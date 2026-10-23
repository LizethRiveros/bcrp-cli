// Renders page.html (built by build.mjs) frame by frame with headless Chrome and pipes the frames to ffmpeg.
// Run from the .build directory:  FMT=h node ../render.js full      (FMT=h → 1920x1080, otherwise 1080x1920)
//                                 node ../render.js test 2 9 17     (PNG stills at those seconds)
// Env: CHROME (path to chrome), FFMPEG (path to ffmpeg).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CHROME =
  process.env.CHROME ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const horizontal = process.env.FMT === "h";

(async () => {
  if (!CHROME) throw new Error("Chrome not found: set CHROME=/path/to/chrome");
  const mode = process.argv[2];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
    defaultViewport: horizontal ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto("file:///" + path.resolve("page.html").split(path.sep).join("/") + (horizontal ? "?h" : ""), { waitUntil: "networkidle0" });
  await page.evaluate(async () => {
    const fonts = ["300 100px Fraunces", "italic 300 100px Fraunces", "400 40px Inter", "600 40px Inter", "500 30px 'JetBrains Mono'", "700 30px 'JetBrains Mono'", "400 30px 'JetBrains Mono'"];
    await Promise.all(fonts.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  });
  const duration = await page.evaluate(() => window.DURATION);
  fs.writeFileSync("clicks.json", JSON.stringify(await page.evaluate(() => window.CLICKS)));

  if (mode === "test") {
    for (const t of process.argv.slice(3).map(Number)) {
      await page.evaluate((s) => window.seek(s), t);
      await page.screenshot({ path: `t_${t}.png` });
    }
  } else {
    const fps = 30;
    const total = Math.round(duration * fps);
    const out = horizontal ? "silent_h.mp4" : "silent.mp4";
    const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", out], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    for (let i = 0; i < total; i++) {
      await page.evaluate((s) => window.seek(s), i / fps);
      const buf = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i % 60 === 0) console.log("frame", i, "/", total);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
  }
  await browser.close();
})();
