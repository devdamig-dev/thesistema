import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

let authenticated = true;
let rpcResult: { data: any; error: any } = {
  data: {
    ok: true,
    business_id: "business-a",
    invitation_id: "invite-a",
    role: "viewer",
  },
  error: null,
};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const activity: any[] = [];

const server = {
  auth: {
    async getUser() {
      return authenticated
        ? { data: { user: { id: "user-a", email: "user@example.com" } }, error: null }
        : { data: { user: null }, error: { message: "missing" } };
    },
  },
};
const admin = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    return rpcResult;
  },
};

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/supabase/server": { createSupabaseServerClient: () => server },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => admin },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/data/activity": { logActivity: async (entry: any) => activity.push(entry) },
    "@/lib/data/notifications": { createNotification: async () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { acceptInvitationAction } = require("../app/actions/invitations");
loader._load = original;

test("invitation acceptance delegates one atomic operation with authenticated identity", async () => {
  const result = await acceptInvitationAction("safe-token");
  assert.deepEqual(result, { ok: true, persisted: true, business_id: "business-a" });
  assert.deepEqual(rpcCalls.at(-1), {
    name: "accept_user_invitation",
    args: { p_token: "safe-token", p_user_id: "user-a", p_email: "user@example.com" },
  });
  assert.equal(activity.at(-1).businessId, "business-a");
});

test("existing membership in another business fails closed without claiming success", async () => {
  rpcResult = { data: { ok: false, error: "business_already_assigned" }, error: null };
  const result = await acceptInvitationAction("safe-token");
  assert.deepEqual(result, { ok: false, persisted: false, error: "business_already_assigned" });
});

test("database error and missing authentication never report persistence", async () => {
  rpcResult = { data: null, error: { message: "database failure" } };
  assert.deepEqual(await acceptInvitationAction("safe-token"), {
    ok: false,
    persisted: false,
    error: "invitation_accept_failed",
  });
  const before = rpcCalls.length;
  authenticated = false;
  assert.deepEqual(await acceptInvitationAction("safe-token"), {
    ok: false,
    persisted: false,
    error: "requires_auth",
  });
  assert.equal(rpcCalls.length, before);
});
