# bcrp-cli

Agent-first CLI for the statistics of the **Banco Central de Reserva del Perú (BCRP)**.
Clean JSON for agents, readable output for humans. No API key required.

> Status: early MVP. Unofficial project, not affiliated with the BCRP.

## Usage

Requires [Bun](https://bun.sh).

```bash
bun install

bun run src/cli.ts fx                      # latest interbank USD/PEN rate
bun run src/cli.ts fx --json
bun run src/cli.ts get PD04638PD --from 2026-9-1 --to 2026-9-30 --json
```

Example:

```
$ bcrp fx
2026-10-02  S/ 3.438 por US$
```

## Data

Data comes from the public [BCRPData](https://estadisticas.bcrp.gob.pe/estadisticas/series/) API.
Dates are normalized (`01.Set.26` → `2026-09-01`) and values parsed to numbers (`n.d.` → `null`).

## Roadmap

- [ ] `search` over a catalog of common series
- [ ] Named shortcuts: inflation, reference rate, reserves, GDP
- [ ] MCP server (`bcrp mcp`)
- [ ] npm package

## License

MIT
