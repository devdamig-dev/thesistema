import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { NextRequest } from "next/server";
import * as redirect from "../lib/auth/redirect";
import * as google from "../lib/auth/google";

let configured = true;
let error: unknown = null;
const exchanges: string[] = [];
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/auth/redirect") return redirect;
  if (name === "@/lib/auth/google") return google;
  if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => configured ? {
    auth: { exchangeCodeForSession: async (code: string) => { exchanges.push(code); return { error }; } },
  } : null };
  return original.call(this, name, ...args);
};
const { GET } = require("../app/api/auth/callback/route") as typeof import("../app/api/auth/callback/route");
loader._load = original;

async function callback(query: string) {
  const response = await GET(new NextRequest(`https://gastropilot.nexodg.com/api/auth/callback?${query}`));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Expires"), "0");
  return new URL(response.headers.get("location")!);
}

test("callback validates code once and only returns inside GastroPilot", async () => {
  configured = true; error = null; exchanges.length = 0;
  const target = await callback("code=fixture&next=%2Fventas");
  assert.equal(target.href, "https://gastropilot.nexodg.com/ventas");
  assert.deepEqual(exchanges, ["fixture"]);
  const hostile = await callback("code=fixture&next=%2F%2Fevil.test");
  assert.equal(hostile.href, "https://gastropilot.nexodg.com/");
});

test("cancelled, missing and failed Google callbacks never redirect to a private destination", async () => {
  configured = true; error = null; exchanges.length = 0;
  for (const query of ["error=access_denied&error_description=private-detail&next=/ventas", "next=/ventas"]) {
    const target = await callback(query);
    assert.equal(target.pathname, "/login");
    assert.equal(target.href.includes("private-detail"), false);
  }
  assert.equal(exchanges.length, 0);
  error = { message: "expired" };
  assert.equal((await callback("code=expired&next=/ventas")).searchParams.get("error"), "auth_callback_failed");
  configured = false;
  assert.equal((await callback("code=fixture")).searchParams.get("error"), "database_config");
});

test("Google invitation resumes existing acceptance while recovery preserves its destination", async () => {
  configured = true; error = null;
  const invited = await callback("code=fixture&next=%2Fventas&invite_token=bound");
  assert.equal(invited.pathname, "/login");
  assert.equal(invited.searchParams.get("invite_token"), "bound");
  assert.equal(invited.searchParams.get("oauth"), "complete");
  assert.equal((await callback("code=fixture&flow=recovery&next=/ventas")).pathname, "/restablecer-contrasena");
});
