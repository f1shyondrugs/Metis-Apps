const fs = require('node:fs');
const path = require('node:path');
// This is a show-window signal, never a command/URL/payload transport. The
// directory is the existing OS-account-owned app profile. The elevated primary
// only watches it: it never creates, reads, follows or deletes a request file.
const REQUEST_FILE = 'show-main-window.request';
function requestWindowActivation(directory) {
  fs.writeFileSync(path.join(directory, REQUEST_FILE), 'show\n', { mode: 0o600 });
}
function listenForWindowActivation({ directory, activate, onError = () => {} }) {
  let closed = false, pending = false;
  let watcher;
  try { watcher = fs.watch(directory, (_event, filename) => {
    if (closed || pending || !filename || filename.toString().toLowerCase() !== REQUEST_FILE) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      if (!closed) Promise.resolve().then(activate).catch(onError);
    });
  });
  } catch (error) { onError(error); return { available: false, close() {} }; }
  watcher.on('error', onError);
  watcher.unref();
  return { available: true, close() { closed = true; watcher.close(); } };
}
module.exports = { REQUEST_FILE, requestWindowActivation, listenForWindowActivation };
