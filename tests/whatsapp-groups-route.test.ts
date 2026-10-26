import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as signup from "../lib/whatsapp/signup";
import * as groups from "../lib/whatsapp/groups";
import * as store from "../lib/whatsapp/groups-store";

const state = { authenticated: true, role: "owner", active: true, memberRole: "owner", limited: false, calls: 0, fail: false };
const scopes: unknown[] = [];
const db = { from(table: string) {
  assert.equal(table, "business_members");
  const q: any = { select() { return q; }, eq(key: string, value: unknown) { scopes.push([key, value]); return q; }, async maybeSingle() { return { error: null, data: { role: state.memberRole, profiles: { active: state.active } } }; } }; return q;
} };
const loader = Module as any, original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated, userId: "user-a", businessId: "business-a", role: state.role }) },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => db },
    "@/lib/rate-limit": { rateLimit: () => ({ ok: !state.limited }) },
    "@/lib/whatsapp/signup": signup, "@/lib/whatsapp/groups": groups, "@/lib/whatsapp/groups-store": store,
    "@/lib/whatsapp/groups-management": { manageGroups: async (_db: unknown, actor: signup.ConnectionActor) => { state.calls++; assert.equal(actor.businessId, "business-a"); if (state.fail) throw new Error("secret-server-detail"); return { ok: true }; } },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { POST } = require("../app/api/integrations/whatsapp/groups/route"); loader._load = original;
const request = (body: unknown = { action: "list" }, origin = "https://fixture.test") => new Request("https://fixture.test/api/integrations/whatsapp/groups", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
function reset() { Object.assign(state, { authenticated: true, role: "owner", active: true, memberRole: "owner", limited: false, calls: 0, fail: false }); scopes.length = 0; }
test("group API verifies current tenant admin and uses private non-cacheable responses", async () => {
  reset(); const result = await POST(request());
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(scopes, [["business_id", "business-a"], ["user_id", "user-a"]]); assert.equal(state.calls, 1);
});
test("group API rejects anonymous, revoked, inactive, cross-origin and rate-limited callers", async () => {
  for (const [change, status] of [[{ authenticated: false }, 401], [{ role: "viewer" }, 403], [{ memberRole: "viewer" }, 403], [{ active: false }, 403], [{ limited: true }, 429]] as const) {
    reset(); Object.assign(state, change); assert.equal((await POST(request())).status, status); assert.equal(state.calls, 0);
  }
  reset(); assert.equal((await POST(request({ action: "list" }, "https://foreign.test"))).status, 403); assert.equal(state.calls, 0);
});
test("group API rejects tenant injection and hides unexpected server errors", async () => {
  reset(); assert.equal((await POST(request({ action: "list", businessId: "foreign" }))).status, 400); assert.equal(state.calls, 0);
  state.fail = true; const result = await POST(request()); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /secret-server-detail/);
});
