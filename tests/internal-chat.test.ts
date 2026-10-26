import assert from "node:assert/strict";
import test from "node:test";
import { ChatError, fileDescriptor, matchesMagic, MAX_FILE_SIZE, memberIds, uuid, validPushEndpoint } from "../lib/chat/validation";
import { chatActor, loadRoom, roomActor, snapshot, type ChatActor } from "../lib/chat/store";
import { toolsForActor } from "../lib/whatsapp-agent/registry";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: ChatActor = { userId: id(1), memberId: id(11), businessId: id(100), phone: "", role: "owner", name: "Ana", admin: true, branchIds: null, enabledModules: ["sales", "stock", "products", "purchases"] };
const members = [
  { id: id(11), user_id: id(1), role: "owner", profiles: { active: true, full_name: "Ana" } },
  { id: id(12), user_id: id(2), role: "employee", profiles: { active: true, full_name: "Luis" } },
];
function database(options: { access?: string | null; changed?: boolean; inactive?: boolean; denied?: boolean; lease?: string | null } = {}) {
  const calls: any[] = [];
  const rows: Record<string, any> = {
    business_members: options.changed ? members.map((m, i) => i ? { ...m, role: "viewer" } : m) : members,
    business_modules: [{ module_key: "sales" }], branch_assignments: [{ business_member_id: id(12), branch_id: id(200) }],
    chat_rooms: [{ id: id(300), name: "Local", branch_id: id(200), archived: false, created_at: "2026-10-26T00:00:00Z", agent_request_id: options.lease ?? id(400), agent_busy_until: "2099-01-01T00:00:00Z" }],
    chat_room_members: [{ room_id: id(300), member_id: id(11), role_snapshot: "owner", joined_at: "2026-10-26T10:00:00Z" }, { room_id: id(300), member_id: id(12), role_snapshot: "employee", joined_at: "2026-10-26T10:00:00Z" }],
    branches: [{ id: id(200), name: "Principal" }], chat_messages: [], whatsapp_agent_pending_operations: [],
  };
  return { calls, async rpc(name: string, args: any) { calls.push([name, args]); return { data: options.access === undefined ? actor.memberId : options.access }; },
    from(table: string) {
      const filters: any[] = [];
      const q: any = { then(resolve: any, reject: any) { return Promise.resolve({ error: options.denied ? "fixture-denied" : null, data: rows[table] ?? [] }).then(resolve, reject); },
        async single() { return { data: rows[table]?.[0] }; }, async maybeSingle() { return { data: { ...rows[table]?.[0], profiles: { active: !options.inactive, full_name: "Ana" } } }; } };
      for (const method of ["select", "eq", "in", "gte", "gt", "is", "order", "limit", "or"]) q[method] = (...args: any[]) => { filters.push([method, ...args]); calls.push([table, method, ...args]); return q; };
      return q;
    },
  };
}
test("chat request identifiers and attachments reject injection, spoofed types and oversized files", () => {
  for (const value of [null, "../room", `${id(1)},id.eq.${id(2)}`]) assert.throws(() => uuid(value));
  assert.throws(() => memberIds([id(1), id(1)])); assert.throws(() => memberIds([]));
  for (const file of [{ mime: "text/html", size: 100 }, { mime: "image/png", size: MAX_FILE_SIZE + 1 }, { mime: "image/png", size: -1 }]) assert.throws(() => fileDescriptor({ filename: "doc", ...file }));
  assert.equal(fileDescriptor({ filename: "folder/\u0000photo.png", mime: "image/png", size: 8 }).filename, "folder__photo.png");
  assert(matchesMagic(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png"));
  assert(!matchesMagic(new TextEncoder().encode("<script>bad</script>"), "image/png"));
  assert(!matchesMagic(new TextEncoder().encode("%PDF-1.7"), "image/jpeg"));
  assert(matchesMagic(new TextEncoder().encode("%PDF-1.7"), "application/pdf"));
});
test("push endpoints allow only known HTTPS delivery hosts without redirect or credential injection", () => {
  for (const value of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/a", "https://web.push.apple.com/Qa"]) assert(validPushEndpoint(value));
  for (const value of ["http://fcm.googleapis.com/a", "https://fcm.googleapis.com.evil.test/a", "https://user:pass@fcm.googleapis.com/a", "https://localhost/a", "https://169.254.169.254/a", "https://fcm.googleapis.com:444/a", "https://fcm.googleapis.com/a#x"]) assert(!validPushEndpoint(value));
});
test("chat identity comes from the active tenant membership, never a supplied phone or role", async () => {
  const db = database();
  const current = await chatActor(db, { isAuthenticated: true, businessId: actor.businessId, userId: actor.userId });
  assert.equal(current.memberId, actor.memberId); assert.equal(current.phone, ""); assert.equal(current.role, "owner");
  assert(db.calls.some(c => c[0] === "business_members" && c[2] === "business_id" && c[3] === actor.businessId));
  await assert.rejects(chatActor(database({ inactive: true }), { isAuthenticated: true, businessId: actor.businessId, userId: actor.userId }), /activo/);
  await assert.rejects(chatActor(db, { isAuthenticated: false, businessId: actor.businessId, userId: actor.userId }), /Ingresá/);
});
test("foreign room denial happens before reading messages, participants or private files", async () => {
  const db = database({ access: null });
  await assert.rejects(loadRoom(db, actor, id(300)), (e: any) => e instanceof ChatError && e.status === 403);
  assert.deepEqual(db.calls.map(c => c[0]), ["chat_access"]);
  assert.deepEqual(db.calls[0][1], { p_user: actor.userId, p_business: actor.businessId, p_room: id(300) });
});
test("group AI intersects current participants permissions and pins the room branch", async () => {
  const result = await roomActor(database(), actor, id(300), id(400));
  assert.deepEqual(result.branchIds, [id(200)]);
  assert(toolsForActor(result).some(t => t.name === "sales.create"));
  assert(!toolsForActor(result).some(t => t.name === "purchases.create"));
  await assert.rejects(roomActor(database({ changed: true }), actor, id(300), id(400)), /Cambió el acceso/);
  await assert.rejects(roomActor(database({ lease: id(401) }), actor, id(300), id(400)), /venció/);
});
test("history is bounded by join time and safe pagination; no credentials reach snapshots", async () => {
  const db = database();
  const data = await snapshot(db, actor, id(300));
  assert(db.calls.some(c => c[0] === "chat_messages" && c[1] === "gte" && c[2] === "created_at" && c[3] === "2026-10-26T10:00:00Z"));
  assert.equal(data.me.userId, actor.userId);
  await assert.rejects(snapshot(database(), actor, id(300), "2026-01-01),business.eq.foreign|bad"), /historial/);
});
