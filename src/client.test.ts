import { expect, test } from "bun:test";
import { fetchSeries, normalizePeriod, parseValue } from "./client";

test("normalizePeriod", () => {
  expect(normalizePeriod("01.Set.26")).toBe("2026-09-01");
  expect(normalizePeriod("Ene.2025")).toBe("2025-01");
  expect(normalizePeriod("2024")).toBe("2024");
});

test("parseValue", () => {
  expect(parseValue("3.36")).toBe(3.36);
  expect(parseValue("n.d.")).toBeNull();
  expect(parseValue(undefined)).toBeNull();
});

test("fetchSeries parses response", async () => {
  const body = JSON.stringify({
    config: { title: "TC", series: [{ name: "TC venta", dec: "3" }] },
    periods: [{ name: "01.Set.26", values: ["3.365"] }],
  });
  const fake = (async () => new Response(body)) as unknown as typeof fetch;
  const s = await fetchSeries("X", "2026-9-1", "2026-9-30", fake);
  expect(s.points).toEqual([{ period: "2026-09-01", value: 3.365 }]);
  expect(s.name).toBe("TC venta");
});
