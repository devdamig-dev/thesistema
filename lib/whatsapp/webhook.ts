import { createHmac, timingSafeEqual } from "node:crypto";
import { array, record, metaId } from "./signup";

export type MetaIncomingText = {
  messageId: string; accountId: string; phoneNumberId: string; senderPhone: string;
  senderName: string; text: string; sentAt: number;
};
export function validMetaSignature(raw: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const hex = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
  const actual = Buffer.from(hex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Only new incoming text messages may become commands. Never normalize histories/echoes/statuses as text. */
export function incomingMetaTexts(payload: unknown): MetaIncomingText[] {
  const root = record(payload);
  if (root.object !== "whatsapp_business_account") return [];
  const messages: MetaIncomingText[] = [];
  const seen = new Set<string>();
  for (const entryRaw of array(root.entry)) {
    const entry = record(entryRaw);
    if (!metaId(entry.id)) continue;
    for (const changeRaw of array(entry.changes)) {
      const change = record(changeRaw);
      if (change.field !== "messages") continue;
      const value = record(change.value);
      if (value.messaging_product !== "whatsapp") continue;
      const metadata = record(value.metadata);
      if (!metaId(metadata.phone_number_id)) continue;
      for (const messageRaw of array(value.messages)) {
        const message = record(messageRaw);
        const context = record(message.context);
        if (message.type !== "text" || message.is_echo === true || message.echo === true || message.group_id || context.group_id) continue;
        const text = record(message.text).body;
        if (typeof text !== "string" || !text.trim() || text.length > 4096) continue;
        if (typeof message.id !== "string" || !message.id || message.id.length > 512 || typeof message.from !== "string" || !/^\d{8,15}$/.test(message.from)) continue;
        const sentAt = Number(message.timestamp) * 1000;
        if (!Number.isFinite(sentAt) || sentAt <= 0) continue;
        const key = `${metadata.phone_number_id}:${message.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const contact = array(value.contacts).map(record).find(contact => contact.wa_id === message.from);
        const name = record(contact?.profile).name;
        messages.push({ messageId: message.id, accountId: entry.id, phoneNumberId: metadata.phone_number_id, senderPhone: message.from, senderName: typeof name === "string" ? name.slice(0, 200) : "WhatsApp", text, sentAt });
      }
    }
  }
  return messages;
}
