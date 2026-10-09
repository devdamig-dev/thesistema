import type { ModuleKey, Permission, Role } from "@/lib/permissions";

export type ToolRisk = "READ" | "WRITE" | "SENSITIVE";

export type AgentActor = {
  userId: string;
  memberId: string;
  businessId: string;
  phone: string;
  name: string;
  role: Role;
  enabledModules: ModuleKey[];
  branchIds: string[] | null;
};

export type ToolDefinition = {
  name: string;
  description: string;
  module: ModuleKey;
  permission: Permission;
  risk: ToolRisk;
  required: string[];
};

export type ToolCall = { name: string; arguments: Record<string, unknown> };

export type AgentReply = {
  status: "completed" | "needs_input" | "needs_confirmation" | "rejected" | "duplicate" | "failed" | "cancelled" | "ignored";
  text: string;
  tool?: string;
  data?: unknown;
};

export type IncomingAgentMessage = {
  messageId: string;
  senderPhone: string;
  recipientPhone: string;
  text: string;
  senderName?: string;
  provider?: "meta" | "internal";
  providerConversationId?: string;
  conversationType?: "direct" | "group";
};

export type PendingOperation = {
  id: string;
  actor: AgentActor;
  toolCall: ToolCall;
  kind: "clarification" | "confirmation";
  clarificationKey?: string;
  /** Durable pre-RPC marker; cancelling stops retries but does not undo a possible commit. */
  resultUncertain?: boolean;
  expiresAt: string;
};

export interface AgentDependencies {
  resolveActor(input: IncomingAgentMessage): Promise<AgentActor | null>;
  claimMessage(input: IncomingAgentMessage, actor: AgentActor): Promise<boolean>;
  interpret(text: string, tools: ToolDefinition[], pending?: PendingOperation | null): Promise<ToolCall | null>;
  getPending(actor: AgentActor): Promise<PendingOperation | null>;
  savePending(operation: Omit<PendingOperation, "id">): Promise<PendingOperation>;
  /** Atomically consumes an unconsumed row scoped to the actor. Only the winner returns true. */
  consumePending(id: string, actor: AgentActor, requireUnexpired?: boolean): Promise<boolean>;
  /** Sales keep their operation ID durable while execution may be uncertain. */
  claimSalePending?(id: string, actor: AgentActor, recovery: boolean): Promise<boolean>;
  cancelSalePending?(id: string, actor: AgentActor): Promise<{ consumed: boolean; resultUncertain: boolean }>;
  /** CAS claim persists the same debt request before execution; recovery never generates a new ID. */
  claimDebtPending?(id: string, actor: AgentActor, recovery: boolean): Promise<boolean>;
  /** Atomically retires a debt pending and returns its current uncertainty, even if our read is stale. */
  cancelDebtPending?(id: string, actor: AgentActor): Promise<{ consumed: boolean; resultUncertain: boolean }>;
  /** Same persisted purchase identity survives RPC timeouts and process interruption. */
  claimPurchasePending?(id: string, actor: AgentActor, recovery: boolean): Promise<boolean>;
  cancelPurchasePending?(id: string, actor: AgentActor): Promise<{ consumed: boolean; resultUncertain: boolean }>;
  /** Read-only resolution and snapshot before a domain confirmation. Never performs writes. */
  prepare?(actor: AgentActor, call: ToolCall): Promise<ToolCall>;
  execute(actor: AgentActor, call: ToolCall, pendingId?: string): Promise<unknown>;
  audit(event: AgentAuditEvent): Promise<void>;
  now(): Date;
}

export type AgentAuditEvent = {
  actor: AgentActor;
  input: IncomingAgentMessage;
  intent?: string;
  module?: ModuleKey;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  confirmationRequired?: boolean;
  confirmed?: boolean;
};
