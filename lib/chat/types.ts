import type { Permission, Role } from "../permissions";

export type ChatMember = { id: string; userId: string; name: string; role: Role; active: boolean; branchIds: string[] | null };
export type Room = { id: string; name: string; branch_id: string; archived: boolean; created_at: string; agent_busy_until: string | null };
export type Attachment = { id: string; filename: string; mime: string; size: number };
export type ChatMessage = {
  id: string; room_id: string; member_id: string; author_name: string; body: string; created_at: string;
  ask_ai: boolean; ai_status: "none" | "queued" | "processing" | "done" | "failed";
  ai_text: string | null; ai_result: string | null; ai_tool: string | null; attachment_id: string | null;
  attachment?: Attachment | null; pending_id: string | null;
};
export type ChatSnapshot = {
  me: { id: string; userId: string; name: string; admin: boolean };
  rooms: Room[]; members: ChatMember[]; branches: { id: string; name: string }[];
  room?: Room; participants?: { member_id: string; joined_at: string; role_snapshot: Role }[];
  messages?: ChatMessage[]; hasOlder?: boolean; pendingId?: string | null; pendingKind?: "clarification" | "confirmation" | null;
  commonPermissions?: Permission[];
  pendingSummary?: string | null; pendingExpiresAt?: string | null;
};
