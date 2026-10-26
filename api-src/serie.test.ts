import { expect, test } from "bun:test";
import { InputError, parseRequest, toCsv } from "./serie";

const q = (s: string) => new URLSearchParams(s);
const now = new Date(2026, 9, 26);

test("converts dates per frequency and defaults to the last 5 years", () => {
  expect(parseRequest(q("codes=PD04638PD&desde=2024-01&hasta=2024-03"), now)).toEqual({ codes: ["PD04638PD"], from: "2024-1-1", to: "2024-3-31", format: "xlsx" });
  expect(parseRequest(q("codes=PN01271PM"), now)).toEqual({ codes: ["PN01271PM"], from: "2021-1", to: "2026-10", format: "xlsx" });
});

test("rejects bad input with a message in Spanish", () => {
  expect(() => parseRequest(q(""), now)).toThrow(InputError);
  expect(() => parseRequest(q("codes=hola"), now)).toThrow("no parece");
  expect(() => parseRequest(q("codes=PD04638PD,PN01271PM"), now)).toThrow("misma frecuencia");
  expect(() => parseRequest(q("codes=PD04638PD&desde=ayer"), now)).toThrow(InputError);
});

test("csv has a BOM, one column per series, blanks for missing and no unpublished tail", () => {
  const csv = toCsv([
    { name: 'Dólar, "venta"', points: [{ period: "2026-10-01", value: 3.4 }, { period: "2026-10-02", value: null }, { period: "2026-10-03", value: null }] },
    { name: "Euro", points: [{ period: "2026-10-01", value: 3.9 }, { period: "2026-10-02", value: 4 }, { period: "2026-10-03", value: null }] },
  ]);
  expect(csv).toBe('﻿Fecha,"Dólar, ""venta""",Euro\r\n2026-10-01,3.4,3.9\r\n2026-10-02,,4\r\n');
});

test("formato=csv is honored and the date error is in Spanish", () => {
  expect(parseRequest(q("codes=PD04638PD&formato=csv"), now).format).toBe("csv");
  expect(() => parseRequest(q("codes=PD04638PD&desde=ayer"), now)).toThrow("Fecha no válida");
});
