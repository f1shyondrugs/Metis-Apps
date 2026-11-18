'use strict';
const { normalizeServer, sameOrigin } = require('../../policy.cjs');

const maxManifestBytes = 16 * 1024;
const version = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$/;

function isMetisRelease(value) {
  const release = value?.release;
  return release?.schemaVersion === 1 && typeof release.version === 'string' &&
    version.test(release.version) && typeof release.packageVersion === 'string' &&
    version.test(release.packageVersion) &&
    ['stable', 'prerelease', 'development'].includes(release.channel) &&
    typeof release.isRelease === 'boolean' && typeof release.builtAt === 'string' &&
    Number.isFinite(Date.parse(release.builtAt));
}

async function verifyMetisServer(value, { fetch = globalThis.fetch, signal, verifyPage = false } = {}) {
  const server = normalizeServer(value);
  const base = new URL(server);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const timeout = AbortSignal.timeout(8000);
  const options = {
    credentials: 'omit', redirect: 'manual', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  };
  async function get(url, accept) {
    for (let count = 0; count < 5; count++) {
      const response = await fetch(url, { ...options, headers: { Accept: accept } });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      await response.body?.cancel();
      const location = response.headers.get('location');
      const destination = location ? new URL(location, url) : null;
      if (!destination || !sameOrigin(destination.href, server) || destination.username || destination.password) break;
      url = destination.href;
    }
    throw new Error('The server redirected away from its Metis address.');
  }
  const response = await get(new URL('api/system/version', base).href, 'application/json');
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
    await response.body?.cancel();
    throw new Error('This address did not return a Metis server response.');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > maxManifestBytes) throw new Error('The server response was too large.');
      chunks.push(chunk);
    }
    if (!isMetisRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')))) {
      throw new Error('This address did not identify a Metis installation.');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (verifyPage) {
    const page = await get(server, 'text/html');
    await page.body?.cancel();
    if (!page.ok || !/^text\/html(?:\s*;|$)/i.test(page.headers.get('content-type') || '')) {
      throw new Error('The Metis workspace did not load successfully.');
    }
  }
}

module.exports = { verifyMetisServer };
