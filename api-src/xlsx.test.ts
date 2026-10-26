import { expect, test } from "bun:test";
import { crc32, excelDate, toXlsx } from "./xlsx";

test("crc32 matches the standard check value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("excel dates count days since 1899-12-30", () => {
  expect(excelDate(1900, 1, 1)).toBe(2);
  expect(excelDate(2026, 10, 26)).toBe(46321);
});

test("xlsx is a zip with the expected parts", () => {
  const bytes = toXlsx([{ name: "Dólar & <Euro>", points: [{ period: "2026-10-01", value: 3.4 }, { period: "2026-10-02", value: null }] }], "2026-10-26");
  expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
  const text = new TextDecoder().decode(bytes);
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) expect(text).toContain(part);
  expect(text).toContain("Dólar &amp; &lt;Euro&gt;");
});
