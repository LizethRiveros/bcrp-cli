import { expect, test } from "bun:test";
import { findByCode, loadCatalog } from "./catalog";
import { SHORTCUTS, closest, resolveCode, shortcutWords } from "./shortcuts";

test("every shortcut points at a real catalog series", () => {
  const { entries } = loadCatalog();
  for (const [name, s] of Object.entries(SHORTCUTS)) {
    expect(findByCode(entries, s.code), `${name} -> ${s.code}`).toBeDefined();
  }
});

test("shortcut names and aliases never collide", () => {
  const words = Object.entries(SHORTCUTS).flatMap(([name, s]) => [name, ...s.aliases]);
  expect(new Set(words).size).toBe(words.length);
});

test("new shortcuts resolve by name and alias", () => {
  expect(resolveCode("euro")).toBe("PD04648PD");
  expect(resolveCode("EUR")).toBe("PD04648PD");
  expect(resolveCode("plata")).toBe("PD04702XD");
  expect(resolveCode("balanza")).toBe("PN38723BM");
});

test("closest suggests plausible typos only", () => {
  expect(closest("compre", ["compare", "change"])).toBe("compare");
  expect(closest("inflacon", shortcutWords())).toBe("inflacion");
  expect(closest("zzzzzz", ["compare", "change"])).toBeUndefined();
  expect(closest("", ["a"])).toBeUndefined();
});
