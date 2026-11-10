const { dialog } = require('electron');
const { sameOrigin } = require('../../policy.cjs');
const sessions = new WeakMap();

// One session policy for the main page and the assistant. Never replace one
// window's permission handler with another window's handler.
function registerWebPermissions(contents, server, parent) {
  const session = contents.session;
  let clients = sessions.get(session);
  if (!clients) {
    clients = new Map(); sessions.set(session, clients);
    const key = (permission, details) => permission + ':' + (details.mediaTypes || []).join(',');
    session.setPermissionCheckHandler((wc, permission, origin, details) => {
      const client = clients.get(wc);
      return Boolean(client && sameOrigin(origin, client.server) && sameOrigin(wc.getURL(), client.server) && client.grants.has(key(permission, details)));
    });
    session.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      const client = clients.get(wc);
      if (!client || !sameOrigin(wc.getURL(), client.server) ||
          !sameOrigin(details.requestingUrl || wc.getURL(), client.server) ||
          !['media', 'notifications', 'clipboard-sanitized-write'].includes(permission)) return callback(false);
      if (permission === 'clipboard-sanitized-write') return callback(true);
      try {
        const { response } = await dialog.showMessageBox(client.parent, {
          type: 'question', title: 'Metis',
          message: permission === 'media' ? 'Allow microphone or camera access?' : 'Allow notifications?',
          detail: client.server, buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0
        });
        const accepted = response === 1 && clients.get(wc) === client && !wc.isDestroyed() && sameOrigin(wc.getURL(), client.server);
        if (accepted) client.grants.add(key(permission, details));
        callback(accepted);
      } catch { callback(false); }
    });
  }
  clients.set(contents, { server, parent, grants: new Set() });
  contents.once('destroyed', () => clients.delete(contents));
}
module.exports = { registerWebPermissions };
