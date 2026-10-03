import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Official WhatsApp Cloud API transport. Credentials never leave the server. */
export async function sendMetaTextReply(
  businessId: string,
  to: string,
  text: string,
): Promise<void> {
  // whatsapp_integrations is newer than the generated Database helper types.
  // Keep the admin client server-only and narrow the untyped surface to this table.
  const db = createSupabaseAdminClient() as any;

  const res = await db
    .from("whatsapp_integrations")
    .select("phone_number_id,access_token,status")
    .eq("business_id", businessId)
    .maybeSingle();

  if (res.error) throw res.error;
  if (!res.data || res.data.status !== "connected") {
    throw new Error("whatsapp_transport_not_connected");
  }

  const version =
    process.env.META_GRAPH_VERSION ??
    process.env.NEXT_PUBLIC_META_GRAPH_VERSION ??
    "v25.0";

  const response = await fetch(
    `https://graph.facebook.com/${version}/${res.data.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${res.data.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4096) },
      }),
    },
  );

  if (!response.ok) throw new Error(`meta_send_failed:${response.status}`);
}
