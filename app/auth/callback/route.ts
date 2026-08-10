import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const supabase = createSupabaseServerClient();

  if (!code || !supabase) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", "auth_callback_missing_code");
    return NextResponse.redirect(login, { status: 303 });
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", "auth_callback_failed");
    return NextResponse.redirect(login, { status: 303 });
  }

  return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
}
