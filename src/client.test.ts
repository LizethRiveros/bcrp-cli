import { expect, test } from "bun:test";
import { BcrpError, extractJson, fetchSeries, normalizePeriod, parseValue } from "./client";

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
  await expect(fetchSeries("NOPE", "2026-1", "2026-2", respond("<html>error</html>"), { delayMs: 0 })).rejects.toThrow(/No data from the BCRP API/);
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

test("extractJson keeps the leading JSON object and ignores trailing PHP debug HTML", () => {
  const json = '{"a":{"b":"x}y","c":"q\\"}"},"periods":[]}';
  expect(extractJson(json + "<br /><font size='1'><table class='xdebug-error'>")).toBe(json);
  expect(extractJson("  " + json)).toBe(json);
  expect(extractJson("<!DOCTYPE html><html></html>")).toBeUndefined();
  expect(extractJson('{"unterminated":')).toBeUndefined();
});

test("fetchSeries returns an empty series for a range with no data (JSON followed by debug HTML)", async () => {
  const body =
    '{"config":{"title":"T","series":[{"name":"S","dec":"2"}]},"periods":[]}<br /><font size="1"><table class="xdebug-error">';
  const s = await fetchSeries("X", "2030-1", "2030-3", respond(body));
  expect(s.points).toEqual([]);
  expect(s.name).toBe("S");
});

test("fetchSeries retries when the API answers with its anti-bot page, then succeeds", async () => {
  const ok = JSON.stringify({ config: { title: "T", series: [{ name: "S", dec: "1" }] }, periods: [{ name: "2024", values: ["1.5"] }] });
  const calls: number[] = [];
  const flaky = (async () => {
    calls.push(1);
    return new Response(calls.length < 3 ? "<!DOCTYPE html><html><script src='/_Incapsula_Resource'></script></html>" : ok);
  }) as unknown as typeof fetch;
  const s = await fetchSeries("X", "2024", "2024", flaky, { delayMs: 0 });
  expect(calls).toHaveLength(3);
  expect(s.points).toEqual([{ period: "2024", value: 1.5 }]);
});

test("fetchSeries gives up after the configured retries", async () => {
  let calls = 0;
  const blocked = (async () => {
    calls++;
    return new Response("<html>blocked</html>");
  }) as unknown as typeof fetch;
  await expect(fetchSeries("X", "2024", "2024", blocked, { retries: 1, delayMs: 0 })).rejects.toThrow(/after 2 attempts/);
  expect(calls).toBe(2);
});
