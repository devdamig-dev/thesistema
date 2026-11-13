/**
 * Fudo read-only API adapter.
 *
 * Server-side only. Callers are responsible for loading credentials from a
 * protected tenant-bound store. Never expose apiKey/apiSecret to the browser.
 *
 * Contract currently targeted:
 * - API: https://api.fu.do/v1alpha1
 * - auth: API key + API secret -> bearer token
 * - token expires and must be renewed
 *
 * Mutating verbs are intentionally not exposed in this foundation.
 */

import { nextFudoPage, parseFudoPage } from "./snapshot";
import { assertSafeFudoJsonNumbers } from "./json-numbers";
import { assertUniqueFudoJsonKeys } from "./json-keys";
import { runFudoReadBatch } from "./read-batch";

export type FudoCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type FudoClientOptions = {
  apiUrl?: string;
  authUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

export type FudoListParams = Record<string, string | number | boolean | undefined>;

export type FudoResource =
  | "products"
  | "ingredients"
  | "providers"
  | "sales"
  | "orders"
  | "customers"
  | "tables"
  | "rooms"
  | "users"
  | "payment-methods"
  | "payments"
  | "kitchens";

export type FudoReadResourceStatus = {
  resource: FudoResource;
  code: "available" | FudoApiError["code"];
};

type AuthPayload = {
  token?: unknown;
  exp?: unknown;
};

export class FudoApiError extends Error {
  constructor(
    public readonly code:
      | "invalid_credentials"
      | "forbidden"
      | "rate_limited"
      | "provider_unavailable"
      | "api_unavailable"
      | "invalid_response",
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FudoApiError";
  }
}

const DEFAULT_API_URL = "https://api.fu.do/v1alpha1";
const DEFAULT_AUTH_URL = "https://auth.fu.do/api";
const TOKEN_SKEW_MS = 5 * 60 * 1000;
// Some valid auth responses omit an explicit exp (e.g. expiry is carried in
// the bearer itself). Cache briefly rather than authenticating before every
// single GET; a 401 still forces one safe refresh.
const MISSING_EXP_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function safeError(status: number, phase: "auth" | "read"): FudoApiError {
  if (status === 401) {
    return new FudoApiError(
      "invalid_credentials",
      "Fudo rechazó las credenciales o el token.",
      status,
      false,
    );
  }
  if (status === 403) {
    return new FudoApiError(
      "forbidden",
      "El usuario de Fudo no tiene permisos suficientes para este recurso.",
      status,
      false,
    );
  }
  if (status === 404) {
    return new FudoApiError("api_unavailable", "No encontramos el endpoint de Fudo. Revisá la versión y la habilitación de la API.", status, false);
  }
  // Fudo can reject an otherwise reachable GET with 400/422 when query
  // parameters do not match its API contract. This is NOT a provider outage:
  // classify the read as incompatible and never retry it as a transient error.
  // Authentication errors have a different operator remedy. Never inspect or
  // echo the upstream error body (which might contain sensitive diagnostics).
  if (status === 400 || status === 422) {
    return new FudoApiError(
      phase === "auth" ? "invalid_credentials" : "invalid_response",
      phase === "auth"
        ? "Fudo rechazó la solicitud de autenticación."
        : "Fudo rechazó la consulta de lectura. Revisá la compatibilidad de la API.",
      status,
      false,
    );
  }
  if (status === 429) {
    return new FudoApiError(
      "rate_limited",
      "Fudo limitó temporalmente las solicitudes.",
      status,
      true,
    );
  }
  // A provider-side timeout or early-request rejection is transient, not
  // evidence that our query or credentials are incompatible. No automatic
  // replay: callers may choose a fresh manual read from the durable cursor.
  if (status === 408 || status === 425) {
    return new FudoApiError(
      "provider_unavailable",
      "Fudo no pudo completar temporalmente la consulta.",
      status,
      true,
    );
  }
  // Other HTTP 4xx (e.g. 405/406/409/410/415) are explicit provider
  // rejections, not outages. Never retry these as transient failures or
  // surface provider error bodies/headers in operator feedback.
  if (status >= 400 && status < 500) {
    return new FudoApiError(
      "invalid_response",
      "Fudo rechazó una solicitud incompatible con su API.",
      status,
      false,
    );
  }
  return new FudoApiError(
    "provider_unavailable",
    "Fudo no pudo responder correctamente.",
    status,
    status >= 500,
  );
}

function normalizeExpiration(exp: unknown): number {
  // Explicit expirations must be exact, representable UTC instants. Number()
  // can turn a huge numeric string into Infinity or silently round an epoch;
  // either used to be capped to a seemingly valid 24-hour lease. Fail closed
  // rather than authorize provider GETs with an unverifiable expiration.
  const parsed = typeof exp === "string" && /^\d+$/.test(exp)
    ? Number(exp) : exp;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    return 0;
  }
  // JWT-style exp is normally seconds; older Fudo payloads may use ms.
  const millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  // Date's representable timestamp range ends at +/-8.64e15ms.
  return Number.isSafeInteger(millis) && millis <= 8_640_000_000_000_000
    ? millis : 0;
}

