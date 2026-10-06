import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json";
import { compareSeries, describeSeries, getLatest, getSeries, searchSeries } from "./api";
import { OVERS } from "./calc";
import { FREQUENCIES } from "./dates";
import { type FxSide, convertCurrency, getChange } from "./insights";
import { SHORTCUTS } from "./shortcuts";

const shortcutList = Object.entries(SHORTCUTS)
  .map(([name, s]) => `${name} (${s.code})`)
  .join(", ");

const seriesParam = z
  .string()
  .describe(`BCRP series code (e.g. PD04638PD) or a shortcut name: ${shortcutList}`);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
    };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "bcrp", version: pkg.version });

  server.registerTool(
    "bcrp_search",
    {
      description:
        "Search the catalog of ~17,000 BCRP (Banco Central de Reserva del Perú) statistical series by text. " +
        "Spanish or English terms (e.g. 'inflación subyacente', 'copper', 'tasa de interés'). " +
        "Returns series codes to use with bcrp_get / bcrp_latest.",
      inputSchema: {
        query: z.string().describe("Search text; every word must match the series name, category or group"),
        frequency: z.enum(FREQUENCIES as [string, ...string[]]).optional().describe("Filter by frequency"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
      },
    },
    ({ query, frequency, limit }) =>
      run(() => searchSeries(query, { frequency: frequency as (typeof FREQUENCIES)[number] | undefined, limit })),
  );

  server.registerTool(
    "bcrp_latest",
    {
      description: "Get the most recent published value of a BCRP series (e.g. today's exchange rate).",
      inputSchema: { series: seriesParam },
    },
    ({ series }) => run(() => getLatest(series)),
  );

  server.registerTool(
    "bcrp_get",
    {
      description:
        "Get observations of a BCRP series over a date range. Dates accept YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn. " +
        "Without a range, returns a recent default window.",
      inputSchema: {
        series: seriesParam,
        from: z.string().optional().describe("Start date"),
        to: z.string().optional().describe("End date (default: today)"),
        last: z.number().int().min(1).max(5000).optional().describe("Return only the last N observations"),
      },
    },
    ({ series, from, to, last }) => run(() => getSeries({ series, from, to, last })),
  );

  server.registerTool(
    "bcrp_compare",
    {
      description:
        "Line up 2 to 6 BCRP series of the same frequency by period (e.g. inflation vs the policy rate). " +
        "Returns one row per period with a value per series. Series must share a frequency.",
      inputSchema: {
        series: z.array(seriesParam).min(2).max(6).describe("Series codes or shortcut names to compare"),
        from: z.string().optional().describe("Start date"),
        to: z.string().optional().describe("End date (default: today)"),
        last: z.number().int().min(1).max(5000).optional().describe("Return only the last N periods"),
      },
    },
    ({ series, from, to, last }) => run(() => compareSeries(series, { from, to, last })),
  );

  server.registerTool(
    "bcrp_change",
    {
      description:
        "How much a BCRP series moved between its latest observation and an earlier point (1 week, 1/3/6 months, 1 year or since the start of the year). " +
        "Returns the absolute change and, for non-percentage series, the % change.",
      inputSchema: {
        series: seriesParam,
        over: z.enum(OVERS).optional().describe("Period to measure over (default: 1m for daily/monthly series, 1y for quarterly/annual)"),
      },
    },
    ({ series, over }) => run(() => getChange(series, over)),
  );

  server.registerTool(
    "bcrp_convert",
    {
      description:
        "Convert an amount between US dollars and Peruvian soles using the BCRP interbank exchange rate " +
        "(latest published, or on a given date). A reference rate: banks and exchange houses quote their own.",
      inputSchema: {
        amount: z.number().describe("Amount to convert"),
        from: z.enum(["usd", "pen"]).describe("Currency of the amount; it is converted into the other one"),
        date: z.string().optional().describe("Use the rate of this date (YYYY-MM-DD); default: latest"),
        side: z.enum(["buy", "sell"]).optional().describe("Interbank buy or sell rate (default: sell)"),
      },
    },
    ({ amount, from, date, side }) => run(() => convertCurrency({ amount, from, date, side: side as FxSide | undefined })),
  );

  server.registerTool(
    "bcrp_info",
    {
      description: "Describe a BCRP series: name, category, frequency, available date range and API URL.",
      inputSchema: { series: seriesParam },
    },
    ({ series }) => run(() => describeSeries(series)),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
