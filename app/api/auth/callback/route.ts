import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAppRedirectPath } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAppRedirectPath(url.searchParams.get("next"));
  const flow = url.searchParams.get("flow");

  if (!code) {
    const destination = new URL("/login", url.origin);
    destination.searchParams.set("error", "auth_callback_missing_code");
    return NextResponse.redirect(destination);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const destination = new URL("/login", url.origin);
    destination.searchParams.set("error", "database_config");
    return NextResponse.redirect(destination);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const destination = new URL("/login", url.origin);
    destination.searchParams.set(
      "error",
      flow === "recovery" ? "recovery_expired" : "auth_callback_failed",
    );
    return NextResponse.redirect(destination);
  }

  if (flow === "recovery") {
    return NextResponse.redirect(new URL("/restablecer-contrasena", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
