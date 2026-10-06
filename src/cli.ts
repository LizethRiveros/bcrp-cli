#!/usr/bin/env node
import pkg from "../package.json";
import { compareSeries, describeSeries, getLatest, getSeries, isSeriesInput, searchSeries } from "./api";
import { OVERS, type Over, isOver } from "./calc";
import { downloadCatalog, encodeCatalog, loadCatalog, saveUserCatalog } from "./catalog";
import { FREQUENCIES, parseFrequency } from "./dates";
import {
  csvChange,
  csvCompare,
  csvConversion,
  csvLatest,
  csvSearch,
  csvSeries,
  formatChange,
  formatCheck,
  formatCompare,
  formatConversion,
  formatInfo,
  formatLatest,
  formatSearch,
  formatSeries,
  formatShortcuts,
} from "./format";
import { type FxSide, checkThreshold, convertCurrency, getChange } from "./insights";
import { SHORTCUTS } from "./shortcuts";

const HELP = `bcrp ${pkg.version} - BCRP (Banco Central de Reserva del Perú) statistics from the terminal

Usage:
  bcrp <shortcut>                    Latest value of a headline indicator
  bcrp <shortcut|CODE> --last 12     Recent observations
  bcrp get <shortcut|CODE> [--from D] [--to D] [--last N]
  bcrp latest <shortcut|CODE>        Most recent value
  bcrp compare <A> <B> [...] [--last N]   Line up 2-6 series of the same frequency
  bcrp change <shortcut|CODE> [--over 1w|1m|3m|6m|1y|ytd]   How much it moved
  bcrp convert <amount> <usd|pen> [--date D] [--side buy|sell]   Convert at the BCRP rate
  bcrp check <shortcut|CODE> --above N | --below N   Alert check for scripts (exit 0 = triggered, 3 = not)
  bcrp search <text> [--freq F] [--limit N]
  bcrp info <shortcut|CODE>          Describe a series
  bcrp shortcuts                     List headline indicators
  bcrp catalog [update]              Show or refresh the local series catalog
  bcrp mcp                           Run as an MCP server (stdio) for AI agents

Shortcuts: ${Object.keys(SHORTCUTS).join(", ")}

Dates: YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn.   Frequencies: ${FREQUENCIES.join(", ")}.

Output: a table in a terminal, JSON when piped. Force with --json / --table, or export with --csv.
Responses are cached for 10 minutes in ~/.bcrp/cache; skip it with --no-cache.

Examples:
  bcrp fx
  bcrp inflation --last 12
  bcrp search "tasa de interés" --freq monthly
  bcrp get PD04638PD --from 2026-01 --to 2026-09 --json
  bcrp compare inflation rate --last 12
  bcrp get fx --from 2026-01 --csv > fx.csv
  bcrp change fx --over ytd
  bcrp convert 100 usd
  bcrp check fx --above 3.5 && echo "the dollar is above 3.50"
`;

const BOOLEAN_FLAGS = new Set(["json", "table", "csv", "no-cache", "help", "version"]);
const VALUE_FLAGS = new Set(["from", "to", "last", "freq", "limit", "over", "side", "date", "above", "below"]);

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
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        if (key === "no-cache") process.env.BCRP_NO_CACHE = "1";
      }
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
  const out = (data: unknown, text: () => string, csv?: () => string) => {
    if (flags.csv === true) {
      if (!csv) throw new UsageError("--csv is not available for this command");
      return console.log(csv());
    }
    console.log(json ? JSON.stringify(data, null, 2) : text());
  };

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
      out(s, () => formatSeries(s), () => csvSeries(s));
    } else {
      const l = await getLatest(input);
      out(l, () => formatLatest(l), () => csvLatest(l));
    }
  };

  switch (cmd) {
    case "get": {
      const input = rest[0];
      if (!input) throw new UsageError("Usage: bcrp get <shortcut|CODE> [--from D] [--to D] [--last N]");
      const s = await getSeries({ series: input, ...query() });
      return out(s, () => formatSeries(s), () => csvSeries(s));
    }
    case "compare": {
      if (rest.length < 2) throw new UsageError("Usage: bcrp compare <A> <B> [...] [--from D] [--to D] [--last N]");
      const c = await compareSeries(rest, query());
      return out(c, () => formatCompare(c), () => csvCompare(c));
    }
    case "change": {
      if (!rest[0]) throw new UsageError("Usage: bcrp change <shortcut|CODE> [--over 1w|1m|3m|6m|1y|ytd]");
      const over = strFlag(flags, "over");
      if (over !== undefined && !isOver(over)) throw new UsageError(`--over must be one of: ${OVERS.join(", ")}`);
      const c = await getChange(rest[0], over as Over | undefined);
      return out(c, () => formatChange(c), () => csvChange(c));
    }
    case "convert": {
      const usage = "Usage: bcrp convert <amount> <usd|pen> [--date D] [--side buy|sell]";
      const amount = Number((rest[0] ?? "").replace(/,/g, ""));
      if (!rest[0] || !Number.isFinite(amount)) throw new UsageError(usage);
      const word = (rest[1] ?? "").toLowerCase();
      const from = ["usd", "dolar", "dolares", "dólar", "dólares", "$"].includes(word)
        ? "usd"
        : ["pen", "sol", "soles", "s/"].includes(word)
          ? "pen"
          : undefined;
      if (!from) throw new UsageError(usage);
      const side = strFlag(flags, "side");
      if (side !== undefined && side !== "buy" && side !== "sell") throw new UsageError("--side must be buy or sell");
      const c = await convertCurrency({ amount, from, date: strFlag(flags, "date"), side: side as FxSide | undefined });
      return out(c, () => formatConversion(c), () => csvConversion(c));
    }
    case "check": {
      if (!rest[0]) throw new UsageError("Usage: bcrp check <shortcut|CODE> --above N | --below N");
      const num = (key: string) => {
        const v = strFlag(flags, key);
        if (v === undefined) return undefined;
        if (!Number.isFinite(Number(v))) throw new UsageError(`--${key} must be a number`);
        return Number(v);
      };
      const above = num("above");
      const below = num("below");
      if ((above === undefined) === (below === undefined)) throw new UsageError("Pass exactly one of --above or --below");
      const r = await checkThreshold(rest[0], { above, below });
      out(r, () => formatCheck(r));
      // Like grep: 0 = the condition holds (alert), 3 = it does not. 1 and 2 stay reserved for errors.
      process.exitCode = r.triggered ? 0 : 3;
      return;
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
      return out(results, () => formatSearch(results), () => csvSearch(results));
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
