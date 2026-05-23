/**
 * Ingredient matching — asocia líneas de factura con ingredients
 * existentes del business.
 *
 * Estrategia:
 *   1. Normalización: bajar a minúsculas, sacar acentos, sacar
 *      cantidades ("x10kg", "180g"), eliminar marcas comerciales.
 *   2. Score basado en tokens compartidos + Jaccard.
 *   3. Estados:
 *      - matched: score ≥ 0.7 y diferencia con el segundo > 0.15
 *      - ambiguous: hay varios candidatos cercanos
 *      - unmatched: nada por encima de 0.4
 *
 * El caller puede aceptar el match, elegir manualmente otro
 * ingrediente o crear uno nuevo.
 */

export type IngredientCandidate = {
  id: string;
  name: string;
};

export type MatchOutcome = {
  status: "matched" | "ambiguous" | "unmatched";
  score: number;                   // score del mejor candidato (0..1)
  suggestedId?: string;            // mejor candidato (incluso si ambiguous)
  alternatives: { id: string; name: string; score: number }[];
};

/* ============================================================================
   normalización
   ============================================================================ */

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "para", "con", "sin", "por",
  "y", "o", "un", "una", "x", "xkg", "xkilo",
  // Atributos/marcas que no aportan al match
  "premium", "extra", "xl", "regular", "pack", "block", "lata",
  "queso", // genérico — el discriminante es el tipo (cheddar, provolone)
]);

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")          // acentos
    .replace(/[°ºª]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")             // puntuación
    .replace(/\b\d+(?:[.,]\d+)?\s*(kg|g|gr|gramos|kilos?|ml|l|litros?|u|un|unidades?|cajas?|pack)\b/g, " ")
    .replace(/\b(x|por)\s*\d+\b/g, " ")        // "x10"
    .replace(/\b\d+\b/g, " ")                  // números sueltos
    .replace(/\s+/g, " ")
    .trim();
}

/** Stem naïve para plurales del español. */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(input: string): string[] {
  return normalize(input)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

/* ============================================================================
   scoring
   ============================================================================ */

export function jaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  let intersection = 0;
  A.forEach((t) => {
    if (B.has(t)) intersection++;
  });
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score combinado, robusto frente a descripciones largas con atributos
 * que el ingrediente no menciona (y viceversa).
 *
 * Mezcla:
 *   - F1-like sobre tokens (50%) — recall × precision balanceados.
 *   - Bonus por presencia de algún token "fuerte" del ingrediente
 *     (≥ 5 chars) en la descripción (30%) — captura matches
 *     parciales como "CHEDDAR BLOCK 1KG" ↔ "Queso cheddar".
 *   - Match del primer token relevante (20%).
 */
export function similarity(description: string, ingredientName: string): number {
  const a = tokenize(description);
  const b = tokenize(ingredientName);
  if (a.length === 0 || b.length === 0) return 0;

  const aSet = new Set(a);
  const bSet = new Set(b);
  const matched = [...bSet].filter((t) => aSet.has(t));

  const recall = matched.length / bSet.size;
  const precision = matched.length / aSet.size;
  const f1 = matched.length === 0 ? 0 : (2 * recall * precision) / (recall + precision);

  const strongTokens = [...bSet].filter((t) => t.length >= 5);
  const strongMatch =
    strongTokens.length > 0 && strongTokens.some((t) => aSet.has(t)) ? 1 : 0;

  const firstTokenMatch = a[0] === b[0] ? 1 : 0;

  return Math.min(1, f1 * 0.5 + strongMatch * 0.3 + firstTokenMatch * 0.2);
}

/* ============================================================================
   match principal
   ============================================================================ */

export function matchIngredient(
  description: string,
  ingredients: IngredientCandidate[],
): MatchOutcome {
  if (ingredients.length === 0) {
    return { status: "unmatched", score: 0, alternatives: [] };
  }

  const scored = ingredients
    .map((ing) => ({
      id: ing.id,
      name: ing.name,
      score: similarity(description, ing.name),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = scored[0];
  const second = scored[1];

  if (best.score < 0.4) {
    return { status: "unmatched", score: best.score, alternatives: scored };
  }

  if (best.score >= 0.7 && (!second || best.score - second.score >= 0.15)) {
    return {
      status: "matched",
      score: best.score,
      suggestedId: best.id,
      alternatives: scored,
    };
  }

  return {
    status: "ambiguous",
    score: best.score,
    suggestedId: best.id,
    alternatives: scored,
  };
}

export function matchAllItems<T extends { description: string }>(
  items: T[],
  ingredients: IngredientCandidate[],
): Array<T & { match: MatchOutcome }> {
  return items.map((item) => ({
    ...item,
    match: matchIngredient(item.description, ingredients),
  }));
}
