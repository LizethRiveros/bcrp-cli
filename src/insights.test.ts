import { expect, test } from "bun:test";
import { checkThreshold, convertCurrency, getChange, isoDate } from "./insights";

/** A fake BCRP API that serves the given periods for any request and records the URLs. */
function fakeApi(periods: { name: string; values: string[] }[], seriesName = "S") {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ config: { title: "T", series: [{ name: seriesName, dec: "3" }] }, periods }));
  }) as unknown as typeof fetch;
  return { urls, impl };
}

const FX = [
  { name: "02.Set.26", values: ["3.360"] },
  { name: "03.Set.26", values: ["3.370"] },
  { name: "04.Set.26", values: ["3.365"] }, // Friday
  { name: "07.Set.26", values: ["3.400"] },
  { name: "02.Oct.26", values: ["3.440"] }, // Friday
  { name: "05.Oct.26", values: ["3.500"] },
  { name: "06.Oct.26", values: ["n.d."] }, // today, not published yet
];

test("isoDate zero-pads", () => {
  expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("getChange measures from the latest published value to the matching earlier date", async () => {
  const c = await getChange("fx", "1m", fakeApi(FX).impl);
  expect(c.code).toBe("PD04638PD");
  expect(c.frequency).toBe("daily");
  expect(c.latest).toEqual({ period: "2026-10-05", value: 3.5 });
  expect(c.base).toEqual({ period: "2026-09-04", value: 3.365 }); // Sep 5 is a Saturday
  expect(c.change).toBeCloseTo(0.135, 10);
  expect(c.changePct).toBeCloseTo((0.135 / 3.365) * 100, 10);
  expect(c.source).toBeTruthy(); // comes from the catalog
});

test("getChange asks the API for enough history before the target date", async () => {
  const { urls, impl } = fakeApi(FX);
  await getChange("fx", "ytd", impl).catch(() => undefined); // the fake has no Dec 31: only the request matters here
  const from = urls[0]!.match(/\/json\/(\d{4})-(\d+)-(\d+)\//)!;
  // The window must start before Dec 31 of last year (ytd base), with slack for publication lag.
  const start = new Date(+from[1]!, +from[2]! - 1, +from[3]!);
  const lastYearEnd = new Date(new Date().getFullYear() - 1, 11, 31);
  expect(start.getTime()).toBeLessThan(lastYearEnd.getTime());
});

test("getChange refuses instead of guessing when there is no honest base", async () => {
  await expect(getChange("fx", "1y", fakeApi(FX).impl)).rejects.toThrow(/Cannot compute a 1y change/);
  const monthly = [{ name: "Jul.2026", values: ["4.0"] }, { name: "Aug.2026", values: ["4.4"] }];
  await expect(getChange("inflation", "1w", fakeApi(monthly).impl)).rejects.toThrow(/too far apart/);
});

test("getChange picks 1m for daily/monthly series and 1y for quarterly/annual by default", async () => {
  const monthly = [{ name: "Jul.2026", values: ["4.0"] }, { name: "Aug.2026", values: ["4.4"] }];
  expect((await getChange("inflation", undefined, fakeApi(monthly).impl)).over).toBe("1m");
  const quarterly = [{ name: "Q2.25", values: ["2.7"] }, { name: "Q2.26", values: ["2.6"] }];
  expect((await getChange("PN02507AQ", undefined, fakeApi(quarterly).impl)).over).toBe("1y");
});

test("a percentage series reports points, not a relative change", async () => {
  const monthly = [{ name: "Aug.2025", values: ["1.1"] }, { name: "Aug.2026", values: ["4.4"] }];
  const name = "Índice de precios Lima Metropolitana (var% 12 meses) - IPC"; // the real API name carries "var%"
  const c = await getChange("inflation", "1y", fakeApi(monthly, name).impl);
  expect(c.change).toBeCloseTo(3.3, 10);
  expect(c.changePct).toBeNull();
});

test("convertCurrency uses the latest published rate", async () => {
  const usd = await convertCurrency({ amount: 100, from: "usd" }, fakeApi(FX).impl);
  expect(usd).toMatchObject({ from: "usd", to: "pen", rate: 3.5, ratePeriod: "2026-10-05", side: "sell", series: "PD04638PD" });
  expect(usd.result).toBeCloseTo(350, 10);
  const pen = await convertCurrency({ amount: 350, from: "pen" }, fakeApi(FX).impl);
  expect(pen.to).toBe("usd");
  expect(pen.result).toBeCloseTo(100, 10);
});

test("convertCurrency on a date uses the last rate on or before it, and the buy side uses the other series", async () => {
  const { urls, impl } = fakeApi(FX);
  const c = await convertCurrency({ amount: 10, from: "usd", date: "2026-09-06", side: "buy" }, impl);
  expect(c.series).toBe("PD04637PD");
  expect(urls[0]).toContain("/PD04637PD/json/2026-8-27/2026-9-6/ing"); // ends on the requested date
  expect(c.ratePeriod).toBe("2026-10-05"); // the fake ignores the range, so this only checks the selection logic
});

test("convertCurrency validates its input and fails clearly with no data", async () => {
  await expect(convertCurrency({ amount: Number.NaN, from: "usd" }, fakeApi(FX).impl)).rejects.toThrow(/must be a number/);
  const empty = fakeApi([{ name: "02.Set.26", values: ["n.d."] }]);
  await expect(convertCurrency({ amount: 1, from: "usd", date: "2026-09-02" }, empty.impl)).rejects.toThrow(/No exchange rate/);
});

test("checkThreshold says whether the latest value crosses the line", async () => {
  const above = await checkThreshold("fx", { above: 3.45 }, fakeApi(FX).impl);
  expect(above).toMatchObject({ code: "PD04638PD", value: 3.5, op: "above", threshold: 3.45, triggered: true });
  expect((await checkThreshold("fx", { above: 3.5 }, fakeApi(FX).impl)).triggered).toBe(false); // strictly above
  expect((await checkThreshold("fx", { below: 3.6 }, fakeApi(FX).impl)).triggered).toBe(true);
  expect((await checkThreshold("fx", { below: 3.5 }, fakeApi(FX).impl)).triggered).toBe(false);
});

test("checkThreshold requires exactly one condition", async () => {
  await expect(checkThreshold("fx", {}, fakeApi(FX).impl)).rejects.toThrow(/exactly one/);
  await expect(checkThreshold("fx", { above: 1, below: 2 }, fakeApi(FX).impl)).rejects.toThrow(/exactly one/);
});
