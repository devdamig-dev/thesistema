/**
 * Fail closed on provider numeric literals that JSON.parse could silently
 * round or underflow before the staging record validator ever sees them.
 *
 * This is a deliberately conservative pre-parse guard, not a lossless parser:
 * decimals with >15 significant nonzero-trimmed digits are rejected even if
 * some happen to round-trip in IEEE-754. If the real Fudo contract requires
 * them, introduce an explicitly reviewed lossless decimal representation.
 * Do not log the raw provider JSON or the offending literal.
 */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NUMERIC_CHARACTER = /[0-9eE+.-]/;

export function assertSafeFudoJsonNumbers(source: string): void {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) continue;
    let end = index + 1;
    while (end < source.length && NUMERIC_CHARACTER.test(source[end])) end++;
    const literal = source.slice(index, end);
    index = end - 1;
    // JSON.parse remains the source of truth for syntax errors. Never
    // normalize malformed tokens into a different valid provider response.
    if (!JSON_NUMBER.test(literal)) continue;
    const numeric = Number(literal);
    if (!Number.isFinite(numeric)
      || (Number.isInteger(numeric) && !Number.isSafeInteger(numeric))) {
      throw new Error("fudo_numeric_precision_loss");
    }
    // IEEE-754 rounds long fractional mantissas; by the time snapshots are
    // hashed the originally supplied digits would have been irrecoverable.
    const [mantissa] = literal.split(/[eE]/);
    const significant = mantissa.replace(/^-/, "").replace(".", "")
      .replace(/^0+/, "").replace(/0+$/, "");
    if ((numeric === 0 && significant.length > 0)
      || (/[.eE]/.test(literal) && significant.length > 15)) {
      throw new Error("fudo_numeric_precision_loss");
    }
  }
}
