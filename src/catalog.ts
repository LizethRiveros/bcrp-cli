import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Frequency, parseFrequency } from "./dates";
import { SHORTCUTS } from "./shortcuts";
import bundled from "../data/catalog.json";

export const METADATA_URL = "https://estadisticas.bcrp.gob.pe/estadisticas/series/metadata";

export interface CatalogEntry {
  code: string;
  category: string;
  group: string;
  name: string;
  frequency: Frequency;
  start: string;
  end: string;
  /** Who produces the data (BCRP, INEI, empresas bancarias, ...) */
  source?: string;
  description?: string;
  /** Pointer to the methodology (usually a link) */
  methodology?: string;
  /** When BCRPData last updated this series (YYYY-MM-DD) */
  updated?: string;
}

/** Compact on-disk format: repeated strings are stored once in `strings`. */
export interface EncodedCatalog {
  generatedAt: string;
  count: number;
  strings: string[];
  /** [code, categoryIdx, groupIdx, name, frequency letter, start, end] */
  rows: [string, number, number, string, string, string, string, number?, string?, number?, number?][];
  /** For rows with the optional tail: [..., sourceIdx, description, methodologyIdx, updatedIdx], -1 meaning "none" */
}

const LETTER: Record<Frequency, string> = { daily: "D", monthly: "M", quarterly: "Q", annual: "A" };
const FROM_LETTER: Record<string, Frequency> = { D: "daily", M: "monthly", Q: "quarterly", A: "annual" };

/** The BCRP metadata export is a semicolon-separated windows-1252 file. */
export function decodeCatalogBytes(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}

export function parseCatalogCsv(text: string): CatalogEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const entries: CatalogEntry[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(";");
    const frequency = parseFrequency(c[10] ?? "");
    if (!c[0] || !frequency) continue;
    const entry: CatalogEntry = {
      code: c[0].trim(),
      category: (c[1] ?? "").trim(),
      group: (c[2] ?? "").trim(),
      name: (c[3] ?? "").trim(),
      frequency,
      start: (c[15] ?? "").trim(),
      end: (c[16] ?? "").trim(),
    };
    const optional = { source: c[9], description: c[4], methodology: c[5], updated: c[14] };
    for (const [key, value] of Object.entries(optional)) {
      const v = value?.trim();
      if (v) entry[key as "source" | "description" | "methodology" | "updated"] = v.length > 400 ? `${v.slice(0, 399)}…` : v;
    }
    entries.push(entry);
  }
  return entries;
}

export function encodeCatalog(entries: CatalogEntry[], generatedAt = new Date().toISOString()): EncodedCatalog {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const intern = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  return {
    generatedAt,
    count: entries.length,
    strings,
    rows: entries.map((e) => [
      e.code,
      intern(e.category),
      intern(e.group),
      e.name,
      LETTER[e.frequency],
      e.start,
      e.end,
      e.source ? intern(e.source) : -1,
      e.description ?? "",
      e.methodology ? intern(e.methodology) : -1,
      e.updated ? intern(e.updated) : -1,
    ]),
  };
}

/** Also reads catalogs saved by older versions, whose rows have only the first seven fields. */
export function decodeCatalog(data: EncodedCatalog): CatalogEntry[] {
  const str = (i: number | undefined) => (i !== undefined && i >= 0 ? data.strings[i] : undefined);
  return data.rows.map(([code, cat, group, name, f, start, end, source, description, methodology, updated]) => {
    const entry: CatalogEntry = {
      code,
      category: data.strings[cat]!,
      group: data.strings[group]!,
      name,
      frequency: FROM_LETTER[f]!,
      start,
      end,
    };
    const s = str(source);
    const m = str(methodology);
    const u = str(updated);
    if (s) entry.source = s;
    if (description) entry.description = description;
    if (m) entry.methodology = m;
    if (u) entry.updated = u;
    return entry;
  });
}

export function userCatalogPath(): string {
  return join(homedir(), ".bcrp", "catalog.json");
}

let loaded: { entries: CatalogEntry[]; generatedAt: string; source: "bundled" | "user" } | undefined;

/** Loads the refreshed catalog from ~/.bcrp if present, otherwise the one bundled with the package. */
export function loadCatalog() {
  if (loaded) return loaded;
  const file = userCatalogPath();
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as EncodedCatalog;
      loaded = { entries: decodeCatalog(data), generatedAt: data.generatedAt, source: "user" };
      return loaded;
    } catch {
      // fall back to the bundled catalog
    }
  }
  const data = bundled as unknown as EncodedCatalog;
  loaded = { entries: decodeCatalog(data), generatedAt: data.generatedAt, source: "bundled" };
  return loaded;
}

export function saveUserCatalog(data: EncodedCatalog): string {
  const file = userCatalogPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  loaded = undefined;
  return file;
}

