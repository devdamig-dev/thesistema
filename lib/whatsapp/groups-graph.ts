import { array, ConnectionError, metaId, record } from "./signup";
import { GROUP_FIELDS, groupId, type GroupInfo, type GroupReadiness, type GroupSummary } from "./groups";

type Config = { phoneNumberId: string; token: string; version: string; appId: string; appSecret: string; callbackUrl: string; phone: string };
export class WhatsAppGroupsGraph {
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {
    if (!metaId(config.phoneNumberId) || !config.token || !/^v\d+\.\d+$/.test(config.version)) throw new ConnectionError("group_configuration", "No pudimos comprobar la configuración de grupos.", 503);
  }
  private async request(path: string, params: Record<string, string> = {}, body?: Record<string, unknown>, appToken = false): Promise<Record<string, unknown>> {
    const url = new URL(`https://graph.facebook.com/${this.config.version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${appToken ? `${this.config.appId}|${this.config.appSecret}` : this.config.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000) });
    } catch { throw new ConnectionError(body ? "group_result_unknown" : "group_meta_unavailable", body ? "Meta no confirmó el resultado. Actualizá la lista antes de repetir la operación." : "Meta no respondió. Volvé a comprobar el acceso a grupos.", 502); }
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || payload.error) {
      const code = record(payload.error).code;
      throw new ConnectionError("group_meta_rejected", `Meta no autorizó esta operación de grupos${typeof code === "number" ? ` (código ${code})` : ""}. Revisá la habilitación del número y los permisos de la cuenta.`, 502);
    }
    return payload;
  }
  async readiness(): Promise<GroupReadiness> {
    const base = { ready: false, phone: this.config.phone };
    const phone = await this.request(this.config.phoneNumberId, { fields: "id,platform_type,is_on_biz_app,status" });
    if (phone.is_on_biz_app === true) return { ...base, code: "business_app", message: "Este número conserva WhatsApp Business en el celular. Para grupos oficiales necesitás un número de Cloud API con aprobación OBA, sin esa modalidad de conexión." };
    if (phone.is_on_biz_app !== false || phone.platform_type !== "CLOUD_API" || phone.status !== "CONNECTED") return { ...base, code: "phone_not_ready", message: "Meta todavía no confirma un número exclusivo de Cloud API habilitado para grupos." };
    const oba = await this.request(`${this.config.phoneNumberId}/official_business_account`);
    if (oba.oba_status !== "APPROVED") return { ...base, code: "oba_required", message: "Falta la aprobación de cuenta oficial de WhatsApp (OBA) para este número. Es distinta de la aprobación de la aplicación." };
    if (!metaId(this.config.appId) || !this.config.appSecret) throw new ConnectionError("group_configuration", "Falta comprobar la recepción de eventos de grupos de la plataforma.", 503);
    const subscriptions = await this.request(`${this.config.appId}/subscriptions`, {}, undefined, true);
    const subscription = array(subscriptions.data).map(record).find(row => row.object === "whatsapp_business_account");
    const fields = array(subscription?.fields).map(field => typeof field === "string" ? field : record(field).name);
    if (!subscription || subscription.active === false || subscription.callback_url !== this.config.callbackUrl || !["messages", ...GROUP_FIELDS].every(field => fields.includes(field))) return { ...base, code: "group_webhooks_required", message: "El número cumple los requisitos. Falta habilitar la recepción de eventos de grupos en la configuración de GastroPilot." };
    return { ready: true, code: "ready", phone: this.config.phone, message: "Número habilitado para consultar y crear grupos oficiales. Meta valida cada operación." };
  }
  async list(): Promise<GroupSummary[]> {
    const groups: GroupSummary[] = [];
    const seen = new Set<string>();
    let after = "";
    for (let page = 0; page < 10; page++) {
      const payload = await this.request(`${this.config.phoneNumberId}/groups`, { limit: "1024", ...(after ? { after } : {}) });
      const rows = record(payload.data).groups;
      if (!Array.isArray(rows)) throw new ConnectionError("group_list_invalid", "Meta no devolvió una lista de grupos verificable.", 502);
      for (const raw of rows) {
        const value = record(raw);
        if (!groupId(value.id) || typeof value.subject !== "string") throw new ConnectionError("group_list_invalid", "Meta devolvió un grupo incompleto.", 502);
        if (!groups.some(group => group.id === value.id)) groups.push({ id: value.id, subject: value.subject.slice(0, 128) });
      }
      const paging = record(payload.paging);
      if (!paging.next) return groups;
      const cursor = record(paging.cursors).after;
      if (typeof cursor !== "string" || !cursor || seen.has(cursor)) break;
      seen.add(cursor); after = cursor;
    }
    throw new ConnectionError("group_list_incomplete", "No pudimos comprobar la lista completa. No se seleccionó ningún grupo.", 502);
  }
  async assertOwned(id: string): Promise<void> {
    if (!groupId(id) || !(await this.list()).some(group => group.id === id)) throw new ConnectionError("group_not_owned", "Ese grupo no pertenece al número conectado a este negocio.", 403);
  }
  async info(id: string): Promise<GroupInfo> {
    if (!groupId(id)) throw new ConnectionError("invalid_group", "El grupo no es válido.");
    const data = await this.request(id, { fields: "id,subject,participants,total_participant_count,suspended,join_approval_mode" });
    const phones = array(data.participants).map(value => record(value).wa_id);
    const count = Number(data.total_participant_count);
    if (data.id !== id || typeof data.subject !== "string" || typeof data.suspended !== "boolean" || !Array.isArray(data.participants) || !Number.isInteger(count) || count !== phones.length || count > 8 || !phones.every(phone => typeof phone === "string" && /^[1-9]\d{7,14}$/.test(phone)) || new Set(phones).size !== count) throw new ConnectionError("group_info_invalid", "No pudimos verificar todos los integrantes del grupo.", 502);
    return { id, subject: data.subject.slice(0, 128), participants: phones as string[], suspended: data.suspended, approvalRequired: data.join_approval_mode === "approval_required" };
  }
  async create(subject: string, description: string): Promise<void> {
    await this.request(`${this.config.phoneNumberId}/groups`, {}, { messaging_product: "whatsapp", subject, description, join_approval_mode: "approval_required" });
    // Creation is asynchronous. The next list/webhook is the source of truth, never an invented group ID.
  }
  async invitation(id: string): Promise<string> {
    const data = await this.request(`${id}/invite_link`);
    if (typeof data.invite_link !== "string" || !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(data.invite_link)) throw new ConnectionError("invalid_invite", "Meta no devolvió un enlace de invitación válido.", 502);
    return data.invite_link;
  }
  async joinRequests(id: string): Promise<Array<{ id: string; phone: string }>> {
    const payload = await this.request(`${id}/join_requests`, { limit: "100" });
    if (record(payload.paging).next) throw new ConnectionError("join_requests_incomplete", "Hay más solicitudes de las que pudimos verificar.", 409);
    if (!Array.isArray(payload.data)) throw new ConnectionError("join_requests_invalid", "No pudimos comprobar las solicitudes de ingreso.", 502);
    return payload.data.map(raw => {
      const row = record(raw);
      if (!groupId(row.join_request_id) || typeof row.wa_id !== "string" || !/^[1-9]\d{7,14}$/.test(row.wa_id)) throw new ConnectionError("join_requests_invalid", "Meta devolvió una solicitud incompleta.", 502);
      return { id: row.join_request_id, phone: row.wa_id };
    });
  }
  async approve(id: string, requestId: string): Promise<void> {
    const result = await this.request(`${id}/join_requests`, {}, { messaging_product: "whatsapp", join_requests: [requestId] });
    if (!array(result.approved_join_requests).includes(requestId)) throw new ConnectionError("join_not_approved", "Meta no confirmó el ingreso de esa persona.", 502);
  }
}
