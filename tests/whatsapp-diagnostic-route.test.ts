import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const state = { database: true, authenticated: true, role: "owner", active: true, memberRole: "owner", queryError: false, writeError: false, limited: false, writes: [] as any[], scopes: [] as any[] };
const db = { from(table: string) {
  if (table === "profiles" || table === "business_members") {
    const q: any = { select() { return q; }, eq(key: string, value: unknown) { state.scopes.push([table, key, value]); return q; }, async maybeSingle() { return { data: table === "profiles" ? { active: state.active } : { role: state.memberRole }, error: state.queryError ? { message: "lookup failed" } : null }; } }; return q;
  }
  assert.equal(table, "activity_logs");
  return { insert(row: unknown) { state.writes.push(row); return { select() { return { async single() { return state.writeError ? { data: null, error: { message: "db failure" } } : { data: { id: "audit" }, error: null }; } }; } }; } };
} };
const loader = Module as any; const original = loader._load;
// Resolve real helpers before installing the loader to avoid recursive mocks.
loader._load = original;
const signup = require("../lib/whatsapp/signup"); const store = require("../lib/whatsapp/signup-diagnostic-store");
const mockLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "next/server": { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } },
    "@/lib/env": { isDatabaseMode: () => state.database },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated, userId: "actor-a", businessId: "business-a", role: state.role }) },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => db },
    "@/lib/rate-limit": { rateLimit: () => ({ ok: !state.limited }) },
    "@/lib/whatsapp/signup": signup, "@/lib/whatsapp/signup-diagnostic-store": store,
    "@/lib/whatsapp/graph": { WhatsAppGraph: class { constructor() { throw new Error("Diagnostic must not contact Graph"); } } },
    "@/lib/whatsapp/connection-service": {},
    "@/lib/whatsapp/connection-store": { connectionStore() { throw new Error("Diagnostic must not create signup sessions"); } },
  };
  return name in mocks ? mocks[name] : mockLoad.call(this, name, ...args);
};
const route = require("../app/api/integrations/whatsapp/complete/route"); loader._load = original;
const payload = { action: "report_error", mode: "business_app", diagnostic: { providerEvent: "CANCEL", errorCode: "2655093", sessionReference: "f34b51dab5e0498", reportedAt: 1746041036 } };
const request = (body: unknown = payload, origin = "https://example.test") => new Request("https://example.test/api/integrations/whatsapp/complete", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
function reset() { Object.assign(state, { database: true, authenticated: true, role: "owner", active: true, memberRole: "owner", queryError: false, writeError: false, limited: false, writes: [], scopes: [] }); }

test("diagnostic POST saves only a tenant-bound audit without contacting Meta or creating a session", async () => {
  reset(); const result = await route.POST(request()); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, phase: "diagnostic_saved" });
  assert.equal(state.writes.length, 1); assert.equal(state.writes[0].business_id, "business-a"); assert.equal(state.writes[0].actor_id, "actor-a");
  assert.ok(state.scopes.some(([table, key, value]) => table === "business_members" && key === "business_id" && value === "business-a"));
});
test("diagnostic POST denies anonymous, wrong-origin, inactive, revoked-role and rate-limited callers", async () => {
  for (const [override, status] of [[{ authenticated: false }, 401], [{ role: "viewer" }, 403], [{ active: false }, 403], [{ memberRole: "viewer" }, 403], [{ queryError: true }, 403], [{ limited: true }, 429], [{ database: false }, 400]] as const) {
    reset(); Object.assign(state, override); assert.equal((await route.POST(request())).status, status); assert.equal(state.writes.length, 0);
  }
  reset(); assert.equal((await route.POST(request(payload, "https://evil.test"))).status, 403); assert.equal(state.writes.length, 0);
});
test("diagnostic POST rejects arbitrary payloads and never returns success for a failed audit write", async () => {
  reset(); assert.equal((await route.POST(request({ ...payload, business_id: "other" }))).status, 400); assert.equal(state.writes.length, 0);
  reset(); state.writeError = true; const result = await route.POST(request()); assert.equal(result.status, 503); assert.equal((await result.json()).ok, false);
});
