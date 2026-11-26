import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAppRedirectPath } from "@/lib/auth/redirect";
import { googleInvitationReturn } from "@/lib/auth/google";

function authRedirect(destination: URL) {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAppRedirectPath(url.searchParams.get("next"));
  const flow = url.searchParams.get("flow");
  const inviteToken = url.searchParams.get("invite_token");

  function failedCallback(reason: string) {
    const destination = new URL("/login", url.origin);
    destination.searchParams.set("error", reason);
    destination.searchParams.set("next", next);
    if (inviteToken) destination.searchParams.set("invite_token", inviteToken);
    return authRedirect(destination);
  }

  if (url.searchParams.has("error")) {
    return failedCallback("oauth_cancelled");
  }

  if (!code) {
    return failedCallback("auth_callback_missing_code");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return failedCallback("database_config");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return failedCallback(
      flow === "recovery" ? "recovery_expired" : "auth_callback_failed",
    );
  }

  if (flow === "recovery") {
    return authRedirect(new URL("/restablecer-contrasena", url.origin));
  }

  if (inviteToken) {
    return authRedirect(new URL(googleInvitationReturn(next, inviteToken), url.origin));
  }

  return authRedirect(new URL(next, url.origin));
}
