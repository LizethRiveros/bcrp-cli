import type { LatestResult, SeriesInfo, SeriesResult } from "./api";
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
  const rows = s.points.map((p) => [p.period, fmtNumber(p.value, s.decimals)]);
  return [
    `${s.name}`,
    `${s.code} · ${s.frequency} · ${s.points.length} observations`,
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
