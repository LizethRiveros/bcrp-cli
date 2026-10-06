import { type LatestResult, frequencyFor, getLatest, getSeries } from "./api";
import { BcrpError } from "./client";
import { type Change, type Currency, type Over, computeChange, convertAmount, isRateLike, shiftBack } from "./calc";
import { type Frequency, dateFromInput } from "./dates";
import { resolveCode } from "./shortcuts";

/** Extra days of history requested before the target date, because series are published with a lag. */
const SLACK_DAYS: Record<Frequency, number> = { daily: 10, monthly: 70, quarterly: 200, annual: 400 };

const DEFAULT_OVER: Record<Frequency, Over> = { daily: "1m", monthly: "1m", quarterly: "1y", annual: "1y" };

export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface ChangeResult extends Change {
  code: string;
  name: string;
  frequency: Frequency;
  decimals: number;
  source?: string;
}

/** How much a series changed between its latest observation and `over` earlier (default 1m, or 1y for slow series). */
export async function getChange(input: string, over?: Over, fetchImpl?: typeof fetch): Promise<ChangeResult> {
  const code = resolveCode(input);
  const frequency = frequencyFor(code);
  const chosen = over ?? DEFAULT_OVER[frequency];

  const start = shiftBack(new Date(), chosen);
  start.setDate(start.getDate() - SLACK_DAYS[frequency]);
  const series = await getSeries({ series: code, from: isoDate(start) }, fetchImpl);

  const result = computeChange(series.points, chosen, { rateLike: isRateLike(series.name) });
  if (!result) {
    throw new BcrpError(
      `Cannot compute a ${chosen} change for ${code} (${frequency}): not enough history, or the observations are ` +
        "too far apart for that period. Try a longer --over.",
      code,
    );
  }
  return {
    ...result,
    code,
    name: series.name,
    frequency,
    decimals: series.decimals,
    ...(series.source ? { source: series.source } : {}),
  };
}

/** USD/PEN interbank reference rates (S/ per US$). */
const FX_SIDES = { sell: "PD04638PD", buy: "PD04637PD" } as const;
export type FxSide = keyof typeof FX_SIDES;

export interface Conversion {
  amount: number;
  from: Currency;
  to: Currency;
  result: number;
  rate: number;
  ratePeriod: string;
  side: FxSide;
  series: string;
  source?: string;
}

/** Converts between USD and PEN with the BCRP interbank rate of today (latest published) or of `date`. */
export async function convertCurrency(
  opts: { amount: number; from: Currency; date?: string; side?: FxSide },
  fetchImpl?: typeof fetch,
): Promise<Conversion> {
  const { amount, from, date, side = "sell" } = opts;
  if (!Number.isFinite(amount)) throw new BcrpError("The amount must be a number");
  const series = FX_SIDES[side];

  let rate: number;
  let ratePeriod: string;
  let source: string | undefined;
  if (date) {
    const end = dateFromInput(date, "to");
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 10);
    const s = await getSeries({ series, from: isoDate(start), to: isoDate(end) }, fetchImpl);
    const last = [...s.points].reverse().find((p) => p.value !== null);
    if (!last) throw new BcrpError(`No exchange rate published on or shortly before ${date}`, series);
    rate = last.value!;
    ratePeriod = last.period;
    source = s.source;
  } else {
    const l: LatestResult = await getLatest(series, fetchImpl);
    rate = l.value;
    ratePeriod = l.period;
    source = l.source;
  }

  return {
    amount,
    from,
    to: from === "usd" ? "pen" : "usd",
    result: convertAmount(amount, from, rate),
    rate,
    ratePeriod,
    side,
    series,
    ...(source ? { source } : {}),
  };
}

export interface ThresholdCheck {
  code: string;
  name: string;
  period: string;
  value: number;
  op: "above" | "below";
  threshold: number;
  triggered: boolean;
}

/** Is the latest value of a series above/below a threshold? Meant for scripts and schedulers (see exit codes). */
export async function checkThreshold(
  input: string,
  cond: { above?: number; below?: number },
  fetchImpl?: typeof fetch,
): Promise<ThresholdCheck> {
  const hasAbove = cond.above !== undefined;
  const hasBelow = cond.below !== undefined;
  if (hasAbove === hasBelow) throw new BcrpError("Pass exactly one of --above or --below");
  const op = hasAbove ? "above" : "below";
  const threshold = (hasAbove ? cond.above : cond.below)!;
  if (!Number.isFinite(threshold)) throw new BcrpError("The threshold must be a number");

  const l = await getLatest(input, fetchImpl);
  return {
    code: l.code,
    name: l.name,
    period: l.period,
    value: l.value,
    op,
    threshold,
    triggered: op === "above" ? l.value > threshold : l.value < threshold,
  };
}
