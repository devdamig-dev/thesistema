import type { ChatMessage, ChatSnapshot } from "./types";

export function mergeMessages(older: ChatMessage[], newer: ChatMessage[]) {
  const map = new Map(older.map(message => [message.id, message]));
  newer.forEach(message => map.set(message.id, message));
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function mergeSnapshot(previous: ChatSnapshot, next: ChatSnapshot): ChatSnapshot {
  const joined = (data: ChatSnapshot) => data.participants?.find(p => p.member_id === data.me.id)?.joined_at;
  if (!next.room || previous.room?.id !== next.room.id || joined(previous) !== joined(next)) return next;
  const old = previous.messages ?? [], recent = next.messages ?? [];
  const overlap = recent.some(message => old.some(row => row.id === message.id));
  // After a long absence, reset to the newest page rather than hide a gap in history.
  if (next.hasOlder && old.length && recent.length && !overlap && old.at(-1)!.created_at < recent[0].created_at) return next;
  return { ...next, messages: mergeMessages(old, recent), hasOlder: old.length && overlap ? previous.hasOlder : next.hasOlder };
}
