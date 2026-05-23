"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";

export async function markNotificationReadAction(notificationId: string) {
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true as const, persisted: false };
  const db = supabase as any;
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) {
    return { ok: false as const, persisted: false, error: error.message };
  }
  revalidatePath("/");
  return { ok: true as const, persisted: true };
}

export async function markAllNotificationsReadAction() {
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true as const, persisted: false };
  const db = supabase as any;
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) {
    return { ok: false as const, persisted: false, error: error.message };
  }
  revalidatePath("/");
  return { ok: true as const, persisted: true };
}
