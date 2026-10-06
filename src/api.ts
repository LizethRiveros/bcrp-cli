import { BcrpError, fetchSeries, fetchSeriesSet, type Series } from "./client";
import { type CatalogEntry, findByCode, loadCatalog, searchCatalog } from "./catalog";
import { type Frequency, dateFromInput, frequencyFromCode, rangeBack, toApiDate } from "./dates";
import { SHORTCUTS, resolveCode, shortcutName } from "./shortcuts";

/** High-level operations shared by the CLI and the MCP server. */

const CODE_RE = /^[A-Z]{2}\d{4,6}[A-Z]{2}$/;

const DEFAULT_COUNT: Record<Frequency, number> = { daily: 30, monthly: 12, quarterly: 8, annual: 10 };
const LATEST_WINDOW: Record<Frequency, number> = { daily: 10, monthly: 14, quarterly: 8, annual: 6 };
/** The BCRP publishes with a lag, so a "last N" window needs extra periods that are then trimmed. */
const LAG_SLACK: Record<Frequency, number> = { daily: 10, monthly: 4, quarterly: 3, annual: 3 };

export interface SeriesQuery {
  /** Series code (PD04638PD) or shortcut name (fx, inflation, ...) */
  series: string;
  from?: string;
  to?: string;
  /** Keep only the last N observations */
  last?: number;
}

export interface SeriesResult extends Series {
  frequency: Frequency;
  /** Range actually requested from the API */
  from: string;
  to: string;
}

export interface LatestResult {
  code: string;
  name: string;
  frequency: Frequency;
  period: string;
  value: number;
  decimals: number;
}

export function isSeriesInput(input: string): boolean {
  return shortcutName(input) !== undefined || CODE_RE.test(input.trim().toUpperCase());
}

function frequencyFor(code: string): Frequency {
  const f = frequencyFromCode(code) ?? findByCode(loadCatalog().entries, code)?.frequency;
  if (!f || (!CODE_RE.test(code) && !findByCode(loadCatalog().entries, code))) {
    throw new BcrpError(
      `"${code}" is not a known series code or shortcut. Shortcuts: ${Object.keys(SHORTCUTS).join(", ")}. ` +
        "Use `bcrp search <text>` to find a series code.",
      code,
    );
  }
  return f;
}

/** The API date range to request for a query: explicit bounds if given, otherwise a window ending today. */
function windowFor(frequency: Frequency, q: Omit<SeriesQuery, "series">): { from: string; to: string } {
  const end = q.to ? dateFromInput(q.to, "to") : new Date();
  const count = q.last ? q.last + LAG_SLACK[frequency] : DEFAULT_COUNT[frequency];
  const window = rangeBack(frequency, count, end);
  return {
    from: q.from ? toApiDate(q.from, frequency, "from") : window.from,
    to: q.to ? toApiDate(q.to, frequency, "to") : window.to,
  };
}

export async function getSeries(q: SeriesQuery, fetchImpl?: typeof fetch): Promise<SeriesResult> {
  const code = resolveCode(q.series);
  const frequency = frequencyFor(code);
  const { from, to } = windowFor(frequency, q);
  const series = await fetchSeries(code, from, to, fetchImpl);
  let points = series.points;
  if (!q.to) {
    // The API lists periods up to today even when nothing is published yet: drop that unpublished tail.
    let end = points.length;
    while (end > 0 && points[end - 1]!.value === null) end--;
    points = points.slice(0, end);
  }
  if (q.last) points = points.slice(-q.last);
  return { ...series, points, frequency, from, to };
}

export async function getLatest(input: string, fetchImpl?: typeof fetch): Promise<LatestResult> {
  const code = resolveCode(input);
  const frequency = frequencyFor(code);
  const { from, to } = rangeBack(frequency, LATEST_WINDOW[frequency]);
  const series = await fetchSeries(code, from, to, fetchImpl);
  const last = [...series.points].reverse().find((p) => p.value !== null);
  if (!last) throw new BcrpError(`No recent data for ${code} (${series.name})`, code);
  return {
    code,
    name: series.name,
    frequency,
    period: last.period,
    value: last.value!,
    decimals: series.decimals,
  };
}

export function searchSeries(
  query: string,
  opts: { frequency?: Frequency; limit?: number } = {},
): CatalogEntry[] {
  return searchCatalog(loadCatalog().entries, query, opts);
}

