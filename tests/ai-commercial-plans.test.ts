import assert from "node:assert/strict";
import test from "node:test";
import { AI_COMMERCIAL_PLANS, AI_CREDIT_PACKS } from "../lib/ai/commercial-plans";

test("AI commercial plans preserve increasing paid capacity", () => {
  const paid = AI_COMMERCIAL_PLANS.filter((plan) => plan.priceUsdCents > 0);
  assert.deepEqual(paid.map((plan) => plan.code), ["starter", "growth", "pro", "business"]);
  for (let i = 1; i < paid.length; i += 1) {
    assert.ok(paid[i].priceUsdCents > paid[i - 1].priceUsdCents);
    assert.ok(paid[i].monthlyCredits > paid[i - 1].monthlyCredits);
  }
});

test("AI credit packs have positive credits, price and 90-day validity", () => {
  for (const pack of AI_CREDIT_PACKS) {
    assert.ok(pack.credits > 0);
    assert.ok(pack.priceUsdCents > 0);
    assert.equal(pack.validityDays, 90);
  }
});