export async function downloadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const res = await fetchImpl(METADATA_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`BCRP metadata download failed: ${res.status}`);
  const entries = parseCatalogCsv(decodeCatalogBytes(await res.arrayBuffer()));
  if (entries.length < 1000) throw new Error(`Unexpected catalog size (${entries.length} series); aborting`);
  return entries;
}

export function findByCode(entries: CatalogEntry[], code: string): CatalogEntry | undefined {
  const c = code.trim().toUpperCase();
  return entries.find((e) => e.code.toUpperCase() === c);
}

// ---------- search ----------

export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** English -> Spanish terms so agents (and people) can search in either language. */
const SYNONYMS: Record<string, string> = {
  inflation: "inflacion",
  exchange: "cambio",
  fx: "cambio",
  gdp: "pbi",
  reserves: "reservas",
  interest: "interes",
  copper: "cobre",
  gold: "oro",
  silver: "plata",
  exports: "exportaciones",
  imports: "importaciones",
  export: "exportaciones",
  import: "importaciones",
  unemployment: "desempleo",
  employment: "empleo",
  deposits: "depositos",
  credit: "credito",
  loans: "creditos",
  debt: "deuda",
  trade: "comercial",
  oil: "petroleo",
  sugar: "azucar",
  wheat: "trigo",
  coffee: "cafe",
  dollar: "dolar",
  usd: "dolar",
  "t-bill": "letras",
  policy: "politica",
  reference: "referencia",
  monetary: "monetaria",
  banks: "bancarias",
  prices: "cotizaciones",
  price: "cotizaciones",
};

/** Filler words dropped from queries (unless that would leave nothing to search for). */
const STOPWORDS = new Set([
  "the", "of", "in", "for", "and", "de", "del", "la", "el", "los", "las", "en", "y", "por", "per",
  "rate", "rates", "index",
]);

/** Headline indicators (the shortcuts) rank above look-alikes when they match. */
const HEADLINE = new Set(Object.values(SHORTCUTS).map((s) => s.code));

interface Indexed {
  /** Lowercased, accent-free, punctuation replaced by spaces and padded with spaces: word-prefix matching is ` ${token}`. */
  name: string;
  group: string;
  category: string;
  code: string;
  endYear: number;
}

const index = new WeakMap<CatalogEntry, Indexed>();

/** Accent-free lowercase text with punctuation turned into single spaces, padded so " word" matches word starts. */
function words(s: string): string {
  return ` ${normalizeText(s).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function indexed(e: CatalogEntry): Indexed {
  let i = index.get(e);
  if (!i) {
    const year = e.end.match(/\d{4}/)?.[0];
    i = {
      name: words(e.name),
      group: words(e.group),
      category: words(e.category),
      code: e.code.toLowerCase(),
      endYear: year ? Number(year) : 0,
    };
    index.set(e, i);
  }
  return i;
}

export interface SearchOptions {
  frequency?: Frequency;
  limit?: number;
  now?: Date;
}

/**
 * Every query word must match the start of a word in the series name, category or group (or its code).
 * Ranked by where the words match (category/name > group), whole-phrase matches, and whether the series is still active.
 */
export function searchCatalog(
  entries: CatalogEntry[],
  query: string,
  { frequency, limit = 20, now = new Date() }: SearchOptions = {},
): CatalogEntry[] {
  const q = normalizeText(query).trim();
  if (!q) return [];
  const exact = entries.find((e) => e.code.toLowerCase() === q);
  if (exact) return [exact];

  const raw = q.split(/\s+/);
  const meaningful = raw.filter((t) => !STOPWORDS.has(t));
  const tokens = (meaningful.length > 0 ? meaningful : raw).map((t) => SYNONYMS[t] ?? t);
  const needles = tokens.map((t) => ` ${t}`);
  const phrase = tokens.length > 1 ? ` ${tokens.join(" ")}` : "";
  const year = now.getFullYear();
  const scored: { e: CatalogEntry; score: number }[] = [];

  for (const e of entries) {
    if (frequency && e.frequency !== frequency) continue;
    const i = indexed(e);
    let score = 0;
    let ok = true;
    for (let k = 0; k < needles.length; k++) {
      const n = needles[k]!;
      const inName = i.name.includes(n);
      const inCategory = i.category.includes(n);
      const inGroup = i.group.includes(n);
      if (!inName && !inCategory && !inGroup && !i.code.startsWith(tokens[k]!)) {
        ok = false;
        break;
      }
      if (inName) score += 3;
      if (inCategory) score += 3;
      if (inGroup) score += 2;
    }
    if (!ok) continue;
    if (phrase && (i.name.includes(phrase) || i.category.includes(phrase) || i.group.includes(phrase))) score += 4;
    if (HEADLINE.has(e.code)) score += 4;
    if (i.endYear >= year - 1) score += 2;
    else if (i.endYear < 2000) score -= 2;
    score -= i.name.length / 200;
    scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length || a.e.code.localeCompare(b.e.code));
  return scored.slice(0, limit).map((s) => s.e);
}
