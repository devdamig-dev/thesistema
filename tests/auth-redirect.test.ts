import assert from "node:assert/strict";
import test from "node:test";
import { safeAppRedirectPath } from "../lib/auth/redirect";

test("post-auth redirects preserve valid internal paths", () => {
  assert.equal(safeAppRedirectPath("/"), "/");
  assert.equal(safeAppRedirectPath("/ventas?periodo=hoy#detalle"), "/ventas?periodo=hoy#detalle");
  assert.equal(safeAppRedirectPath("/ajustes/ia"), "/ajustes/ia");
});

test("post-auth redirects reject external and protocol-relative destinations", () => {
  assert.equal(safeAppRedirectPath("https://evil.example/phishing"), "/");
  assert.equal(safeAppRedirectPath("//evil.example/phishing"), "/");
  assert.equal(safeAppRedirectPath("javascript:alert(1)"), "/");
});

test("post-auth redirects reject browser-normalized and encoded escape variants", () => {
  assert.equal(safeAppRedirectPath("/\\\\evil.example"), "/");
  assert.equal(safeAppRedirectPath("/%5c%5cevil.example"), "/");
  assert.equal(safeAppRedirectPath("/%2f%2fevil.example"), "/");
  assert.equal(safeAppRedirectPath("/%252f%252fevil.example"), "/");
  assert.equal(safeAppRedirectPath("/%E0%A4%A"), "/");
});

test("post-auth redirects use only a safe fallback", () => {
  assert.equal(safeAppRedirectPath(null, "/onboarding"), "/onboarding");
  assert.equal(safeAppRedirectPath("https://evil.example", "//fallback.example"), "/");
});
