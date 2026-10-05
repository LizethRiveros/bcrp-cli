import { expect, test } from "bun:test";
import { BcrpError, fetchSeries, normalizePeriod, parseValue } from "./client";

test("normalizePeriod handles every label shape the API returns", () => {
  expect(normalizePeriod("01.Set.26")).toBe("2026-09-01");
  expect(normalizePeriod("15.Dic.2025")).toBe("2025-12-15");
  expect(normalizePeriod("Ene.2025")).toBe("2025-01");
  expect(normalizePeriod("Jan.2025")).toBe("2025-01");
  expect(normalizePeriod("Q1.24")).toBe("2024-Q1");
  expect(normalizePeriod("T4.2025")).toBe("2025-Q4");
  expect(normalizePeriod("2024")).toBe("2024");
  expect(normalizePeriod("something else")).toBe("something else");
});

test("parseValue", () => {
  expect(parseValue("3.36")).toBe(3.36);
  expect(parseValue("-0.16")).toBe(-0.16);
  expect(parseValue("n.d.")).toBeNull();
  expect(parseValue("")).toBeNull();
  expect(parseValue(undefined)).toBeNull();
});

const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test("fetchSeries parses a response", async () => {
  const body = JSON.stringify({
    config: { title: "TC", series: [{ name: "TC venta", dec: "3" }] },
    periods: [
      { name: "01.Set.26", values: ["3.365"] },
      { name: "02.Set.26", values: ["n.d."] },
    ],
  });
  const s = await fetchSeries("X", "2026-9-1", "2026-9-30", respond(body));
  expect(s.points).toEqual([
    { period: "2026-09-01", value: 3.365 },
    { period: "2026-09-02", value: null },
  ]);
  expect(s.name).toBe("TC venta");
  expect(s.decimals).toBe(3);
});

test("fetchSeries explains non-JSON responses (unknown series)", async () => {
  await expect(fetchSeries("NOPE", "2026-1", "2026-2", respond("<html>error</html>"))).rejects.toThrow(/not found/);
});

test("fetchSeries surfaces HTTP and network errors", async () => {
  await expect(fetchSeries("X", "2026-1", "2026-2", respond("", 503))).rejects.toThrow(/503/);
  const down = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const err = await fetchSeries("X", "2026-1", "2026-2", down).catch((e) => e);
  expect(err).toBeInstanceOf(BcrpError);
  expect(err.message).toMatch(/ECONNRESET/);
});
