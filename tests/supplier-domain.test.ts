import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isSupplierId, isSupplierVersion, validateSupplierFields, normalizeSupplierFields, supplierRpcFields, supplierError } from "../lib/suppliers/domain";

test("supplier fields preserve real Unicode contacts and multiline terms, normalized once", () => {
  const input = { name: "  José & Hijos  ", phone: "+54 (11) 5555-4444", email: "ventas@example.invalid", paymentTerms: " 30 días\nTransferencia ", notes: "Entrega semanal" };
  assert.equal(validateSupplierFields(input), null);
  assert.equal(normalizeSupplierFields(input).name, "José & Hijos");
  assert.equal(supplierRpcFields(input).p_payment_terms, "30 días\nTransferencia");
  assert.equal(supplierRpcFields(input).p_tax_id, null);
});
test("supplier validation rejects wrong types, blanks, unsafe contacts and excessive fields", () => {
  for (const input of [null, [], "x", { name: " " }, { name: 7 }, { name: "x", phone: 123 }, { name: "x", phone: "javascript:123" }, { name: "x", phone: "12" }, { name: "x", email: "a@b" }, { name: "x", email: "a@@b.c" }, { name: "x", notes: "a".repeat(4001) }, { name: "a".repeat(201) }, { name: "a\nb" }, { name: "x", notes: "bad\x01control" }]) assert.ok(validateSupplierFields(input), JSON.stringify(input));
});
test("IDs and CAS versions are strict and retain microsecond precision", () => {
  assert.ok(isSupplierId("00000000-0000-4000-8000-000000000031"));
  assert.equal(isSupplierId("supplier-a"), false);
  assert.equal(isSupplierId(null), false);
  assert.ok(isSupplierVersion("2026-10-09T01:02:03.123456+00:00"));
  assert.equal(isSupplierVersion("2026-10-09"), false);
  assert.equal(isSupplierVersion("x"), false);
});
test("lost or malformed write responses stay uncertain, never claim rollback", () => {
  for (const error of [null, { code: "PGRST000", message: "network" }, { code: "500", message: "bad gateway" }]) {
    const result = supplierError(error);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.persisted, null); assert.equal(result.status, "uncertain"); }
  }
});
test("stale CAS and duplicate IDs require verification; authorization and validation are known rejections", () => {
  for (const message of ["supplier_stale_version", "supplier_request_conflict"]) {
    const result = supplierError({ message });
    if (!result.ok) assert.equal(result.status, "conflict");
  }
  for (const code of ["42501", "23514", "P0002"]) {
    const result = supplierError({ code });
    if (!result.ok) { assert.equal(result.persisted, false); assert.equal(result.status, "rejected"); }
  }
});
test("supplier UI has durable create recovery, synchronous submit lock and no automatic mutation retry", () => {
  const source = readFileSync("components/suppliers/supplier-form.tsx", "utf8");
  assert.match(source, /sessionStorage\.setItem\(storageKey, JSON\.stringify\(request\)\)/);
  assert.match(source, /if \(busy\.current/);
  assert.match(source, /getSupplierManualAction\(id\)/);
  assert.match(source, /attempt && verifiedAbsent/);
  assert.match(source, /sendCreate\(attempt, true\)/);
  assert.match(source, /setAttempt\(saved\)/);
  assert.match(source, /expectedUpdatedAt: row\.updated_at/);
});
test("history keeps archived supplier names while creation exposes active options only", () => {
  const source = readFileSync("app/actions/purchases-page.ts", "utf8");
  assert.match(source, /const supplierMap = new Map\(suppliers\.map/);
  assert.match(source, /suppliers: suppliers\.filter\(\(supplier\) => supplier\.active\)/);
  assert.match(source, /\.eq\("active", true\)/);
});
