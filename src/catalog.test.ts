import { expect, test } from "bun:test";
import {
  type CatalogEntry,
  decodeCatalog,
  encodeCatalog,
  findByCode,
  loadCatalog,
  normalizeText,
  parseCatalogCsv,
  searchCatalog,
} from "./catalog";

const CSV = [
  "Código de serie;Categoría de serie;Grupo de serie;Nombre de serie;Descripción;Metodología;Unidad;Escala;Geografía;Fuente;Frecuencia;Creación;Grupo pub;Área;Actualización;Inicio;Fin;Memo;",
  "PD04638PD;Tipo de cambio nominal;Tipo de cambio;TC Interbancario (S/ por US$) - Venta;;;;;PE;BCRP;Diaria;2020-01-01;g;a;2026-09-03;1997-01-02;2026-09-03;;",
  "PN01273PM;Inflación;Índice de precios Lima Metropolitana (var% 12 meses);IPC;;;;;PE;BCRP;Mensual;2020-01-01;g;a;2026-09-03;Ene-1950;Dic-2025;;",
  "PN06001XX;Rubbish;g;bad frequency row;;;;;PE;BCRP;Quincenal;;;;;;;;",
  "",
].join("\r\n");

test("parseCatalogCsv skips header, blank and unparseable rows", () => {
  const entries = parseCatalogCsv(CSV);
  expect(entries.map((e) => e.code)).toEqual(["PD04638PD", "PN01273PM"]);
  expect(entries[0]).toEqual({
    code: "PD04638PD",
    category: "Tipo de cambio nominal",
    group: "Tipo de cambio",
    name: "TC Interbancario (S/ por US$) - Venta",
    frequency: "daily",
    start: "1997-01-02",
    end: "2026-09-03",
    source: "BCRP",
    updated: "2026-09-03",
  });
  expect(entries[1]!.source).toBe("BCRP");
});

test("encode/decode round-trips", () => {
  const entries = parseCatalogCsv(CSV);
  const encoded = encodeCatalog(entries, "2026-01-01T00:00:00.000Z");
  expect(encoded.count).toBe(2);
  expect(decodeCatalog(JSON.parse(JSON.stringify(encoded)))).toEqual(entries);
});

test("normalizeText strips accents", () => {
  expect(normalizeText("Inflación Subyacente")).toBe("inflacion subyacente");
});

const mk = (code: string, category: string, group: string, name: string, end = "2026-09-03"): CatalogEntry => ({
  code,
  category,
  group,
  name,
  frequency: "monthly",
  start: "2000",
  end,
});

const SAMPLE = [
  mk("PN00001XX", "Tipo de cambio nominal", "Tipo de cambio", "Interbancario - Venta"),
  mk("PN00002XX", "Comercio", "Términos de intercambio", "Índice de precios de exportación"),
  mk("PN00003XX", "Inflación", "Índice de precios", "Inflación Subyacente - Bienes"),
  mk("PN00004XX", "Inflación", "Índice de precios", "Inflación Subyacente - Servicios"),
  mk("PN00005XX", "Inflación", "Índice de precios", "Inflación Antigua", "1985"),
];

test("search matches word starts, not substrings ('cambio' is not 'intercambio')", () => {
  const codes = searchCatalog(SAMPLE, "cambio").map((e) => e.code);
  expect(codes).toContain("PN00001XX");
  expect(codes).not.toContain("PN00002XX");
});

test("search ignores accents and requires every word", () => {
  expect(searchCatalog(SAMPLE, "inflacion subyacente").map((e) => e.code).sort()).toEqual(["PN00003XX", "PN00004XX"]);
  expect(searchCatalog(SAMPLE, "inflacion zzz")).toEqual([]);
});

test("search understands English terms and ignores filler words", () => {
  expect(searchCatalog(SAMPLE, "exchange rate").map((e) => e.code)).toEqual(["PN00001XX"]);
  expect(searchCatalog(SAMPLE, "inflation")[0]!.code).not.toBe("PN00005XX");
});

test("search ranks active series above long-dead ones", () => {
  const codes = searchCatalog(SAMPLE, "inflacion").map((e) => e.code);
  expect(codes.indexOf("PN00005XX")).toBe(codes.length - 1);
});

test("search by exact code, frequency filter and limit", () => {
  expect(searchCatalog(SAMPLE, "pn00003xx").map((e) => e.code)).toEqual(["PN00003XX"]);
  expect(searchCatalog(SAMPLE, "inflacion", { frequency: "daily" })).toEqual([]);
  expect(searchCatalog(SAMPLE, "inflacion", { limit: 1 })).toHaveLength(1);
  expect(searchCatalog(SAMPLE, "   ")).toEqual([]);
});

test("the bundled catalog loads and finds the headline series", () => {
  const { entries } = loadCatalog();
  expect(entries.length).toBeGreaterThan(15000);
  expect(findByCode(entries, "pd04638pd")?.frequency).toBe("daily");
  expect(searchCatalog(entries, "tipo de cambio")[0]!.code).toBe("PD04638PD");
  expect(searchCatalog(entries, "inflación subyacente").length).toBeGreaterThan(5);
});

test("decodeCatalog still reads catalogs saved by older versions (rows without source/description)", () => {
  const old = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    count: 1,
    strings: ["Inflación", "IPC group"],
    rows: [["PN01273PM", 0, 1, "IPC", "M", "Ene-1950", "Dic-2025"]],
  };
  const [e] = decodeCatalog(old as never);
  expect(e).toEqual({
    code: "PN01273PM",
    category: "Inflación",
    group: "IPC group",
    name: "IPC",
    frequency: "monthly",
    start: "Ene-1950",
    end: "Dic-2025",
  });
  expect(e!.source).toBeUndefined();
});

test("bundled catalog carries the source of each series", () => {
  const { entries } = loadCatalog();
  expect(findByCode(entries, "PN01273PM")?.source).toBe("INEI");
  expect(entries.filter((e) => e.source).length).toBeGreaterThan(14000);
});
