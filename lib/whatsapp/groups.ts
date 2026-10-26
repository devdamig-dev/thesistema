import { ConnectionError, record } from "./signup";
import { permissionsFor, type Permission, type Role } from "../permissions";
import type { AgentActor } from "../whatsapp-agent/types";

// Meta's group IDs are opaque base64-like strings, not phone numbers or numeric asset IDs.
export const groupId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_=-]{8,512}$/.test(value);
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const GROUP_FIELDS = ["group_lifecycle_update", "group_participants_update", "group_settings_update", "group_status_update"] as const;
export type GroupReadiness = { ready: boolean; code: string; message: string; phone: string };
export type GroupSummary = { id: string; subject: string };
export type GroupInfo = GroupSummary & { participants: string[]; suspended: boolean; approvalRequired: boolean };
export type GroupRequest =
  | { action: "list" }
  | { action: "identify_member"; memberId: string; phone: string }
  | { action: "create"; requestId: string; subject: string; description: string }
  | { action: "authorize"; groupId: string; branchId: string; memberIds: string[] }
  | { action: "pause"; conversationId: string }
  | { action: "details"; groupId: string }
  | { action: "approve"; groupId: string; joinRequestId: string };

export function parseGroupRequest(input: unknown): GroupRequest {
  const body = record(input);
  const fail = (): never => { throw new ConnectionError("invalid_group_request", "Revisá el grupo, la sucursal y las personas elegidas."); };
  const only = (keys: string[]) => { if (Object.keys(body).some(key => !keys.includes(key))) fail(); };
  if (body.action === "list") { only(["action"]); return { action: "list" }; }
  if (body.action === "identify_member") {
    only(["action", "memberId", "phone", "confirmed"]);
    if (!uuid(body.memberId) || body.confirmed !== true || typeof body.phone !== "string" || !/^\+?[0-9 ()-]{8,30}$/.test(body.phone)) return fail();
    const phone = body.phone.replace(/\D/g, "");
    if (!/^[1-9]\d{7,14}$/.test(phone)) return fail();
    return { action: "identify_member", memberId: body.memberId, phone };
  }
  if (body.action === "create") {
    only(["action", "requestId", "subject", "description", "confirmed"]);
    if (!uuid(body.requestId) || typeof body.subject !== "string" || !body.subject.trim() || body.subject.trim().length > 128 || typeof body.description !== "string" || body.description.length > 2048 || body.confirmed !== true) return fail();
    return { action: "create", requestId: body.requestId, subject: body.subject.trim(), description: body.description.trim() };
  }
  if (body.action === "pause") { only(["action", "conversationId"]); if (!uuid(body.conversationId)) return fail(); return { action: "pause", conversationId: body.conversationId }; }
  if (body.action === "details") { only(["action", "groupId"]); if (!groupId(body.groupId)) return fail(); return { action: "details", groupId: body.groupId }; }
  if (body.action === "approve") {
    only(["action", "groupId", "joinRequestId", "confirmed"]);
    if (!groupId(body.groupId) || !groupId(body.joinRequestId) || body.confirmed !== true) return fail();
    return { action: "approve", groupId: body.groupId, joinRequestId: body.joinRequestId };
  }
  if (body.action === "authorize") {
    only(["action", "groupId", "branchId", "memberIds", "confirmed"]);
    if (!groupId(body.groupId) || !uuid(body.branchId) || body.confirmed !== true || !Array.isArray(body.memberIds) || body.memberIds.length < 1 || body.memberIds.length > 8 || !body.memberIds.every(uuid) || new Set(body.memberIds).size !== body.memberIds.length) return fail();
    return { action: "authorize", groupId: body.groupId, branchId: body.branchId, memberIds: body.memberIds };
  }
  return fail();
}

export type GroupMember = { memberId: string; phone: string; role: Role; branchIds: string[] | null };
/** A group response is visible to every participant, so use their common permissions. */
export function scopeActorToGroup(actor: AgentActor, branchId: string, participants: string[], members: GroupMember[]): AgentActor | null {
  if (!participants.length || participants.length > 8 || new Set(participants).size !== participants.length || !participants.includes(actor.phone)) return null;
  const present: GroupMember[] = [];
  for (const phone of participants) {
    const matches = members.filter(member => member.phone === phone);
    if (matches.length !== 1 || matches[0].branchIds !== null && !matches[0].branchIds.includes(branchId)) return null;
    present.push(matches[0]);
  }
  if (!present.some(member => member.memberId === actor.memberId && member.phone === actor.phone)) return null;
  const permissionLimit: Permission[] = permissionsFor(actor.role).filter(permission => present.every(member => permissionsFor(member.role).includes(permission)));
  return { ...actor, branchIds: [branchId], permissionLimit };
}
