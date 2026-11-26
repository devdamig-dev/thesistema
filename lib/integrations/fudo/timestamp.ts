/**
 * Provider and database timestamps are only evidence when unambiguous; do not guess a local timezone.
 * Date.parse accepts ambiguous locale dates and timezone-free timestamps,
 * and normalizes impossible calendar dates on some JS engines. A fabricated
 * update/sync instant can undermine reconciliation and pilot readiness: return null instead.
 * Never reflect the rejected provider value to errors or logs.
 */
export function parseStrictFudoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, zone] = match;
  const [year, month, day, hour, minute, second] =
    [rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z") {
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes !== 0)) return null;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  // JS accepts year 0000 (and can shift a valid local year across a UTC
  // boundary), while PostgreSQL timestamptz rejects year zero. A large
  // timezone shift can also produce ISO years beyond the four-digit contract.
  // Never feed an out-of-range normalized source_updated_at into the atomic
  // staging RPC; retain the original provider text only inside the payload.
  const date = new Date(instant);
  const utcYear = date.getUTCFullYear();
  return utcYear >= 1 && utcYear <= 9999 ? date.toISOString() : null;
}

