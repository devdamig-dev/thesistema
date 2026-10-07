import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("runtime dependencies stay on the patched Next and React lines", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.equal(pkg.dependencies.next, "16.4.0");
  assert.equal(pkg.dependencies.react, "19.3.0");
  assert.equal(pkg.dependencies["react-dom"], "19.3.0");
});

test("Next request APIs and the Supabase server client remain asynchronous", () => {
  const serverClient = readFileSync(join(root, "lib/supabase/server.ts"), "utf8");
  assert.match(serverClient, /export async function createSupabaseServerClient/);
  assert.match(serverClient, /await cookies\(\)/);

  const offenders = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))]
    .filter((path) => !path.endsWith("lib/supabase/server.ts"))
    .flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, index) => ({ path, line, index: index + 1 }))
        .filter(({ line }) =>
          line.includes("createSupabaseServerClient()") &&
          !line.includes("await createSupabaseServerClient()"),
        ),
    );

  assert.deepEqual(offenders, []);
});

test("the authorization boundary uses the Next proxy convention", () => {
  assert.equal(existsSync(join(root, "middleware.ts")), false);
  const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
  assert.match(proxy, /export async function proxy\(/);
  assert.match(proxy, /export const config\s*=/);
});
