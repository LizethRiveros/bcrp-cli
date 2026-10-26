/**
 * Builds docs/preguntar/index.html: a page for people who don't use a terminal. They type a question
 * ("¿a cuánto está el dólar?") and get the official BCRP figure, its date, a chart and a link to the source.
 *
 *   bun run ask
 *
 * The BCRP API sends no CORS headers, so the browser cannot call it: the data is fetched here, with bcrp itself,
 * and embedded in the page. Aborts without writing anything if any topic cannot be fetched.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSeries } from "../src/api";
import { computeChange, isRateLike } from "../src/calc";
import { fmtNumber } from "../src/format";
import { SHORTCUTS } from "../src/shortcuts";

interface Topic {
  key: keyof typeof SHORTCUTS;
  /** Chip text and question the page answers */
  question: string;
  /** Short name shown above the figure */
  label: string;
  prefix?: string;
  suffix?: string;
  /** Plain-language explanation, written once; it states what the figure is, not how it will move */
  explain: string;
  /** Words people may use to ask for it (lowercase, no accents) */
  keywords: string[];
  /** How many observations to chart */
  last: number;
}

const TOPICS: Topic[] = [
  {
    key: "fx",
    question: "¿A cuánto está el dólar?",
    label: "Dólar",
    prefix: "S/ ",
    explain:
      "Es cuántos soles cuesta un dólar en el mercado entre bancos (interbancario, precio de venta). Bancos y casas de cambio publican su propio precio, un poco distinto.",
    keywords: ["dolar", "dolares", "tipo de cambio", "cambio", "usd", "billete verde", "us$"],
    last: 90,
  },
  {
    key: "euro",
    question: "¿A cuánto está el euro?",
    label: "Euro",
    prefix: "S/ ",
    explain: "Es cuántos soles cuesta un euro según el tipo de cambio de venta que publica el BCRP.",
    keywords: ["euro", "euros", "eur"],
    last: 90,
  },
  {
    key: "inflation",
    question: "¿Cuánto subieron los precios?",
    label: "Inflación",
    suffix: "%",
    explain:
      "Es cuánto subieron los precios de lo que consume una familia en Lima Metropolitana, comparando el último mes con el mismo mes del año anterior.",
    keywords: ["inflacion", "precios", "subieron", "caro", "costo de vida", "ipc", "subida"],
    last: 24,
  },
  {
    key: "rate",
    question: "¿Cuál es la tasa de interés del BCRP?",
    label: "Tasa de referencia",
    suffix: "%",
    explain:
      "Es la tasa que fija el BCRP como guía para el costo del dinero en el país. Los bancos la toman como referencia para sus propias tasas.",
    keywords: ["tasa", "interes", "referencia", "tasa de referencia", "tpm", "prestamos"],
    last: 90,
  },
  {
    key: "reserves",
    question: "¿Cuántas reservas tiene el Perú?",
    label: "Reservas internacionales netas",
    prefix: "US$ ",
    explain:
      "Es el dinero en moneda extranjera y otros activos que guarda el BCRP. La cifra está en millones de dólares.",
    keywords: ["reservas", "rin", "reservas internacionales", "ahorro del pais"],
    last: 90,
  },
  {
    key: "gdp",
    question: "¿Cuánto crece la economía?",
    label: "PBI",
    suffix: "%",
    explain:
      "Es cuánto creció o cayó la producción del país, comparando el último mes con el mismo mes del año anterior.",
    keywords: ["pbi", "economia", "crece", "crecimiento", "produccion", "pib"],
    last: 24,
  },
  {
    key: "unemployment",
    question: "¿Cuánto es el desempleo?",
    label: "Desempleo en Lima",
    suffix: "%",
    explain:
      "Es el porcentaje de personas que buscan trabajo y no lo encuentran en Lima Metropolitana (promedio de los últimos 3 meses).",
    keywords: ["desempleo", "desempleado", "empleo", "trabajo", "desocupacion"],
    last: 24,
  },
  {
    key: "gold",
    question: "¿A cuánto está el oro?",
    label: "Oro",
    prefix: "US$ ",
    explain: "Precio internacional de una onza troy de oro en Londres, en dólares.",
    keywords: ["oro"],
    last: 90,
  },
  {
    key: "copper",
    question: "¿A cuánto está el cobre?",
    label: "Cobre",
    explain: "Precio internacional del cobre en Londres, en centavos de dólar por libra.",
    keywords: ["cobre"],
    last: 90,
  },
  {
    key: "silver",
    question: "¿A cuánto está la plata?",
    label: "Plata",
    prefix: "US$ ",
    explain: "Precio internacional de una onza troy de plata, en dólares.",
    keywords: ["plata"],
    last: 90,
  },
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const topics: unknown[] = [];
let fxRate = 0;
let eurRate = 0;
let fxPeriod = "";

for (const t of TOPICS) {
  // Download history is longer than the chart: ~2 years of daily data, ~10 years of monthly.
  const series = await getSeries({ series: t.key, last: t.last > 30 ? 730 : 120 });
  const all = series.points.filter((p): p is { period: string; value: number } => p.value !== null);
  const obs = all.slice(-t.last);
  const latest = all[all.length - 1];
  if (!latest) throw new Error(`no data for ${t.key}`);
  if (t.key === "fx") {
    fxRate = latest.value;
    fxPeriod = latest.period;
  }
  if (t.key === "euro") eurRate = latest.value;

  const rateLike = isRateLike(series.name);
  const change = computeChange(series.points, "1m", { rateLike });
  const delta = change
    ? {
        up: change.change > 0,
        text: change.changePct === null ? `${fmtNumber(Math.abs(change.change), series.decimals)} puntos` : `${Math.abs(change.changePct).toFixed(2)}%`,
        from: formatPeriod(change.base.period),
      }
    : null;

  topics.push({
    id: t.key,
    question: t.question,
    label: t.label,
    keywords: t.keywords,
    explain: t.explain,
    display: `${t.prefix ?? ""}${fmtNumber(latest.value, series.decimals)}${t.suffix ?? ""}`,
    value: latest.value,
    decimals: series.decimals,
    prefix: t.prefix ?? "",
    suffix: t.suffix ?? "",
    when: formatPeriod(latest.period),
    frequency: series.frequency,
    delta,
    points: obs.map((o) => [formatPeriod(o.period), o.value]),
    rows: all.map((o) => [o.period, o.value]),
    name: series.name,
    code: series.code,
    source: series.source ?? "BCRP",
    apiUrl: `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${series.code}/json`,
  });
  console.log(`${t.key.padEnd(12)} ${`${t.prefix ?? ""}${fmtNumber(latest.value, series.decimals)}${t.suffix ?? ""}`.padStart(14)}  ${latest.period}`);
  await sleep(800); // the BCRP API rejects bursts of requests
}

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, "ask.template.html"), "utf8");
// "<" is escaped so no series name can close the <script> block it is embedded in.
const data = JSON.stringify({ topics, fx: fxRate, euro: eurRate }).replace(/</g, "\\u003c");
const html = template
  .replace("{{DATA}}", () => data)
  .replace("{{UPDATED}}", formatPeriod(fxPeriod || new Date().toISOString().slice(0, 10)));

