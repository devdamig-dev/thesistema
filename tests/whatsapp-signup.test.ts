import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { authorizeConnectionActor, parseConnectionRequest, parseSignupEvent, signupOptions, sameOrigin, ConnectionError } from "../lib/whatsapp/signup";
import { WhatsAppGraph } from "../lib/whatsapp/graph";
import { assertSession, connectSelection, prepareConnection, type ConnectionGraph, type ConnectionStore, type SignupSession } from "../lib/whatsapp/connection-service";
import { incomingMetaTexts, validMetaSignature } from "../lib/whatsapp/webhook";

const actor = { userId: "00000000-0000-4000-8000-000000000001", businessId: "00000000-0000-4000-8000-000000000002", role: "owner" };
const phone = { id: "123456789", accountId: "987654321", name: "QA", phone: "+54 9 11 1234 5678", selectable: true, reason: null, onBusinessApp: true, platform: "CLOUD_API", status: "CONNECTED" };
function fixture() {
  let session: SignupSession | null = null;
  let writes = 0;
  let subscriptions = 0;
  const graph: ConnectionGraph = {
    exchange: async () => ({ accessToken: "unit-test-secret-not-real", expiresAt: null, accountIds: [phone.accountId] }),
    validateToken: async token => ({ accessToken: token, expiresAt: null, accountIds: [phone.accountId] }),
    phones: async () => [phone], assertWebhook: async () => {}, subscribe: async () => { subscriptions++; },
  };
  const store: ConnectionStore = {
    create: async value => { session = value; }, get: async () => session,
    claim: async () => { if (!session || session.claimed_at) return false; session.claimed_at = new Date().toISOString(); return true; },
    discard: async () => { if (session) session.access_token = null; },
    persist: async () => { writes++; if (session) { session.consumed_at = new Date().toISOString(); session.access_token = null; } },
    assertAvailable: async () => {},
  };
  return { graph, store, session: () => session!, writes: () => writes, subscriptions: () => subscriptions };
}
const prepare = (f: ReturnType<typeof fixture>) => prepareConnection(actor, { action: "prepare", mode: "business_app", code: "authorized-test-code", wabaId: phone.accountId }, f.graph, f.store);

