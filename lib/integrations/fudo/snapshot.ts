import { createHash } from "node:crypto";

export const FUDO_SYNC_RESOURCES = ["products", "ingredients", "providers", "orders", "sales"] as const;
export type FudoSyncResource = typeof FUDO_SYNC_RESOURCES[number];
export const FUDO_SYNC_PAGE_SIZE = 100;

// JSON:API resource types may be singular (as in Fudo examples) or plural,
// depending on the provider schema version. Only compare recognized resource
// identities and retain missing-type compatibility until real pilot QA.
const FUDO_JSON_API_TYPES: Record<FudoSyncResource, readonly string[]> = {
  products: ["product", "products"], ingredients: ["ingredient", "ingredients"],
  providers: ["provider", "providers"], orders: ["order", "orders"],
  sales: ["sale", "sales"],
};

/**
 * PostgreSQL jsonb rejects U+0000 and unpaired UTF-16 surrogates in JSON
 * values AND object keys. JSON.parse can also round unsafe JSON integers and
 * turn oversized numeric literals into Infinity, which JSON.stringify then
 * silently stores as null. Reject those values before hashing/staging rather
 * than importing altered financial or provenance data. Never expose payloads.
 */
function hasUnsafeStagingValue(root: unknown): boolean {
  const invalidText = (text: string): boolean => {
    if (text.includes("\u0000")) return true;
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next < 0xdc00 || next > 0xdfff || Number.isNaN(next)) return true;
        i++; // A complete surrogate pair represents a valid Unicode scalar.
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return true;
      }
    }
    return false;
  };

  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (invalidText(value)) return true;
    } else if (typeof value === "number") {
      // JSON.parse("1e999") -> Infinity -> JSON.stringify(...) -> null.
      // JSON.parse("9007199254740993") silently rounds the integer.
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return true;
    } else if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (invalidText(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

/**
 * The provider timestamp is optional provenance, NOT a machine-local guess.
 * Date.parse accepts ambiguous locale dates and timezone-free timestamps,
 * and normalizes impossible calendar dates on some JS engines. A fabricated
 * update instant can undermine cross-system reconciliation: keep null instead.
 * Never reflect the rejected provider value to errors or logs.
 */
function parseSourceTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, zone] = match;
  const [year, month, day, hour, minute, second] =
    [rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z") {
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes !== 0)) return null;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/**
 * JSONB and JSON:API both treat object member order as semantically irrelevant.
 * A provider can reorder keys between reads without changing a product/sale.
 * Hash a canonical object representation so a repeated scan does not report
 * phantom source changes. Array order remains significant. The original
 * provider object is still retained unchanged as the staging payload.
 */
function canonicalFudoJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return Object.fromEntries(
        Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      );
    }
    return current;
  });
}

export type FudoSnapshot = {
  externalId: string;
  payload: Record<string, unknown>;
  contentHash: string;
  sourceUpdatedAt: string | null;
};

