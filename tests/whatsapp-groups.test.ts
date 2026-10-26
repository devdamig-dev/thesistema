import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppGroupsGraph } from "../lib/whatsapp/groups-graph";
import { GROUP_FIELDS, parseGroupRequest, scopeActorToGroup, type GroupMember } from "../lib/whatsapp/groups";
import { incomingMetaTexts } from "../lib/whatsapp/webhook";
import { toolsForActor } from "../lib/whatsapp-agent/registry";
import type { AgentActor } from "../lib/whatsapp-agent/types";

const config = { phoneNumberId: "123456789", token: "fixture-token", version: "v25.0", appId: "987654321", appSecret: "fixture-secret", callbackUrl: "https://fixture.test/api/webhooks/whatsapp", phone: "+5491111111111" };
const id = "Y2FwaV9ncm91cDoxNzA1NTU1MDEzOToxMjAzNjM0MDQ2OTQyMzM4MjAZD";
const userId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const graph = (handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) => new WhatsAppGroupsGraph(config, ((url, init) => handler(new URL(String(url)), init)) as typeof fetch);

test("groups requests reject tenant injection, path injection and implicit permission grants", () => {
  const valid = { action: "authorize", groupId: id, branchId, memberIds: [userId], confirmed: true };
  assert.equal(parseGroupRequest(valid).action, "authorize");
  for (const value of [{ ...valid, businessId: "other" }, { ...valid, confirmed: false }, { ...valid, groupId: "../../me" }, { ...valid, memberIds: [userId, userId] }, { ...valid, branchId: null }, { action: "list", token: "secret" }]) assert.throws(() => parseGroupRequest(value));
});

test("a Business app number stops before OBA, creation and account changes", async () => {
  let calls = 0;
  const client = graph(() => { calls++; return json({ id: config.phoneNumberId, is_on_biz_app: true, platform_type: "CLOUD_API", status: "CONNECTED" }); });
  const result = await client.readiness();
  assert.equal(result.ready, false); assert.equal(result.code, "business_app"); assert.equal(calls, 1);
});

test("readiness requires explicit Cloud API, approved OBA and all group webhook fields", async () => {
  let oba = "PENDING", fields: string[] = ["messages"];
  const client = graph(url => {
    if (url.pathname.endsWith("/official_business_account")) return json({ oba_status: oba });
    if (url.pathname.endsWith("/subscriptions")) return json({ data: [{ object: "whatsapp_business_account", callback_url: config.callbackUrl, active: true, fields }] });
    return json({ id: config.phoneNumberId, is_on_biz_app: false, platform_type: "CLOUD_API", status: "CONNECTED" });
  });
  assert.equal((await client.readiness()).code, "oba_required");
  oba = "APPROVED"; assert.equal((await client.readiness()).code, "group_webhooks_required");
  fields = ["messages", ...GROUP_FIELDS]; assert.equal((await client.readiness()).ready, true);
});

test("group pagination only uses fixed Graph origin and cannot authorize a foreign group", async () => {
  const urls: URL[] = [];
  const client = graph(url => { urls.push(url); return url.searchParams.has("after") ? json({ data: { groups: [{ id, subject: "Local" }] } }) : json({ data: { groups: [] }, paging: { next: "https://attacker.invalid/secrets", cursors: { after: "opaque_cursor" } } }); });
  assert.deepEqual(await client.list(), [{ id, subject: "Local" }]);
  assert(urls.every(url => url.origin === "https://graph.facebook.com" && url.pathname === "/v25.0/123456789/groups"));
  await assert.rejects(client.assertOwned("foreign_group_id"), /no pertenece/);
});

test("creation requires approval and a lost response is never retried internally", async () => {
  let calls = 0;
  const client = graph((_url, init) => { calls++; assert.equal(JSON.parse(String(init?.body)).join_approval_mode, "approval_required"); throw new Error("network timeout"); });
  await assert.rejects(client.create("Operaciones", "Sólo equipo"), /no confirmó/);
  assert.equal(calls, 1);
});

test("unknown or partial participants cannot be interpreted as an empty verified group", async () => {
  const value: Record<string, unknown> = { id, subject: "Local", suspended: false, join_approval_mode: "approval_required", participants: [{ wa_id: "5491111111111" }], total_participant_count: 1 };
  const client = graph(() => json(value));
  assert.deepEqual((await client.info(id)).participants, ["5491111111111"]);
  value.total_participant_count = 2; await assert.rejects(client.info(id), /integrantes/);
  value.total_participant_count = 0; delete value.participants; await assert.rejects(client.info(id), /integrantes/);
});

test("join request IDs use Meta's documented join_request_id field", async () => {
  const client = graph(() => json({ data: [{ join_request_id: "MTY0NjcwNDM1OTU6MTIwMzYzNDA0Njk0MjMzODIw", wa_id: "5491111111111" }] }));
  assert.equal((await client.joinRequests(id))[0].phone, "5491111111111");
});

test("group text preserves sender identity and conversation identity separately", () => {
  const payload = { object: "whatsapp_business_account", entry: [{ id: "987654321", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "123456789" }, messages: [{ id: "wamid.group-fixture", from: "5491111111111", group_id: id, timestamp: "1793036000", type: "text", text: { body: "ventas de hoy" } }] } }] }] };
  const message = incomingMetaTexts(payload)[0];
  assert.equal(message.groupId, id); assert.equal(message.senderPhone, "5491111111111");
  payload.entry[0].changes[0].value.messages[0].group_id = "../../path";
  assert.deepEqual(incomingMetaTexts(payload), []);
});

const owner: AgentActor = { userId, memberId: "owner", businessId: "business", phone: "5491111111111", name: "Socio", role: "owner", enabledModules: ["sales", "debts", "stock"], branchIds: null };
const members: GroupMember[] = [{ memberId: "owner", phone: owner.phone, role: "owner", branchIds: null }, { memberId: "other", phone: "5491122222222", role: "waiter", branchIds: [branchId] }];
test("shared replies never expose tools outside every participant's permissions", () => {
  const scoped = scopeActorToGroup(owner, branchId, members.map(member => member.phone), members);
  assert(scoped); assert.deepEqual(scoped.branchIds, [branchId]);
  const staffTools = toolsForActor({ ...owner, role: "waiter" }).map(tool => tool.name);
  assert(toolsForActor(scoped).every(tool => staffTools.includes(tool.name)));
  assert(toolsForActor(owner).length > toolsForActor(scoped).length);
});
test("outsiders, removed members, ambiguous phones and wrong branches close group access", () => {
  assert.equal(scopeActorToGroup(owner, branchId, [owner.phone, "5491199999999"], members), null);
  assert.equal(scopeActorToGroup(owner, branchId, [owner.phone], []), null);
  assert.equal(scopeActorToGroup(owner, branchId, [owner.phone], [...members, members[0]]), null);
  assert.equal(scopeActorToGroup(owner, "other-branch", members.map(member => member.phone), members), null);
});
