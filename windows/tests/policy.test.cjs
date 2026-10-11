const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServer, sameOrigin, externalUrl, DEFAULT_SERVER } = require('../policy.cjs');
test('public and custom HTTPS servers, local development', () => {
  assert.equal(normalizeServer(DEFAULT_SERVER), DEFAULT_SERVER);
  assert.equal(normalizeServer(' https://example.com '), 'https://example.com/');
  assert.equal(normalizeServer('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(normalizeServer('http://[::1]:3000'), 'http://[::1]:3000/');
});
test('reject malformed, insecure and credential-bearing server addresses', () => {
  for (const input of [null, {}, 'example.com', 'javascript:alert(1)', 'file:///tmp/a', 'http://example.com', 'https://user:pass@example.com', 'https://example.com?token=a', 'https://example.com#x']) assert.throws(() => normalizeServer(input));
});
test('navigation must match the exact origin', () => {
  assert.equal(sameOrigin('https://example.com/chat/1', 'https://example.com/'), true);
  for (const url of ['https://example.com.evil.test', 'http://example.com', 'https://example.com:8443', 'file:///tmp/a', 'invalid']) assert.equal(sameOrigin(url, 'https://example.com/'), false);
});
test('external links cannot execute local code or OS protocols', () => {
  for (const url of ['https://example.com', 'mailto:hi@example.com']) assert.equal(externalUrl(url), true);
  for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'powershell:run', 'https://user:pass@example.com', 'invalid']) assert.equal(externalUrl(url), false);
});
