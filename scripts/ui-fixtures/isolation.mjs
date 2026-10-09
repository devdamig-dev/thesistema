// Safety assertions for isolated component fixtures, never real application services.
import assert from 'node:assert/strict';

export function assertFixtureBundle(bundle) {
  const unsafe = Object.keys(bundle.metafile.inputs).filter((input) =>
    !input.startsWith('qa:') && /(?:^|\/)app\/actions\/|(?:^|\/)lib\/supabase\/|@supabase\//.test(input));
  assert.deepEqual(unsafe, [], 'A production action or Supabase module escaped fixture isolation');
}

export async function isolateFixturePage(page, origin, assets) {
  const allowed = new Set([...assets, '/favicon.ico']);
  const blocked = [];
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && request.method() === 'GET' && allowed.has(url.pathname)) {
      await route.continue();
    } else {
      blocked.push(request.url());
      await route.abort('blockedbyclient');
    }
  });
  return () => assert.deepEqual(blocked, [], 'Attempted network access outside fixture assets');
}

export async function ensureInter(page) {
  await page.evaluate(async () => {
    await document.fonts.load('14px Inter', 'Composición Clientes Cronograma');
    await document.fonts.ready;
    if (![...document.fonts].some((font) => font.family === 'Inter' && font.status === 'loaded')) {
      throw new Error('Build Inter font did not load');
    }
    if (!/^["']?Inter\b/.test(getComputedStyle(document.body).fontFamily)) {
      throw new Error('Fixture body did not use Inter');
    }
  });
}

export const fixtureCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
