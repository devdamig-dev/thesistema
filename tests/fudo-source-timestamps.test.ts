import assert from "node:assert/strict";
import test from "node:test";
import { parseFudoPage } from "../lib/integrations/fudo/snapshot";

function importedTimestamp(value: unknown, field: "updatedAt" | "updated_at" = "updatedAt") {
  const rows = parseFudoPage({
    data: [{ type: "product", id: "safe-product", attributes: { [field]: value } }],
  }, "products");
  assert.equal(rows.length, 1);
  return rows[0].sourceUpdatedAt;
}

test("Fudo O1 source provenance accepts only explicit timezone instants", () => {
  assert.equal(importedTimestamp("2026-11-09T12:00:00-03:00"), "2026-11-09T15:00:00.000Z");
  assert.equal(importedTimestamp("2026-11-09T15:00:00Z", "updated_at"), "2026-11-09T15:00:00.000Z");
  assert.equal(importedTimestamp("2024-02-29T23:59:59.123Z"), "2024-02-29T23:59:59.123Z");
  assert.equal(importedTimestamp("2026-11-09T15:00:00+00:00"), "2026-11-09T15:00:00.000Z");
  assert.equal(importedTimestamp("0001-01-01T00:00:00Z"), "0001-01-01T00:00:00.000Z");
  assert.equal(importedTimestamp("9999-12-31T23:59:59Z"), "9999-12-31T23:59:59.000Z");
});

test("Fudo O1 source provenance never invents instants for ambiguous or impossible dates", () => {
  for (const date of [
    "2026-11-09T12:00:00", // No timezone: depends on host runtime TZ.
    "11/09/2026 12:00:00", // Locale dependent.
    "2026-02-30T12:00:00Z", // JS may normalize this to March 2.
    "2025-02-29T12:00:00Z", // Not a leap year.
    "2026-13-01T12:00:00Z",
    "2026-11-09T24:00:00Z",
    "2026-11-09T12:60:00Z",
    "2026-11-09T12:00:60Z",
    "2026-11-09T12:00:00+15:00",
    "2026-11-09T12:00:00+14:01",
    "2026-11-09T12:00:00+01:60",
    "0000-01-01T00:00:00Z", // JS accepts year zero; PostgreSQL timestamptz rejects it.
    "0001-01-01T00:00:00+14:00", // Local year 1 becomes UTC year 0.
    "9999-12-31T23:00:00-14:00", // Local year 9999 becomes extended ISO year +010000.
    "not-a-date",
    "",
    null,
    1762700400000,
  ]) {
    assert.equal(importedTimestamp(date), null, String(date));
  }
});

test("Fudo O1 ambiguous updatedAt remains in source payload but is not normalized into provenance", () => {
  const record = parseFudoPage({
    data: [{ id: "opaque-product", type: "product", attributes: { updatedAt: "2026-11-09T12:00:00" } }],
  }, "products")[0];
  assert.equal(record.sourceUpdatedAt, null);
  assert.deepEqual(record.payload.attributes, { updatedAt: "2026-11-09T12:00:00" });
  assert.match(record.contentHash, /^[a-f0-9]{64}$/);
});