function toQuery(params: FudoListParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}


/**
 * Bound provider JSON BEFORE parsing it. Snapshot size checks happen after
 * JSON.parse and cannot prevent an unexpectedly large upstream response from
 * exhausting serverless memory. Keep this limit generous enough for 100 records
 * of up to 128 KiB each, but reject oversized/misreported streams fail-closed.
 *
 * Errors from here are mapped to fixed, non-sensitive invalid_response codes
 * by the caller. Never log or return provider body bytes.
 */
const MAX_AUTH_JSON_BYTES = 64 * 1024;
// Connect and permission checks request only one record, not a 100-record
// import page. Keep the aggregate payload budget low when probing five
// resources concurrently: each individual staged record is capped at 128 KiB.
const MAX_PROBE_JSON_BYTES = 1024 * 1024;
const MAX_READ_JSON_BYTES = 16 * 1024 * 1024;

// Fetch resolves as soon as headers arrive; a discarded error response can
// still carry an unbounded body. Cancel it before retrying/authenticating or
// returning a sanitized status, without parsing or logging provider content.
async function discardResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Already closed or aborted. */ }
}

async function readBoundedJson(response: Response, maxBytes: number, enforceNumericFidelity = false): Promise<unknown> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes) {
    // Header-based rejection must also release the upstream response. Otherwise
    // a rejected body can keep a serverless fetch/stream alive until timeout.
    await discardResponseBody(response);
    throw new Error("fudo_response_too_large");
  }
  if (!response.body) throw new Error("fudo_response_missing_body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    while (true) {
      // A stream may fail after HTTP 200 (timeout, aborted connection, socket reset).
      // Treat an interrupted transport differently from malformed provider JSON,
      // and never propagate the stream's potentially sensitive error message.
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try { readResult = await reader.read(); }
      catch { throw new Error("fudo_response_transport_failed"); }
      const { done, value } = readResult;
      if (done) { finished = true; break; }
      total += value.byteLength;
      if (total > maxBytes) throw new Error("fudo_response_too_large");
      chunks.push(value);
    }
  } finally {
    // Stop downloading once a bound or network error is detected.
    if (!finished) {
      try { await reader.cancel(); } catch { /* Transport already closed. */ }
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // JSON.parse silently overwrites duplicate object keys, which would alter
  // provider prices/IDs before staging and make reconciliation unreliable.
  // Inspect both auth and read JSON before parsing; never reveal payload bytes.
  assertUniqueFudoJsonKeys(source);
  if (enforceNumericFidelity) assertSafeFudoJsonNumbers(source);
  return JSON.parse(source);
}

export class FudoClient {
  private readonly apiUrl: string;
  private readonly authUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  // Share a single auth/refresh request across concurrent read probes.
  // Fudo O1 preflight reads five endpoints in parallel.
  private authenticationInFlight: Promise<void> | null = null;

  constructor(
    private readonly credentials: FudoCredentials,
    options: FudoClientOptions = {},
  ) {
    if (!credentials.apiKey.trim() || !credentials.apiSecret.trim()) {
      throw new FudoApiError(
        "invalid_credentials",
        "Las credenciales de Fudo están incompletas.",
        null,
        false,
      );
    }
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.authUrl = options.authUrl ?? DEFAULT_AUTH_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = Math.min(30000, Math.max(1000, options.timeoutMs ?? 15000));
  }

  private async authenticate(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.authUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: this.credentials.apiKey,
          apiSecret: this.credentials.apiSecret,
        }),
        cache: "no-store",
        // Never forward API key/secret to an auth-origin redirect (307/308).
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new FudoApiError(
        "provider_unavailable",
        "No se pudo contactar al servicio de autenticación de Fudo.",
        null,
        true,
      );
    }

    if (!response.ok) {
      await discardResponseBody(response);
      throw safeError(response.status, "auth");
    }

    // A 206 Partial Content (or another unexpected 2xx) may still contain a
    // valid-looking bearer JSON while omitting authentication data. Only a
    // complete HTTP 200 auth response may install a token or authorize a GET.
    // Cancel the upstream body without reading or logging provider content.
    if (response.status !== 200) {
      await discardResponseBody(response);
      throw new FudoApiError(
        "invalid_response",
        "Fudo devolvió un estado de autenticación inesperado.",
        response.status,
        false,
      );
    }

    let payload: AuthPayload;
    try {
      payload = (await readBoundedJson(response, MAX_AUTH_JSON_BYTES)) as AuthPayload;
    } catch (error) {
      const interrupted = error instanceof Error && error.message === "fudo_response_transport_failed";
      throw new FudoApiError(
        interrupted ? "provider_unavailable" : "invalid_response",
        interrupted
          ? "Se interrumpió la respuesta de autenticación de Fudo. Reintentá."
          : "Fudo devolvió una respuesta de autenticación inválida.",
        response.status,
        interrupted,
      );
    }

    // A syntactically valid JSON response can still be null, an array, or a
    // primitive. Treat it as a provider contract error, never a generic crash.
    // Bearer values must be a single, bounded HTTP-header token. A provider
    // response containing only whitespace, control characters or an enormous
    // token is not a successful authentication. Reject before issuing ANY GET.
    // Do not echo provider-supplied token contents into errors or logs.
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || typeof payload.token !== "string" || payload.token.length === 0
      || payload.token.length > 8192 || /[\s\x00-\x1f\x7f]/.test(payload.token)) {
      throw new FudoApiError(
        "invalid_response",
        "Fudo no devolvió un token utilizable.",
        response.status,
        false,
      );
    }

    const now = this.now();
    // JSON null explicitly supplied by Fudo is invalid, not an omitted exp.
    // Only an absent property may use the bounded fallback lease.
    const hasExplicitExpiration = Object.prototype.hasOwnProperty.call(payload, "exp");
    const explicitExpiration = hasExplicitExpiration ? normalizeExpiration(payload.exp) : null;
    // An explicit but malformed/expired timestamp is not a usable token:
    // fail before sending it to Fudo. An omitted timestamp is different:
    // give the otherwise valid bearer a short, bounded local lease and rely
    // on the existing 401 single-flight refresh if the provider revokes it.
    if (hasExplicitExpiration && (!explicitExpiration || explicitExpiration <= now)) {
      throw new FudoApiError(
        "invalid_response",
        "Fudo devolvió una expiración de token inválida.",
        response.status,
        false,
      );
    }
    this.token = payload.token;
    this.tokenExpiresAt = Math.min(
      explicitExpiration ?? now + MISSING_EXP_TTL_MS,
      now + MAX_TOKEN_CACHE_TTL_MS,
    );
  }

  private async authenticateOnce(): Promise<void> {
    if (this.authenticationInFlight) {
      await this.authenticationInFlight;
      return;
    }
    const pending = this.authenticate();
    this.authenticationInFlight = pending;
    try {
      await pending;
    } finally {
      // A failed authentication must not poison subsequent manual retries.
      if (this.authenticationInFlight === pending) this.authenticationInFlight = null;
    }
  }

  private async ensureAuthenticated(): Promise<string> {
    // Return the bearer observed during the authentication check, instead of
    // reading mutable shared state after getJson's await boundary. A parallel
    // read can receive 401 and clear this.token in that microtask gap, causing
    // the next GET to send the literal "Bearer null".
    for (let attempt = 0; attempt < 2; attempt++) {
      if (
        !this.token ||
        !this.tokenExpiresAt ||
        this.tokenExpiresAt <= this.now() + TOKEN_SKEW_MS
      ) {
        await this.authenticateOnce();
      }
      const bearer = this.token;
      if (bearer) return bearer;
      // A concurrent 401 may invalidate the token while auth was awaited.
      // Make at most one additional coalesced auth attempt.
    }
    throw new FudoApiError(
      "provider_unavailable",
      "No se pudo establecer una sesión de lectura de Fudo.",
      null,
      true,
    );
  }

  private async getJson(path: string, params: FudoListParams = {}, retry = true): Promise<unknown> {
    // Capture the exact authorized bearer before yielding to other requests.
    // A later 401 can invalidate the cache, but it must never produce a GET
    // with "Bearer null" or with a newer unrelated token.
    const attemptedToken = await this.ensureAuthenticated();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiUrl}/${path.replace(/^\//, "")}${toQuery(params)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${attemptedToken}`,
          },
          cache: "no-store",
          // Never follow a provider redirect carrying our bearer token.
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new FudoApiError(
        "provider_unavailable",
        "No se pudo contactar a la API de Fudo.",
        null,
        true,
      );
    }

    if (response.status === 401 && retry) {
      // The first 401 may have an arbitrarily large body. Release it before
      // refreshing credentials or issuing any retry GET.
      await discardResponseBody(response);
      // Never invalidate a newer token installed by a concurrent read.
      if (this.token === attemptedToken) {
        this.token = null;
        this.tokenExpiresAt = 0;
      }
      await this.ensureAuthenticated();
      // One retry per read only, even if the new token is also rejected.
      return this.getJson(path, params, false);
    }

    if (!response.ok) {
      await discardResponseBody(response);
      throw safeError(response.status, "read");
    }

    // Fudo's read endpoints declare HTTP 200 for complete JSON:API pages.
    // Other 2xx statuses (especially 206 Partial Content) cannot certify a
    // complete page, product probe or import cursor. Never parse/stage them.
    // Cancel the upstream stream without exposing its body or treating it as
    // a successful read-only sync.
    if (response.status !== 200) {
      await discardResponseBody(response);
      throw new FudoApiError(
        "invalid_response",
        "Fudo devolvió un estado de lectura inesperado.",
        response.status,
        false,
      );
    }

    try {
      // A one-record preflight should never buffer a 16 MiB import page.
      // Full 100-record synchronization retains its existing larger bound.
      const maxBytes = String(params["page[size]"] ?? "") === "1"
        ? MAX_PROBE_JSON_BYTES : MAX_READ_JSON_BYTES;
      return await readBoundedJson(response, maxBytes, true);
    } catch (error) {
      const interrupted = error instanceof Error && error.message === "fudo_response_transport_failed";
      throw new FudoApiError(
        interrupted ? "provider_unavailable" : "invalid_response",
        interrupted
          ? "Se interrumpió la lectura de Fudo. Reintentá."
          : "Fudo devolvió una respuesta inválida.",
        response.status,
        interrupted,
      );
    }
  }

  /** Generic read-only listing for explicitly allowed Fudo resources. */
  list(resource: FudoResource, params: FudoListParams = {}): Promise<unknown> {
    return this.getJson(resource, params);
  }

  products(params: FudoListParams = {}) {
    return this.list("products", params);
  }

  ingredients(params: FudoListParams = {}) {
    return this.list("ingredients", params);
  }

  providers(params: FudoListParams = {}) {
    return this.list("providers", params);
  }

  sales(params: FudoListParams = {}) {
    return this.list("sales", params);
  }

  orders(params: FudoListParams = {}) {
    return this.list("orders", params);
  }

  /**
   * Diagnostic read-only probes for the five O1 resources.
   * Authentication is performed once, before starting resource reads in parallel.
   * Only sanitized status codes leave this client, never provider payloads/URLs.
   */
  async probeReadAccess(resources: readonly FudoResource[]): Promise<FudoReadResourceStatus[]> {
    await this.ensureAuthenticated();
    // Bound preflight bursts just like sync imports. A five-resource probe must
    // not issue five simultaneous GETs against a rate-limited Fudo account.
    // Per-resource errors remain sanitized results, so all checks still run.
    return runFudoReadBatch(resources, async (resource): Promise<FudoReadResourceStatus> => {
      try {
        const response = await this.list(resource, { "page[number]": 1, "page[size]": 1 });
        // A 200 alone is not enough: invalid JSON:API shape would break a sync.
        const snapshots = parseFudoPage(response, resource);
        // The first page must also have usable pagination metadata; otherwise
        // the importer would fail immediately after a misleading green probe.
        nextFudoPage(response, 1, snapshots.length, resource, 1);
        return { resource, code: "available" };
      } catch (error) {
        return { resource, code: error instanceof FudoApiError ? error.code : "invalid_response" };
      }
    });
  }

  /**
   * A successful HTTP response alone is not a working integration:
   * verify the same JSON:API record contract required by the importer before
   * accepting or storing credentials as "connected". No provider data leaves
   * this probe and no provider mutation is performed.
   */
  async testConnection(): Promise<{ ok: true }> {
    const response = await this.products({ "page[size]": 1, "page[number]": 1 });
    const snapshots = parseFudoPage(response, "products");
    nextFudoPage(response, 1, snapshots.length, "products", 1);
    return { ok: true };
  }
}
