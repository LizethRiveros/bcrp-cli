# bcrp-cli

Agent-first CLI and [MCP](https://modelcontextprotocol.io) server for the statistics of the
**Banco Central de Reserva del Perú (BCRP)**: exchange rate, inflation, policy rate, reserves, GDP,
commodity prices and **~17,000 more series**. No API key required.

Tables for humans, clean JSON for scripts and AI agents.

> Unofficial project, not affiliated with the BCRP. Data comes from the public
> [BCRPData](https://estadisticas.bcrp.gob.pe/estadisticas/series/) API.

```console
$ bcrp fx
Tipo de cambio - TC Interbancario (S/ por US$) - Venta
PD04638PD · daily

2026-10-02  3.438

$ bcrp inflation --last 4
Índice de precios Lima Metropolitana (var% 12 meses) - IPC
PN01273PM · monthly · 4 observations

PERIOD   VALUE
───────  ─────
2026-05   3.91
2026-06   4.01
2026-07   4.07
2026-08   4.44
```

## Why

BCRP series have opaque codes (`PD04638PD`) and the API can't search them. `bcrp` bundles the full
series catalog so you (or your agent) can **find** a series by name in Spanish or English, then fetch it,
with dates and numbers already normalized.

## Install

With npm (Node 18+). The package is `@lizethriveros/bcrp-cli` and installs the `bcrp` command:

```bash
npx @lizethriveros/bcrp-cli fx          # run without installing
npm install -g @lizethriveros/bcrp-cli  # or install it, then just: bcrp fx
```

From source (requires [Bun](https://bun.sh) and Node 18+):

```bash
git clone https://github.com/LizethRiveros/bcrp-cli
cd bcrp-cli
bun install
bun run build
npm link          # puts `bcrp` on your PATH
```

Or run without building: `bun src/cli.ts fx`.

## Usage

```bash
bcrp <shortcut>                        # latest value of a headline indicator
bcrp <shortcut|CODE> --last 12         # recent observations
bcrp get <shortcut|CODE> --from 2026-01 --to 2026-09
bcrp compare inflation gdp --last 6    # line up 2-6 series of the same frequency
bcrp change fx --over ytd              # how much it moved (1w, 1m, 3m, 6m, 1y, ytd)
bcrp convert 100 usd                   # at the BCRP interbank rate (or --date 2026-03-15)
bcrp check fx --above 3.50             # alert check for scripts and schedulers
bcrp get fx --from 2026-01 --csv > fx.csv
bcrp search "tasa de interés" --freq monthly
bcrp info PD04638PD                    # what is this series?
bcrp shortcuts                         # list headline indicators
```

### Shortcuts

| Shortcut | Series | Aliases |
|---|---|---|
| `fx` | USD/PEN interbank exchange rate, sell (daily) | `usd`, `dolar`, `tc` |
| `inflation` | Lima CPI, 12-month % change (monthly) | `ipc`, `cpi` |
| `rate` | Monetary policy reference rate (daily) | `tasa`, `tpm` |
| `reserves` | Net international reserves, US$ millions (daily) | `rin` |
| `gdp` | GDP, year-over-year % change (monthly) | `pbi` |
| `copper` | Copper, London (daily) | `cobre` |
| `gold` | Gold, London (daily) | `oro` |

### Finding any other series

```console
$ bcrp search "exchange rate" --limit 2
CODE       FREQ    SERIES                                                 RANGE
─────────  ──────  ─────────────────────────────────────────────────────  ───────────────────────
PD04638PD  daily   TC Interbancario (S/ por US$) - Venta · Tipo de camb…  1997-01-02 → 2026-09-03
PM05291PA  annual  Yen (¥) · Tipo de cambio de las principales monedas …  1996 → 2025
```

Search matches the start of words in the name, category and group, ignores accents and understands
common English terms (`inflation`, `copper`, `gdp`, `reserves`, …).

### Dates

`--from` / `--to` accept `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or `YYYY-Qn` and are converted to whatever
the series' frequency needs (daily, monthly, quarterly or annual). `--last N` keeps the last N observations.

### Comparing series

`bcrp compare` lines up 2 to 6 series by period (they must share a frequency). Gaps show as `n.d.`
because series are published with different lags.

```console
$ bcrp compare inflation gdp --last 4
PN01273PM  Índice de precios Lima Metropolitana (var% 12 meses) - IPC
PN01728AM  Producto bruto interno y demanda interna (variación porcentual interanual) - PBI

PERIOD   PN01273PM  PN01728AM
───────  ─────────  ─────────
2026-05       3.91        2.2
2026-06       4.01        1.8
2026-07       4.07        3.6
2026-08       4.44       n.d.
```

### Changes

`bcrp change` measures how much a series moved between its latest observation and an earlier point.
Daily series use the last observation on or before that date (weekends and holidays); monthly, quarterly
and annual series need an observation in exactly that month, quarter or year.

```console
$ bcrp change fx --over ytd
Tipo de cambio - TC Interbancario (S/ por US$) - Venta
PD04638PD · daily
Source: SBS, Reuters, Datatec, BCRP

Over ytd:  3.364 (2025-12-31)  →  3.427 (2026-10-05)
Change:    +0.064  (+1.89%)
```

Series that are already rates or percentages (inflation, interest rates) report the change in points, not a
percentage of a percentage. A period shorter than the series' own frequency (a weekly change of a monthly
series) is refused instead of comparing the wrong periods.

### Converting dollars and soles

```console
$ bcrp convert 100 usd
100.00 USD = 342.71 PEN
Rate: 3.427 S/ per US$ · interbank sell · 2026-10-05
PD04638PD · Source: SBS, Reuters, Datatec, BCRP
Reference rate; banks and exchange houses quote their own.
```

`--date 2026-03-15` uses the last rate on or before that date, and `--side buy` uses the interbank buy rate.
Only USD/PEN is supported.

### Alerts

`bcrp check` tests the latest value against a threshold and is meant for scripts and schedulers. Like `grep`,
it exits `0` when the condition holds (alert) and `3` when it does not; `1` and `2` stay reserved for errors.

```bash
bcrp check fx --above 3.50 && echo "The dollar is above 3.50"

# cron, weekdays at 5 pm
0 17 * * 1-5  bcrp check fx --above 3.50 --json && curl -d "dollar above 3.50" ntfy.sh/my-topic
```

### Output

A table in a terminal (with a one-line trend chart for series); **JSON when piped**.
Force with `--json` / `--table`, or export with `--csv` (`get`, `latest`, `search` and `compare`).
Errors go to stderr as `{"error": "..."}` with exit code `1` (data/API) or `2` (usage).

```console
$ bcrp get fx --last 7
Tipo de cambio - TC Interbancario (S/ por US$) - Venta
PD04638PD · daily · 7 observations

▁▃▆▇▅█▆  3.406 → 3.438  (+0.033)
...
```

```bash
bcrp fx | jq .value
bcrp get inflation --last 12 | jq '.points[] | [.period, .value]'
bcrp compare inflation gdp --last 12 --csv > macro.csv
```

## Use it from an AI agent (MCP)

`bcrp mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio with
seven tools: `bcrp_search`, `bcrp_latest`, `bcrp_get`, `bcrp_compare`, `bcrp_change`, `bcrp_convert` and
`bcrp_info`.

Claude Code:

```bash
claude mcp add bcrp -- npx -y @lizethriveros/bcrp-cli mcp
```

Claude Desktop / any MCP client (`mcpServers` config):

```json
{
  "mcpServers": {
    "bcrp": {
      "command": "npx",
      "args": ["-y", "@lizethriveros/bcrp-cli", "mcp"]
    }
  }
}
```

Then ask things like *"What's the dollar at today?"* or *"Compare Peru's inflation and the policy rate this year."*

## Keeping the catalog fresh

A snapshot of the catalog ships with the package. To refresh it from BCRPData:

```bash
bcrp catalog update     # saves to ~/.bcrp/catalog.json, used from then on
bcrp catalog            # show catalog size, date and source
```

To regenerate the bundled snapshot in this repo: `bun run catalog`.

## Development

```bash
bun install
bun test            # unit tests (no network needed)
bun run typecheck
bun run build       # bundles to dist/cli.js (runs on Node)
```

## Notes

- The BCRP publishes with a lag: monthly series trail by a few weeks, quarterly by a few months.
  `bcrp <series>` always returns the latest *published* observation.
- Series metadata in the catalog (date ranges) can be older than the live data.
- Each series carries its **source** (BCRP, INEI, SBS, ...) from the catalog; `bcrp info` also shows the
  description, methodology link and last update when BCRPData provides them.
- Responses are cached for 10 minutes in `~/.bcrp/cache` (only answers with data). Use `--no-cache` or
  `BCRP_NO_CACHE=1` to skip it.
- The BCRP API sits behind an anti-bot filter that rejects bursts of requests. `bcrp` retries with a short
  back-off, and `compare` fetches all its series in a single request; if you script many calls, add a small
  delay between them.

## License

MIT
