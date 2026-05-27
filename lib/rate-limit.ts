/**
 * Rate limiter in-memory simple.
 *
 * Ventana deslizante por key (IP, user, etc). No persiste entre
 * deploys — en producción usar Redis/KV. Para piloto es suficiente.
 */

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

export function rateLimit(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): { ok: boolean; remaining: number; resetAt: number } {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count++;

  // Cleanup periódico (cada 100 calls, limpia entries viejas)
  if (entry.count % 100 === 0) {
    for (const [k, v] of store) {
      if (now > v.resetAt) store.delete(k);
    }
  }

  return {
    ok: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    resetAt: entry.resetAt,
  };
}
