import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const flow = url.searchParams.get("flow");

  if (!code) {
    const destination = new URL("/login", url.origin);
    destination.searchParams.set("error", "auth_callback_missing_code");
    return NextResponse.redirect(destination);
  }

  const supabase = createSupabaseServerClient();
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
