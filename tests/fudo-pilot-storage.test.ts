import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptFudoCredentials, decryptFudoCredentials } from "../lib/integrations/fudo/crypto";
import { parseFudoPage, FUDO_SYNC_PAGE_SIZE, FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";

const businessA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const businessB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = randomBytes(32).toString("base64");

test("Fudo API key and secret are never persisted in plaintext and are bound to the tenant", () => {
  const credentials = { apiKey: "pilot-api-key-12345", apiSecret: "pilot-secret-987654" };
  const encrypted = encryptFudoCredentials(businessA, credentials, key);
  assert.match(encrypted, /^v1\./);
  assert.ok(!encrypted.includes(credentials.apiKey));
  assert.ok(!encrypted.includes(credentials.apiSecret));
  assert.deepEqual(decryptFudoCredentials(businessA, encrypted, key), credentials);
  assert.throws(() => decryptFudoCredentials(businessB, encrypted, key), /fudo_ciphertext_invalid/);
  assert.throws(() => decryptFudoCredentials(businessA, encrypted, randomBytes(32).toString("base64")), /fudo_ciphertext_invalid/);
});

test("Fudo encryption fails closed on missing or malformed server key", () => {
  const credentials = { apiKey: "a long enough key", apiSecret: "a long enough secret" };
  assert.throws(() => encryptFudoCredentials(businessA, credentials, ""), /fudo_encryption_unavailable/);
  assert.throws(() => encryptFudoCredentials(businessA, credentials, "wrong"), /fudo_encryption_unavailable/);
  const encrypted = encryptFudoCredentials(businessA, credentials, key);
  const tampered = encrypted.slice(0, -2) + (encrypted.endsWith("aa") ? "bb" : "aa");
  assert.throws(() => decryptFudoCredentials(businessA, tampered, key), /fudo_ciphertext_invalid/);
});

test("Fudo JSON:API page keeps stable external IDs and hash for repeated sync", () => {
  const payload = { data: [
    { id: "p-1", type: "products", attributes: { name: "Pizza", updatedAt: "2026-11-01T12:00:00Z" } },
    { id: "p-2", type: "products", attributes: { name: "Milanesa" } },
  ] };
  const first = parseFudoPage(payload);
  const second = parseFudoPage(payload);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.externalId), ["p-1","p-2"]);
  assert.equal(first[0].sourceUpdatedAt, "2026-11-01T12:00:00.000Z");
  assert.match(first[0].contentHash, /^[a-f0-9]{64}$/);
  assert.equal(FUDO_SYNC_PAGE_SIZE, 100);
  assert.deepEqual(FUDO_SYNC_RESOURCES, ["products", "ingredients", "providers", "orders", "sales"]);
});

test("Fudo staging rejects ambiguous records and oversized provider pages", () => {
  assert.throws(() => parseFudoPage({ unexpected: [] }), /invalid_fudo_page/);
  assert.throws(() => parseFudoPage({ data: [{}] }), /invalid_fudo_record/);
  assert.throws(() => parseFudoPage({ data: [{ id: "1" }, { id: "1" }] }), /invalid_fudo_record/);
  assert.throws(() => parseFudoPage({ data: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) }), /invalid_fudo_page/);
  assert.throws(() => parseFudoPage({ data: [{ id: "1", attributes: { large: "z".repeat(131072) } }] }), /fudo_record_too_large/);
});
