import { expect, test } from "bun:test";
import { compareSeries, describeSeries, getLatest, getSeries, isSeriesInput } from "./api";
import { findByCode, loadCatalog } from "./catalog";
import { SHORTCUTS, resolveCode, shortcutName } from "./shortcuts";

/** A fake BCRP API that records requested URLs and returns the given periods. */
function fakeApi(periods: { name: string; values: string[] }[]) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    return new Response(
      JSON.stringify({ config: { title: "T", series: [{ name: "S", dec: "2" }] }, periods }),
    );
  }) as unknown as typeof fetch;
  return { urls, impl };
}

test("shortcuts resolve names, aliases and raw codes", () => {
  expect(resolveCode("fx")).toBe("PD04638PD");
  expect(resolveCode("USD")).toBe("PD04638PD");
  expect(resolveCode("pbi")).toBe("PN01728AM");
  expect(resolveCode("pn01273pm")).toBe("PN01273PM");
  expect(shortcutName("nope")).toBeUndefined();
  expect(isSeriesInput("fx")).toBe(true);
  expect(isSeriesInput("PD04638PD")).toBe(true);
  expect(isSeriesInput("hello")).toBe(false);
});

test("every shortcut points at a real series with a consistent frequency", () => {
  for (const [name, s] of Object.entries(SHORTCUTS)) {
    const info = describeSeries(name);
    expect(info.code).toBe(s.code);
    expect(info.name).toBeTruthy(); // exists in the bundled catalog
    expect(info.shortcut).toBe(name);
  }
});

test("getSeries sends API-formatted dates and trims to --last", async () => {
  const { urls, impl } = fakeApi([
    { name: "01.Set.26", values: ["3.1"] },
    { name: "02.Set.26", values: ["3.2"] },
    { name: "03.Set.26", values: ["3.3"] },
  ]);
  const s = await getSeries({ series: "fx", from: "2026-09", to: "2026-09", last: 2 }, impl);
  expect(urls[0]).toContain("/PD04638PD/json/2026-9-1/2026-9-30/ing");
  expect(s.points.map((p) => p.value)).toEqual([3.2, 3.3]);
  expect(s.frequency).toBe("daily");
  expect(s.from).toBe("2026-9-1");
});

test("getSeries uses the right date shape for quarterly and annual series", async () => {
  const q = fakeApi([{ name: "Q1.24", values: ["1.5"] }]);
  await getSeries({ series: "PN02507AQ", from: "2024-Q1", to: "2024-Q4" }, q.impl);
  expect(q.urls[0]).toContain("/PN02507AQ/json/2024-1/2024-4/ing");
  const a = fakeApi([{ name: "2024", values: ["3.5"] }]);
  await getSeries({ series: "PM04923AA", from: "2020", to: "2024" }, a.impl);
  expect(a.urls[0]).toContain("/PM04923AA/json/2020/2024/ing");
});

test("getLatest returns the most recent non-null observation", async () => {
  const { impl } = fakeApi([
    { name: "01.Set.26", values: ["3.1"] },
    { name: "02.Set.26", values: ["3.2"] },
    { name: "03.Set.26", values: ["n.d."] },
  ]);
  const l = await getLatest("fx", impl);
  expect(l).toMatchObject({ code: "PD04638PD", period: "2026-09-02", value: 3.2, frequency: "daily" });
});

test("getLatest fails clearly when nothing is published", async () => {
  const { impl } = fakeApi([{ name: "01.Set.26", values: ["n.d."] }]);
  await expect(getLatest("fx", impl)).rejects.toThrow(/No recent data/);
});

test("unknown series input gives an actionable error", async () => {
  await expect(getSeries({ series: "banana" })).rejects.toThrow(/bcrp search/);
});

