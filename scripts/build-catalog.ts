/**
 * Regenerates data/catalog.json from the BCRP metadata export.
 *
 *   bun scripts/build-catalog.ts            # download from BCRPData
 *   bun scripts/build-catalog.ts file.csv   # use a local copy
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeCatalogBytes, downloadCatalog, encodeCatalog, parseCatalogCsv } from "../src/catalog";

const local = process.argv[2];
const entries = local
  ? parseCatalogCsv(decodeCatalogBytes(readFileSync(local)))
  : await downloadCatalog();

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json");
writeFileSync(out, JSON.stringify(encodeCatalog(entries)));
console.log(`wrote ${entries.length} series to ${out}`);
