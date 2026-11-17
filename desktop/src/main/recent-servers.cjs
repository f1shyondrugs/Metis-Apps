'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DEFAULT_SERVER, normalizeServer } = require('../../policy.cjs');

const ID = /^[a-f0-9]{24}$/;
const idFor = url => createHash('sha256').update(url).digest('hex').slice(0, 24);
const labelFor = value => { const url = new URL(value); return url.host + (url.pathname === '/' ? '' : url.pathname); };

function canonicalOrNull(value) {
  try { return normalizeServer(value); } catch { return null; }
}

function createRecentServers({ configPath, initialServer } = {}) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  const legacy = canonicalOrNull(saved?.url);
  const initial = canonicalOrNull(initialServer);
  let current = legacy || initial || DEFAULT_SERVER;
  let history = [];
  const seed = legacy || initial;
  const candidates = [seed, ...(Array.isArray(saved?.recentServers) ? saved.recentServers : [])];
  for (const candidate of candidates) {
    const url = canonicalOrNull(candidate);
    if (url && !history.includes(url)) history.push(url);
    if (history.length === 10) break;
  }

  return {
    getCurrent: () => current,
    list: () => history.map(url => ({ id: idFor(url), url, label: labelFor(url) })),
    resolve(id) {
      if (typeof id !== 'string' || !ID.test(id)) return null;
      return history.find(url => idFor(url) === id) || null;
    },
    select(value) {
      const next = normalizeServer(value);
      const recentServers = [next, ...history.filter(url => url !== next)].slice(0, 10);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      // Same-directory rename is atomic; unique names isolate concurrent writers.
      const temporary = configPath + '.' + randomUUID() + '.tmp';
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ url: next, recentServers }, null, 2) + '\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, configPath);
      } catch (error) {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
      }
      current = next;
      history = recentServers;
      return next;
    }
  };
}

function serverArgument(argv) {
  if (!Array.isArray(argv)) return null;
  const candidates = argv.filter(arg => typeof arg === 'string' &&
    (arg === '--metis-server' || arg.startsWith('--metis-server=')));
  if (candidates.length !== 1) return null;
  const match = /^--metis-server=([a-f0-9]{24})$/.exec(candidates[0]);
  return match ? match[1] : null;
}

// Windows CRT/CommandLineToArgvW quoting, not cmd.exe shell escaping.
// Always quote: double backslashes before quotes and before the closing quote.
function quoteWindows(value) {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) throw new TypeError('Invalid launch argument.');
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

function buildJumpList({ entries, removedItems = [], execPath, appPath, packaged }) {
  if (typeof execPath !== 'string' || !execPath || /[\0\r\n]/.test(execPath)) {
    throw new TypeError('Invalid executable path.');
  }
  const prefix = packaged ? '' : quoteWindows(appPath) + ' ';
  const items = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const url = canonicalOrNull(entry?.url);
    if (!url || entry.id !== idFor(url) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const title = labelFor(url);
    const args = prefix + '--metis-server=' + entry.id;
    if (removedItems.some(item => item && item.args === args && item.title === title)) continue;
    items.push({
      type: 'task', title, description: 'Open Metis on ' + title,
      program: execPath, args, iconPath: execPath, iconIndex: 0
    });
    if (items.length === 10) break;
  }
  return items.length ? [{ type: 'custom', name: 'Recent Servers', items }] : [];
}

module.exports = { createRecentServers, serverArgument, buildJumpList };