test("getSeries drops the unpublished tail unless an end date is given", async () => {
  const periods = [
    { name: "01.Set.26", values: ["3.1"] },
    { name: "02.Set.26", values: ["3.2"] },
    { name: "03.Set.26", values: ["n.d."] },
  ];
  const open = await getSeries({ series: "fx", last: 5 }, fakeApi(periods).impl);
  expect(open.points.map((p) => p.value)).toEqual([3.1, 3.2]);
  const explicit = await getSeries({ series: "fx", from: "2026-09", to: "2026-09" }, fakeApi(periods).impl);
  expect(explicit.points).toHaveLength(3);
});

/**
 * A fake of the real API's multi-series behaviour: codes joined by "-" in the URL, series returned in ascending code
 * order (NOT the order requested), one column of values per series. `data` maps code -> [period label, value][].
 */
function fakeMultiApi(data: Record<string, [string, string][]>) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    const codes = url.match(/\/api\/([^/]+)\/json/)![1]!.split("-").sort();
    const names = codes.map((c) => {
      const e = findByCode(loadCatalog().entries, c);
      return e ? `${e.group} - ${e.name}` : `S-${c}`;
    });
    const labels = [...new Set(codes.flatMap((c) => data[c]!.map(([label]) => label)))];
    const periods = labels.map((name) => ({
      name,
      values: codes.map((c) => data[c]!.find(([label]) => label === name)?.[1] ?? "n.d."),
    }));
    return new Response(JSON.stringify({ config: { title: "T", series: names.map((name) => ({ name, dec: "2" })) }, periods }));
  }) as unknown as typeof fetch;
  return { urls, impl };
}

const INFLATION: [string, string][] = [
  ["Jun.2026", "4.0"],
  ["Jul.2026", "4.1"],
  ["Aug.2026", "4.4"],
];
const GDP: [string, string][] = [
  ["Jun.2026", "1.8"],
  ["Jul.2026", "3.6"],
];

test("compareSeries uses ONE request and matches each series by name, not by the API's order", async () => {
  const { urls, impl } = fakeMultiApi({ PN01273PM: INFLATION, PN01728AM: GDP });
  // Requested gdp first; the fake API answers with PN01273PM (inflation) first, like the real one does.
  const c = await compareSeries(["gdp", "inflation"], { last: 3 }, impl);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("/PN01728AM-PN01273PM/json/");
  expect(c.frequency).toBe("monthly");
  expect(c.series.map((s) => s.code)).toEqual(["PN01728AM", "PN01273PM"]);
  expect(c.rows).toEqual([
    { period: "2026-06", values: [1.8, 4.0] },
    { period: "2026-07", values: [3.6, 4.1] },
    { period: "2026-08", values: [null, 4.4] },
  ]);
});

test("compareSeries falls back to one request per series when it cannot match them with certainty", async () => {
  // PN99999PM looks like a valid code but is not in the catalog, so its API name cannot be predicted.
  const { urls, impl } = fakeMultiApi({ PN01273PM: INFLATION, PN99999PM: [["Jun.2026", "7.0"], ["Jul.2026", "8.0"]] });
  const c = await compareSeries(["inflation", "PN99999PM"], { last: 2 }, impl);
  expect(urls).toHaveLength(2);
  expect(c.series.map((s) => s.code)).toEqual(["PN01273PM", "PN99999PM"]);
  expect(c.rows).toEqual([
    { period: "2026-07", values: [4.1, 8.0] },
    { period: "2026-08", values: [4.4, null] },
  ]);
});

test("compareSeries validates its inputs before touching the network", async () => {
  const { urls, impl } = fakeMultiApi({ PD04638PD: [], PN01273PM: [] });
  await expect(compareSeries(["fx"], {}, impl)).rejects.toThrow(/at least two/);
  await expect(compareSeries(["fx", "usd"], {}, impl)).rejects.toThrow(/at least two/); // same series
  await expect(compareSeries(["fx", "inflation"], {}, impl)).rejects.toThrow(/different frequencies/);
  expect(urls).toHaveLength(0);
});
