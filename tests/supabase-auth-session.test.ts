import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

test("Supabase SSR dependencies are pinned to the reviewed session contract", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["@supabase/ssr"], "0.12.7");
  assert.equal(pkg.dependencies["@supabase/supabase-js"], "2.117.2");
});

test("server clients use the non-deprecated getAll/setAll cookie contract", () => {
  const server = read("lib/supabase/server.ts");
  const proxy = read("proxy.ts");

  assert.match(server, /getAll\(\)/);
  assert.match(server, /setAll\(cookiesToSet\)/);
  assert.doesNotMatch(server, /\bremove\(name:/);

  assert.match(proxy, /getAll: \(\) => request\.cookies\.getAll\(\)/);
  assert.match(proxy, /setAll: \(cookiesToSet, headers\)/);
  assert.match(proxy, /Object\.entries\(headers\)/);
});

test("proxy verifies claims and preserves refreshed auth state on redirects", () => {
  const proxy = read("proxy.ts");

  assert.match(proxy, /supabase\.auth\.getClaims\(\)/);
  assert.match(proxy, /response\.cookies\.getAll\(\)/);
  assert.match(proxy, /AUTH_RESPONSE_HEADERS/);
  assert.equal((proxy.match(/redirectWithAuthState\(response, redirect\)/g) ?? []).length, 4);
});

test("auth callback responses cannot cache session cookies", () => {
  const callback = read("app/api/auth/callback/route.ts");

  assert.match(callback, /Cache-Control", "private, no-store"/);
  assert.match(callback, /Pragma", "no-cache"/);
  assert.match(callback, /Expires", "0"/);
  assert.equal((callback.match(/return authRedirect\(/g) ?? []).length, 5);
});
