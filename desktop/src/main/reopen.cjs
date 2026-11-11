// A normal shortcut must not launch another administrator process just to show
// an already running window. The primary handles the fixed activation signal.
async function forwardSecondInstance({ platform, ready, isElevated, requestActivation, reportError, quit }) {
  try {
    if (platform !== 'win32') return;
    await ready();
    if (await isElevated()) return; // Same-integrity native activation already works.
    await requestActivation();
  } catch (error) {
    reportError(error);
  } finally {
    quit();
  }
}
module.exports = { forwardSecondInstance };
