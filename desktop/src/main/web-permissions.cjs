const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { sameOrigin } = require('../../policy.cjs');

function createWebPermissionPolicy({ file, prompt = (parent, options) => dialog.showMessageBox(parent, options) }) {
  const sessions = new WeakMap();
  const microphones = new Set();
  const pending = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.version === 1 && Array.isArray(saved.microphones)) {
      for (const origin of saved.microphones) {
        try { if (typeof origin === 'string' && new URL(origin).origin === origin) microphones.add(origin); } catch {}
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }

  function rememberMicrophone(origin) {
    if (microphones.has(origin)) return;
    const temporary = file + '.' + randomUUID() + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, microphones: [...microphones, origin] }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
      microphones.add(origin);
    } finally { fs.rmSync(temporary, { force: true }); }
  }

  function mediaTypes(details, checking) {
    // Electron uses singular mediaType for checks, plural mediaTypes for requests.
    const types = checking ? [details.mediaType] : details.mediaTypes;
    if (!Array.isArray(types) || !types.length || types.some(type => !['audio', 'video'].includes(type))) return null;
    return [...new Set(types)].sort();
  }

  function register(contents, server, parent) {
    const session = contents.session;
    let clients = sessions.get(session);
    if (!clients) {
      clients = new Map();
      sessions.set(session, clients);
      const valid = (wc, origin, details = {}) => {
        const client = clients.get(wc);
        return client && !wc.isDestroyed() && details.isMainFrame !== false &&
          sameOrigin(origin, client.server) && sameOrigin(wc.getURL(), client.server) ? client : null;
      };
      const granted = (client, permission, types) => {
        const origin = new URL(client.server).origin;
        return permission === 'media'
          ? types && types.every(type => type === 'audio' ? microphones.has(origin) : client.grants.has('video'))
          : client.grants.has(permission);
      };
      session.setPermissionCheckHandler((wc, permission, origin, details = {}) => {
        const client = valid(wc, origin, details);
        if (!client) return false;
        if (permission === 'clipboard-sanitized-write') return true;
        if (!['media', 'notifications'].includes(permission)) return false;
        return Boolean(granted(client, permission, permission === 'media' ? mediaTypes(details, true) : null));
      });
      session.setPermissionRequestHandler(async (wc, permission, callback, details = {}) => {
        const originUrl = details.requestingUrl || wc?.getURL();
        const client = valid(wc, originUrl, details);
        if (!client || !['media', 'notifications', 'clipboard-sanitized-write'].includes(permission)) return callback(false);
        if (permission === 'clipboard-sanitized-write') return callback(true);
        const types = permission === 'media' ? mediaTypes(details, false) : null;
        if (permission === 'media' && !types) return callback(false);
        const current = () => clients.get(wc) === client && Boolean(valid(wc, originUrl, details));
        if (granted(client, permission, types)) return callback(true);
        const origin = new URL(client.server).origin;
        // Coalesce the same microphone prompt across main and assistant windows.
        const key = origin + ':' + permission + ':' + (types || []).join(',');
        try {
          let question = pending.get(key);
          if (!question) {
            question = (async () => {
              const { response } = await prompt(client.parent, {
                type: 'question', title: 'Metis',
                message: permission !== 'media' ? 'Allow notifications?' :
                  types.includes('video') ? (types.includes('audio') ? 'Allow microphone and camera access?' : 'Allow camera access?') : 'Allow microphone access?',
                detail: origin + (types?.includes('audio') ? '\nMicrophone approval is remembered for this server on this device.' : ''),
                buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0
              });
              if (response !== 1 || !current()) return false;
              if (types?.includes('audio')) rememberMicrophone(origin);
              return true;
            })();
            pending.set(key, question);
            question.finally(() => { if (pending.get(key) === question) pending.delete(key); }).catch(() => {});
          }
          const accepted = await question && current();
          if (accepted) {
            if (types?.includes('video')) client.grants.add('video');
            if (permission === 'notifications') client.grants.add(permission);
          }
          callback(Boolean(accepted));
        } catch { callback(false); }
      });
    }
    clients.set(contents, { server, parent, grants: new Set() });
    contents.once('destroyed', () => clients.delete(contents));
  }
  return { register };
}

let policy;
function registerWebPermissions(contents, server, parent) {
  policy ||= createWebPermissionPolicy({ file: path.join(app.getPath('userData'), 'web-permissions.json') });
  policy.register(contents, server, parent);
}
module.exports = { registerWebPermissions, createWebPermissionPolicy };
