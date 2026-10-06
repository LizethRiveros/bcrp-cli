/**
 * Regenerates data/catalog.json from the BCRP metadata export.
 *
 *   bun scripts/build-catalog.ts            # download from BCRPData
 *   bun scripts/build-catalog.ts file.csv   # use a local copy
 *
 * Leaves the file untouched when nothing changed (the generation date alone is not a change), and refuses to
 * replace it with a catalog that is much smaller than the current one (a truncated download).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EncodedCatalog,
  decodeCatalogBytes,
  downloadCatalog,
  encodeCatalog,
  parseCatalogCsv,
} from "../src/catalog";

const MIN_RATIO = 0.9;

const local = process.argv[2];
const entries = local ? parseCatalogCsv(decodeCatalogBytes(readFileSync(local))) : await downloadCatalog();
const next = encodeCatalog(entries);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json");
const current: EncodedCatalog | undefined = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;

if (current && current.count > 0) {
  if (next.count < current.count * MIN_RATIO) {
    console.error(`refusing to replace ${current.count} series with only ${next.count}: the download looks incomplete`);
    process.exit(1);
  }
  const same = (a: EncodedCatalog, b: EncodedCatalog) =>
    JSON.stringify([a.strings, a.rows]) === JSON.stringify([b.strings, b.rows]);
  if (same(current, next)) {
    console.log(`catalog unchanged (${current.count} series)`);
    process.exit(0);
  }
}

writeFileSync(out, JSON.stringify(next));
console.log(`wrote ${entries.length} series to ${out}` + (current ? ` (was ${current.count})` : ""));
