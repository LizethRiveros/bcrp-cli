// src/cache.ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var CACHE_TTL_MS = 10 * 60 * 1000;
var PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
function cacheDir() {
  return join(homedir(), ".bcrp", "cache");
}
function cacheEnabled() {
  return process.env.BCRP_NO_CACHE !== "1";
}
function looksLikeData(body) {
  return body.trimStart().startsWith("{");
}
function prune(dir, now) {
  try {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (now - statSync(file).mtimeMs > PRUNE_AFTER_MS)
        unlinkSync(file);
    }
  } catch {}
}
function cachedFetch(base = fetch, { dir = cacheDir(), ttlMs = CACHE_TTL_MS, now = Date.now } = {}) {
  return async (input, init) => {
    const url = String(input);
    const file = join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
    try {
      const entry = JSON.parse(readFileSync(file, "utf8"));
      if (now() - entry.t < ttlMs)
        return new Response(entry.body);
    } catch {}
    const res = await base(input, init);
    if (!res.ok)
      return res;
    const body = await res.text();
    if (looksLikeData(body)) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ t: now(), body }));
        prune(dir, now());
      } catch {}
    }
    return new Response(body, { status: res.status });
  };
}

// src/client.ts
var BASE = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";
var MONTHS = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  set: "09",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
  jan: "01",
  apr: "04",
  aug: "08",
  dec: "12"
};
function fullYear(y) {
  return y.length === 2 ? `20${y}` : y;
}
function normalizePeriod(label) {
  const daily = label.match(/^(\d{1,2})\.([A-Za-z]{3})\.(\d{2,4})$/);
  if (daily) {
    const m = MONTHS[daily[2].toLowerCase()];
    if (m)
      return `${fullYear(daily[3])}-${m}-${daily[1].padStart(2, "0")}`;
  }
  const monthly = label.match(/^([A-Za-z]{3})\.(\d{2,4})$/);
  if (monthly) {
    const m = MONTHS[monthly[1].toLowerCase()];
    if (m)
      return `${fullYear(monthly[2])}-${m}`;
  }
  const quarterly = label.match(/^[QqTt]([1-4])\.(\d{2,4})$/);
  if (quarterly)
    return `${fullYear(quarterly[2])}-Q${quarterly[1]}`;
  return label;
}
function parseValue(raw) {
  if (raw === undefined || raw === "" || raw === "n.d.")
    return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

class BcrpError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "BcrpError";
  }
}
function extractJson(text) {
  const body = text.trimStart();
  if (!body.startsWith("{"))
    return;
  let depth = 0;
  let inString = false;
  for (let i = 0;i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (c === "\\")
        i++;
      else if (c === '"')
        inString = false;
    } else if (c === '"')
      inString = true;
    else if (c === "{")
      depth++;
    else if (c === "}" && --depth === 0)
      return body.slice(0, i + 1);
  }
  return;
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var defaultFetch = (input, init) => (cacheEnabled() ? cachedFetch() : fetch)(input, init);
async function fetchSeriesSet(codes, from, to, fetchImpl = defaultFetch, { retries = 2, delayMs = 700 } = {}) {
  const label = codes.join("-");
  const url = `${BASE}/${codes.map(encodeURIComponent).join("-")}/json/${from}/${to}/ing`;
  for (let attempt = 0;; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { "user-agent": "bcrp-cli (+https://github.com/LizethRiveros/bcrp-cli)" },
        signal: AbortSignal.timeout(30000)
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw new BcrpError(`Could not reach the BCRP API: ${e instanceof Error ? e.message : e}`, label);
    }
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw new BcrpError(`BCRP API error ${res.status} for ${label}`, label);
    }
    const json = extractJson(await res.text());
    if (json)
      return toSeriesSet(JSON.parse(json));
    if (attempt >= retries) {
      throw new BcrpError(`No data from the BCRP API for "${label}" after ${attempt + 1} attempts. A code may not exist, ` + "or the BCRP's anti-bot protection is throttling requests: wait a few seconds and retry, " + `or check the code with \`bcrp info <code>\`.`, label);
    }
    await sleep(delayMs * (attempt + 1));
  }
}
function toSeriesSet(raw) {
  return {
    title: raw.config.title,
    series: raw.config.series.map((s, i) => ({
      name: s.name,
      decimals: Number(s.dec ?? 2),
      points: (raw.periods ?? []).map((p) => ({ period: normalizePeriod(p.name), value: parseValue(p.values[i]) }))
    }))
  };
}

