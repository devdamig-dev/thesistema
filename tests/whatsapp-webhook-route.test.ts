import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createHmac } from "node:crypto";
import * as webhook from "../lib/whatsapp/webhook";
import { record } from "../lib/whatsapp/signup";

const secret = "controlled-webhook-fixture-not-real";
const branch = "a0000000-0000-4000-8000-000000000001";
const integration = { business_id: "business-a", phone_number_id: "123456789", waba_id: "987654321", status: "connected", display_phone_number: "+5491112345678", connected_at: new Date(Date.now() - 60000).toISOString(), token_expires_at: null };
let copies: Record<string, unknown>[] = [];
let calls = 0, replies = 0, extractions = 0;
let status = "executed", authorized = true;
const db = { from(table: string) {
  const filters: Array<(row: any) => boolean> = [];
  const query: any = {
    select() { return query; }, eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
    async maybeSingle() { assert.equal(table, "whatsapp_integrations"); return { data: filters.every(fn => fn(integration)) ? integration : null, error: null }; },
    async insert(value: Record<string, unknown>) { assert.equal(table, "whatsapp_messages"); copies.push(value); return { error: null }; },
  }; return query;
} };
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => db },
    "@/lib/ai/extract": { extractFromMessage: async () => { extractions++; return {}; } },
    "@/lib/data/activity": { logActivity: async () => {} },
    "@/lib/whatsapp-agent/service": { processWhatsAppAgentMessage: async () => { calls++; return { status, text: "Resultado controlado" }; } },
    "@/lib/whatsapp-agent/supabase-adapter": { resolveAuthorizedConversation: async () => authorized ? { id: "conversation-a", business_id: integration.business_id, branch_id: branch } : null },
    "@/lib/whatsapp-agent/meta-transport": { sendMetaTextReply: async () => { replies++; } },
    "@/lib/whatsapp/webhook": webhook,
    "@/lib/whatsapp/signup": { record },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { POST } = require("../app/api/webhooks/whatsapp/route");
loader._load = original;
function envelope(accountId = integration.waba_id) {
  return { object: "whatsapp_business_account", entry: [{ id: accountId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: integration.phone_number_id }, messages: [{ id: "wamid.controlled", from: "5491198765432", type: "text", timestamp: String(Math.floor(Date.now()/1000)), text: { body: "ventas de hoy" } }] } }] }] };
}
async function post(payload: unknown, signed = true) {
  process.env.META_APP_SECRET = secret;
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed) headers["x-hub-signature-256"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return POST(new Request("https://fixture.test/api/webhooks/whatsapp", { method: "POST", headers, body: raw }));
}
function reset() { copies = []; calls = replies = extractions = 0; authorized = true; status = "executed"; }

test("signed route preserves the authorized branch on the Inbox copy", async () => {
  reset(); const response = await post(envelope());
  assert.equal(response.status, 200); assert.equal(copies.length, 1);
  assert.equal(copies[0].branch_id, branch); assert.equal(copies[0].business_id, integration.business_id);
  assert.equal(calls, 1); assert.equal(replies, 1); assert.equal(extractions, 0);
});
test("wrong account, unsigned payload and unauthorized chats never persist or execute", async () => {
  reset(); assert.equal((await post(envelope(), false)).status, 401);
  await post(envelope("111111111")); authorized = false; await post(envelope());
  assert.equal(calls, 0); assert.equal(copies.length, 0); assert.equal(extractions, 0);
});
test("denied actors and durable duplicates never fall back into Inbox extraction", async () => {
  reset(); for (const result of ["ignored", "rejected", "duplicate"]) { status = result; await post(envelope()); }
  assert.equal(copies.length, 0); assert.equal(replies, 0); assert.equal(extractions, 0);
});
test("history and timestamps older than connection do not reach the Agent Core", async () => {
  reset(); const history = envelope(); history.entry[0].changes[0].field = "history"; await post(history);
  const old = envelope(); old.entry[0].changes[0].value.messages[0].timestamp = "100"; await post(old);
  assert.equal(calls, 0); assert.equal(copies.length, 0);
});
