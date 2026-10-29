"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { authorizeConnectionActor, ConnectionError } from "@/lib/whatsapp/signup";

type Result = { ok: boolean; message: string };
const digits = (value: string) => value.replace(/\D/g, "");
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (message: string): Result => ({ ok: false, message });

export async function saveWhatsAppReadSource(input: {
  phone: string; label: string; branchId: string; consent: boolean;
}): Promise<Result> {
  try {
    if (!isDatabaseMode()) return fail("La demostración no autoriza fuentes reales.");
    const actor = authorizeConnectionActor(await getCurrentUserContext());
    const phone = digits(String(input.phone ?? ""));
    const label = String(input.label ?? "").trim();
    if (!/^[1-9]\d{7,14}$/.test(phone) || !uuid(input.branchId) || label.length < 1 || label.length > 100 || input.consent !== true)
      return fail("Indicá un nombre, número completo con código de país, sucursal y confirmá la autorización para procesar nuevos mensajes.");
    const db = createSupabaseAdminClient() as any;
    const [integration, branch] = await Promise.all([
      db.from("whatsapp_integrations").select("phone_number_id,status,token_expires_at").eq("business_id", actor.businessId).maybeSingle(),
      db.from("branches").select("id").eq("id", input.branchId).eq("business_id", actor.businessId).maybeSingle(),
    ]);
    if (integration.error || branch.error) return fail("No pudimos verificar el negocio ni la vinculación.");
    if (!branch.data) return fail("La sucursal no pertenece a este negocio.");
    const wa = integration.data;
    if (!wa || wa.status !== "connected" || wa.token_expires_at && Date.parse(wa.token_expires_at) <= Date.now())
      return fail("Primero verificá que WhatsApp esté conectado y autorizado.");
    const member = await db.from("whatsapp_authorized_conversations").select("id").eq("business_id", actor.businessId).eq("provider", "meta").eq("provider_conversation_id", phone).eq("enabled", true).limit(1);
    if (member.error) return fail("No pudimos verificar las autorizaciones existentes.");
    if (member.data?.length) return fail("Ese número ya está autorizado para operar. No duplicamos su conversación como fuente de lectura.");
    const existing = await db.from("whatsapp_read_sources").select("id").eq("business_id", actor.businessId).eq("sender_phone", phone).maybeSingle();
    if (existing.error) return fail("El módulo de fuentes de lectura todavía no está habilitado.");
    if (existing.data) return fail("Esa fuente ya existe. Podés activarla o pausarla desde la lista.");
    const saved = await db.from("whatsapp_read_sources").insert({
      business_id: actor.businessId, phone_number_id: wa.phone_number_id,
      sender_phone: phone, label, branch_id: input.branchId,
      enabled: true, consent_confirmed_at: new Date().toISOString(), created_by: actor.userId,
    });
    if (saved.error) return fail("No se pudo guardar la fuente. Comprobá el teléfono y la sucursal.");
    revalidatePath("/ajustes/whatsapp");
    return { ok: true, message: "Fuente habilitada en modo lectura. Los próximos textos que lleguen desde este número se enviarán al Inbox para revisión, sin ejecutar cargas." };
  } catch (error) { return fail(error instanceof ConnectionError ? error.message : "No se pudo verificar la autorización."); }
}

export async function toggleWhatsAppReadSource(id: string, enabled: boolean): Promise<Result> {
  try {
    if (!isDatabaseMode()) return fail("No se pueden modificar fuentes en demo.");
    const actor = authorizeConnectionActor(await getCurrentUserContext());
    if (!uuid(id) || typeof enabled !== "boolean") return fail("Fuente inválida.");
    const db = createSupabaseAdminClient() as any;
    const changed = await db.from("whatsapp_read_sources").update({ enabled }).eq("business_id", actor.businessId).eq("id", id).select("id").maybeSingle();
    if (changed.error || !changed.data) return fail("No pudimos confirmar el cambio. Actualizá y reintentá.");
    revalidatePath("/ajustes/whatsapp");
    return { ok: true, message: enabled ? "Fuente reactivada para nuevos mensajes." : "Fuente pausada. No se procesarán mensajes nuevos de ese teléfono." };
  } catch (error) { return fail(error instanceof ConnectionError ? error.message : "No pudimos actualizar la fuente."); }
}
