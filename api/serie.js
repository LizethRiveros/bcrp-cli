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

// api-src/xlsx.ts
var enc = new TextEncoder;
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0;n < 256; n++) {
    let c = n;
    for (let k = 0;k < 8; k++)
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data) {
  let c = 4294967295;
  for (const b of data)
    c = CRC_TABLE[(c ^ b) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v, o, n) => v.setUint16(o, n, true);
  const u32 = (v, o, n) => v.setUint32(o, n, true);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 67324752);
    u16(lv, 4, 20);
    u16(lv, 6, 2048);
    u32(lv, 14, crc);
    u32(lv, 18, f.data.length);
    u32(lv, 22, f.data.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    u32(cv, 0, 33639248);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 2048);
    u32(cv, 16, crc);
    u32(cv, 20, f.data.length);
    u32(cv, 24, f.data.length);
    u16(cv, 28, name.length);
    u32(cv, 42, offset);
    cen.set(name, 46);
    parts.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 101010256);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, size);
  u32(ev, 16, offset);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
var xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var clean = (s) => xml(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""));
function colName(i) {
  let s = "";
  for (let n = i + 1;n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
var EPOCH = Date.UTC(1899, 11, 30);
function excelDate(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}
function periodCell(period) {
  let m = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m)
    return { n: excelDate(+m[1], +m[2], +m[3]), style: 2 };
  m = period.match(/^(\d{4})-(\d{2})$/);
  if (m)
    return { n: excelDate(+m[1], +m[2], 1), style: 3 };
  if (/^\d{4}$/.test(period))
    return { n: Number(period) };
  return { s: period };
}
function sheetXml(rows, widths, freezeHeader) {
  const body = rows.map((row, r) => {
    const cells = row.map((c, i) => {
      if (!c)
        return "";
      const ref = `${colName(i)}${r + 1}`;
      if ("s" in c)
        return `<c r="${ref}" t="inlineStr"${r === 0 && freezeHeader ? ' s="1"' : ""}><is><t xml:space="preserve">${clean(c.s)}</t></is></c>`;
      return `<c r="${ref}"${c.style ? ` s="${c.style}"` : ""}><v>${c.n}</v></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const pane = freezeHeader ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`;
}
var STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function toXlsx(series, downloadedOn) {
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  let end = periods.length;
  while (end > 0 && series.every((s) => s.points[end - 1]?.value == null))
    end--;
  const data = [[{ s: "Fecha" }, ...series.map((s) => ({ s: s.name }))]];
  for (let i = 0;i < end; i++) {
    data.push([periodCell(periods[i]), ...series.map((s) => s.points[i]?.value == null ? null : { n: s.points[i].value })]);
  }
  const info = [
    [{ s: "Fuente" }],
    [{ s: "Banco Central de Reserva del Perú (BCRPData)" }],
    [{ s: "https://estadisticas.bcrp.gob.pe/estadisticas/series/" }],
    [{ s: `Descargado el ${downloadedOn} con bcrp-cli (proyecto no oficial)` }],
    [null],
    [{ s: "Series incluidas" }],
    ...series.map((s) => [{ s: s.name }])
  ];
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Fuente" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(data, [13, ...series.map(() => 34)], true)],
    ["xl/worksheets/sheet2.xml", sheetXml(info, [80], false)]
  ];
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
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
    return { codes, from, to, format: params.get("formato") === "csv" ? "csv" : "xlsx" };
  } catch (e) {
    throw new InputError("Fecha no válida. Usa el formato año-mes-día, por ejemplo 2024-03-15.");
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
    const { codes, from, to, format } = parseRequest(new URL(req.url ?? "/", "http://x").searchParams);
    const set = await fetchSeriesSet(codes, from, to, fetch);
    if (set.series.length === 0 || set.series[0].points.length === 0) {
      return send(404, "El BCRP no tiene datos para esas series en ese rango de fechas.");
    }
    res.statusCode = 200;
    const base = `bcrp-${codes.slice(0, 3).join("-")}`;
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
    if (e instanceof InputError)
      return send(400, e.message);
    if (e instanceof BcrpError)
      return send(502, "El BCRP no devolvió datos. Puede que la serie no exista o que esté ocupado: espera unos segundos y vuelve a intentar.");
    return send(500, "No se pudo preparar la descarga.");
  }
}
export {
  InputError,
  handler as default,
  parseRequest,
  toCsv
};
