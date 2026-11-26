import assert from "node:assert/strict";
import test from "node:test";
import { googleCallbackUrl, googleInvitationReturn } from "../lib/auth/google";

test("Google uses the initiating app's server callback and retains internal destination", () => {
  const url = new URL(googleCallbackUrl("https://gastropilot.nexodg.com", "/ventas?periodo=hoy"));
  assert.equal(url.origin + url.pathname, "https://gastropilot.nexodg.com/api/auth/callback");
  assert.equal(url.searchParams.get("next"), "/ventas?periodo=hoy");
  assert.equal(url.searchParams.has("invite_token"), false);
});

test("Google cannot carry an external destination through the callback", () => {
  for (const path of ["https://evil.test", "//evil.test", "/%252f%252fevil.test", "/\\evil.test"]) {
    assert.equal(new URL(googleCallbackUrl("https://gastropilot.nexodg.com", path)).searchParams.get("next"), "/");
  }
  assert.throws(() => googleCallbackUrl("http://insecure.test", "/"));
  assert.throws(() => googleCallbackUrl("javascript:alert(1)", "/"));
});

test("invitation return preserves the exact token for existing server validation", () => {
  const token = "invitation-with+reserved&characters";
  const url = new URL(googleCallbackUrl("https://gastropilot.nexodg.com", "/ventas", token));
  assert.equal(url.searchParams.get("invite_token"), token);
  const after = new URL(googleInvitationReturn("//evil.test", token), url.origin);
  assert.equal(after.pathname, "/login");
  assert.equal(after.searchParams.get("oauth"), "complete");
  assert.equal(after.searchParams.get("invite_token"), token);
  assert.equal(after.searchParams.get("next"), "/");
});
