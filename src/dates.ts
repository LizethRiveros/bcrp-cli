export type Frequency = "daily" | "monthly" | "quarterly" | "annual";

export const FREQUENCIES: Frequency[] = ["daily", "monthly", "quarterly", "annual"];

const SPANISH: Record<string, Frequency> = {
  diaria: "daily",
  mensual: "monthly",
  trimestral: "quarterly",
  anual: "annual",
};

/** Accepts English ("daily") or Spanish ("diaria") frequency names. */
export function parseFrequency(input: string): Frequency | undefined {
  const s = input.trim().toLowerCase();
  return (FREQUENCIES as string[]).includes(s) ? (s as Frequency) : SPANISH[s];
}

const BY_SUFFIX: Record<string, Frequency> = {
  D: "daily",
  M: "monthly",
  Q: "quarterly",
  A: "annual",
};

/** BCRP series codes end with a letter that encodes the frequency (PD04638PD -> D). */
export function frequencyFromCode(code: string): Frequency | undefined {
  return BY_SUFFIX[code.trim().toUpperCase().slice(-1)];
}

interface Parts {
  year: number;
  month?: number;
  day?: number;
  quarter?: number;
}

const DATE_HINT = "Use YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn";

export function parseDateInput(input: string): Parts {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const parts = { year: +m[1]!, month: +m[2]!, day: +m[3]! };
    check(parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= 31, input);
    return parts;
  }
  m = s.match(/^(\d{4})-[Qq]([1-4])$/) ?? s.match(/^[QqTt]([1-4])-(\d{4})$/);
  if (m) {
    const swapped = m[2]!.length === 4;
    return { year: +(swapped ? m[2]! : m[1]!), quarter: +(swapped ? m[1]! : m[2]!) };
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const month = +m[2]!;
    check(month >= 1 && month <= 12, input);
    return { year: +m[1]!, month };
  }
  m = s.match(/^(\d{4})$/);
  if (m) return { year: +m[1]! };
  throw new Error(`Invalid date "${input}". ${DATE_HINT}`);
}

function check(ok: boolean, input: string) {
  if (!ok) throw new Error(`Invalid date "${input}". ${DATE_HINT}`);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Converts a user date into the format the BCRP API expects for a given frequency. */
export function toApiDate(input: string, freq: Frequency, edge: "from" | "to"): string {
  const p = parseDateInput(input);
  const first = edge === "from";
  const month =
    p.month ?? (p.quarter ? (first ? (p.quarter - 1) * 3 + 1 : p.quarter * 3) : first ? 1 : 12);
  switch (freq) {
    case "annual":
      return String(p.year);
    case "quarterly":
      return `${p.year}-${p.quarter ?? Math.ceil(month / 3)}`;
    case "monthly":
      return `${p.year}-${month}`;
    case "daily":
      return `${p.year}-${month}-${p.day ?? (first ? 1 : daysInMonth(p.year, month))}`;
  }
}

/** A window ending now that covers at least `count` observations of the given frequency. */
export function rangeBack(
  freq: Frequency,
  count: number,
  now: Date = new Date(),
): { from: string; to: string } {
  const n = Math.max(1, Math.floor(count));
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  switch (freq) {
    case "daily": {
      const days = Math.ceil((n * 7) / 5) + 4; // business days -> calendar days, plus slack
      const start = new Date(now.getTime() - days * 86_400_000);
      return { from: ymd(start), to: ymd(now) };
    }
    case "monthly": {
      const t = y * 12 + (m - 1) - (n - 1);
      return { from: `${Math.floor(t / 12)}-${(t % 12) + 1}`, to: `${y}-${m}` };
    }
    case "quarterly": {
      const q = Math.floor((m - 1) / 3) + 1;
      const t = y * 4 + (q - 1) - (n - 1);
      return { from: `${Math.floor(t / 4)}-${(t % 4) + 1}`, to: `${y}-${q}` };
    }
    case "annual":
      return { from: String(y - (n - 1)), to: String(y) };
  }
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The calendar date a user input stands for: first day of the period for "from", last day for "to". */
export function dateFromInput(input: string, edge: "from" | "to"): Date {
  const p = parseDateInput(input);
  const first = edge === "from";
  const month =
    p.month ?? (p.quarter ? (first ? (p.quarter - 1) * 3 + 1 : p.quarter * 3) : first ? 1 : 12);
  return new Date(p.year, month - 1, p.day ?? (first ? 1 : daysInMonth(p.year, month)));
}
