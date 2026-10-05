#!/usr/bin/env node
import pkg from "../package.json";
import { describeSeries, getLatest, getSeries, isSeriesInput, searchSeries } from "./api";
import { downloadCatalog, encodeCatalog, loadCatalog, saveUserCatalog } from "./catalog";
import { FREQUENCIES, parseFrequency } from "./dates";
import { formatInfo, formatLatest, formatSearch, formatSeries, formatShortcuts } from "./format";
import { SHORTCUTS } from "./shortcuts";

const HELP = `bcrp ${pkg.version} - BCRP (Banco Central de Reserva del Perú) statistics from the terminal

Usage:
  bcrp <shortcut>                    Latest value of a headline indicator
  bcrp <shortcut|CODE> --last 12     Recent observations
  bcrp get <shortcut|CODE> [--from D] [--to D] [--last N]
  bcrp latest <shortcut|CODE>        Most recent value
  bcrp search <text> [--freq F] [--limit N]
  bcrp info <shortcut|CODE>          Describe a series
  bcrp shortcuts                     List headline indicators
  bcrp catalog [update]              Show or refresh the local series catalog
  bcrp mcp                           Run as an MCP server (stdio) for AI agents

Shortcuts: ${Object.keys(SHORTCUTS).join(", ")}

Dates: YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn.   Frequencies: ${FREQUENCIES.join(", ")}.

Output: a table in a terminal, JSON when piped. Force with --json / --table.

Examples:
  bcrp fx
  bcrp inflation --last 12
  bcrp search "tasa de interés" --freq monthly
  bcrp get PD04638PD --from 2026-01 --to 2026-09 --json
`;

const BOOLEAN_FLAGS = new Set(["json", "table", "help", "version"]);
const VALUE_FLAGS = new Set(["from", "to", "last", "freq", "limit"]);

interface Parsed {
  flags: Record<string, string | true>;
  positional: string[];
}

function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h") flags.help = true;
    else if (arg === "-v") flags.version = true;
    else if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
      else if (VALUE_FLAGS.has(key)) {
        const value = inline ?? argv[++i];
        if (value === undefined) throw new UsageError(`--${key} needs a value`);
        flags[key] = value;
      } else throw new UsageError(`Unknown option --${key}`);
    } else positional.push(arg);
  }
  return { flags, positional };
}

class UsageError extends Error {}

function intFlag(flags: Parsed["flags"], key: string): number | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${key} must be a positive integer`);
  return n;
}

function strFlag(flags: Parsed["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;

  const json = flags.json === true || (flags.table !== true && !process.stdout.isTTY);
  const out = (data: unknown, text: () => string) => console.log(json ? JSON.stringify(data, null, 2) : text());

  if (flags.version) return console.log(pkg.version);
  if (!cmd || cmd === "help" || flags.help) return console.log(HELP);

  const hasRange = flags.from !== undefined || flags.to !== undefined || flags.last !== undefined;
  const query = () => ({
    from: strFlag(flags, "from"),
    to: strFlag(flags, "to"),
    last: intFlag(flags, "last"),
  });

  const series = async (input: string | undefined) => {
    if (!input) throw new UsageError("Missing series. Pass a shortcut (fx, inflation, ...) or a series code.");
    if (hasRange) {
      const s = await getSeries({ series: input, ...query() });
      out(s, () => formatSeries(s));
    } else {
      const l = await getLatest(input);
      out(l, () => formatLatest(l));
    }
  };

  switch (cmd) {
    case "get": {
      const input = rest[0];
      if (!input) throw new UsageError("Usage: bcrp get <shortcut|CODE> [--from D] [--to D] [--last N]");
      const s = await getSeries({ series: input, ...query() });
      return out(s, () => formatSeries(s));
    }
    case "latest":
      if (!rest[0]) throw new UsageError("Usage: bcrp latest <shortcut|CODE>");
      return series(rest[0]);
    case "search": {
      const text = rest.join(" ").trim();
      if (!text) throw new UsageError('Usage: bcrp search <text> [--freq daily|monthly|quarterly|annual] [--limit N]');
      const freqInput = strFlag(flags, "freq");
      const frequency = freqInput ? parseFrequency(freqInput) : undefined;
      if (freqInput && !frequency) throw new UsageError(`--freq must be one of: ${FREQUENCIES.join(", ")}`);
      const results = searchSeries(text, { frequency, limit: intFlag(flags, "limit") });
      return out(results, () => formatSearch(results));
    }
    case "info": {
      if (!rest[0]) throw new UsageError("Usage: bcrp info <shortcut|CODE>");
      const info = describeSeries(rest[0]);
      return out(info, () => formatInfo(info));
    }
    case "shortcuts":
      return out(SHORTCUTS, formatShortcuts);
    case "catalog": {
      if (rest[0] === "update") {
        console.error("Downloading the BCRP series catalog (~7 MB)...");
        const entries = await downloadCatalog();
        const file = saveUserCatalog(encodeCatalog(entries));
        return console.log(`Updated catalog: ${entries.length} series saved to ${file}`);
      }
      const { entries, generatedAt, source } = loadCatalog();
      const info = { series: entries.length, generatedAt, source };
      return out(info, () => `${info.series} series (${source} catalog, generated ${generatedAt})`);
    }
    case "mcp": {
      const { startMcpServer } = await import("./mcp");
      return startMcpServer();
    }
    default:
      if (isSeriesInput(cmd)) return series(cmd);
      throw new UsageError(`Unknown command "${cmd}". Run \`bcrp help\`.`);
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const jsonErrors = process.argv.includes("--json") || !process.stderr.isTTY;
  console.error(jsonErrors ? JSON.stringify({ error: message }) : `error: ${message}`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
