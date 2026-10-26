import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as validation from "../lib/chat/validation";
import * as signup from "../lib/whatsapp/signup";
import type { ChatActor } from "../lib/chat/store";
const actor: ChatActor = { userId: "00000000-0000-4000-8000-000000000001", memberId: "00000000-0000-4000-8000-000000000002", businessId: "business-a", phone: "", name: "Ana", role: "owner", admin: true, enabledModules: [], branchIds: null };
const roomId = "00000000-0000-4000-8000-000000000003", id = "00000000-0000-4000-8000-000000000004";
const state = { authenticated: true, active: true, database: true, limited: false, fail: false, calls: 0, ai: 0, notifications: 0, existing: false };
const deferred: Array<() => Promise<void>> = [];
const rpc: any[] = [];
const db = { from() { const q: any = { select() { return q; }, eq() { return q; }, gte() { return q; }, then(resolve: any) { return Promise.resolve({ data: [], count: 0 }).then(resolve); } }; return q; }, async rpc(name: string, args: any) { rpc.push({ name, args }); return { data: { existing: state.existing } }; } };
const loader = Module as any, original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "./media") return { attachmentBytes: async () => new Uint8Array() };
  if (name === "./push") return { publicPushKey: async () => "fixture", subscribePush: async () => {} };
  if (name === "./store") return { checked: (r: any) => { if (r.error) throw new Error("hidden-db-error"); return r.data; }, loadRoom: async () => ({ membership: { joined_at: "2026-01-01" } }) };
  return original.call(this, name, ...args);
};
const { manageChat } = require("../lib/chat/manage");
loader._load = function(name: string, ...args: any[]) {
  if (name === "next/server") return { ...original.call(this, name, ...args), after: (callback: () => Promise<void>) => deferred.push(callback) };
  const mocks: Record<string, any> = {

    "@/lib/env": { isDatabaseMode: () => state.database },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated }) },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => db },
    "@/lib/rate-limit": { rateLimit: () => ({ ok: !state.limited }) },
    "@/lib/whatsapp/signup": signup, "@/lib/chat/validation": validation,
    "@/lib/chat/store": { chatActor: async () => { if (!state.active) throw new validation.ChatError("inactive", "Inactivo", 403); return actor; }, snapshot: async () => ({ me: { id: actor.memberId } }) },
    "@/lib/chat/manage": { manageChat: async (...args: any[]) => { state.calls++; if (state.fail) throw new Error("SECRET_DATABASE_URL"); return manageChat(...args); } },
    "@/lib/chat/agent": { processChatAi: async () => { state.ai++; } }, "@/lib/chat/push": { notifyRoom: async () => { state.notifications++; } },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { POST } = require("../app/api/chat/route"); loader._load = original;
const request = (body: unknown, origin = "https://fixture.test") => new Request("https://fixture.test/api/chat", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
function reset() { Object.assign(state, { authenticated: true, active: true, database: true, limited: false, fail: false, calls: 0, ai: 0, notifications: 0, existing: false }); deferred.length = 0; rpc.length = 0; }
const send = { action: "send", roomId, id, body: "Mensaje al equipo", askAi: false };
test("chat sends persist under session identity, ordinary messages never invoke AI", async () => {
  reset(); const response = await POST(request(send));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(rpc[0].args.p_business, actor.businessId); assert.equal(rpc[0].args.p_user, actor.userId);
  await Promise.all(deferred.map(f => f())); assert.equal(state.ai, 0); assert.equal(state.notifications, 1);
});
test("only an explicit AI request runs after persistence, duplicate sends do not notify twice", async () => {
  reset(); state.existing = true;
  const response = await POST(request({ ...send, askAi: true })); assert.equal(response.status, 200);
  await Promise.all(deferred.map(f => f())); assert.equal(state.ai, 1); assert.equal(state.notifications, 0);
});
test("chat rejects anonymous, inactive, cross-origin, demo and rate-limited writes", async () => {
  for (const [change, status] of [[{ authenticated: false }, 401], [{ active: false }, 403], [{ database: false }, 409], [{ limited: true }, 429]] as const) {
    reset(); Object.assign(state, change); assert.equal((await POST(request(send))).status, status); assert.equal(state.calls, 0);
  }
  reset(); assert.equal((await POST(request(send, "https://evil.test"))).status, 403); assert.equal(state.calls, 0);
});
test("tenant and identity injection fail before any database mutation and errors hide internals", async () => {
  reset(); for (const extra of [{ businessId: "foreign" }, { memberId: "foreign" }, { role: "owner" }, { token: "bad" }]) assert.equal((await POST(request({ ...send, ...extra }))).status, 400);
  assert.equal(rpc.length, 0); state.fail = true; const result = await POST(request(send)); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /SECRET/);
});
test("non-administrators cannot configure rooms and spoofed upload metadata fails", async () => {
  reset(); await assert.rejects(manageChat(db, { ...actor, admin: false }, { action: "configure", roomId, branchId: id, name: "Local", memberIds: [actor.memberId] }), /administradora/);
  await assert.rejects(manageChat(db, actor, { action: "upload_prepare", roomId, filename: "page.html", mime: "text/html", size: 50 }), /imagen/);
  assert.equal(rpc.length, 0);
});