// src/dates.ts
var BY_SUFFIX = {
  D: "daily",
  M: "monthly",
  Q: "quarterly",
  A: "annual"
};
function frequencyFromCode(code) {
  return BY_SUFFIX[code.trim().toUpperCase().slice(-1)];
}
var DATE_HINT = "Use YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn";
function parseDateInput(input) {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const parts = { year: +m[1], month: +m[2], day: +m[3] };
    check(parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= 31, input);
    return parts;
  }
  m = s.match(/^(\d{4})-[Qq]([1-4])$/) ?? s.match(/^[QqTt]([1-4])-(\d{4})$/);
  if (m) {
    const swapped = m[2].length === 4;
    return { year: +(swapped ? m[2] : m[1]), quarter: +(swapped ? m[1] : m[2]) };
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const month = +m[2];
    check(month >= 1 && month <= 12, input);
    return { year: +m[1], month };
  }
  m = s.match(/^(\d{4})$/);
  if (m)
    return { year: +m[1] };
  throw new Error(`Invalid date "${input}". ${DATE_HINT}`);
}
function check(ok, input) {
  if (!ok)
    throw new Error(`Invalid date "${input}". ${DATE_HINT}`);
}
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
function toApiDate(input, freq, edge) {
  const p = parseDateInput(input);
  const first = edge === "from";
  const month = p.month ?? (p.quarter ? first ? (p.quarter - 1) * 3 + 1 : p.quarter * 3 : first ? 1 : 12);
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

// api-src/serie.ts
var CODE_RE = /^[A-Z]{2}\d{4,6}[A-Z]{2}$/;
var MAX_CODES = 10;

class InputError extends Error {
}
function parseRequest(params, now = new Date) {
  const codes = (params.get("codes") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0)
    throw new InputError("Falta elegir al menos una serie.");
  if (codes.length > MAX_CODES)
    throw new InputError(`Máximo ${MAX_CODES} series por descarga.`);
  for (const c of codes)
    if (!CODE_RE.test(c))
      throw new InputError(`"${c}" no parece un código de serie del BCRP.`);
  const freqs = new Set(codes.map((c) => frequencyFromCode(c)));
  if (freqs.size > 1)
    throw new InputError("Elige series con la misma frecuencia (todas diarias, todas mensuales...).");
  const freq = frequencyFromCode(codes[0]);
  try {
    const hasta = params.get("hasta");
    const desde = params.get("desde");
    const to = toApiDate(hasta || `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`, freq, "to");
    const from = toApiDate(desde || String(now.getFullYear() - 5), freq, "from");
    return { codes, from, to };
  } catch (e) {
    throw new InputError(e instanceof Error ? e.message : "Fecha no válida.");
  }
}
var csvCell = (s) => /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
function toCsv(series) {
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  let end = periods.length;
  while (end > 0 && series.every((s) => s.points[end - 1]?.value == null))
    end--;
  const lines = [["Fecha", ...series.map((s) => s.name)].map(csvCell).join(",")];
  for (let i = 0;i < end; i++) {
    lines.push([periods[i], ...series.map((s) => String(s.points[i]?.value ?? ""))].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join(`\r
`)}\r
`;
}
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  const send = (status, message) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
  };
  try {
    const { codes, from, to } = parseRequest(new URL(req.url ?? "/", "http://x").searchParams);
    const set = await fetchSeriesSet(codes, from, to, fetch);
    if (set.series.length === 0 || set.series[0].points.length === 0) {
      return send(404, "El BCRP no tiene datos para esas series en ese rango de fechas.");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bcrp-${codes.slice(0, 3).join("-")}.csv"`);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(toCsv(set.series));
  } catch (e) {
    if (e instanceof InputError)
      return send(400, e.message);
    if (e instanceof BcrpError)
      return send(502, "El BCRP no respondió bien. Espera unos segundos y vuelve a intentar.");
    return send(500, "No se pudo preparar la descarga.");
  }
}
export {
  InputError,
  handler as default,
  parseRequest,
  toCsv
};