test("signup requires a real authenticated owner/admin and selected business", () => {
  for (const role of ["viewer", "employee", "manager"]) assert.throws(() => authorizeConnectionActor({ ...actor, role, isAuthenticated: true }));
  assert.throws(() => authorizeConnectionActor({ ...actor, isAuthenticated: false }));
  assert.throws(() => authorizeConnectionActor({ ...actor, isAuthenticated: true, businessId: null }));
  assert.deepEqual(authorizeConnectionActor({ ...actor, isAuthenticated: true }), actor);
});
test("signup DTO rejects tenant injection, malformed/null bodies and unrecognized flow", () => {
  for (const raw of [null, [], {}, { action: "prepare", mode: "business_app", code: "test", business_id: actor.businessId }, { action: "prepare", mode: "anything", code: "test" }, { action: "prepare", mode: "cloud_api", code: "test", wabaId: 123456 }]) assert.throws(() => parseConnectionRequest(raw));
  assert.equal(parseConnectionRequest({ action: "prepare", mode: "business_app", code: "test" }).action, "prepare");
});
test("Business App launch explicitly requests Coexistence, including with a v4 configuration", () => {
  assert.deepEqual(signupOptions("123456789", "business_app"), {
    config_id: "123456789",
    response_type: "code",
    override_default_response_type: true,
    extras: { featureType: "whatsapp_business_app_onboarding" },
  });
});
test("Cloud API launch keeps configuration-driven products and permissions without Coexistence", () => {
  assert.deepEqual(signupOptions("123456789", "cloud_api"), {
    config_id: "123456789",
    response_type: "code",
    override_default_response_type: true,
    extras: {},
  });
  // Switching flows with the same config must not retain Business App launch options.
  signupOptions("123456789", "business_app");
  assert.deepEqual(signupOptions("123456789", "cloud_api").extras, {});
});
test("both signup modes preserve the selected configuration and reject malformed IDs", () => {
  for (const mode of ["business_app", "cloud_api"] as const) {
    assert.equal(signupOptions("222222222", mode).config_id, "222222222");
    assert.throws(() => signupOptions("invalid", mode));
  }
});
test("Business App completion accepts account-only event and rejects non-Meta origins", () => {
  const event = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: phone.accountId } };
  assert.deepEqual(parseSignupEvent("https://www.facebook.com", JSON.stringify(event)), { kind: "finish", accountId: phone.accountId });
  for (const origin of ["null", "https://www.facebook.com.evil.test", "https://evil.test"]) assert.equal(parseSignupEvent(origin, event), null);
  assert.equal(parseSignupEvent("https://www.facebook.com", "not json"), null);
  assert.equal(parseSignupEvent("https://www.facebook.com", { ...event, data: { waba_id: "malformed" } }), null);
});
test("same-origin mutation protection fails closed", () => {
  assert.equal(sameOrigin("https://example.test/api", "https://example.test"), true);
  for (const origin of [null, "null", "https://evil.test", "https://example.test/path"]) assert.equal(sameOrigin("https://example.test/api", origin), false);
});
test("preparation discovers an account-only number without exposing tokens or executing writes", async () => {
  const f = fixture(); const result = await prepare(f);
  assert.equal(result.phase, "choose_number"); assert.equal(result.choices.length, 1);
  assert.equal(f.writes(), 0); assert.equal(f.subscriptions(), 0);
  assert.equal(JSON.stringify(result).includes("unit-test-secret"), false);
  assert.equal(result.suggestedPhoneId, null);
});
test("account-only Business App completion discovers and revalidates a number before explicit connection", async () => {
  const f = fixture();
  const event = parseSignupEvent("https://web.facebook.com", {
    type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: phone.accountId },
  });
  assert.equal(event?.kind, "finish");
  if (event?.kind !== "finish") assert.fail("expected account-only completion");
  assert.equal(event.phoneNumberId, undefined);
  const lookups: Array<{ accountId: string; mode: string }> = [];
  f.graph.phones = async (accountId, _token, mode) => { lookups.push({ accountId, mode }); return [phone]; };
  const result = await prepareConnection(actor, { action: "prepare", mode: "business_app", code: "authorized-test-code", wabaId: event.accountId }, f.graph, f.store);
  assert.equal(result.suggestedPhoneId, null);
  assert.equal(result.choices[0].selectable, true);
  assert.equal(f.subscriptions(), 0); assert.equal(f.writes(), 0);
  await connectSelection(actor, result.sessionId, phone.id, f.graph, f.store);
  assert.deepEqual(lookups, [{ accountId: phone.accountId, mode: "business_app" }, { accountId: phone.accountId, mode: "business_app" }]);
  assert.equal(f.subscriptions(), 1); assert.equal(f.writes(), 1);
});
test("multiple authorized phones require an explicit final selection", async () => {
  const f = fixture(); f.graph.phones = async () => [phone, { ...phone, id: "222222222" }];
  const result = await prepare(f); assert.equal(result.choices.length, 2); assert.equal(f.writes(), 0);
  await connectSelection(actor, result.sessionId, "222222222", f.graph, f.store); assert.equal(f.writes(), 1);
});
test("unshared account and forged phone selection fail without subscription/persistence", async () => {
  const f = fixture();
  await assert.rejects(prepareConnection(actor, { action: "prepare", mode: "business_app", code: "test", wabaId: "555555555" }, f.graph, f.store));
  const result = await prepare(f);
  await assert.rejects(connectSelection(actor, result.sessionId, "666666666", f.graph, f.store));
  assert.equal(f.subscriptions(), 0); assert.equal(f.writes(), 0);
});
test("signup session cannot cross businesses or users even if a store returns it", async () => {
  const f = fixture(); const result = await prepare(f);
  await assert.rejects(connectSelection({ ...actor, businessId: "other-business" }, result.sessionId, phone.id, f.graph, f.store));
  await assert.rejects(connectSelection({ ...actor, userId: "other-user" }, result.sessionId, phone.id, f.graph, f.store));
  assert.equal(f.writes(), 0); assert.equal(f.subscriptions(), 0);
});
test("expired or previously claimed sessions cannot complete", async () => {
  const f = fixture(); await prepare(f);
  for (const session of [{ ...f.session(), expires_at: "not-a-date" }, { ...f.session(), expires_at: new Date(0).toISOString() }, { ...f.session(), claimed_at: new Date().toISOString() }, { ...f.session(), access_token: null }]) assert.throws(() => assertSession(session, actor, Date.now()));
});
test("missing app webhook is a platform error, not a successful customer connection", async () => {
  const f = fixture(); const result = await prepare(f);
  f.graph.assertWebhook = async () => { throw new ConnectionError("provider_setup_required", "missing callback", 503); };
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store));
  assert.equal(f.writes(), 0); assert.equal(f.subscriptions(), 0); assert.equal(f.session().claimed_at, null);
});
test("competing confirmations persist and subscribe at most once", async () => {
  const f = fixture(); const result = await prepare(f);
  const results = await Promise.allSettled([connectSelection(actor, result.sessionId, phone.id, f.graph, f.store), connectSelection(actor, result.sessionId, phone.id, f.graph, f.store)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.writes(), 1); assert.equal(f.subscriptions(), 1); assert.equal(f.session().access_token, null);
});
test("revoked phone readiness or another business assignment never gets overwritten", async () => {
  const f = fixture(); const result = await prepare(f);
  f.graph.phones = async () => [{ ...phone, selectable: false, reason: "not ready" }];
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store));
  f.graph.phones = async () => [phone]; f.store.assertAvailable = async () => { throw new Error("already assigned"); };
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store));
  assert.equal(f.writes(), 0); assert.equal(f.subscriptions(), 0);
});
test("failed persistence does not return linked and clears the short-lived token", async () => {
  const f = fixture(); const result = await prepare(f); f.store.persist = async () => { throw new Error("database failure"); };
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store));
  assert.equal(f.writes(), 0); assert.equal(f.session().access_token, null);
});

