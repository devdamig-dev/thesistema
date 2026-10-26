import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { ConnectionError } from "../lib/whatsapp/signup";
import type { GroupMember } from "../lib/whatsapp/groups";

const actor = { userId: "owner-user", businessId: "business-a", role: "owner" };
const group = "Y2FwaV9ncm91cDox";
let ready = true, failCreate = false, owned = true, createCalls = 0, approveCalls = 0, rpcCalls = 0;
let participants: string[] = [];
let members: GroupMember[] = [{ memberId: "member-a", phone: "5491111111111", role: "owner", branchIds: null }];
const journal = new Map<string, { subject: string; status: string }>();
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {}; let update: Record<string, unknown> = {};
    const query: any = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      update(value: Record<string, unknown>) { update = value; return query; },
      async insert(value: any) {
        assert.equal(table, "whatsapp_group_creation_requests");
        if (journal.has(value.id) || [...journal.values()].some(row => row.subject === value.subject && row.status !== "failed")) return { error: { code: "23505" } };
        journal.set(value.id, { subject: value.subject, status: "requested" }); return { error: null };
      },
      async maybeSingle() { return { error: null, data: { id: "conversation-a", branch_id: "branch-a" } }; },
      then(resolve: (value: unknown) => void) {
        assert.equal(filters.business_id, actor.businessId);
        if (table === "whatsapp_group_creation_requests") {
          const row = journal.get(String(filters.id)); if (row) Object.assign(row, update);
          resolve({ error: null });
        } else resolve({ data: [], error: null });
      },
    }; return query;
  },
  async rpc(_name: string, args: Record<string, unknown>) { rpcCalls++; assert.equal(args.p_business_id, actor.businessId); assert.equal(args.p_actor_id, actor.userId); return { error: null, data: "conversation-a" }; },
};
const graph = {
  async readiness() { return { ready, code: ready ? "ready" : "business_app", message: "Requiere Cloud API y OBA" }; },
  async list() { return [{ id: group, subject: "Local" }]; },
  async assertOwned(id: string) { if (!owned || id !== group) throw new ConnectionError("group_not_owned", "Grupo de otra cuenta", 403); },
  async info() { return { id: group, subject: "Local", approvalRequired: true, suspended: false, participants }; },
  async create() { createCalls++; if (failCreate) throw new ConnectionError("group_result_unknown", "Timeout", 502); },
  async joinRequests() { return [{ id: "join-request", phone: "5491199999999" }]; },
  async approve() { approveCalls++; },
};
const loader = Module as any, original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "./groups-store") return { groupConnection: async () => ({ graph, phoneNumberId: "123456789" }), activeGroupMembers: async () => members, savedGroupMembers: async () => members };
  return original.call(this, name, ...args);
};
const { manageGroups } = require("../lib/whatsapp/groups-management");
loader._load = original;
function reset() { ready = owned = true; failCreate = false; createCalls = approveCalls = rpcCalls = 0; participants = []; journal.clear(); members = [{ memberId: "member-a", phone: "5491111111111", role: "owner", branchIds: null }]; }

test("unavailable groups are blocked server-side before creation or authorization", async () => {
  reset(); ready = false;
  await assert.rejects(manageGroups(db, actor, { action: "create", requestId: "request-a", subject: "Local", description: "" }));
  await assert.rejects(manageGroups(db, actor, { action: "authorize", groupId: group, branchId: "branch-a", memberIds: ["member-a"] }));
  assert.equal(createCalls, 0); assert.equal(journal.size, 0); assert.equal(rpcCalls, 0);
});
test("replayed creation and a lost response cannot create another group", async () => {
  reset(); failCreate = true;
  const input = { action: "create", requestId: "request-a", subject: "Local", description: "" };
  await assert.rejects(manageGroups(db, actor, input));
  assert.equal(journal.get("request-a")?.status, "unknown");
  failCreate = false;
  await assert.rejects(manageGroups(db, actor, input), /Ya se solicitó/);
  await assert.rejects(manageGroups(db, actor, { ...input, requestId: "request-b" }), /Ya se solicitó/);
  assert.equal(createCalls, 1);
});
test("foreign groups and unknown existing participants cannot be authorized", async () => {
  reset(); const input = { action: "authorize", groupId: group, branchId: "branch-a", memberIds: ["member-a"] };
  owned = false; await assert.rejects(manageGroups(db, actor, input), /otra cuenta/);
  owned = true; participants = ["5491199999999"]; await assert.rejects(manageGroups(db, actor, input), /participantes/);
  assert.equal(rpcCalls, 0);
});
test("revoked branch assignments and an unrecognized join request are rejected", async () => {
  reset(); members = [{ ...members[0], role: "waiter", branchIds: ["other-branch"] }];
  await assert.rejects(manageGroups(db, actor, { action: "authorize", groupId: group, branchId: "branch-a", memberIds: ["member-a"] }), /sucursal/);
  await assert.rejects(manageGroups(db, actor, { action: "approve", groupId: group, joinRequestId: "join-request" }), /persona autorizada/);
  assert.equal(approveCalls, 0); assert.equal(rpcCalls, 0);
});
test("authorized group is persisted through the atomic RPC with the server's tenant", async () => {
  reset(); participants = [members[0].phone];
  const result = await manageGroups(db, actor, { action: "authorize", groupId: group, branchId: "branch-a", memberIds: ["member-a"] });
  assert.equal(result.ok, true); assert.equal(rpcCalls, 1);
});
