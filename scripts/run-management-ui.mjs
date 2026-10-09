// Keep all isolated suites observable even when an earlier suite fails.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  ['catalog', 'scripts/run-catalog-ui.mjs'],
  ['customers', 'scripts/run-customers-ui.mjs'],
  ['suppliers', 'scripts/run-suppliers-ui.mjs'],
  ['stock', 'scripts/run-stock-ui.mjs'],
  ['debts', 'tests/debt-plan-ui.browser.mjs'],
  ['inbox-debts', 'tests/inbox-debt-ui.browser.mjs'],
  ['sales', 'scripts/run-sales-ui.mjs'],
  ['inbox-sales', 'tests/inbox-sales-ui.browser.mjs'],
  ['employees', 'scripts/run-employees-ui.mjs'],
  ['closures', 'tests/closures-ui.browser.mjs'],
  ['expenses', 'scripts/run-expenses-ui.mjs'],
  ['purchases', 'scripts/run-purchases-ui.mjs'],
  ['inbox-expenses', 'tests/inbox-expenses-ui.browser.mjs'],
];
const results = [];
for (const [name, file] of suites) {
  console.log(`\n=== Isolated UI suite: ${name} ===`);
  const result = spawnSync(process.execPath, [join(root, file)], { cwd: root, env: process.env, stdio: 'inherit' });
  results.push({ name, passed: result.status === 0 && !result.error, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null });
}
const report = { browserExecuted: process.env.BUNDLE_ONLY !== '1', passed: results.every((result) => result.passed), suites: results };
await mkdir(join(root, '.test-artifacts'), { recursive: true });
await writeFile(join(root, '.test-artifacts', 'management-ui-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
