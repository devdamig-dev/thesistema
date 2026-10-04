import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { BUSINESS_WIDE_ROLES, hasPermission } from "../lib/permissions/index";

const context = { isAuthenticated: true, userId: "owner-a", businessId: "a", role: "owner" };
let ctx: any = context;
let connected = true;
const records: Record<string, any[]> = {
  business_members: [{ id: "member-a", business_id: "a", user_id: "user-a", role: "viewer" }, { id: "member-b", business_id: "b", user_id: "user-b", role: "owner" }],
  user_invitations: [{ id: "invite-a", business_id: "a", status: "pending" }, { id: "invite-b", business_id: "b", status: "pending" }],
  profiles: [],
  branches: [
    { id: "branch-a", business_id: "a", name: "Principal A", is_main: true },
    { id: "branch-b", business_id: "b", name: "Principal B", is_main: true },
  ],
  branch_assignments: [],
};
let rpcError = false;
let queries = 0;
const db = {
  async rpc(name: string, args: any) {
    queries++;
    if (rpcError) return { data: null, error: { message: "database failure" } };
    assert.equal(name, "update_member_role_with_branch");
    const member = records.business_members.find(
      (row) => row.id === args.p_member_id && row.business_id === args.p_business_id,
    );
    if (!member) return { data: { ok: false, error: "not_found" }, error: null };
    if (member.role === "owner" || args.p_role === "owner") {
      return { data: { ok: false, error: "owner_immutable" }, error: null };
    }
    const oldRole = member.role;
    let branchAssigned = false;
    if (!BUSINESS_WIDE_ROLES.includes(args.p_role)) {
      const existing = records.branch_assignments.find((row) => row.business_member_id === member.id);
      if (!existing) {
        const branch = records.branches.find(
          (row) => row.business_id === member.business_id && row.is_main,
        );
        if (!branch) return { data: { ok: false, error: "branch_required" }, error: null };
        records.branch_assignments.push({ business_member_id: member.id, branch_id: branch.id });
        branchAssigned = true;
      }
    }
    member.role = args.p_role;
    return {
      data: {
        ok: true,
        member_id: member.id,
        old_role: oldRole,
        role: member.role,
        branch_assigned: branchAssigned,
      },
      error: null,
    };
  },
  from(table: string) {
  queries++;
  const filters: Array<[string, unknown]> = [];
  let update: any;
  let insertion: any;
  const result = () => {
    if (insertion) { const row = { ...insertion, id: "new", token: "safe-token" }; records[table].push(row); return { data: row, error: null }; }
    const rows = records[table].filter(row => filters.every(([key, value]) => row[key] === value));
    if (update) rows.forEach(row => Object.assign(row, update));
    return { data: rows, error: null };
  };
  const query: any = {
    select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    in() { return query; }, order() { return query; }, update(value: any) { update = value; return query; },
    insert(value: any) { insertion = value; return query; },
    maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return query;
} };
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/supabase/server": { createSupabaseServerClient: () => connected ? db : null },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/data/auth": { getCurrentUserContext: async () => ctx },
    "@/lib/permissions": { BUSINESS_WIDE_ROLES, hasPermission },
    "@/lib/data/activity": { logActivity: async () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/team");
const data = require("../lib/data/team");
loader._load = original;

test("Equipo reads and mutations stay inside the authenticated business", async () => {
  assert.deepEqual((await data.listTeamMembers()).map((row: any) => row.id), ["member-a"]);
  assert.deepEqual((await data.listPendingInvitations()).map((row: any) => row.id), ["invite-a"]);
  assert.equal((await actions.updateMemberRoleAction("member-b", "viewer")).ok, false);
  assert.equal(records.business_members[1].role, "owner");
  assert.equal((await actions.revokeInvitationAction("invite-b")).ok, false);
  assert.equal(records.user_invitations[1].status, "pending");
  const restrictedUpdate = await actions.updateMemberRoleAction("member-a", "employee");
  assert.equal(restrictedUpdate.persisted, true);
  assert.equal(restrictedUpdate.branchAssigned, true);
  assert.equal(records.business_members[0].role, "employee");
  assert.deepEqual(records.branch_assignments, [{ business_member_id: "member-a", branch_id: "branch-a" }]);
  assert.equal((await actions.updateMemberRoleAction("member-a", "marketing")).branchAssigned, false);
  assert.equal(records.branch_assignments.length, 1);
  assert.equal((await actions.updateMemberRoleAction("member-a", "owner")).ok, false);
  assert.equal(records.business_members[0].role, "marketing");
  assert.equal((await actions.updateMemberRoleAction("member-b", "admin")).ok, false);
  assert.equal(records.business_members[1].role, "owner");
  assert.equal((await actions.revokeInvitationAction("invite-a")).persisted, true);
  assert.equal((await actions.revokeInvitationAction("invite-a")).ok, false);
  assert.equal((await actions.inviteUserAction({ email: "new@example.com", role: "viewer" })).persisted, true);
  assert.equal(records.user_invitations.at(-1).business_id, "a");
  assert.equal(records.user_invitations.at(-1).branch_id, "branch-a");
  assert.equal((await actions.inviteUserAction({ email: "other@example.com", role: "employee", branchId: "branch-b" })).ok, false);
  assert.equal((await actions.inviteUserAction({ email: "admin@example.com", role: "admin", branchId: "branch-b" })).persisted, true);
  assert.equal(records.user_invitations.at(-1).branch_id, null);
});

test("ambiguous business, missing session, permission and connection fail closed", async () => {
  for (const invalid of [{ ...context, businessId: null }, { ...context, isAuthenticated: false }, { ...context, role: "viewer" }]) {
    ctx = invalid;
    const before = queries;
    assert.equal((await actions.inviteUserAction({ email: "x@example.com", role: "viewer" })).ok, false);
    assert.equal((await actions.updateMemberRoleAction("member-b", "admin")).ok, false);
    assert.equal((await actions.revokeInvitationAction("invite-b")).ok, false);
    assert.deepEqual(await data.listTeamMembers(), []);
    assert.deepEqual(await data.listPendingInvitations(), []);
    assert.equal(queries, before);
  }
  ctx = context; connected = false;
  assert.equal((await actions.inviteUserAction({ email: "x@example.com", role: "viewer" })).ok, false);
  assert.equal((await actions.updateMemberRoleAction("member-a", "admin")).ok, false);
  assert.equal((await actions.revokeInvitationAction("invite-a")).ok, false);
  connected = true;
});

test("role update database failures never claim persistence", async () => {
  ctx = context;
  rpcError = true;
  assert.deepEqual(
    await actions.updateMemberRoleAction("member-a", "employee"),
    { ok: false, persisted: false, error: "role_update_failed" },
  );
  rpcError = false;
});
