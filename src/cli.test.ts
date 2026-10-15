import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** Runs the CLI as a subprocess. Only offline commands are used here (catalog and usage errors). */
async function bcrp(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, BCRP_NO_CACHE: "1" } });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

test("--version and help", async () => {
  expect((await bcrp("--version")).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  const help = await bcrp("help");
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("bcrp stats");
});

test("shortcuts prints JSON when piped", async () => {
  const r = await bcrp("shortcuts");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.stdout).fx.code).toBe("PD04638PD");
});

test("search and info work offline", async () => {
  const search = JSON.parse((await bcrp("search", "tipo de cambio", "--limit", "1")).stdout);
  expect(search[0].code).toBe("PD04638PD");
  const info = JSON.parse((await bcrp("info", "euro")).stdout);
  expect(info.shortcut).toBe("euro");
});

test("usage errors exit 2 with a JSON error and a suggestion", async () => {
  const typo = await bcrp("compre", "fx", "euro");
  expect(typo.code).toBe(2);
  expect(JSON.parse(typo.stderr).error).toContain('did you mean "compare"');
  expect((await bcrp("get", "fx", "--nope")).code).toBe(2);
  expect((await bcrp("convert", "abc", "usd")).code).toBe(2);
  expect((await bcrp("convert", "10", "usd", "--to", "eur")).code).toBe(1); // cross rate: refused before any request
  expect((await bcrp("check", "fx")).code).toBe(2);
});
