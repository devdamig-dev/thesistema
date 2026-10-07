import test from "node:test";
import assert from "node:assert/strict";
import { connectionRecovery } from "../lib/whatsapp/connection-recovery";

test("only known pre-claim errors preserve number selection", () => {
  assert.equal(connectionRecovery("provider_setup_required"), "retry_selection");
  assert.equal(connectionRecovery("meta_unavailable"), "retry_selection");
  assert.equal(connectionRecovery("meta_unavailable", "check_status"), "check_status");
  assert.equal(connectionRecovery("rate_limited"), "retry_selection");
});
test("expired or consumed sessions reset while ambiguous/network outcomes require status checking", () => {
  for (const code of ["session_unavailable", "meta_authorization_expired", "permission_denied"]) assert.equal(connectionRecovery(code), "restart");
  for (const code of [undefined, "connection_in_progress", "connection_failed", "connection_storage_failed"]) assert.equal(connectionRecovery(code), "check_status");
  assert.equal(connectionRecovery("unknown", "retry_selection"), "check_status");
});
