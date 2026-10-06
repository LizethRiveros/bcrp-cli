import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How long a cached answer is reused. The BCRP publishes at most daily, so a few minutes is safe. */
export const CACHE_TTL_MS = 10 * 60 * 1000;
/** Entries older than this are deleted when something new is written. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export function cacheDir(): string {
  return join(homedir(), ".bcrp", "cache");
}

export function cacheEnabled(): boolean {
  return process.env.BCRP_NO_CACHE !== "1";
}

interface Entry {
  t: number;
  body: string;
}

/** Only answers that actually contain data are cached, never the anti-bot page or errors. */
function looksLikeData(body: string): boolean {
  return body.trimStart().startsWith("{");
}

function prune(dir: string, now: number) {
  try {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (now - statSync(file).mtimeMs > PRUNE_AFTER_MS) unlinkSync(file);
    }
  } catch {
    // best effort
  }
}

/** Wraps `fetch` with a small on-disk cache keyed by URL. Any filesystem problem just means no caching. */
export function cachedFetch(
  base: typeof fetch = fetch,
  { dir = cacheDir(), ttlMs = CACHE_TTL_MS, now = Date.now }: { dir?: string; ttlMs?: number; now?: () => number } = {},
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const file = join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);

    try {
      const entry = JSON.parse(readFileSync(file, "utf8")) as Entry;
      if (now() - entry.t < ttlMs) return new Response(entry.body);
    } catch {
      // miss or unreadable entry
    }

    const res = await base(input, init);
    if (!res.ok) return res;
    const body = await res.text();
    if (looksLikeData(body)) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ t: now(), body } satisfies Entry));
        prune(dir, now());
      } catch {
        // read-only home, full disk, ...: carry on without caching
      }
    }
    return new Response(body, { status: res.status });
  }) as typeof fetch;
}
