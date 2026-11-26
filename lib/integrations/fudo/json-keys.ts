/**
 * JSON.parse keeps only the last occurrence of a repeated object key.
 * For Fudo staging that silently changes source data, amounts and hashes.
 * Inspect the bounded source BEFORE parsing; never echo key names or values.
 *
 * Each object has its own key set. Array elements and nested objects do not
 * share keys. Decode escaped JSON keys so "id" and "\\u0069d" are duplicates.
 * JSON.parse is still responsible for full JSON syntax validation.
 */
export function assertUniqueFudoJsonKeys(source: string): void {
  const frames: Array<Set<string> | null> = [];

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      const start = index++;
      let escaped = false;
      while (index < source.length) {
        const current = source[index];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') break;
        index++;
      }
      if (index === source.length) return; // The subsequent JSON.parse will reject it.

      let next = index + 1;
      while (next < source.length && /[ \t\r\n]/.test(source[next])) next++;
      const currentObject = frames[frames.length - 1];
      if (source[next] === ":" && currentObject) {
        // JSON.parse decodes Unicode escapes and throws for malformed strings.
        const key = JSON.parse(source.slice(start, index + 1)) as string;
        if (currentObject.has(key)) throw new Error("fudo_json_duplicate_key");
        currentObject.add(key);
      }
      continue;
    }
    if (char === "{") frames.push(new Set<string>());
    else if (char === "[") frames.push(null);
    else if (char === "}" || char === "]") frames.pop();
  }
}
