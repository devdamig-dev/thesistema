import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectionRequest, parseSignupEvent } from "../lib/whatsapp/signup";
import { diagnosticFromMeta, parseSignupDiagnostic } from "../lib/whatsapp/signup-diagnostics";
import { persistSignupDiagnostic } from "../lib/whatsapp/signup-diagnostic-store";

const data = { error_code: "2655093", session_id: "f34b51dab5e0498", timestamp: "1746041036", error_message: "Provider detail must never be persisted" };
const event = { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data };
const diagnostic = { providerEvent: "CANCEL" as const, errorCode: "2655093", sessionReference: "f34b51dab5e0498", reportedAt: 1746041036 };

test("Meta's documented reported-error CANCEL is not a voluntary cancellation", () => {
  assert.deepEqual(parseSignupEvent("https://www.facebook.com", JSON.stringify(event)), { kind: "error", diagnostic });
});
test("plain cancellation stays cancellation; ERROR captures the same safe reference", () => {
  assert.deepEqual(parseSignupEvent("https://www.facebook.com", { ...event, data: { current_step: "PHONE_NUMBER_SETUP" } }), { kind: "cancel" });
  assert.deepEqual(parseSignupEvent("https://www.facebook.com", { ...event, event: "ERROR" }), { kind: "error", diagnostic: { ...diagnostic, providerEvent: "ERROR" } });
});
test("reported errors without a usable code still cannot be mislabeled as cancellation", () => {
  assert.deepEqual(parseSignupEvent("https://www.facebook.com", { ...event, data: { error_message: "unknown rejection" } }), { kind: "error", diagnostic: { providerEvent: "CANCEL" } });
});
test("diagnostics reject forged origins and strip raw messages, auth codes, phones and tokens", () => {
  assert.equal(parseSignupEvent("https://www.facebook.com.evil.test", event), null);
  const result = diagnosticFromMeta("ERROR", { ...data, access_token: "fixture-private-value", code: "fixture-private-value", phone: "+19995550101", business_id: "other-business" });
  assert.deepEqual(result, { ...diagnostic, providerEvent: "ERROR" });
  assert.equal(JSON.stringify(result).includes("fixture-private-value"), false);
  assert.equal(JSON.stringify(result).includes("Provider detail"), false);
});
test("unsupported reference formats and invalid finite ranges are not retained", () => {
  for (const error_code of [-1, Infinity, NaN, "200 OR true", "1234567890"]) assert.equal(diagnosticFromMeta("ERROR", { error_code }).errorCode, undefined);
  for (const session_id of ["EAA-private-token", "<script>", "+19995550101", "a".repeat(65)]) assert.equal(diagnosticFromMeta("ERROR", { session_id }).sessionReference, undefined);
  for (const timestamp of [0, Infinity, 1746041036.1, "bad", 4102444800]) assert.equal(diagnosticFromMeta("ERROR", { timestamp }).reportedAt, undefined);
  assert.equal(diagnosticFromMeta("ERROR", { session_id: "00000000-0000-4000-8000-000000000001" }).sessionReference, "00000000-0000-4000-8000-000000000001");
});
test("report DTO rejects tenant injection, unknown fields, malformed metadata and modes", () => {
  const base = { action: "report_error", mode: "business_app", diagnostic };
  assert.deepEqual(parseConnectionRequest(base), base);
  for (const raw of [{ ...base, business_id: "other" }, { ...base, mode: "other" }, { ...base, diagnostic: { ...diagnostic, access_token: "private" } }, { ...base, diagnostic: { ...diagnostic, errorCode: "not-numeric" } }, { ...base, diagnostic: [] }]) assert.throws(() => parseConnectionRequest(raw));
  assert.equal(parseSignupDiagnostic({ ...diagnostic, reportedAt: "1746041036" }), null);
});
const actor = { userId: "actor-a", businessId: "business-a", role: "owner" };
function dbFixture(role = "owner", storageError = false) {
  const writes: any[] = []; const filters: any[] = [];
  return { writes, filters, db: { from(table: string) {
    if (table === "business_members") { const query: any = { select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, async maybeSingle() { return { data: { role }, error: null }; } }; return query; }
    assert.equal(table, "activity_logs");
    return { insert(row: unknown) { writes.push(row); return { select() { return { async single() { return storageError ? { data: null, error: { message: "private db error" } } : { data: { id: "audit-only" }, error: null }; } }; } }; } };
  } } };
}
test("diagnostic audit is tenant-bound, revalidates role and never writes connection state", async () => {
  const f = dbFixture();
  assert.deepEqual(await persistSignupDiagnostic(f.db, actor, { action: "report_error", mode: "business_app", diagnostic }, { appId: "123456789", configId: "987654321" }), { ok: true, phase: "diagnostic_saved" });
  assert.deepEqual(f.filters, [["business_id", "business-a"], ["user_id", "actor-a"]]);
  assert.equal(f.writes[0].business_id, "business-a"); assert.equal(f.writes[0].actor_id, "actor-a");
  assert.equal(f.writes[0].data.source, "browser_report_unverified"); assert.equal(f.writes.length, 1);
});
test("revoked role and failed persistence never acknowledge a diagnostic as saved", async () => {
  const revoked = dbFixture("viewer");
  await assert.rejects(persistSignupDiagnostic(revoked.db, actor, { action: "report_error", mode: "business_app", diagnostic }, { appId: "123456789", configId: "987654321" }));
  assert.equal(revoked.writes.length, 0);
  const failed = dbFixture("admin", true);
  await assert.rejects(persistSignupDiagnostic(failed.db, actor, { action: "report_error", mode: "business_app", diagnostic }, { appId: "123456789", configId: "987654321" }));
});
