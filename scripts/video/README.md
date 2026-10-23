# Demo videos

Generator for the animated demos in `media/` (text that types itself, smooth motion, music). It is a dev tool: it is not part of the published npm package.

## What it makes

| Command | Output |
| --- | --- |
| `node build.mjs` | `media/bcrp-demo-no-tech-vertical.mp4` (1080×1920, Instagram) and `…-horizontal.mp4` (1920×1080, LinkedIn), light theme |
| `node build.mjs --theme dark` | the same two files with a `-dark` suffix |
| `node build.mjs --format vertical` | only one format (`vertical` or `horizontal`) |
| `node build.mjs --test 2,9,17` | PNG stills of those seconds in `.build/`, no video (fast way to check a change) |

26 seconds: the question types itself → the answer (figure, date, chart with max/min) → «Sin inventar. Solo el dato oficial del BCRP.» → «¿Programas?» with the terminal → closing card.

## Requirements

- Node 18+ and `npm install` inside this folder (only `puppeteer-core`; it uses your Chrome).
- Chrome. If it is not in a standard place: `CHROME=/path/to/chrome`.
- `ffmpeg` on the PATH, or `FFMPEG=/path/to/ffmpeg`.
- Python 3 with `numpy` (`PYTHON=…` to choose the interpreter).

## How it works

- **Data:** `build.mjs` reads the dollar topic from `docs/preguntar/index.html`, so the figures are the ones on the page. Run `bun run ask` first if you want today's data.
- **Animation:** `animation.html` (light) and `animation.dark.html` are one page each with a `seek(t)` function that draws any instant. `render.js` calls it for every frame of a 30 fps timeline and pipes the screenshots to ffmpeg. All timings (when each letter appears, when each block enters) are constants at the top of the script.
- **Layouts:** the horizontal one is the same page with the `h` class (two-column answer card), selected by `?h`.
- **Music:** `audio.py` synthesizes an original track (pad, bass, arpeggio, light drums, no samples) and the keyboard clicks at the exact typing times the page reported in `clicks.json`. To use another song, skip `audio.py` and mux your own audio.
- **Background photo:** `docs/preguntar/bcrp-sede.jpg` (AlejandroFC, CC BY-SA 4.0, see the credit in the page footer).

## Notes

- The text inside the page is Spanish and written for the dollar figure; to change a phrase, edit the `typer("…")` lines in the `.html`.
- Videos are re-encoded each run, so the binary files change even when nothing else did. Commit them only when you mean to publish a new cut.
