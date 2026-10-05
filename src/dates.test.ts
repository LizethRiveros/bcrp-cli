import { expect, test } from "bun:test";
import { dateFromInput, frequencyFromCode, parseFrequency, rangeBack, toApiDate } from "./dates";

test("frequencyFromCode reads the trailing letter", () => {
  expect(frequencyFromCode("PD04638PD")).toBe("daily");
  expect(frequencyFromCode("pn01271pm")).toBe("monthly");
  expect(frequencyFromCode("PN02436FQ")).toBe("quarterly");
  expect(frequencyFromCode("PM05568XA")).toBe("annual");
  expect(frequencyFromCode("PD04638PX")).toBeUndefined();
});

test("parseFrequency accepts English and Spanish", () => {
  expect(parseFrequency("daily")).toBe("daily");
  expect(parseFrequency("Mensual")).toBe("monthly");
  expect(parseFrequency("trimestral")).toBe("quarterly");
  expect(parseFrequency("nope")).toBeUndefined();
});

test("toApiDate adapts input to each frequency", () => {
  expect(toApiDate("2026-09-15", "daily", "from")).toBe("2026-9-15");
  expect(toApiDate("2026-09", "daily", "from")).toBe("2026-9-1");
  expect(toApiDate("2026-09", "daily", "to")).toBe("2026-9-30");
  expect(toApiDate("2024-02", "daily", "to")).toBe("2024-2-29"); // leap year
  expect(toApiDate("2026", "daily", "to")).toBe("2026-12-31");
  expect(toApiDate("2026-09-15", "monthly", "from")).toBe("2026-9");
  expect(toApiDate("2026", "monthly", "from")).toBe("2026-1");
  expect(toApiDate("2026", "monthly", "to")).toBe("2026-12");
  expect(toApiDate("2024-Q2", "quarterly", "from")).toBe("2024-2");
  expect(toApiDate("T3-2024", "quarterly", "to")).toBe("2024-3");
  expect(toApiDate("2024-08", "quarterly", "to")).toBe("2024-3");
  expect(toApiDate("2024-Q2", "monthly", "from")).toBe("2024-4");
  expect(toApiDate("2024-Q2", "monthly", "to")).toBe("2024-6");
  expect(toApiDate("2024-08-10", "annual", "from")).toBe("2024");
});

test("toApiDate rejects invalid dates", () => {
  expect(() => toApiDate("2026-13", "monthly", "from")).toThrow(/Invalid date/);
  expect(() => toApiDate("2026-00-10", "daily", "from")).toThrow(/Invalid date/);
  expect(() => toApiDate("yesterday", "daily", "from")).toThrow(/Invalid date/);
  expect(() => toApiDate("2024-Q5", "quarterly", "from")).toThrow(/Invalid date/);
});

test("rangeBack covers at least N periods ending at the given date", () => {
  const now = new Date(2026, 9, 5); // 2026-10-05
  expect(rangeBack("monthly", 12, now)).toEqual({ from: "2025-11", to: "2026-10" });
  expect(rangeBack("monthly", 1, now)).toEqual({ from: "2026-10", to: "2026-10" });
  expect(rangeBack("quarterly", 8, now)).toEqual({ from: "2025-1", to: "2026-4" });
  expect(rangeBack("annual", 10, now)).toEqual({ from: "2017", to: "2026" });
  const daily = rangeBack("daily", 5, now);
  expect(daily.to).toBe("2026-10-5");
  expect(daily.from).toBe("2026-9-24"); // 5 business days = 7 calendar days, plus 4 days of slack
});

test("dateFromInput gives period boundaries", () => {
  expect(dateFromInput("2026-09", "from")).toEqual(new Date(2026, 8, 1));
  expect(dateFromInput("2026-09", "to")).toEqual(new Date(2026, 8, 30));
  expect(dateFromInput("2025-Q4", "to")).toEqual(new Date(2025, 11, 31));
  expect(dateFromInput("2025", "from")).toEqual(new Date(2025, 0, 1));
});
