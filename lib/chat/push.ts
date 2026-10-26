import webpush from "web-push";
import { ChatError, validPushEndpoint } from "./validation";
import { checked, loadRoom, teamMembers, type ChatActor } from "./store";

async function pushKeys(db: any) {
  let row = checked(await db.from("chat_push_config").select("public_key,private_key").eq("id", true).maybeSingle());
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    checked(await db.from("chat_push_config").upsert({ id: true, public_key: keys.publicKey, private_key: keys.privateKey }, { onConflict: "id", ignoreDuplicates: true }));
    row = checked(await db.from("chat_push_config").select("public_key,private_key").eq("id", true).single());
  }
  return row as { public_key: string; private_key: string };
}
export async function publicPushKey(db: any) { return (await pushKeys(db)).public_key; }
export async function subscribePush(db: any, actor: ChatActor, subscription: any) {
  if (!subscription || !validPushEndpoint(subscription.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys?.p256dh ?? "") || !/^[A-Za-z0-9_-]{20,30}$/.test(subscription.keys?.auth ?? "")) throw new ChatError("invalid_subscription", "Este dispositivo no pudo habilitar notificaciones.");
  const existing = checked(await db.from("chat_push_subscriptions").select("user_id").eq("endpoint", subscription.endpoint).maybeSingle());
  if (existing && existing.user_id !== actor.userId) throw new ChatError("subscription_in_use", "Desactivá las notificaciones de la cuenta anterior en este dispositivo antes de habilitarlas aquí.", 409);
  const count = await db.from("chat_push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", actor.userId);
  checked(count);
  if (!existing && count.count >= 10) throw new ChatError("device_limit", "Ya hay diez dispositivos habilitados para tu cuenta.", 409);
  checked(await db.from("chat_push_subscriptions").upsert({ endpoint: subscription.endpoint, user_id: actor.userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, { onConflict: "endpoint", ignoreDuplicates: true }));
}
export async function notifyRoom(db: any, actor: ChatActor, roomId: string) {
  const { room, participants } = await loadRoom(db, actor, roomId);
  const members = await teamMembers(db, actor.businessId);
  const recipients = members.filter(m => m.active && m.id !== actor.memberId && participants.some(p => p.member_id === m.id && p.role_snapshot === m.role) && (m.branchIds === null || m.branchIds.includes(room.branch_id))).map(m => m.userId);
  if (!recipients.length) return;
  const subscriptions = checked(await db.from("chat_push_subscriptions").select("*").in("user_id", recipients));
  if (!subscriptions.length) return;
  const keys = await pushKeys(db);
  await Promise.allSettled(subscriptions.filter((s: any) => validPushEndpoint(s.endpoint)).map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: "GastroPilot", body: "Tenés un mensaje nuevo en el chat de tu equipo.", roomId }), {
        TTL: 300, timeout: 6000, vapidDetails: { subject: "https://gastropilot.nexodg.com", publicKey: keys.public_key, privateKey: keys.private_key },
      });
    } catch (error: any) {
      if ([404, 410].includes(error?.statusCode)) await db.from("chat_push_subscriptions").delete().eq("id", s.id).eq("user_id", s.user_id);
    }
  }));
}
