import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { AuthClient } from "@supabase/auth-js";

// Exercise the real browser factory without credentials or network access.
function browserOptions() {
  let options: any;
  const source = fs.readFileSync("lib/supabase/client.ts", "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} as any };
  vm.runInNewContext(javascript, { module: compiled, exports: compiled.exports, require(name: string) {
    if (name === "@supabase/ssr") return { createBrowserClient(_url: string, _key: string, input: any) { options = input; return {}; } };
    if (name === "@/lib/env") return { env: { supabaseUrl: "https://example.invalid", supabaseAnonKey: "synthetic" }, isDatabaseMode: () => true };
    throw new Error(`Unexpected import ${name}`);
  }});
  compiled.exports.createSupabaseBrowserClient();
  return options;
}

async function exchange(options: { detect: boolean; recovery?: boolean; rejected?: boolean; verifier?: boolean }) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined });
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const storageKey = `qa-${Math.random()}`;
  const store = new Map<string, string>();
  if (options.verifier !== false) store.set(`${storageKey}-code-verifier`, JSON.stringify(`synthetic-verifier${options.recovery ? "/recovery" : ""}`));
  const location = { href: "https://example.invalid/login?code=synthetic-code" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, history: { state: null, replaceState(_state: unknown, _title: string, url: string) { location.href = url; } } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
  let requests = 0;
  const client = new AuthClient({
    url: "https://example.invalid/auth/v1", storageKey, flowType: "pkce",
    detectSessionInUrl: options.detect, autoRefreshToken: false, persistSession: true,
    storage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); } },
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify(options.rejected
        ? { error: "invalid_grant", error_description: "Synthetic rejected code" }
        : { access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user: { id: "synthetic-user", aud: "authenticated" } }),
      { status: options.rejected ? 400 : 200, headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    const result = await client.exchangeCodeForSession("synthetic-code");
    return { requests, error: result.error, session: result.data.session, redirectType: (result.data as { redirectType?: string | null }).redirectType };
  } finally {
    await client.stopAutoRefresh();
    if (previousBroadcastChannel) Object.defineProperty(globalThis, "BroadcastChannel", previousBroadcastChannel); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  }
}

test("PKCE regression: automatic detection consumes the verifier before explicit login exchange", async () => {
  const result = await exchange({ detect: true });
  assert.equal(result.requests, 1);
  assert.equal(result.error?.name, "AuthPKCECodeVerifierMissingError");
  assert.equal(result.session, null);
});

test("browser factory gives login sole ownership of magic-link PKCE exchange", async () => {
  assert.equal(browserOptions()?.auth?.detectSessionInUrl, false);
  const result = await exchange({ detect: browserOptions().auth.detectSessionInUrl });
  assert.equal(result.requests, 1);
  assert.equal(result.error, null);
  assert.ok(result.session);
});

test("explicit recovery retains recovery type with one exchange", async () => {
  const result = await exchange({ detect: browserOptions().auth.detectSessionInUrl, recovery: true });
  assert.equal(result.requests, 1);
  assert.equal(result.error, null);
  assert.equal(result.redirectType, "recovery");
});

test("invalid code and absent PKCE verifier remain rejected", async () => {
  const rejected = await exchange({ detect: browserOptions().auth.detectSessionInUrl, rejected: true });
  assert.equal(rejected.requests, 1);
  assert.ok(rejected.error);
  assert.equal(rejected.session, null);
  const missing = await exchange({ detect: browserOptions().auth.detectSessionInUrl, verifier: false });
  assert.equal(missing.requests, 0);
  assert.equal(missing.error?.name, "AuthPKCECodeVerifierMissingError");
  assert.equal(missing.session, null);
});