export function parseFudoPage(value: unknown, expectedResource?: string): FudoSnapshot[] {
  // JSON:API forbids top-level data and errors together. An upstream can
  // return HTTP 200 with seemingly importable records AND an error document;
  // never mark that page as imported or advance its cursor. Treat even an
  // empty errors member as an ambiguous provider contract, without exposing
  // its contents to logs or the UI.
  if (value && typeof value === "object" && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, "errors")) {
    throw new Error("invalid_fudo_page");
  }
  const expectedTypes = expectedResource ? (FUDO_JSON_API_TYPES as Record<string, readonly string[]>)[expectedResource] : undefined;
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).data
      : null;
  if (!Array.isArray(raw) || raw.length > FUDO_SYNC_PAGE_SIZE) throw new Error("invalid_fudo_page");

  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_fudo_record");
    const body = item as Record<string, unknown>;
    // A 200 from /products containing a Sale object is not a valid products
    // import. Do not upsert a wrong provider type or mark its cursor complete.
    if (expectedTypes && Object.prototype.hasOwnProperty.call(body, "type")
      && (typeof body.type !== "string" || !expectedTypes.includes(body.type.toLowerCase()))) {
      throw new Error("invalid_fudo_record");
    }
    // JavaScript JSON parsing rounds integers beyond MAX_SAFE_INTEGER. Never
    // persist a rounded external_id: two distinct Fudo records could otherwise
    // collide in the tenant's upsert key. Providers must send large IDs as strings.
    const rawId = body.id;
    // External IDs are opaque provider keys: trimming changes their identity
    // and can silently collapse distinct records across pages into one upsert.
    // Reject padded IDs rather than normalizing them or marking the cycle complete.
    const id = typeof rawId === "string" ? rawId
      : typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : "";
    // Control characters in IDs corrupt provenance/export and can break SQL
    // text storage (NUL is forbidden in PostgreSQL). Fail before staging.
    if (!id || id !== id.trim() || id.length > 256
      || /[\u0000-\u001f\u007f]/u.test(id) || seen.has(id)) throw new Error("invalid_fudo_record");
    // Fail before the atomic RPC if JSONB would reject text or JavaScript
    // would silently alter a provider number during serialization/hashing.
    if (hasUnsafeStagingValue(body)) throw new Error("invalid_fudo_record");
    seen.add(id);

    // JSON:API allows attributes to be omitted, but an explicitly supplied
    // attributes member MUST be an object. Silently treating null, arrays or
    // primitives as empty would mark malformed provider data as imported and
    // could leave source_updated_at/provenance incomplete.
    if (Object.prototype.hasOwnProperty.call(body, "attributes")
      && (!body.attributes || typeof body.attributes !== "object" || Array.isArray(body.attributes))) {
      throw new Error("invalid_fudo_record");
    }
    const attributes = (body.attributes ?? {}) as Record<string, unknown>;
    const rawDate = attributes.updatedAt ?? attributes.updated_at;
    const sourceUpdatedAt = parseSourceTimestamp(rawDate);
    const serialized = JSON.stringify(body);
    // JSON.stringify().length counts UTF-16 code units, not UTF-8 bytes.
    // A multibyte product description must not bypass the 128 KiB staging limit.
    if (Buffer.byteLength(serialized, "utf8") > 131072) throw new Error("fudo_record_too_large");
    return {
      externalId: id,
      payload: body,
      contentHash: createHash("sha256").update(canonicalFudoJson(body)).digest("hex"),
      sourceUpdatedAt,
    };
  });
}


/**
 * Resolve page-number progress using the provider's explicit JSON:API next link
 * when available. A provider may cap page size below our requested 100 records:
 * a short response alone must not be treated as the end of that resource.
 *
 * We NEVER fetch provider-supplied links (which could point off-origin).
 * Instead, they are only a continuation signal for our allowlisted, fixed
 * Fudo endpoint and incremented numeric page parameter.
 */
