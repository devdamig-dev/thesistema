// Shared local-only harness. Imported by the three management UI scripts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareFixtureFont } from '../prepare-fixture-font.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const fixturePath = (name) => path.join(root, 'scripts/ui-fixtures', name);
export const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
export { assert };

export async function noOverflow(page) {
  // Scrollable tables may be wider internally. The page and open editor may not.
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    editors: [...document.querySelectorAll('aside, dialog[open]')].map((element) => ({
      client: element.clientWidth, scroll: element.scrollWidth,
    })),
  }));
  assert.ok(result.document <= result.viewport + 1, `Page overflow: ${JSON.stringify(result)}`);
  assert.ok(result.body <= result.viewport + 1, `Body overflow: ${JSON.stringify(result)}`);
  assert.ok(result.editors.every((editor) => editor.scroll <= editor.client + 1), `Editor overflow: ${JSON.stringify(result)}`);
}

export async function editorReady(page, selector = 'aside') {
  await page.locator(selector).waitFor({ state: 'visible' });
  // Framer Motion animates with JS. Wait for its actual geometry, not a fixed sleep.
  await page.waitForFunction((query) => {
    const element = document.querySelector(query);
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1;
  }, selector);
  return page.locator(selector);
}

export async function clickTwice(button) {
  // Same-tick activation deliberately exercises synchronous duplicate guards.
  await button.evaluate((element) => { element.click(); element.click(); });
}

export async function releaseWrites(page) {
  await page.evaluate(() => { window.qa.holdWrites = false; window.qa.releaseWrites(); });
}

export async function runUiHarness({ name, entry, actionModules, run }) {
  const out = path.join(root, '.test-artifacts', `${name}-ui`);
  // A new run cannot accidentally reuse an old pass report or old screenshots.
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await prepareFixtureFont(root, out);
  // Never read .env files; these fixtures require no credentials or live services.
  execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'),
    '-i', 'app/globals.css', '-o', path.join(out, 'style.css'), '--minify'], { cwd: root, stdio: 'inherit' });
  const bundle = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: root },
    outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    nodePaths: [path.join(root, 'node_modules')], tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NEXT_PUBLIC_APP_MODE': '"database"', 'process.env.NODE_ENV': '"development"' },
    metafile: true,
    plugins: [{
      name: 'isolated-management-actions',
      setup(builder) {
        builder.onResolve({ filter: /^@\/app\/actions\// }, ({ path: specifier }) => {
          const fixture = actionModules[specifier];
          if (!fixture) throw new Error(`Unmocked server action import: ${specifier}`);
          return { path: fixture };
        });
        builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'qa-link' }));
        builder.onLoad({ filter: /.*/, namespace: 'qa-link' }, () => ({
          contents: "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}",
          loader: 'jsx', resolveDir: root,
        }));
      },
    }],
  });
  const bundledInputs = Object.keys(bundle.metafile.inputs);
  const unsafe = bundledInputs.filter((input) => /(?:^|\/)app\/actions\/|(?:^|\/)lib\/supabase\/|@supabase\//.test(input));
  assert.deepEqual(unsafe, [], 'A production action or Supabase module escaped fixture isolation');
  await fs.writeFile(path.join(out, 'bundle-metafile.json'), JSON.stringify(bundle.metafile, null, 2));
  await fs.writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA ${name}: fixtures ficticios</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/font.css"></head><body class="font-sans"><main id="root" class="p-4"></main><script src="/app.js"></script></body></html>`);
  const bundleResult = { name, stage: 'bundle-only', browserExecuted: false, fixturesOnly: true, artifactDirectory: out, bundledInputs: bundledInputs.length };
  await fs.writeFile(path.join(out, 'bundle-result.json'), JSON.stringify(bundleResult, null, 2));
  if (process.env.BUNDLE_ONLY === '1') {
    console.log(JSON.stringify(bundleResult));
    return; // Must remain before server creation, listen(), or browser import/launch.
  }

  const fixtureAssets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/font.css': ['font.css', 'text/css'] };
  for (const file of await fs.readdir(path.join(out, 'fonts'))) {
    if (/^[A-Za-z0-9_.-]+\.woff2$/.test(file)) fixtureAssets[`/fonts/${file}`] = [`fonts/${file}`, 'font/woff2'];
  }
  const fixtureAsset = (pathname) => Object.hasOwn(fixtureAssets, pathname) ? fixtureAssets[pathname] : null;
  let server;
  let browser;
  let context;
  const checks = [];
  const pageErrors = [];
  const blockedRequests = [];
  let failed = null;
  try {
    server = http.createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      const file = fixtureAsset(pathname);
      if (request.method !== 'GET' || !file) { response.writeHead(404).end(); return; }
      try {
        response.setHeader('Content-Type', `${file[1]}; charset=utf-8`);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
        response.end(await fs.readFile(path.join(out, file[0])));
      } catch { response.writeHead(500).end(); }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = await import('playwright');
    // Use Playwright's configured bundled browser. Never a machine-specific path.
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && (fixtureAsset(url.pathname) !== null || url.pathname === '/favicon.ico') && route.request().method() === 'GET') {
        await route.continue();
      } else {
        blockedRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const checkErrors = () => {
      assert.deepEqual(pageErrors, [], 'Unexpected browser pageerror');
      assert.deepEqual(blockedRequests, [], 'Attempted network access outside fixture assets');
    };
    const ensureFixtureFont = async () => {
      await page.evaluate(async () => {
        await document.fonts.load('14px Inter', 'Clientes Contactos Composición');
        await document.fonts.ready;
        if (![...document.fonts].some((font) => font.family === 'Inter' && font.status === 'loaded')) throw new Error('Build Inter font did not load');
        if (!/^["']?Inter\b/.test(getComputedStyle(document.body).fontFamily)) throw new Error('Fixture body did not use Inter');
      });
    };
    const check = async (label, task) => {
      await ensureFixtureFont();
      await task(); checkErrors(); checks.push(label); console.log(`PASS ${name}: ${label}`);
    };
    const screenshot = async (label) => {
      await ensureFixtureFont();
      await noOverflow(page);
      await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true, animations: 'disabled' });
      checkErrors();
    };
    await run({ page, origin, check, screenshot });
    checkErrors();
  } catch (error) {
    failed = error instanceof Error ? error.stack : String(error);
    if (context?.pages()[0]) {
      await context.pages()[0].screenshot({ path: path.join(out, 'failure.png'), fullPage: true, animations: 'disabled', timeout: 3000 }).catch(() => {});
    }
    throw error;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (server) await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    const report = { name, stage: 'browser', passed: failed === null, checks, pageErrors, blockedRequests, error: failed };
    await fs.writeFile(path.join(out, 'browser-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
