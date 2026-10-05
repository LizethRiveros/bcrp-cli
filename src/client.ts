const BASE = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";

export interface Point {
  /** ISO date (YYYY-MM-DD) for daily series, YYYY-MM for monthly, YYYY for annual; raw label otherwise */
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

/** "01.Set.26" -> "2026-09-01", "Set.2026" -> "2026-09", "2026" -> "2026"; unknown labels pass through. */
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
  return label;
}

function fullYear(y: string): string {
  return y.length === 2 ? `20${y}` : y;
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

export async function fetchSeries(
  code: string,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Series> {
  const url = `${BASE}/${encodeURIComponent(code)}/json/${from}/${to}/ing`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`BCRP API error ${res.status} for ${code}`);
  const text = await res.text();
  let raw: RawResponse;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Series "${code}" not found or invalid date range`);
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
