import { expect, test } from "bun:test";
import type { CompareResult, SeriesResult } from "./api";
import { csvCompare, csvSeries, formatCompare, sparkline, toCsv, trendLine } from "./format";

test("toCsv quotes commas, quotes and newlines; nulls become empty", () => {
  expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, 1.5], ["line\nbreak", ""]])).toBe(
    'a,b\n"x,y","say ""hi"""\n,1.5\n"line\nbreak",',
  );
});

test("sparkline scales between min and max and skips nulls", () => {
  expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe("▁▂▃▄▅▆▇█");
  expect(sparkline([1, null, 8])).toBe("▁█");
  expect(sparkline([5, 5, 5])).toBe("▄▄▄");
  expect(sparkline([1])).toBe("");
});

test("sparkline samples down long series", () => {
  const long = Array.from({ length: 500 }, (_, i) => i);
  const line = sparkline(long, 20);
  expect([...line]).toHaveLength(20);
  expect(line[0]).toBe("▁");
  expect(line.at(-1)).toBe("█");
});

const series: SeriesResult = {
  code: "X",
  title: "T",
  name: "Name",
  decimals: 2,
  frequency: "monthly",
  from: "2026-1",
  to: "2026-3",
  points: [
    { period: "2026-01", value: 1 },
    { period: "2026-02", value: null },
    { period: "2026-03", value: 3 },
  ],
};

test("trendLine reports first, last and change", () => {
  expect(trendLine(series)).toBe("▁█  1.00 → 3.00  (+2.00)");
  expect(trendLine({ ...series, points: [series.points[0]!] })).toBe("");
});

test("csvSeries", () => {
  expect(csvSeries(series)).toBe("period,value\n2026-01,1\n2026-02,\n2026-03,3");
});

const compare: CompareResult = {
  frequency: "monthly",
  series: [
    { code: "A", name: "Alpha", decimals: 1 },
    { code: "B", name: "Beta", decimals: 2 },
  ],
  rows: [
    { period: "2026-01", values: [1, 2] },
    { period: "2026-02", values: [null, 3] },
  ],
};

test("compare formatting", () => {
  expect(csvCompare(compare)).toBe("period,A,B\n2026-01,1,2\n2026-02,,3");
  const text = formatCompare(compare);
  expect(text).toContain("A  Alpha");
  expect(text).toContain("n.d.");
});
