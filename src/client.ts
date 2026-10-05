const BASE = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";

export interface Point {
  /** YYYY-MM-DD (daily), YYYY-MM (monthly), YYYY-Qn (quarterly), YYYY (annual); raw label if unrecognized */
  period: string;
  value: number | null;
}

export interface Series {
  code: string;
  title: string;
  name: string;
  decimals: number;
  points: Point[];
}

const MONTHS: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", set: "09", sep: "09", oct: "10", nov: "11", dic: "12",
  jan: "01", apr: "04", aug: "08", dec: "12",
};

function fullYear(y: string): string {
  return y.length === 2 ? `20${y}` : y;
}

/**
 * Normalizes the period labels the API returns:
 * "01.Set.26" -> "2026-09-01", "Jan.2025" -> "2025-01", "Q1.24"/"T1.24" -> "2024-Q1", "2024" -> "2024".
 * Unknown labels pass through unchanged.
 */
export function normalizePeriod(label: string): string {
  const daily = label.match(/^(\d{1,2})\.([A-Za-z]{3})\.(\d{2,4})$/);
  if (daily) {
    const m = MONTHS[daily[2]!.toLowerCase()];
    if (m) return `${fullYear(daily[3]!)}-${m}-${daily[1]!.padStart(2, "0")}`;
  }
  const monthly = label.match(/^([A-Za-z]{3})\.(\d{2,4})$/);
  if (monthly) {
    const m = MONTHS[monthly[1]!.toLowerCase()];
    if (m) return `${fullYear(monthly[2]!)}-${m}`;
  }
  const quarterly = label.match(/^[QqTt]([1-4])\.(\d{2,4})$/);
  if (quarterly) return `${fullYear(quarterly[2]!)}-Q${quarterly[1]}`;
  return label;
}

export function parseValue(raw: string | undefined): number | null {
  if (raw === undefined || raw === "" || raw === "n.d.") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface RawResponse {
  config: { title: string; series: { name: string; dec: string }[] };
  periods: { name: string; values: string[] }[];
}

export class BcrpError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "BcrpError";
  }
}

export async function fetchSeries(
  code: string,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Series> {
  const url = `${BASE}/${encodeURIComponent(code)}/json/${from}/${to}/ing`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": "bcrp-cli (+https://github.com/LizethRiveros/bcrp-cli)" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new BcrpError(`Could not reach the BCRP API: ${e instanceof Error ? e.message : e}`, code);
  }
  if (!res.ok) throw new BcrpError(`BCRP API error ${res.status} for ${code}`, code);
  const text = await res.text();
  let raw: RawResponse;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BcrpError(
      `Series "${code}" not found, or the date range ${from} to ${to} is not valid for it. Try \`bcrp search\` to find series codes.`,
      code,
    );
  }
  const s = raw.config.series[0];
  return {
    code,
    title: raw.config.title,
    name: s?.name ?? code,
    decimals: Number(s?.dec ?? 2),
    points: raw.periods.map((p) => ({
      period: normalizePeriod(p.name),
      value: parseValue(p.values[0]),
    })),
  };
}
