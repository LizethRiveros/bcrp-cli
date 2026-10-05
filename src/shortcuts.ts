export interface Shortcut {
  code: string;
  description: string;
  aliases: string[];
}

/** Hand-picked headline indicators. Codes were verified against the BCRP catalog. */
export const SHORTCUTS: Record<string, Shortcut> = {
  fx: {
    code: "PD04638PD",
    description: "Tipo de cambio interbancario venta (S/ por US$), diario",
    aliases: ["usd", "dolar", "tc"],
  },
  inflation: {
    code: "PN01273PM",
    description: "Inflación Lima Metropolitana, variación % 12 meses, mensual",
    aliases: ["ipc", "inflacion", "cpi"],
  },
  rate: {
    code: "PD12301MD",
    description: "Tasa de referencia de la política monetaria, diario",
    aliases: ["tasa", "tpm", "policy-rate"],
  },
  reserves: {
    code: "PD04650MD",
    description: "Reservas internacionales netas (millones US$), diario",
    aliases: ["rin", "reservas"],
  },
  gdp: {
    code: "PN01728AM",
    description: "PBI, variación % interanual, mensual",
    aliases: ["pbi"],
  },
  copper: {
    code: "PD04701XD",
    description: "Cobre, Londres (cUS$ por libra), diario",
    aliases: ["cobre"],
  },
  gold: {
    code: "PD04704XD",
    description: "Oro, Londres (US$ por onza troy), diario",
    aliases: ["oro"],
  },
};

const BY_ALIAS = new Map<string, string>();
for (const [name, s] of Object.entries(SHORTCUTS)) {
  BY_ALIAS.set(name, name);
  for (const a of s.aliases) BY_ALIAS.set(a, name);
}

/** Returns the canonical shortcut name for a name or alias, if it is one. */
export function shortcutName(input: string): string | undefined {
  return BY_ALIAS.get(input.trim().toLowerCase());
}

/** Resolves a shortcut name/alias to a series code; any other input is treated as a series code. */
export function resolveCode(input: string): string {
  const name = shortcutName(input);
  return name ? SHORTCUTS[name]!.code : input.trim().toUpperCase();
}
