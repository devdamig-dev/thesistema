import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBranchesPayload,
  validateBusinessPayload,
  validateChannelsPayload,
} from "../lib/onboarding/validation";

test("business onboarding accepts and normalizes the supported payload", () => {
  assert.deepEqual(validateBusinessPayload({
    name: "  Local Centro  ",
    taxId: " 30-12345678-9 ",
    industry: "cafeteria",
  }), {
    ok: true,
    value: {
      name: "Local Centro",
      taxId: "30-12345678-9",
      industry: "cafeteria",
      timezone: "America/Argentina/Buenos_Aires",
    },
  });
});

test("business onboarding rejects unknown keys, enums and malformed values", () => {
  for (const payload of [
    null,
    { name: "", industry: "cafeteria" },
    { name: "Local", industry: "otro" },
    { name: "Local", industry: "cafeteria", timezone: "Mars/Olympus" },
    { name: "Local", industry: "cafeteria", business_id: "foreign-tenant" },
    { name: 123, industry: "cafeteria" },
  ]) {
    assert.deepEqual(validateBusinessPayload(payload), {
      ok: false,
      error: "invalid_business_payload",
    });
  }
});

test("branch onboarding accepts only the single main branch configured by the UI", () => {
  assert.deepEqual(validateBranchesPayload({
    branches: [{ name: " Principal ", address: " Calle 1 ", type: "local", isMain: true }],
  }), {
    ok: true,
    value: { name: "Principal", address: "Calle 1", type: "local", isMain: true },
  });

  for (const payload of [
    { branches: [] },
    { branches: [{ name: "Principal", type: "warehouse", isMain: true }] },
    { branches: [{ name: "Principal", type: "local", isMain: false }] },
    { branches: [{ name: "", type: "local", isMain: true }] },
    { branches: [
      { name: "Principal", type: "local", isMain: true },
      { name: "Otra", type: "local", isMain: false },
    ] },
    { branches: [{ name: "Principal", type: "local", isMain: true, business_id: "foreign" }] },
  ]) {
    assert.deepEqual(validateBranchesPayload(payload), {
      ok: false,
      error: "invalid_branches_payload",
    });
  }
});

test("channel onboarding rejects empty, duplicate and unknown channel lists", () => {
  assert.deepEqual(validateChannelsPayload(["salon", "whatsapp"]), {
    ok: true,
    value: ["salon", "whatsapp"],
  });

  for (const payload of [
    [],
    ["salon", "salon"],
    ["salon", "sql_arbitrario"],
    "salon",
  ]) {
    assert.deepEqual(validateChannelsPayload(payload), {
      ok: false,
      error: "invalid_channels_payload",
    });
  }
});
