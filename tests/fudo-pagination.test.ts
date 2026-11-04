import assert from "node:assert/strict";
import test from "node:test";
import { nextFudoPage, parseFudoPage } from "../lib/integrations/fudo/snapshot";

test("Fudo O1 numbered links continue to the actual next page without following the URL", () => {
  assert.equal(nextFudoPage({ data: [], links: { next: null } }, 1, 0), 0);
  assert.equal(nextFudoPage({
    links: { next: "/v1alpha1/products?page%5Bnumber%5D=2&page%5Bsize%5D=20" },
  }, 1, 20, "products", 20), 2);
  assert.equal(nextFudoPage({ data: [] }, 1, 0), 0);
  assert.equal(nextFudoPage({ links: { next: "/v1alpha1/products?page=2" } }, 1, 1), 2);
  assert.equal(nextFudoPage({
    links: { next: "https://api.fu.do/v1alpha1/orders?page%5Bnumber%5D=13&page%5Bsize%5D=20" },
  }, 12, 20, "orders", 20), 13);
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
    // Unsupported next-link options must not be silently discarded by our
    // fixed-endpoint GET; doing so could skip data or claim a false full scan.
    "/v1alpha1/products?page=2&filter[status]=paid",
    "/v1alpha1/products?page=2&cursor=opaque",
    "/v1alpha1/products?page=2&page[size]=not-a-number",
    "/v1alpha1/products?page=2&page[size]=101",
    "/v1alpha1/products?page=2&page[size]=20", // Valid size, but NOT the requested size of 100.
    "/v1alpha1/products?page=2&page[size]=20&page[size]=20",
    "/v1alpha1/products?page=2#unexpected-fragment",
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

test("Fudo O1 rejects size mismatch in a test-connection probe without leaking the provider URL", () => {
  const response = { links: { next: "/v1alpha1/products?page[number]=2&page[size]=100" } };
  assert.throws(() => nextFudoPage(response, 1, 1, "products", 1), /invalid_fudo_page/);
  assert.equal(nextFudoPage({ links: { next: "/v1alpha1/products?page[number]=2&page[size]=1" } },
    1, 1, "products", 1), 2);
});

test("Fudo O1 continuation metadata must refer to the resource being imported", () => {
  const valid = [
    "?page[number]=2",
    "/v1alpha1/orders?page=2",
    "/orders?page[number]=2",
    "https://api.fu.do/v1alpha1/orders?page%5Bnumber%5D=2",
  ];
  for (const next of valid) {
    assert.equal(nextFudoPage({ links: { next } }, 1, 1, "orders"), 2, next);
  }

  const wrongResource = [
    "/v1alpha1/products?page=2",
    "/products?page[number]=2",
    "https://api.fu.do/v1alpha1/sales?page=2",
    "/v1alpha1/orders/123?page=2",
    "/v1alpha1/orders/../products?page=2",
  ];
  for (const next of wrongResource) {
    assert.throws(() => nextFudoPage({ links: { next } }, 1, 1, "orders"),
      /invalid_fudo_page/, next);
  }
});

test("Fudo O1 refuses an overfilled page even when links.next is null", () => {
  const overfilled = { data: [{ id: "sample-1" }, { id: "sample-2" }], links: { next: null } };
  const rows = parseFudoPage(overfilled);
  assert.equal(rows.length, 2);
  assert.throws(() => nextFudoPage(overfilled, 1, rows.length, "products", 1),
    /invalid_fudo_page/, "provider did not honor the requested one-record probe size");
  assert.equal(nextFudoPage(overfilled, 1, rows.length, "products", 2), 0,
    "the same data is valid if the caller explicitly requested two records");
});
