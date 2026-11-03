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

function safeError(status: number): FudoApiError {
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
  if (status === 429) {
    return new FudoApiError(
      "rate_limited",
      "Fudo limitó temporalmente las solicitudes.",
      status,
      true,
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
  if (typeof exp === "number" && Number.isFinite(exp)) {
    // JWT-style exp is normally seconds since epoch. Accept ms too.
    return exp < 10_000_000_000 ? exp * 1000 : exp;
  }
  if (typeof exp === "string" && /^\d+$/.test(exp)) {
    return normalizeExpiration(Number(exp));
  }
  return 0;
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

export class FudoClient {
  private readonly apiUrl: string;
  private readonly authUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private token: string | null = null;
  private tokenExpiresAt = 0;

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

    if (!response.ok) throw safeError(response.status);

    let payload: AuthPayload;
    try {
      payload = (await response.json()) as AuthPayload;
    } catch {
      throw new FudoApiError(
        "invalid_response",
        "Fudo devolvió una respuesta de autenticación inválida.",
        response.status,
        false,
      );
    }

    if (typeof payload.token !== "string" || !payload.token) {
      throw new FudoApiError(
        "invalid_response",
        "Fudo no devolvió un token utilizable.",
        response.status,
        false,
      );
    }

    this.token = payload.token;
    this.tokenExpiresAt = normalizeExpiration(payload.exp);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (
      !this.token ||
      !this.tokenExpiresAt ||
      this.tokenExpiresAt <= this.now() + TOKEN_SKEW_MS
    ) {
      await this.authenticate();
    }
  }

  private async getJson(path: string, params: FudoListParams = {}, retry = true): Promise<unknown> {
    await this.ensureAuthenticated();

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiUrl}/${path.replace(/^\//, "")}${toQuery(params)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          cache: "no-store",
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
      this.token = null;
      this.tokenExpiresAt = 0;
      await this.authenticate();
      return this.getJson(path, params, false);
    }

    if (!response.ok) throw safeError(response.status);

    try {
      return await response.json();
    } catch {
      throw new FudoApiError(
        "invalid_response",
        "Fudo devolvió una respuesta inválida.",
        response.status,
        false,
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

  /** Minimal harmless probe used by a connection-test route later. */
  async testConnection(): Promise<{ ok: true }> {
    await this.products({ "page[size]": 1, "page[number]": 1 });
    return { ok: true };
  }
}
