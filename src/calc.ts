import type { Point } from "./client";

/** Periods a change can be measured over. `ytd` is "since the end of last year". */
export const OVERS = ["1w", "1m", "3m", "6m", "1y", "ytd"] as const;
export type Over = (typeof OVERS)[number];

export function isOver(s: string): s is Over {
  return (OVERS as readonly string[]).includes(s);
}

/** First day of the period a series label stands for: "2026-09-02", "2026-09", "2026-Q3" or "2026". */
export function periodStart(period: string): Date {
  let m = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  m = period.match(/^(\d{4})-Q([1-4])$/);
  if (m) return new Date(+m[1]!, (+m[2]! - 1) * 3, 1);
  m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(+m[1]!, +m[2]! - 1, 1);
  m = period.match(/^(\d{4})$/);
  if (m) return new Date(+m[1]!, 0, 1);
  throw new Error(`Unrecognized period "${period}"`);
}

/** The date `over` before `date`. Month steps clamp to the end of shorter months (Mar 31 - 1m = Feb 28/29). */
export function shiftBack(date: Date, over: Over): Date {
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const months = (n: number) => {
    const first = new Date(y, mo - n, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(d, lastDay));
  };
  switch (over) {
    case "1w":
      return new Date(y, mo, d - 7);
    case "1m":
      return months(1);
    case "3m":
      return months(3);
    case "6m":
      return months(6);
    case "1y":
      return months(12);
    case "ytd":
      return new Date(y - 1, 11, 31);
  }
}

/** Series that are already rates or percentages: a % change of a % is misleading, so only points are reported. */
export function isRateLike(name: string): boolean {
  return /var%|variaci[oó]n|porcentaje|%|tasa|inter[eé]s|rendimiento/i.test(name);
}

export interface Observation {
  period: string;
  value: number;
}

export interface Change {
  over: Over;
  latest: Observation;
  base: Observation;
  /** latest - base, in the series' own units (points for rates) */
  change: number;
  /** Relative change in %, or null for rate-like series or a zero base */
  changePct: number | null;
}

type Granularity = "day" | "month" | "quarter" | "year";

function granularityOf(period: string): Granularity {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return "day";
  if (/^\d{4}-Q[1-4]$/.test(period)) return "quarter";
  if (/^\d{4}-\d{2}$/.test(period)) return "month";
  return "year";
}

/** A requested period shorter than this is finer than the series itself (e.g. 1 week of a monthly series). */
const MIN_SPAN_DAYS: Record<Granularity, number> = { day: 1, month: 28, quarter: 89, year: 360 };

/** Daily series skip weekends and holidays: accept a base up to this many days before the target date. */
const MAX_DAILY_GAP_DAYS = 7;

function sameBucket(a: Date, b: Date, g: Granularity): boolean {
  if (a.getFullYear() !== b.getFullYear()) return false;
  if (g === "year") return true;
  if (g === "quarter") return Math.floor(a.getMonth() / 3) === Math.floor(b.getMonth() / 3);
  return a.getMonth() === b.getMonth();
}

const DAY_MS = 86_400_000;

/**
 * Change between the most recent observation and the one `over` earlier.
 *
 * Daily series use the last observation at or before the target date (weekends, holidays). Monthly, quarterly and
 * annual series need an observation in exactly the target month/quarter/year. Returns undefined when there is none,
 * or when `over` is shorter than the series' own frequency, rather than comparing the wrong periods.
 */
export function computeChange(points: Point[], over: Over, { rateLike = false } = {}): Change | undefined {
  const obs = points
    .filter((p): p is Observation => p.value !== null)
    .sort((a, b) => a.period.localeCompare(b.period));
  const latest = obs[obs.length - 1];
  if (!latest) return undefined;

  const granularity = granularityOf(latest.period);
  const latestStart = periodStart(latest.period);
  const target = shiftBack(latestStart, over);
  if (Math.round((latestStart.getTime() - target.getTime()) / DAY_MS) < MIN_SPAN_DAYS[granularity]) return undefined;

  let base: Observation | undefined;
  if (granularity === "day") {
    for (const o of obs) {
      if (periodStart(o.period) <= target) base = o;
      else break;
    }
    if (base && (target.getTime() - periodStart(base.period).getTime()) / DAY_MS > MAX_DAILY_GAP_DAYS) base = undefined;
  } else {
    base = obs.find((o) => sameBucket(periodStart(o.period), target, granularity));
  }
  if (!base || base.period === latest.period) return undefined;

  const change = latest.value - base.value;
  const changePct = rateLike || base.value === 0 ? null : (change / Math.abs(base.value)) * 100;
  return { over, latest, base, change, changePct };
}

export type Currency = "usd" | "pen";

/** Converts using a S/ per US$ rate. */
export function convertAmount(amount: number, from: Currency, rate: number): number {
  return from === "usd" ? amount * rate : amount / rate;
}
