/**
 * A minimal .xlsx writer with no dependencies: an Office Open XML package is a ZIP of a few XML files, and ZIP allows
 * entries to be stored uncompressed. Writes one data sheet (real dates, bold frozen header) and a "Fuente" sheet.
 */
import type { Point } from "../src/client";

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP archive with every entry stored (method 0). */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n, true);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800); // UTF-8 names
    u32(lv, 14, crc);
    u32(lv, 18, f.data.length);
    u32(lv, 22, f.data.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
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
  u32(ev, 0, 0x06054b50);
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

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// XML 1.0 forbids most control characters; a stray one would make Excel report a corrupt file.
const clean = (s: string) => xml(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""));

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const EPOCH = Date.UTC(1899, 11, 30);
/** Excel stores a date as the number of days since 1899-12-30. */
export function excelDate(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000);
}

type Cell = { s: string } | { n: number; style?: number } | null;

/** Style ids from styles.xml below: 1 = bold header, 2 = yyyy-mm-dd, 3 = yyyy-mm. */
function periodCell(period: string): Cell {
  let m = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { n: excelDate(+m[1]!, +m[2]!, +m[3]!), style: 2 };
  m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return { n: excelDate(+m[1]!, +m[2]!, 1), style: 3 };
  if (/^\d{4}$/.test(period)) return { n: Number(period) };
  return { s: period };
}

function sheetXml(rows: Cell[][], widths: number[], freezeHeader: boolean): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          if (!c) return "";
          const ref = `${colName(i)}${r + 1}`;
          if ("s" in c) return `<c r="${ref}" t="inlineStr"${r === 0 && freezeHeader ? ' s="1"' : ""}><is><t xml:space="preserve">${clean(c.s)}</t></is></c>`;
          return `<c r="${ref}"${c.style ? ` s="${c.style}"` : ""}><v>${c.n}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const pane = freezeHeader ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export interface SeriesForXlsx {
  name: string;
  points: Point[];
}

export function toXlsx(series: SeriesForXlsx[], downloadedOn: string): Uint8Array {
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  let end = periods.length;
  while (end > 0 && series.every((s) => s.points[end - 1]?.value == null)) end--;
  const data: Cell[][] = [[{ s: "Fecha" }, ...series.map((s) => ({ s: s.name }))]];
  for (let i = 0; i < end; i++) {
    data.push([periodCell(periods[i]!), ...series.map((s) => (s.points[i]?.value == null ? null : { n: s.points[i]!.value as number }))]);
  }
  const info: Cell[][] = [
    [{ s: "Fuente" }],
    [{ s: "Banco Central de Reserva del Perú (BCRPData)" }],
    [{ s: "https://estadisticas.bcrp.gob.pe/estadisticas/series/" }],
    [{ s: `Descargado el ${downloadedOn} con bcrp-cli (proyecto no oficial)` }],
    [null],
    [{ s: "Series incluidas" }],
    ...series.map((s) => [{ s: s.name }] as Cell[]),
  ];
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Fuente" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(data, [13, ...series.map(() => 34)], true)],
    ["xl/worksheets/sheet2.xml", sheetXml(info, [80], false)],
  ];
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}
