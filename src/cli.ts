#!/usr/bin/env bun
import { fetchSeries, type Series } from "./client";

const FX_CODE = "PD04638PD"; // TC interbancario venta

function today(): Date {
  return new Date();
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

function print(series: Series, json: boolean) {
  if (json) {
    console.log(JSON.stringify(series, null, 2));
    return;
  }
  console.log(`${series.name} (${series.code})`);
  for (const p of series.points) {
    console.log(`${p.period}\t${p.value === null ? "n.d." : p.value.toFixed(series.decimals)}`);
  }
}

const HELP = `bcrp - BCRP statistics from the terminal

Usage:
  bcrp fx [--json]                         Latest interbank USD/PEN exchange rate
  bcrp get <CODE> [--from YYYY-M[-D]] [--to YYYY-M[-D]] [--json]

Examples:
  bcrp fx
  bcrp get PD04638PD --from 2026-9-1 --to 2026-9-30 --json
`;

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = positional;
  const json = flags.json === true;

  if (!cmd || cmd === "help" || flags.help) {
    console.log(HELP);
    return;
  }

  if (cmd === "fx") {
    const now = today();
    const start = new Date(now.getTime() - 10 * 86_400_000);
    const s = await fetchSeries(FX_CODE, ymd(start), ymd(now));
    const last = [...s.points].reverse().find((p) => p.value !== null);
    if (!last) throw new Error("No recent exchange rate data");
    if (json) console.log(JSON.stringify({ code: s.code, name: s.name, ...last }, null, 2));
    else console.log(`${last.period}  S/ ${last.value!.toFixed(s.decimals)} por US$`);
    return;
  }

  if (cmd === "get") {
    if (!arg) throw new Error("Usage: bcrp get <CODE> [--from ...] [--to ...]");
    const now = today();
    const from = typeof flags.from === "string" ? flags.from : ym(new Date(now.getFullYear() - 1, now.getMonth()));
    const to = typeof flags.to === "string" ? flags.to : ym(now);
    print(await fetchSeries(arg, from, to), json);
    return;
  }

  throw new Error(`Unknown command: ${cmd}\n\n${HELP}`);
}

main().catch((e) => {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