const outDir = join(here, "..", "docs", "preguntar");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
console.log(`\nwrote docs/preguntar/index.html (${html.length} bytes)`);

// Phone widget: compact tiles for the home screen (docs/widget/) and a JSON feed for Scriptable (docs/widget/data.json).
const widgetTopics = (topics as Record<string, unknown>[]).map((t) => ({
  id: t.id, label: t.label, display: t.display, when: t.when, delta: t.delta,
  spark: (t.points as [string, number][]).slice(-((t.frequency as string)?.toLowerCase().startsWith("d") ? 30 : 12)).map((p) => p[1]),
}));
const widgetTemplate = readFileSync(join(here, "widget.template.html"), "utf8");
const widgetDir = join(here, "..", "docs", "widget");
mkdirSync(widgetDir, { recursive: true });
const updated = formatPeriod(fxPeriod || new Date().toISOString().slice(0, 10));
writeFileSync(
  join(widgetDir, "index.html"),
  widgetTemplate
    .replace("{{DATA}}", () => JSON.stringify(widgetTopics).replace(/</g, "\u003c"))
    .replace("{{UPDATED}}", updated),
);
writeFileSync(join(widgetDir, "data.json"), JSON.stringify({ updated, topics: widgetTopics }, null, 1));
console.log("wrote docs/widget/index.html and data.json");
