import { expect, test } from "bun:test";
import { computeChange, convertAmount, isOver, isRateLike, periodStart, shiftBack } from "./calc";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

test("periodStart reads every label shape", () => {
  expect(periodStart("2026-09-02")).toEqual(d(2026, 9, 2));
  expect(periodStart("2026-09")).toEqual(d(2026, 9, 1));
  expect(periodStart("2026-Q3")).toEqual(d(2026, 7, 1));
  expect(periodStart("2026")).toEqual(d(2026, 1, 1));
  expect(() => periodStart("soon")).toThrow(/Unrecognized period/);
});

test("shiftBack clamps month steps to the end of shorter months", () => {
  expect(shiftBack(d(2026, 3, 31), "1m")).toEqual(d(2026, 2, 28));
  expect(shiftBack(d(2024, 3, 31), "1m")).toEqual(d(2024, 2, 29)); // leap year
  expect(shiftBack(d(2024, 2, 29), "1y")).toEqual(d(2023, 2, 28));
  expect(shiftBack(d(2026, 1, 15), "1m")).toEqual(d(2025, 12, 15)); // across a year
  expect(shiftBack(d(2026, 10, 5), "3m")).toEqual(d(2026, 7, 5));
  expect(shiftBack(d(2026, 10, 5), "6m")).toEqual(d(2026, 4, 5));
  expect(shiftBack(d(2026, 10, 5), "1w")).toEqual(d(2026, 9, 28));
  expect(shiftBack(d(2026, 10, 5), "ytd")).toEqual(d(2025, 12, 31));
});

test("isOver", () => {
  expect(isOver("ytd")).toBe(true);
  expect(isOver("2m")).toBe(false);
});

const daily = [
  { period: "2026-09-02", value: 3.36 },
  { period: "2026-09-03", value: 3.37 },
  { period: "2026-09-04", value: 3.365 }, // Friday
  { period: "2026-09-07", value: 3.4 },
  { period: "2026-10-02", value: 3.4 }, // Friday
  { period: "2026-10-05", value: 3.5 },
];

test("computeChange uses the last observation at or before the target date (weekends)", () => {
  // Oct 5 minus 1 month = Sep 5 (a Saturday): the base is Friday Sep 4.
  const c = computeChange(daily, "1m")!;
  expect(c.base).toEqual({ period: "2026-09-04", value: 3.365 });
  expect(c.latest).toEqual({ period: "2026-10-05", value: 3.5 });
  expect(c.change).toBeCloseTo(0.135, 10);
  expect(c.changePct).toBeCloseTo((0.135 / 3.365) * 100, 10);
  // Oct 5 minus 1 week = Sep 28, but the nearest earlier observation is 3 weeks before: no honest base.
  expect(computeChange(daily, "1w")).toBeUndefined();
});

test("computeChange on monthly, quarterly and annual series", () => {
  const monthly = [
    { period: "2025-12", value: 100 },
    { period: "2026-07", value: 110 },
    { period: "2026-08", value: 121 },
  ];
  expect(computeChange(monthly, "1m")!.base.period).toBe("2026-07");
  expect(computeChange(monthly, "1m")!.changePct).toBeCloseTo(10, 10);
  expect(computeChange(monthly, "ytd")!.base.period).toBe("2025-12"); // end of last year
  const quarterly = [
    { period: "2024-Q4", value: 2 },
    { period: "2025-Q4", value: 3 },
  ];
  expect(computeChange(quarterly, "1y")!.base.period).toBe("2024-Q4");
  const annual = [
    { period: "2024", value: 50 },
    { period: "2025", value: 60 },
  ];
  expect(computeChange(annual, "1y")!.changePct).toBeCloseTo(20, 10);
});

test("computeChange skips nulls and refuses when there is no usable base", () => {
  expect(computeChange([{ period: "2026-08", value: null }], "1m")).toBeUndefined();
  expect(computeChange([], "1m")).toBeUndefined();
  // not enough history
  expect(computeChange([{ period: "2026-08", value: 4 }], "1y")).toBeUndefined();
  // a weekly change of a monthly series would compare an observation with itself
  expect(
    computeChange(
      [
        { period: "2026-07", value: 1 },
        { period: "2026-08", value: 2 },
      ],
      "1w",
    ),
  ).toBeUndefined();
  const withGap = [
    { period: "2026-07", value: 1 },
    { period: "2026-08", value: null },
    { period: "2026-09", value: 3 },
  ];
  // Sep minus 1m is Aug, which is null: do NOT silently compare against July.
  expect(computeChange(withGap, "1m")).toBeUndefined();
  expect(computeChange(withGap, "3m")).toBeUndefined();
});

test("rate-like series report points only; a zero base has no percentage", () => {
  const pts = [
    { period: "2025-08", value: 1.1 },
    { period: "2026-08", value: 4.4 },
  ];
  const c = computeChange(pts, "1y", { rateLike: true })!;
  expect(c.change).toBeCloseTo(3.3, 10);
  expect(c.changePct).toBeNull();
  expect(
    computeChange(
      [
        { period: "2025-08", value: 0 },
        { period: "2026-08", value: 5 },
      ],
      "1y",
    )!.changePct,
  ).toBeNull();
  expect(isRateLike("Índice de precios (var% 12 meses) - IPC")).toBe(true);
  expect(isRateLike("Tasa de Referencia de la Política Monetaria")).toBe(true);
  expect(isRateLike("Reservas internacionales (millones US$)")).toBe(false);
  expect(isRateLike("TC Interbancario (S/ por US$) - Venta")).toBe(false);
});

test("convertAmount", () => {
  expect(convertAmount(100, "usd", 3.4)).toBeCloseTo(340, 10);
  expect(convertAmount(340, "pen", 3.4)).toBeCloseTo(100, 10);
});

test("a period shorter than the series' frequency is refused, longer ones are fine", () => {
  const monthly = [
    { period: "2026-06", value: 1 },
    { period: "2026-07", value: 2 },
    { period: "2026-08", value: 3 },
  ];
  expect(computeChange(monthly, "1w")).toBeUndefined();
  expect(computeChange(monthly, "1m")!.base.period).toBe("2026-07");
  expect(computeChange(monthly, "3m")).toBeUndefined(); // no May in the data
  const quarterly = [
    { period: "2025-Q3", value: 5 },
    { period: "2025-Q4", value: 6 },
  ];
  expect(computeChange(quarterly, "1m")).toBeUndefined();
  expect(computeChange(quarterly, "3m")!.base.period).toBe("2025-Q3");
  const annual = [
    { period: "2024", value: 1 },
    { period: "2025", value: 2 },
  ];
  expect(computeChange(annual, "6m")).toBeUndefined();
  expect(computeChange(annual, "1y")!.base.period).toBe("2024");
  // year-to-date is only meaningful once the year has started
  expect(computeChange([{ period: "2025-12", value: 1 }, { period: "2026-01", value: 2 }], "ytd")).toBeUndefined();
});
