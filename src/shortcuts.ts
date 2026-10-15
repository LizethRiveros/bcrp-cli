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
  silver: {
    code: "PD04702XD",
    description: "Plata, H. Harman (US$ por onza troy), diario",
    aliases: ["plata"],
  },
  zinc: {
    code: "PD04703XD",
    description: "Zinc, Londres (cUS$ por libra), diario",
    aliases: [],
  },
  euro: {
    code: "PD04648PD",
    description: "Tipo de cambio del euro, venta (S/ por euro), diario",
    aliases: ["eur"],
  },
  interbank: {
    code: "PD04692MD",
    description: "Tasa de interés interbancaria en soles (%), diario",
    aliases: ["interbancaria"],
  },
  unemployment: {
    code: "PN38063GM",
    description: "Tasa de desempleo, Lima Metropolitana (%, promedio móvil 3 meses), mensual",
    aliases: ["desempleo"],
  },
  exports: {
    code: "PN38714BM",
    description: "Exportaciones, valor FOB (millones US$), mensual",
    aliases: ["exportaciones"],
  },
  imports: {
    code: "PN38718BM",
    description: "Importaciones, valor FOB (millones US$), mensual",
    aliases: ["importaciones"],
  },
  trade: {
    code: "PN38723BM",
    description: "Balanza comercial, valor FOB (millones US$), mensual",
    aliases: ["balanza", "trade-balance"],
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

/** Levenshtein distance, for "did you mean" hints. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The closest candidate to a mistyped word, if it is close enough to be a plausible typo. */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const word = input.trim().toLowerCase();
  if (!word) return undefined;
  let best: { c: string; d: number } | undefined;
  for (const c of candidates) {
    const d = distance(word, c.toLowerCase());
    if (!best || d < best.d) best = { c, d };
  }
  const limit = Math.max(1, Math.floor(word.length / 3));
  return best && best.d <= limit ? best.c : undefined;
}

/** Shortcut names and aliases that a mistyped word can be matched against. */
export function shortcutWords(): string[] {
  return [...BY_ALIAS.keys()];
}

/** Resolves a shortcut name/alias to a series code; any other input is treated as a series code. */
export function resolveCode(input: string): string {
  const name = shortcutName(input);
  return name ? SHORTCUTS[name]!.code : input.trim().toUpperCase();
}
