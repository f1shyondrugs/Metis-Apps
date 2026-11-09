const DEFAULT_SERVER = 'https://ai.f1shy312.com/';
function normalizeServer(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid server address.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete address starting with https://.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('The server requires HTTPS. HTTP is only allowed for localhost.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter a server address without credentials, query parameters or a fragment.');
  return url.href;
}
function sameOrigin(candidate, server) {
  try { return new URL(candidate).origin === new URL(server).origin; } catch { return false; }
}
function externalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
module.exports = { DEFAULT_SERVER, normalizeServer, sameOrigin, externalUrl };