const config = { appId: "123456789", appSecret: "unit-test-only", version: "v25.0", callbackUrl: "https://example.test/api/webhooks/whatsapp" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
test("Graph phone listing follows cursors on fixed origin, not attacker next URLs", async () => {
  const urls: string[] = [];
  const graph = new WhatsAppGraph(config, (async (input: unknown) => {
    urls.push(String(input));
    return response({ data: [{ id: urls.length === 1 ? "111111111" : "222222222", display_phone_number: "+5491112345678", platform_type: "CLOUD_API", status: "CONNECTED", is_on_biz_app: true }], ...(urls.length === 1 ? { paging: { next: "https://evil.test/collect", cursors: { after: "next-cursor" } } } : {}) });
  }) as typeof fetch);
  const phones = await graph.phones(phone.accountId, "test-token", "business_app");
  assert.equal(phones.length, 2); assert.equal(urls.length, 2);
  assert.ok(urls.every(url => new URL(url).origin === "https://graph.facebook.com"));
  assert.equal(new URL(urls[1]).searchParams.get("after"), "next-cursor");
});
test("Graph does not promise coexistence for an unpaired or unregistered number", async () => {
  const graph = new WhatsAppGraph(config, (async () => response({ data: [{ id: phone.id, display_phone_number: phone.phone, platform_type: "ON_PREMISE", status: "CONNECTED", is_on_biz_app: true }] })) as typeof fetch);
  assert.equal((await graph.phones(phone.accountId, "test-token", "business_app"))[0].selectable, false);
});
test("Graph enables Coexistence only for connected Cloud API numbers confirmed on the Business App", async () => {
  const base = { id: phone.id, display_phone_number: phone.phone, platform_type: "CLOUD_API", status: "CONNECTED", is_on_biz_app: true };
  for (const [overrides, selectable] of [
    [{}, true],
    [{ is_on_biz_app: false }, false],
    [{ is_on_biz_app: undefined }, false],
    [{ is_on_biz_app: "true" }, false],
    [{ platform_type: "ON_PREMISE" }, false],
    [{ platform_type: undefined }, false],
    [{ status: "PENDING" }, false],
  ] as const) {
    const graph = new WhatsAppGraph(config, (async () => response({ data: [{ ...base, ...overrides }] })) as typeof fetch);
    assert.equal((await graph.phones(phone.accountId, "test-token", "business_app"))[0].selectable, selectable, JSON.stringify(overrides));
  }
});
test("an existing connected Cloud API number does not need to be on the Business App", async () => {
  const graph = new WhatsAppGraph(config, (async () => response({ data: [{ id: phone.id, display_phone_number: phone.phone, platform_type: "CLOUD_API", status: "CONNECTED", is_on_biz_app: false }] })) as typeof fetch);
  assert.equal((await graph.phones(phone.accountId, "test-token", "cloud_api"))[0].selectable, true);
  assert.equal((await graph.phones(phone.accountId, "test-token", "business_app"))[0].selectable, false);
});
test("Graph rejects tokens for another app, missing scopes and invalid/expired authorizations", async () => {
  const valid = { is_valid: true, app_id: config.appId, expires_at: 0, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] };
  for (const data of [{ ...valid, is_valid: false }, { ...valid, app_id: "999999999" }, { ...valid, scopes: [] }, { ...valid, expires_at: 1 }]) {
    const graph = new WhatsAppGraph(config, (async () => response({ data })) as typeof fetch);
    await assert.rejects(graph.validateToken("test-token"));
  }
});
test("Graph webhook check validates exact callback plus messages field", async () => {
  for (const entry of [{ object: "whatsapp_business_account", callback_url: "https://wrong.test", fields: [{ name: "messages" }] }, { object: "whatsapp_business_account", callback_url: config.callbackUrl, fields: [] }]) {
    const graph = new WhatsAppGraph(config, (async () => response({ data: [entry] })) as typeof fetch);
    await assert.rejects(graph.assertWebhook());
  }
});
const message = (id: string) => ({ id, from: "5491112345678", timestamp: "1791400000", type: "text", text: { body: "ventas de hoy" } });
const envelope = (field = "messages", messages: unknown[] = [message("a")]) => ({ object: "whatsapp_business_account", entry: [{ id: phone.accountId, changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone.id }, messages } }] }] });
test("webhook iterates every incoming text and deduplicates repeated IDs within the envelope", () => {
  const data = envelope("messages", [message("a"), message("b"), message("a")]);
  assert.equal(incomingMetaTexts(data).length, 2);
  data.entry.push({ ...data.entry[0], changes: [{ ...data.entry[0].changes[0], value: { ...data.entry[0].changes[0].value, messages: [message("c")] } }] });
  assert.equal(incomingMetaTexts(data).length, 3);
});
test("histories, SMB app sync, echoes, delivery receipts and group/media events never become commands", () => {
  for (const field of ["history", "smb_app_state_sync", "smb_message_echoes", "account_update"]) assert.deepEqual(incomingMetaTexts(envelope(field)), []);
  for (const event of [{ ...message("a"), type: "image" }, { ...message("a"), is_echo: true }, { ...message("a"), context: { group_id: "group" } }, { ...message("a"), timestamp: "bad" }]) assert.deepEqual(incomingMetaTexts(envelope("messages", [event])), []);
  assert.deepEqual(incomingMetaTexts({ text: "registrá una compra", from: "5491112345678" }), []);
});
test("Meta signature is mandatory, payload-bound and constant-time verified", () => {
  const raw = JSON.stringify(envelope()); const secret = "unit-test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(validMetaSignature(raw, signature, secret), true);
  assert.equal(validMetaSignature(`${raw} `, signature, secret), false);
  assert.equal(validMetaSignature(raw, null, secret), false);
  assert.equal(validMetaSignature(raw, "sha256=bad", secret), false);
});


test("post-claim subscription and persistence failures require a status check, not reused selection", async () => {
  for (const stage of ["subscribe", "persist"] as const) {
    const f = fixture(); const result = await prepare(f);
    if (stage === "subscribe") f.graph.subscribe = async () => { throw new ConnectionError("meta_unavailable", "temporary", 502); };
    else f.store.persist = async () => { throw new Error("database unavailable"); };
    await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store), (error: unknown) => error instanceof ConnectionError && error.recovery === "check_status");
    assert.equal(f.session().access_token, null);
    await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store), (error: unknown) => error instanceof ConnectionError && error.code === "session_unavailable");
    assert.equal(f.writes(), 0);
  }
});
test("lost persistence response does not claim rollback or replay an already committed connection", async () => {
  const f = fixture(); const result = await prepare(f); const persist = f.store.persist;
  f.store.persist = async (...args) => { await persist(...args); throw new Error("response lost"); };
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store), (error: unknown) => error instanceof ConnectionError && error.recovery === "check_status");
  await assert.rejects(connectSelection(actor, result.sessionId, phone.id, f.graph, f.store));
  assert.equal(f.writes(), 1); assert.equal(f.subscriptions(), 1);
});
