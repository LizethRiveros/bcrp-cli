/**
 * Builds docs/series/: a search-and-download page over the whole BCRP catalog (no terminal, no codes).
 *
 *   bun run series
 *
 * The page searches in the browser over docs/series/catalog.json (a slim copy of data/catalog.json) and downloads
 * through the /api/serie function (api-src/serie.ts), because the BCRP API sends no CORS headers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADLINE, STOPWORDS, SYNONYMS, loadCatalog } from "../src/catalog";

const API_BASE = process.env.API_BASE ?? "https://bcrp-cli.vercel.app";
const LETTER = { daily: "D", monthly: "M", quarterly: "Q", annual: "A" } as const;

const { entries } = loadCatalog();
const strings: string[] = [];
const index = new Map<string, number>();
const idx = (s: string) => {
  let i = index.get(s);
  if (i === undefined) {
    i = strings.length;
    strings.push(s);
    index.set(s, i);
  }
  return i;
};

// [code, categoryIdx, groupIdx, name, frequency letter, start, end, sourceIdx or -1]
const rows = entries.map((e) => [e.code, idx(e.category), idx(e.group), e.name, LETTER[e.frequency], e.start, e.end, e.source ? idx(e.source) : -1]);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "docs", "series");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "catalog.json"), JSON.stringify({ strings, rows, synonyms: SYNONYMS, stopwords: [...STOPWORDS], headline: Object.fromEntries(HEADLINE) }));

const template = readFileSync(join(here, "series.template.html"), "utf8");
writeFileSync(
  join(outDir, "index.html"),
  template.replace("{{COUNT}}", () => entries.length.toLocaleString("es-PE")).replace("{{API_BASE}}", () => API_BASE),
);
console.log(`wrote docs/series/ (${entries.length} series, ${strings.length} shared strings)`);