export function nextFudoPage(response: unknown, currentPage: number, recordCount: number, expectedResource?: string, requestedPageSize = FUDO_SYNC_PAGE_SIZE): number {
  if (!Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1 || requestedPageSize > FUDO_SYNC_PAGE_SIZE) {
    throw new Error("invalid_fudo_page");
  }
  // A provider returning more rows than requested breaks numbered offsets.
  // Reject the page during connect/preflight (page size 1) as well as sync.
  if (!Number.isSafeInteger(currentPage) || currentPage < 1 || currentPage > 100000
    || !Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > requestedPageSize) {
    throw new Error("invalid_fudo_page");
  }
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const links = (response as Record<string, unknown>).links;
    if (links !== undefined) {
      if (!links || typeof links !== "object" || Array.isArray(links)) {
        throw new Error("invalid_fudo_page");
      }
      if (Object.prototype.hasOwnProperty.call(links, "next")) {
        const next = (links as Record<string, unknown>).next;
        if (next === null) return 0;
        const href = typeof next === "string" ? next
          : next && typeof next === "object" && !Array.isArray(next)
            ? (next as Record<string, unknown>).href
            : null;
        if (typeof href !== "string" || href.trim().length === 0
          || recordCount === 0 || currentPage === 100000) {
          throw new Error("invalid_fudo_page");
        }

        // Only numbered next-page links can be resumed by this adapter.
        // A merely non-empty href could be a cursor, an old page, an
        // unrelated host or malformed data: silently incrementing would
        // import duplicate or missing records while reporting a full scan.
        // Never fetch this URL or include it in a returned error/log.
        let nextUrl: URL;
        try {
          const link = href.trim();
          if (!/^(https?:\/\/|\/|\?)/i.test(link) || /\s/.test(link)) {
            throw new Error("invalid_fudo_page");
          }
          nextUrl = new URL(link, `https://api.fu.do/v1alpha1/${expectedResource ?? "products"}`);
        } catch {
          throw new Error("invalid_fudo_page");
        }
        if (nextUrl.protocol !== "https:" || nextUrl.origin !== "https://api.fu.do"
          || nextUrl.username || nextUrl.password) {
          throw new Error("invalid_fudo_page");
        }
        // A same-origin link can still point to another Fudo resource. Since
        // the adapter only follows its fixed allowlisted endpoint, accepting
        // that metadata would silently scan the wrong page and misstate
        // reconciliation. Bind the hint to the resource actually requested.
        if (expectedResource) {
          const path = nextUrl.pathname.replace(/\/$/, "");
          if (path !== `/v1alpha1/${expectedResource}` && path !== `/${expectedResource}`) {
            throw new Error("invalid_fudo_page");
          }
        }
        // The importer constructs its own fixed GET with numbered pagination.
        // Unknown next-link parameters (filters, offsets, cursors, etc.) would
        // silently be dropped, so never claim that the scan is complete.
        if (nextUrl.hash) throw new Error("invalid_fudo_page");
        for (const key of nextUrl.searchParams.keys()) {
          if (key !== "page[number]" && key !== "page" && key !== "page[size]") {
            throw new Error("invalid_fudo_page");
          }
        }
        const sizes = nextUrl.searchParams.getAll("page[size]");
        // The next GET repeats the caller's requested size, not the link's
        // query string. A different size would change page offsets and could
        // silently skip records, so fail closed until a durable per-resource
        // effective-size cursor is implemented and verified with Fudo.
        if (sizes.length > 1 || (sizes.length === 1 && sizes[0] !== String(requestedPageSize))) {
          throw new Error("invalid_fudo_page");
        }
        const numbered = nextUrl.searchParams.getAll("page[number]");
        const simple = nextUrl.searchParams.getAll("page");
        if (numbered.length + simple.length !== 1) throw new Error("invalid_fudo_page");
        const nextNumber = (numbered[0] ?? simple[0]).trim();
        if (!/^[1-9]\d*$/.test(nextNumber) || Number(nextNumber) !== currentPage + 1) {
          throw new Error("invalid_fudo_page");
        }
        return currentPage + 1;
      }
    }
  }
  // Legacy fallback only when next-link metadata is absent. A nonempty
  // short import page is ambiguous: Fudo could have capped the requested
  // size while more records remain. Never commit next_page=0 and claim a
  // complete five-resource cycle based only on that short response.
  // Probes request page[size]=1 and do not claim a full import.
  if (requestedPageSize === FUDO_SYNC_PAGE_SIZE && recordCount > 0
    && recordCount < requestedPageSize) {
    throw new Error("invalid_fudo_page");
  }
  if (recordCount !== FUDO_SYNC_PAGE_SIZE) return 0;
  if (currentPage === 100000) throw new Error("invalid_fudo_page");
  return currentPage + 1;
}
