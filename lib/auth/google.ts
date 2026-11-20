import { safeAppRedirectPath } from "./redirect";

/** Keep PKCE on the initiating origin; Supabase authorizes deployed return URLs. */
export function googleCallbackUrl(origin: string, next: string, inviteToken?: string | null): string {
  const base = new URL(origin);
  const local = ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) {
    throw new Error("Invalid authentication origin");
  }
  const callback = new URL("/api/auth/callback", base.origin);
  callback.searchParams.set("next", safeAppRedirectPath(next));
  if (inviteToken) callback.searchParams.set("invite_token", inviteToken);
  return callback.href;
}

/** An invitation still needs its existing email/tenant validation after Google. */
export function googleInvitationReturn(next: string, inviteToken: string): string {
  const params = new URLSearchParams({
    next: safeAppRedirectPath(next),
    invite_token: inviteToken,
    oauth: "complete",
  });
  return `/login?${params}`;
}
