---
name: bcrp
description: Official Peruvian macroeconomic data from the BCRP (Banco Central de Reserva del Perú) - exchange rate (dólar, tipo de cambio), inflation, policy rate, reserves, GDP (PBI), copper and gold prices, and ~17,000 other series. Use whenever the user asks for current or historical Peruvian economic figures, wants to compare series, measure a change, or convert USD/PEN, instead of answering from memory. Needs the `bcrp` CLI (npx @lizethriveros/bcrp-cli) or the bcrp MCP server.
---

# bcrp: official Peruvian economic data

Your training data does not know today's exchange rate or last month's inflation. Fetch them with `bcrp`, then
answer with the number, its period and its source.

## How to call it

Either the MCP tools (if the `bcrp` server is connected) or the CLI. Same operations:

| Need | CLI | MCP tool |
|---|---|---|
| Latest value of a headline indicator | `bcrp fx` | `bcrp_latest` |
| Find a series by name | `bcrp search "tasa de interés" --freq monthly` | `bcrp_search` |
| What is this series? | `bcrp info PD04638PD` | `bcrp_info` |
| History | `bcrp get inflation --last 12` / `--from 2026-01 --to 2026-09` | `bcrp_get` |
| Several series side by side | `bcrp compare inflation gdp --last 12` | `bcrp_compare` |
| How much did it move? | `bcrp change fx --over ytd` | `bcrp_change` |
| USD <-> PEN | `bcrp convert 100 usd [--date 2026-03-15]` | `bcrp_convert` |
| Alert test for a script | `bcrp check fx --above 3.50` | (use `bcrp_latest`) |

Without a terminal, run it as `npx -y @lizethriveros/bcrp-cli <command>`. The CLI prints JSON when its output is
piped; add `--json` to be sure, `--csv` to export.

## Headline shortcuts

`fx` (USD/PEN interbank, daily), `inflation` (Lima CPI, 12-month %), `rate` (policy rate), `reserves` (net
international reserves, US$ millions), `gdp` (year-over-year %), `copper`, `gold`. Aliases such as `dolar`, `ipc`,
`tasa`, `rin`, `pbi`, `cobre`, `oro` also work. Anything else is a series code like `PD04638PD`.

## Workflow

1. Headline indicator? Use its shortcut. Otherwise `bcrp search` (Spanish or English, accents optional), pick a
   series, and confirm with `bcrp info` when several look alike.
2. **Never invent or guess a series code.** If search finds nothing, say so.
3. Fetch with `latest` / `get` / `change` / `compare`.
4. Answer with the value, **its period** and the **source** (the output includes `Source:`).

## Pitfalls that change the answer

- **Publication lag.** Daily series run up to the last business day; monthly series (inflation, GDP) trail by weeks; quarterly
  by months. `bcrp inflation` returns the latest *published* month, not this month. Always state the period, and never
  call a July figure "today's".
- **Levels vs rates.** Inflation, GDP growth and interest rates are already percentages. For those, `change` reports the
  difference in *points*; do not describe it as a percent change.
- **Same frequency to compare.** `compare` only lines up series of the same frequency (daily with daily, monthly with
  monthly). Use `bcrp search --freq` to find a matching one. Gaps show as `n.d.` because series publish with
  different lags; mention it instead of filling them in.
- **`change` refuses some questions** (a weekly change of a monthly series, or not enough history). Relay that and
  suggest a longer period rather than working around it.
- **`convert` is a reference rate** (interbank). Banks and exchange houses quote their own: say so when money decisions
  depend on it. USD/PEN only.
- **Be gentle with the API.** The BCRP rejects bursts of requests. Do not fire many calls in parallel; prefer
  `compare` (one request for several series). Results are cached for 10 minutes.
- **Dates:** `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-Qn`.

## Exit codes (CLI)

`0` ok (for `check`: condition met), `1` data/API error, `2` bad usage, `3` (`check` only) condition not met.

## Examples

- "¿A cuánto está el dólar?" -> `bcrp fx` -> "S/ 3.427 por US$ (tipo de cambio interbancario venta, 5 oct 2026; fuente: BCRP/SBS)."
- "¿Cómo va la inflación frente a la tasa de referencia?" -> `bcrp compare inflation rate` fails (monthly vs daily): use
  `bcrp inflation` and `bcrp rate` separately, or search a monthly policy-rate series (`bcrp search "tasa de referencia" --freq monthly`).
- "¿Cuánto subió el dólar este año?" -> `bcrp change fx --over ytd`.
- "Pásame 500 dólares a soles" -> `bcrp convert 500 usd`.
