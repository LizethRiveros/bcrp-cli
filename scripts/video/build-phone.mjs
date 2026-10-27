/**
 * Builds the "widget on a phone" video (1080x1920): open the link, add it to the home screen, open it as an app,
 * choose what to see. Uses the figures in docs/widget/data.json (run `bun run ask` first for today's data).
 *
 *   node build-phone.mjs               # → media/bcrp-widget-celular-vertical.mp4
 *   node build-phone.mjs --test 3,7,10 # PNG stills of those seconds in .build-phone/
 *
 * Reuses render.js and audio.py of the demo videos. Needs Chrome, ffmpeg (FFMPEG=) and Python with numpy (PYTHON=).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const build = join(here, process.argv.includes("android") ? ".build-phone-android" : ".build-phone");
const i = process.argv.indexOf("--test");
const test = i > -1 ? process.argv[i + 1] : "";
const pi = process.argv.indexOf("--platform");
const plat = pi > -1 ? process.argv[pi + 1] : "ios"; // ios | android
if (!["ios", "android"].includes(plat)) throw new Error("--platform must be ios or android");

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const PYTHON = process.env.PYTHON || "python";
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: build, stdio: "inherit", env: { ...process.env, FFMPEG, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

const raw = JSON.parse(readFileSync(join(root, "docs", "widget", "data.json"), "utf8"));
// the feed carries the text of each figure; the animation also needs the number to count up to
const topics = raw.topics.map((t) => ({ ...t, value: parseFloat(t.display.replace(/[^0-9.]/g, "")) }));
const data = { updated: raw.updated, topics, plat };

mkdirSync(build, { recursive: true });
writeFileSync(join(build, "page.html"), readFileSync(join(here, "phone-animation.html"), "utf8").replace("__DATA__", () => JSON.stringify(data)));
copyFileSync(join(root, "docs", "preguntar", "bcrp-sede.jpg"), join(build, "bg.jpg"));

const render = join(here, "render.js");
if (test) {
  run("node", [render, "test", ...test.split(",")]);
  console.log(`stills in ${build}`);
  process.exit(0);
}
run("node", [render, "full"], { FMT: "" });
run(PYTHON, [join(here, "audio.py")]);
const out = join(root, "media", plat === "android" ? "bcrp-widget-android-vertical.mp4" : "bcrp-widget-celular-vertical.mp4");
run(FFMPEG, ["-y", "-loglevel", "error", "-i", "silent.mp4", "-i", "music.wav",
  "-filter_complex", "[0:v]scale=in_range=full:out_range=tv,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=9[a]",
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
console.log("wrote", out);
