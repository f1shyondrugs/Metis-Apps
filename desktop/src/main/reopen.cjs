// Windows cannot deliver Electron's activation message from a medium-integrity
// shortcut process to an already elevated instance. Re-enter at that instance's
// configured integrity level; only the fixed, installed executable is launched.
async function forwardSecondInstance({ platform, ready, permissionMode, isElevated, elevate, reportError, quit }) {
  try {
    if (platform !== 'win32') return;
    await ready();
    if (await isElevated()) return; // The elevated handoff must never recurse.
    if (permissionMode() !== 'admin') return; // User-mode devices never elevate.
    await elevate();
  } catch (error) {
    reportError(error);
  } finally {
    quit();
  }
}
module.exports = { forwardSecondInstance };
