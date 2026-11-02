// GET-only checks of public production pages. No auth, cookies, POST or customer data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const targets = [
  {
    "name": "GastroPilot inicio",
    "url": "https://gastropilot.nexodg.com/",
    "kind": "html"
  },
  {
    "name": "GastroPilot acceso",
    "url": "https://gastropilot.nexodg.com/login",
    "kind": "html"
  }
];
const allowedHosts = new Set(["gastropilot.nexodg.com"]);

for (const target of targets) {
  test(target.name + ' is publicly reachable in production', async () => {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': target.kind === 'css' ? 'text/css' : 'text/html' },
    });
    const final = new URL(response.url);
    assert.equal(final.protocol, 'https:', 'Must remain HTTPS');
    assert.ok(allowedHosts.has(final.hostname), 'Unexpected redirect host: ' + final.hostname);
    assert.equal(response.status, 200, target.name + ' HTTP ' + response.status + ' at ' + final.origin + final.pathname);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    assert.ok(contentType.includes(target.kind === 'css' ? 'text/css' : 'text/html'),
      target.name + ' unexpected content-type: ' + contentType);
    const body = await response.text();
    assert.ok(body.length > (target.kind === 'css' ? 20 : 150), target.name + ' response unexpectedly empty');
    if (target.kind === 'html') {
      assert.ok(/<(?:html|!doctype html)[\s>]/i.test(body), 'Missing HTML document');
      assert.ok(!/Authentication Required.{0,300}Vercel/i.test(body), 'Vercel SSO page instead of app');
    }
    console.log(target.name + ': HTTP 200; type=' + contentType.split(';')[0] + '; host=' + final.hostname);
  });
}
