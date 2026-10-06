import type { CompareResult, LatestResult, SeriesInfo, SeriesResult } from "./api";
import type { CatalogEntry } from "./catalog";
import { SHORTCUTS } from "./shortcuts";

export function fmtNumber(value: number | null, decimals: number): string {
  if (value === null) return "n.d.";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

export function renderTable(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const pad = (s: string, i: number) => (rightAlign.includes(i) ? s.padStart(widths[i]!) : s.padEnd(widths[i]!));
  const line = (cells: string[]) => cells.map(pad).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "─".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatSeries(s: SeriesResult): string {
  if (s.points.length === 0) {
    return `${s.name}\n${s.code} · ${s.frequency}\n\nNo observations between ${s.from} and ${s.to}.`;
  }
  const rows = s.points.map((p) => [p.period, fmtNumber(p.value, s.decimals)]);
  return [
    `${s.name}`,
    `${s.code} · ${s.frequency} · ${s.points.length} observations`,
    ...(trendLine(s) ? ["", trendLine(s)] : []),
    "",
    renderTable(["PERIOD", "VALUE"], rows, [1]),
  ].join("\n");
}

export function formatLatest(l: LatestResult): string {
  return `${l.name}\n${l.code} · ${l.frequency}\n\n${l.period}  ${fmtNumber(l.value, l.decimals)}`;
}

export function formatSearch(entries: CatalogEntry[], width = process.stdout.columns || 100): string {
  if (entries.length === 0) return "No series found.";
  const fixed = 9 + 9 + 2 + 2 + 2 + 2 + 21; // code + freq + range + separators
  const nameWidth = Math.max(30, width - fixed);
  const rows = entries.map((e) => [
    e.code,
    e.frequency,
    truncate(e.group && e.group !== e.name ? `${e.name} · ${e.group}` : e.name, nameWidth),
    `${e.start} → ${e.end}`,
  ]);
  return renderTable(["CODE", "FREQ", "SERIES", "RANGE"], rows);
}

export function formatInfo(i: SeriesInfo): string {
  const rows: [string, string | undefined][] = [
    ["Code", i.code],
    ["Name", i.name],
    ["Category", i.category],
    ["Group", i.group],
    ["Frequency", i.frequency],
    ["Range", i.start && i.end ? `${i.start} → ${i.end}` : undefined],
    ["Shortcut", i.shortcut],
    ["API", i.apiUrl],
  ];
  const label = Math.max(...rows.map(([k]) => k.length));
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.padEnd(label)}  ${v}`)
    .join("\n");
}

export function formatShortcuts(): string {
  const rows = Object.entries(SHORTCUTS).map(([name, s]) => [name, s.code, s.description, s.aliases.join(", ")]);
  return renderTable(["SHORTCUT", "CODE", "DESCRIPTION", "ALIASES"], rows);
}

// ---------- CSV ----------

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function csvSeries(s: SeriesResult): string {
  return toCsv(["period", "value"], s.points.map((p) => [p.period, p.value]));
}

export function csvLatest(l: LatestResult): string {
  return toCsv(["code", "period", "value"], [[l.code, l.period, l.value]]);
}

export function csvSearch(entries: CatalogEntry[]): string {
  return toCsv(
    ["code", "frequency", "name", "category", "group", "start", "end"],
    entries.map((e) => [e.code, e.frequency, e.name, e.category, e.group, e.start, e.end]),
  );
}

// ---------- trend ----------

const BARS = "▁▂▃▄▅▆▇█";

/** One-line chart of a series. Missing values are skipped; long series are sampled down to `width` points. */
export function sparkline(values: (number | null)[], width = 40): string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return "";
  const sampled =
    nums.length <= width ? nums : Array.from({ length: width }, (_, i) => nums[Math.round((i * (nums.length - 1)) / (width - 1))]!);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (max === min) return BARS[3]!.repeat(sampled.length);
  return sampled.map((v) => BARS[Math.round(((v - min) / (max - min)) * (BARS.length - 1))]).join("");
}

export function trendLine(s: SeriesResult): string {
  const nums = s.points.map((p) => p.value).filter((v): v is number => v !== null);
  if (nums.length < 2) return "";
  const first = nums[0]!;
  const last = nums[nums.length - 1]!;
  const delta = last - first;
  const sign = delta > 0 ? "+" : "";
  return `${sparkline(s.points.map((p) => p.value))}  ${fmtNumber(first, s.decimals)} → ${fmtNumber(last, s.decimals)}  (${sign}${fmtNumber(delta, s.decimals)})`;
}

// ---------- compare ----------

export function formatCompare(c: CompareResult): string {
  const legend = c.series.map((s) => `${s.code}  ${s.name}`).join("\n");
  const rows = c.rows.map((r) => [r.period, ...r.values.map((v, i) => fmtNumber(v, c.series[i]!.decimals))]);
  const right = c.series.map((_, i) => i + 1);
  return [legend, "", renderTable(["PERIOD", ...c.series.map((s) => s.code)], rows, right)].join("\n");
}

export function csvCompare(c: CompareResult): string {
  return toCsv(["period", ...c.series.map((s) => s.code)], c.rows.map((r) => [r.period, ...r.values]));
}
