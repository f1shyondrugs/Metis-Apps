const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyMetisServer } = require('../src/main/server-verification.cjs');
const fakeRelease = () => Response.json({ release: { schemaVersion: 1, version: '1.0.29', packageVersion: '1.0.29', channel: 'development', isRelease: false, builtAt: '2026-11-18T00:00:00Z' } });

test('successful proof uses the configured base path, with no credentials even on redirect', async () => {
  const seen = [];
  await verifyMetisServer('https://metis.example/workspace', { verifyPage: true, fetch: async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    seen.push(url);
    if (url.endsWith('/api/system/version')) return fakeRelease();
    if (url.endsWith('/workspace')) return new Response(null, { status: 302, headers: { location: '/workspace/' } });
    return new Response('<html>Workspace</html>', { headers: { 'Content-Type': 'text/html' } });
  }});
  assert.deepEqual(seen, ['https://metis.example/workspace/api/system/version', 'https://metis.example/workspace', 'https://metis.example/workspace/']);
});

test('generic HTML, incomplete JSON, non-success and oversized manifest all fail closed', async () => {
  for (const fixture of [
    () => new Response('<html>Cloudflare</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ release: { schemaVersion: 1, version: '1.0.0' } }),
    () => new Response(null, { status: 503 }),
    () => Response.json({ value: ' '.repeat(17000) }),
  ]) {
    await assert.rejects(verifyMetisServer('https://metis.example/', { fetch: async () => fixture() }));
  }
});

test('legacy history rejects a blocked workspace even if the version endpoint works', async () => {
  await assert.rejects(verifyMetisServer('https://metis.example/', { verifyPage: true, fetch: async url =>
    url.includes('/api/') ? fakeRelease() : new Response('Cloudflare Error', { status: 502, headers: { 'Content-Type': 'text/html' } })
  }), /workspace did not load/);
});

test('foreign redirects are never followed', async () => {
  let calls = 0;
  await assert.rejects(verifyMetisServer('https://metis.example/', { fetch: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://foreign.example/api/system/version' } });
  }}), /redirected away/);
  assert.equal(calls, 1);
});
