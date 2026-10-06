/**
 * Builds docs/index.html: a static page with today's headline indicators, fetched with bcrp itself.
 *
 *   bun run demo
 *
 * Aborts without writing anything if any indicator cannot be fetched, so a half-empty page is never published.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSeries } from "../src/api";
import { computeChange, isRateLike } from "../src/calc";
import { fmtNumber } from "../src/format";
import { SHORTCUTS } from "../src/shortcuts";

interface CardSpec {
  key: keyof typeof SHORTCUTS;
  label: string;
  what: string;
  prefix?: string;
  suffix?: string;
}

const CARDS: CardSpec[] = [
  { key: "fx", label: "Dólar", what: "Tipo de cambio interbancario venta (S/ por US$)", prefix: "S/ " },
  { key: "inflation", label: "Inflación", what: "Variación en 12 meses, Lima Metropolitana", suffix: "%" },
  { key: "rate", label: "Tasa de referencia", what: "Política monetaria del BCRP", suffix: "%" },
  { key: "reserves", label: "Reservas internacionales", what: "Netas, millones de US$", prefix: "US$ " },
  { key: "gdp", label: "PBI", what: "Variación interanual", suffix: "%" },
  { key: "copper", label: "Cobre", what: "Londres, ¢US$ por libra" },
  { key: "gold", label: "Oro", what: "Londres, US$ por onza troy", prefix: "US$ " },
];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatPeriod(period: string): string {
  let m = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = period.match(/^(\d{4})-Q([1-4])$/);
  if (m) return `T${m[2]} ${m[1]}`;
  m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Polyline points for a 100x30 viewBox. */
function sparkPoints(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = max === min ? 15 : 28 - ((v - min) / (max - min)) * 26;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cards: string[] = [];
let fxValue = 0;
let latestDate = "";

for (const spec of CARDS) {
  const series = await getSeries({ series: spec.key, last: 40 });
  const obs = series.points.filter((p): p is { period: string; value: number } => p.value !== null);
  const latest = obs[obs.length - 1];
  if (!latest) throw new Error(`no data for ${spec.key}`);
  if (spec.key === "fx") fxValue = latest.value;
  if (latest.period > latestDate && /^\d{4}-\d{2}-\d{2}$/.test(latest.period)) latestDate = latest.period;

  const change = computeChange(series.points, "1m", { rateLike: isRateLike(series.name) });
  let delta = "";
  if (change) {
    const up = change.change > 0;
    const arrow = change.change === 0 ? "—" : up ? "▲" : "▼";
    const sign = up ? "+" : "";
    const amount =
      change.changePct === null
        ? `${sign}${fmtNumber(change.change, series.decimals)} pts`
        : `${sign}${change.changePct.toFixed(2)}%`;
    delta = `<div class="delta">${arrow} ${amount} en 1 mes</div>`;
  }

  const spark = obs.slice(-30).map((o) => o.value);
  const svg =
    spark.length >= 2
      ? `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPoints(spark)}"/></svg>`
      : "";

  const display = `${spec.prefix ?? ""}${fmtNumber(latest.value, series.decimals)}${spec.suffix ?? ""}`;
  cards.push(
    [
      `      <article class="card">`,
      `        <h3>${escapeHtml(spec.label)}</h3>`,
      `        <p class="what">${escapeHtml(spec.what)}</p>`,
      `        <div class="value">${escapeHtml(display)}</div>`,
      `        <div class="when">${escapeHtml(formatPeriod(latest.period))}</div>`,
      `        ${delta}`,
      `        ${svg}`,
      `        <div class="src">Fuente: ${escapeHtml(series.source ?? "BCRP")} · <code>${series.code}</code></div>`,
      `      </article>`,
    ].join("\n"),
  );
  console.log(`${spec.key.padEnd(10)} ${display.padStart(14)}  ${latest.period}`);
  await sleep(800); // the BCRP API rejects bursts of requests
}

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, "demo.template.html"), "utf8");
const html = template
  .replace("{{CARDS}}", cards.join("\n"))
  .replace("{{UPDATED}}", formatPeriod(latestDate || new Date().toISOString().slice(0, 10)))
  .replace("{{CONVERT}}", (fxValue * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const outDir = join(here, "..", "docs");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
writeFileSync(join(outDir, ".nojekyll"), "");
console.log(`\nwrote docs/index.html (${html.length} bytes)`);
