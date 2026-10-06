import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedFetch } from "./cache";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bcrp-cache-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A base fetch that counts calls and answers with `body`. */
function base(body: string, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("a repeated request is served from the cache", async () => {
  const { calls, impl } = base('{"periods":[]}');
  const f = cachedFetch(impl, { dir });
  expect(await (await f("https://x/a")).text()).toBe('{"periods":[]}');
  expect(await (await f("https://x/a")).text()).toBe('{"periods":[]}');
  expect(calls).toHaveLength(1);
  await f("https://x/b"); // a different URL is a different entry
  expect(calls).toHaveLength(2);
});

test("entries expire after the TTL", async () => {
  const { calls, impl } = base('{"a":1}');
  let t = 1_000_000;
  const f = cachedFetch(impl, { dir, ttlMs: 60_000, now: () => t });
  await f("https://x/a");
  t += 59_000;
  await f("https://x/a");
  expect(calls).toHaveLength(1);
  t += 2_000;
  await f("https://x/a");
  expect(calls).toHaveLength(2);
});

test("anti-bot pages and errors are never cached", async () => {
  const html = base("<!DOCTYPE html><html>challenge</html>");
  const f = cachedFetch(html.impl, { dir });
  await f("https://x/a");
  await f("https://x/a");
  expect(html.calls).toHaveLength(2);
  expect(readdirSync(dir)).toHaveLength(0);

  const err = base('{"error":true}', 503);
  const g = cachedFetch(err.impl, { dir });
  expect((await g("https://x/b")).status).toBe(503);
  await g("https://x/b");
  expect(err.calls).toHaveLength(2);
});

test("old entries are pruned when something new is written", async () => {
  const stale = join(dir, "stale.json");
  writeFileSync(stale, "{}");
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(stale, old, old);
  await cachedFetch(base('{"a":1}').impl, { dir })("https://x/a");
  expect(readdirSync(dir)).not.toContain("stale.json");
});

test("a broken cache directory degrades to plain fetching", async () => {
  const { calls, impl } = base('{"a":1}');
  const file = join(dir, "not-a-dir");
  writeFileSync(file, "x"); // a file where the cache directory should be
  const f = cachedFetch(impl, { dir: join(file, "cache") });
  expect(await (await f("https://x/a")).text()).toBe('{"a":1}');
  expect(await (await f("https://x/a")).text()).toBe('{"a":1}');
  expect(calls).toHaveLength(2);
});
