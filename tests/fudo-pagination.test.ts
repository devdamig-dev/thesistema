import assert from "node:assert/strict";
import test from "node:test";
import { nextFudoPage } from "../lib/integrations/fudo/snapshot";

test("Fudo O1 numbered links continue to the actual next page without following the URL", () => {
  assert.equal(nextFudoPage({ data: [], links: { next: null } }, 1, 0), 0);
  assert.equal(nextFudoPage({ data: [] }, 1, 0), 0);
  assert.equal(nextFudoPage({ links: { next: "/v1alpha1/products?page=2" } }, 1, 1), 2);
  assert.equal(nextFudoPage({
    links: { next: "https://api.fu.do/v1alpha1/orders?page%5Bnumber%5D=13&page%5Bsize%5D=20" },
  }, 12, 20), 13);
  assert.equal(nextFudoPage({
    links: { next: { href: "?page[number]=3&page[size]=100" } },
  }, 2, 12), 3);
  // A full page without explicit metadata is the legacy compatibility fallback.
  assert.equal(nextFudoPage({ data: [] }, 1, 100), 2);
});

test("Fudo O1 refuses malformed, non-numbered, skipped or external next links", () => {
  const rejected: unknown[] = [
    "broken-link",
    "",
    "/v1alpha1/products?cursor=abc",
    "/v1alpha1/products?page[number]=1",
    "/v1alpha1/products?page[number]=3",
    "/v1alpha1/products?page[number]=2&page[number]=2",
    "/v1alpha1/products?page[number]=2&page=2",
    "/v1alpha1/products?page[number]=2.0",
    "/v1alpha1/products?page[number]=NaN",
    "https://untrusted.example/v1alpha1/products?page=2",
    "http://api.fu.do/v1alpha1/products?page=2",
    "javascript:alert(1)",
    "https://user:pass@api.fu.do/v1alpha1/products?page=2",
    { href: true },
  ];
  for (const next of rejected) {
    assert.throws(() => nextFudoPage({ links: { next } }, 1, 1), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "invalid_fudo_page");
      assert.doesNotMatch(error.message, /untrusted|cursor|user|pass/);
      return true;
    }, JSON.stringify(next));
  }
  assert.throws(() => nextFudoPage({ links: { next: "/v1alpha1/products?page=2" } }, 1, 0), /invalid_fudo_page/);
  assert.throws(() => nextFudoPage({ links: { next: "/v1alpha1/products?page=100001" } }, 100000, 1), /invalid_fudo_page/);
});
