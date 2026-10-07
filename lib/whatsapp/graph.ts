import { array, record, metaId, ConnectionError, type PhoneChoice, type SignupMode } from "./signup";

type GraphConfig = { appId: string; appSecret: string; version: string; callbackUrl: string };
export type TokenInfo = { accessToken: string; expiresAt: string | null; accountIds: string[] };
export type GraphPhone = PhoneChoice & { onBusinessApp: boolean; platform: string; status: string };

/** No URLs from Meta pagination are fetched: only opaque cursors are reused on a fixed Graph origin. */
export class WhatsAppGraph {
  constructor(private config: GraphConfig, private fetcher: typeof fetch = fetch) {
    if (!metaId(config.appId) || !config.appSecret || !/^v\d+\.\d+$/.test(config.version)) throw new ConnectionError("configuration_missing", "La conexión de Meta necesita una revisión de configuración.", 503);
  }
  private async request(path: string, token: string | null, params: Record<string, string> = {}, method = "GET"): Promise<Record<string, unknown>> {
    const url = new URL(`https://graph.facebook.com/${this.config.version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error" });
    } catch {
      throw new ConnectionError("meta_unavailable", "Meta no respondió a tiempo. No se modificó tu número; volvé a intentarlo.", 502);
    }
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || payload.error) {
      const error = record(payload.error);
      const code = Number(error.code);
      if ([10, 200, 294].includes(code)) throw new ConnectionError("meta_permissions", "Meta no autorizó el acceso solicitado. Revisá el control de la cuenta y los permisos concedidos a Thesistema. Si continúa, necesitamos revisar los permisos de nuestra aplicación.", 403);
      if (code === 190) throw new ConnectionError("meta_authorization_expired", "La autorización de Meta venció. Volvé a conectar la cuenta.", 401);
      throw new ConnectionError("meta_rejected", `Meta no pudo completar esta operación${Number.isSafeInteger(code) ? ` (código ${code})` : ""}. Conservá tu WhatsApp actual y volvé a intentarlo.`, 502);
    }
    return payload;
  }
  async validateToken(accessToken: string): Promise<TokenInfo> {
    const payload = await this.request("debug_token", `${this.config.appId}|${this.config.appSecret}`, { input_token: accessToken });
    const data = record(payload.data);
    if (data.is_valid !== true || String(data.app_id) !== this.config.appId) throw new ConnectionError("invalid_authorization", "Meta no devolvió una autorización válida para esta aplicación.", 403);
    const now = Math.floor(Date.now() / 1000);
    const expiry = Number(data.expires_at);
    const accessExpiry = Number(data.data_access_expires_at);
    if (!Number.isFinite(expiry) || expiry < 0 || (expiry > 0 && expiry <= now) || (Number.isFinite(accessExpiry) && accessExpiry > 0 && accessExpiry <= now)) throw new ConnectionError("meta_authorization_expired", "La autorización de Meta venció. Volvé a iniciar la conexión.", 401);
    const scopes = array(data.scopes);
    if (!["whatsapp_business_management", "whatsapp_business_messaging"].every(scope => scopes.includes(scope))) throw new ConnectionError("missing_permissions", "Faltó autorizar la administración y mensajería de WhatsApp. Volvé a Meta y concedé ambos permisos; si no se ofrecen, necesitamos habilitarlos en nuestra aplicación.", 403);
    const ids = array(data.granular_scopes).flatMap(scope => {
      const value = record(scope);
      return value.scope === "whatsapp_business_management" ? array(value.target_ids).filter(metaId) : [];
    });
    return { accessToken, expiresAt: expiry > 0 ? new Date(expiry * 1000).toISOString() : null, accountIds: [...new Set(ids)] };
  }
  async exchange(code: string): Promise<TokenInfo> {
    const result = await this.request("oauth/access_token", null, { client_id: this.config.appId, client_secret: this.config.appSecret, code });
    if (typeof result.access_token !== "string" || !result.access_token) throw new ConnectionError("invalid_authorization", "Meta no devolvió una autorización válida.", 403);
    return this.validateToken(result.access_token);
  }
  async phones(accountId: string, token: string, mode: SignupMode): Promise<GraphPhone[]> {
    if (!metaId(accountId)) throw new ConnectionError("invalid_account", "La cuenta seleccionada no es válida.");
    const result: GraphPhone[] = [];
    const visited = new Set<string>();
    let after = "";
    for (let page = 0; page < 20; page++) {
      const payload = await this.request(`${accountId}/phone_numbers`, token, { fields: "id,display_phone_number,verified_name,status,platform_type,is_on_biz_app", limit: "100", ...(after ? { after } : {}) });
      if (!Array.isArray(payload.data)) throw new ConnectionError("invalid_meta_response", "No pudimos comprobar los números autorizados. Reintentá la conexión.", 502);
      for (const raw of payload.data) {
        const phone = record(raw);
        if (!metaId(phone.id) || typeof phone.display_phone_number !== "string") continue;
        const onBusinessApp = phone.is_on_biz_app === true;
        const platform = typeof phone.platform_type === "string" ? phone.platform_type : "";
        const status = typeof phone.status === "string" ? phone.status : "";
        const reason = mode === "business_app" && !onBusinessApp
          ? "Meta no confirmó que este número conserve la app del celular. Repetí la conexión eligiendo WhatsApp Business app."
          : platform !== "CLOUD_API" || status !== "CONNECTED"
            ? "Meta todavía no habilitó este número para operar por esta conexión. No lo borres ni lo desvincules de su plataforma actual."
            : null;
        result.push({ id: phone.id, accountId, phone: phone.display_phone_number, name: typeof phone.verified_name === "string" ? phone.verified_name : "WhatsApp Business", onBusinessApp, platform, status, selectable: reason === null, reason });
      }
      const paging = record(payload.paging);
      if (!paging.next) return result;
      const cursor = record(paging.cursors).after;
      if (typeof cursor !== "string" || !cursor || visited.has(cursor)) break;
      visited.add(cursor);
      after = cursor;
    }
    throw new ConnectionError("account_list_incomplete", "La cuenta tiene más números de los que pudimos verificar. Seleccioná una cuenta más específica en Meta; no elegimos un número automáticamente.", 409);
  }
  async assertWebhook(): Promise<void> {
    const payload = await this.request(`${this.config.appId}/subscriptions`, `${this.config.appId}|${this.config.appSecret}`);
    const subscription = array(payload.data).map(record).find(value => value.object === "whatsapp_business_account");
    const fields = array(subscription?.fields).map(field => typeof field === "string" ? field : record(field).name);
    if (!subscription || subscription.active === false || subscription.callback_url !== this.config.callbackUrl || !fields.includes("messages")) throw new ConnectionError("provider_setup_required", "La cuenta fue autorizada, pero falta habilitar la recepción de mensajes de Thesistema en Meta. Es una configuración de nuestra plataforma, no de tu número.", 503);
  }
  async subscribe(accountId: string, token: string): Promise<void> {
    const result = await this.request(`${accountId}/subscribed_apps`, token, {}, "POST");
    if (result.success !== true) throw new ConnectionError("subscription_not_confirmed", "Meta no confirmó la recepción de mensajes. La conexión no se marcó como terminada.", 502);
  }
}
