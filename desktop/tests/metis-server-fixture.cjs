function replyMetisVersion(request, response) {
  if (!request.url.endsWith('/api/system/version')) return false;
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({
    release: { schemaVersion: 1, version: '1.0.0', packageVersion: '1.0.0', channel: 'development',
      isRelease: false, builtAt: '2026-01-01T00:00:00.000Z', commit: null, tag: null }
  }));
  return true;
}
module.exports = { replyMetisVersion };
