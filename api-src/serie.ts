/**
 * Vercel function: GET /api/serie?codes=PD04638PD,PD04639PD&desde=2024-01&hasta=2026-10
 * Answers with a CSV that opens in Excel (UTF-8 with BOM). The BCRP API sends no CORS headers, so the browser cannot
 * call it; this function does, and adds them. Bundled to api/serie.js by `bun run api` (Vercel runs no build step here).
 */
import { BcrpError, fetchSeriesSet, type Point } from "../src/client";
import { frequencyFromCode, toApiDate } from "../src/dates";
import { toXlsx } from "./xlsx";

const CODE_RE = /^[A-Z]{2}\d{4,6}[A-Z]{2}$/;
const MAX_CODES = 10;

export class InputError extends Error {}

export interface CsvRequest {
  codes: string[];
  from: string;
  to: string;
  format: "xlsx" | "csv";
}

/** Validates the query and turns the user's dates into the format the BCRP API expects. */
export function parseRequest(params: URLSearchParams, now = new Date()): CsvRequest {
  const codes = (params.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) throw new InputError("Falta elegir al menos una serie.");
  if (codes.length > MAX_CODES) throw new InputError(`Máximo ${MAX_CODES} series por descarga.`);
  for (const c of codes) if (!CODE_RE.test(c)) throw new InputError(`"${c}" no parece un código de serie del BCRP.`);
  const freqs = new Set(codes.map((c) => frequencyFromCode(c)));
  if (freqs.size > 1) throw new InputError("Elige series con la misma frecuencia (todas diarias, todas mensuales...).");
  const freq = frequencyFromCode(codes[0]!)!;
  try {
    const hasta = params.get("hasta");
    const desde = params.get("desde");
    const to = toApiDate(hasta || `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`, freq, "to");
    const from = toApiDate(desde || String(now.getFullYear() - 5), freq, "from");
    return { codes, from, to, format: params.get("formato") === "csv" ? "csv" : "xlsx" };
  } catch (e) {
    throw new InputError("Fecha no válida. Usa el formato año-mes-día, por ejemplo 2024-03-15.");
  }
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

/** One row per period, one column per series; blank where the BCRP has no figure. Trailing unpublished rows are dropped. */
export function toCsv(series: { name: string; points: Point[] }[]): string {
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  let end = periods.length;
  while (end > 0 && series.every((s) => s.points[end - 1]?.value == null)) end--;
  const lines = [["Fecha", ...series.map((s) => s.name)].map(csvCell).join(",")];
  for (let i = 0; i < end; i++) {
    lines.push([periods[i]!, ...series.map((s) => String(s.points[i]?.value ?? ""))].map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

interface Res {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array): void;
}

export default async function handler(req: { url?: string }, res: Res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  const send = (status: number, message: string) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
  };
  try {
    const { codes, from, to, format } = parseRequest(new URL(req.url ?? "/", "http://x").searchParams);
    // Plain fetch: the local file cache used by the CLI does not exist on Vercel.
    const set = await fetchSeriesSet(codes, from, to, fetch);
    if (set.series.length === 0 || set.series[0]!.points.length === 0) {
      return send(404, "El BCRP no tiene datos para esas series en ese rango de fechas.");
    }
    res.statusCode = 200;
    const base = `bcrp-${codes.slice(0, 3).join("-")}`;
    // Same query, same answer: let Vercel's CDN absorb repeats so the BCRP is not asked twice within the hour.
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
      return res.end(toCsv(set.series));
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
    res.end(toXlsx(set.series, new Date().toISOString().slice(0, 10)));
  } catch (e) {
    if (e instanceof InputError) return send(400, e.message);
    if (e instanceof BcrpError) return send(502, "El BCRP no devolvió datos. Puede que la serie no exista o que esté ocupado: espera unos segundos y vuelve a intentar.");
    return send(500, "No se pudo preparar la descarga.");
  }
}
