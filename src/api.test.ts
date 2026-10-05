import { expect, test } from "bun:test";
import { describeSeries, getLatest, getSeries, isSeriesInput } from "./api";
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