export interface SeriesInfo extends Partial<CatalogEntry> {
  code: string;
  frequency: Frequency;
  shortcut?: string;
  apiUrl: string;
}

export function describeSeries(input: string): SeriesInfo {
  const code = resolveCode(input);
  const frequency = frequencyFor(code);
  const entry = findByCode(loadCatalog().entries, code);
  const shortcut = Object.entries(SHORTCUTS).find(([, s]) => s.code === code)?.[0];
  return {
    ...entry,
    code,
    frequency,
    ...(shortcut ? { shortcut } : {}),
    apiUrl: `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${code}/json`,
  };
}

export interface CompareResult {
  frequency: Frequency;
  series: { code: string; name: string; decimals: number }[];
  /** One row per period, with one value per series in the same order as `series` */
  rows: { period: string; values: (number | null)[] }[];
}

const MAX_COMPARE = 6;

/** The series name the API reports for a catalog entry: "<group> - <name>". */
function apiName(e: CatalogEntry): string {
  return `${e.group} - ${e.name}`;
}

/**
 * Fetches several same-frequency series in ONE request and returns them in the order of `codes`.
 *
 * The API returns series in its own order and identifies them only by name, so each one is matched back to its code
 * through the catalog. If that match is not certain (unknown code, repeated names, unexpected response), it falls
 * back to one request per series rather than risk assigning values to the wrong series.
 */
async function fetchMany(codes: string[], from: string, to: string, fetchImpl?: typeof fetch): Promise<Series[]> {
  const catalog = loadCatalog().entries;
  const names = codes.map((c) => {
    const e = findByCode(catalog, c);
    return e ? apiName(e) : undefined;
  });

  if (names.every((n): n is string => n !== undefined) && new Set(names).size === codes.length) {
    const set = await fetchSeriesSet(codes, from, to, fetchImpl);
    const order = names.map((n) => set.series.findIndex((s) => s.name === n));
    if (set.series.length === codes.length && order.every((i) => i >= 0) && new Set(order).size === codes.length) {
      return codes.map((code, i) => {
        const s = set.series[order[i]!]!;
        return { code, title: set.title, name: s.name, decimals: s.decimals, points: s.points };
      });
    }
  }

  // Not certain which series is which: ask for them one at a time (sequentially, to avoid the anti-bot filter).
  const out: Series[] = [];
  for (const code of codes) out.push(await fetchSeries(code, from, to, fetchImpl));
  return out;
}

/** Fetches several series of the same frequency and aligns them by period. */
export async function compareSeries(
  inputs: string[],
  q: Omit<SeriesQuery, "series"> = {},
  fetchImpl?: typeof fetch,
): Promise<CompareResult> {
  const codes = [...new Set(inputs.map((i) => resolveCode(i)))];
  if (codes.length < 2) throw new BcrpError("compare needs at least two different series");
  if (codes.length > MAX_COMPARE) throw new BcrpError(`compare supports up to ${MAX_COMPARE} series`);

  const frequencies = codes.map((c) => frequencyFor(c));
  const frequency = frequencies[0]!;
  const other = frequencies.findIndex((f) => f !== frequency);
  if (other >= 0) {
    throw new BcrpError(
      `Cannot compare series of different frequencies: ${codes[0]} is ${frequency} but ${codes[other]} is ${frequencies[other]}. ` +
        "Pick series with the same frequency (see `bcrp search --freq`).",
    );
  }

  const { from, to } = windowFor(frequency, q);
  const results = await fetchMany(codes, from, to, fetchImpl);

  const byPeriod = new Map<string, (number | null)[]>();
  results.forEach((r, i) => {
    for (const p of r.points) {
      const row = byPeriod.get(p.period) ?? results.map(() => null as number | null);
      row[i] = p.value;
      byPeriod.set(p.period, row);
    }
  });
  let rows = [...byPeriod].sort(([a], [b]) => a.localeCompare(b)).map(([period, values]) => ({ period, values }));
  if (!q.to) {
    // Drop the unpublished tail: trailing periods where no series has a value yet.
    let end = rows.length;
    while (end > 0 && rows[end - 1]!.values.every((v) => v === null)) end--;
    rows = rows.slice(0, end);
  }
  if (q.last) rows = rows.slice(-q.last);

  return {
    frequency,
    series: results.map((r) => ({ code: r.code, name: r.name, decimals: r.decimals })),
    rows,
  };
}
