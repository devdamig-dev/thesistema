import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptFudoCredentials, decryptFudoCredentials } from "../lib/integrations/fudo/crypto";
import { nextFudoPage, parseFudoPage, FUDO_SYNC_PAGE_SIZE, FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";

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
  // Mutate an actual authentication-tag byte; changing the last base64url characters
  // can alter only unused padding bits and leave the decoded ciphertext unchanged.
  const parts = encrypted.split(".");
  const tag = Buffer.from(parts[2], "base64url");
  assert.equal(tag.length, 16);
  tag[0] ^= 0x01;
  parts[2] = tag.toString("base64url");
  const tampered = parts.join(".");
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


test("Fudo preserves numeric safe IDs but refuses rounded or fractional external IDs", () => {
  assert.equal(parseFudoPage({ data: [{ id: Number.MAX_SAFE_INTEGER }] })[0].externalId,
    String(Number.MAX_SAFE_INTEGER));
  // A 64-bit provider ID is safe when transmitted as text, never as a JSON number.
  assert.equal(parseFudoPage({ data: [{ id: "9007199254740993" }] })[0].externalId,
    "9007199254740993");
  assert.throws(() => parseFudoPage({ data: [{ id: Number.MAX_SAFE_INTEGER + 1 }] }),
    /invalid_fudo_record/);
  assert.throws(() => parseFudoPage({ data: [{ id: 42.5 }] }), /invalid_fudo_record/);
  assert.throws(() => parseFudoPage({ data: [{ id: -Infinity }] }), /invalid_fudo_record/);
  assert.throws(() => parseFudoPage({ data: [{ id: " " }] }), /invalid_fudo_record/);
});

test("Fudo keeps paging a short provider-capped page when JSON:API links.next exists", () => {
  const shortPage = { data: [{ id: "x1" }, { id: "x2" }],
    links: { next: "https://api.fu.do/v1alpha1/products?page%5Bnumber%5D=2" } };
  const rows = parseFudoPage(shortPage);
  assert.equal(rows.length, 2);
  assert.equal(nextFudoPage(shortPage, 1, rows.length), 2);
  // Only a compatible page-number link can signal continuation.
  // Reject a foreign URL rather than hiding the provider mismatch.
  // We never fetch links supplied in provider response bodies.
  const offOrigin = { ...shortPage, links: { next: "https://malicious.invalid/exfiltrate" } };
  assert.throws(() => nextFudoPage(offOrigin, 1, rows.length), /invalid_fudo_page/);
});

test("Fudo pagination honors explicit end, even on a full page", () => {
  const full = { data: Array.from({ length: FUDO_SYNC_PAGE_SIZE }, (_, i) => ({ id: String(i) })),
    links: { next: null } };
  assert.equal(nextFudoPage(full, 1, parseFudoPage(full).length), 0);
  assert.equal(nextFudoPage({ data: [] }, 2, 0), 0);
  assert.equal(nextFudoPage({ data: full.data }, 2, FUDO_SYNC_PAGE_SIZE), 3);
  assert.equal(nextFudoPage({ data: full.data, links: { next: { href: "/products?page=3" } } }, 2, FUDO_SYNC_PAGE_SIZE), 3);
});

test("Fudo rejects malformed or inconsistent pagination metadata", () => {
  assert.throws(() => nextFudoPage({ links: { next: true } }, 1, 2), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ links: { next: "/products?page=2" } }, 1, 0), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ links: { next: " " } }, 1, 2), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ links: null }, 1, 2), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ links: { next: "/products?page=100001" } }, 100000, 2), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ data: [] }, 0, 0), /invalid_fudo_page/);
});
