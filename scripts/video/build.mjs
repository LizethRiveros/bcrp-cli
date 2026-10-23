/**
 * Builds the animated demo videos (typing, smooth motion, music) with today's data from docs/preguntar/index.html.
 *
 *   cd scripts/video && npm install
 *   node build.mjs                          # light theme, both formats  → media/bcrp-demo-no-tech-{vertical,horizontal}.mp4
 *   node build.mjs --theme dark             # dark theme                 → media/bcrp-demo-no-tech-dark-*.mp4
 *   node build.mjs --format vertical        # only 1080x1920 (Instagram); "horizontal" = 1920x1080 (LinkedIn)
 *   node build.mjs --test 2,9,17            # only PNG stills of those seconds in .build/, no video
 *
 * Needs: Node 18+, Chrome (CHROME=...), ffmpeg (FFMPEG=...), Python 3 with numpy (PYTHON=...).
 * Run `bun run ask` first when the data changed, so docs/preguntar/index.html has the latest figures.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const build = join(here, ".build");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const theme = arg("theme", "light");
const format = arg("format", "both");
const test = arg("test", "");
if (!["light", "dark"].includes(theme)) throw new Error("--theme must be light or dark");
if (!["both", "vertical", "horizontal"].includes(format)) throw new Error("--format must be both, vertical or horizontal");

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const PYTHON = process.env.PYTHON || "python";
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: build, stdio: "inherit", env: { ...process.env, FFMPEG, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

// ---- data: the dollar topic of the no-tech page ----
const page = readFileSync(join(root, "docs", "preguntar", "index.html"), "utf8");
const m = page.match(/var DATA = (.*?);\r?\n/);
if (!m) throw new Error("DATA not found in docs/preguntar/index.html (run `bun run ask`)");
const fx = JSON.parse(m[1]).topics.find((t) => t.id === "fx");
if (!fx) throw new Error("fx topic not found");
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const [d, mon, y] = fx.when.split(" ");
const iso = `${y}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
const data = {
  display: fx.display, when: fx.when, delta: fx.delta, value: fx.value, points: fx.points,
  code: fx.code, source: fx.source, decimals: fx.decimals, name: fx.name, frequency: fx.frequency, iso,
};

mkdirSync(build, { recursive: true });
const template = theme === "dark" ? "animation.dark.html" : "animation.html";
writeFileSync(join(build, "page.html"), readFileSync(join(here, template), "utf8").replace("__DATA__", () => JSON.stringify(data)));
copyFileSync(join(root, "docs", "preguntar", "bcrp-sede.jpg"), join(build, "bg.jpg"));

const render = join(here, "render.js");
if (test) {
  run("node", [render, "test", ...test.split(",")], format === "horizontal" ? { FMT: "h" } : {});
  console.log(`stills in ${build}`);
  process.exit(0);
}

const jobs = [];
if (format !== "horizontal") jobs.push({ name: "vertical", fmt: "", silent: "silent.mp4" });
if (format !== "vertical") jobs.push({ name: "horizontal", fmt: "h", silent: "silent_h.mp4" });

for (const job of jobs) run("node", [render, "full"], job.fmt ? { FMT: job.fmt } : { FMT: "" });
run(PYTHON, [join(here, "audio.py")]); // reads clicks.json (typing times) and writes music.wav

const suffix = theme === "dark" ? "-dark" : "";
for (const job of jobs) {
  const out = join(root, "media", `bcrp-demo-no-tech${suffix}-${job.name}.mp4`);
  // loudnorm to -16 LUFS; limited-range bt709 so every player shows the same colors
  run(FFMPEG, ["-y", "-loglevel", "error", "-i", job.silent, "-i", "music.wav",
    "-filter_complex", "[0:v]scale=in_range=full:out_range=tv,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=9[a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
  console.log("wrote", out);
}
