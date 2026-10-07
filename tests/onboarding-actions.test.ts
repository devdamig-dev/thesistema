import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as validation from "../lib/onboarding/validation";

let clientCreations = 0;

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/supabase/server": {
      createSupabaseServerClient: async () => {
        clientCreations += 1;
        throw new Error("invalid input reached the database boundary");
      },
    },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/industries": { SUGGESTED_MODULES_BY_INDUSTRY: {} },
    "@/lib/onboarding/validation": validation,
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const {
  saveBranchStep,
  saveBusinessStep,
  saveChannelsStep,
} = require("../app/actions/onboarding");
loader._load = original;

test("manipulated onboarding payloads fail before creating a Supabase client", async () => {
  const before = clientCreations;

  assert.deepEqual(await saveBusinessStep({
    name: "QA",
    industry: "cafeteria",
    business_id: "foreign-tenant",
  }), {
    ok: false,
    persisted: false,
    error: "invalid_business_payload",
  });
  assert.deepEqual(await saveBranchStep({
    branches: [{ name: "Principal", type: "warehouse", isMain: true }],
  }), {
    ok: false,
    persisted: false,
    error: "invalid_branches_payload",
  });
  assert.deepEqual(await saveChannelsStep(["salon", "salon"]), {
    ok: false,
    persisted: false,
    error: "invalid_channels_payload",
  });

  assert.equal(clientCreations, before);
});
