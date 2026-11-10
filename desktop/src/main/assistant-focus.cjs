// Restore only the foreground window that Metis itself displaced.
function createForegroundRestore() {
  if (process.platform !== 'win32') return { remember() {}, restore() {} };
  const koffi = require('koffi'), user32 = koffi.load('user32.dll');
  const get = user32.func('void *GetForegroundWindow()');
  const set = user32.func('bool SetForegroundWindow(void *)');
  const valid = user32.func('bool IsWindow(void *)');
  let previous;
  return {
    remember() { previous = get(); },
    restore() { if (previous && valid(previous)) set(previous); previous = null; },
  };
}
module.exports = { createForegroundRestore };
