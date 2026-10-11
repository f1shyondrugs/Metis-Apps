const DEFAULT_SERVER = 'https://ai.f1shy312.com/';
function normalizeServer(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Bitte eine gültige Serveradresse eingeben.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Bitte eine vollständige Adresse mit https:// eingeben.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Der Server benötigt HTTPS. HTTP ist nur für localhost erlaubt.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Bitte eine Serveradresse ohne Zugangsdaten, Suchparameter oder Fragment eingeben.');
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
