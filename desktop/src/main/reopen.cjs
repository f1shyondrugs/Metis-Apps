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
// Claim before Electron readiness, GPU startup or updater initialization. The
// short secondary has no window, remote runtime or lifecycle hooks to drain.
function claimDesktopInstance({app,platform,readElevation,requestActivation,onError=()=>{}}) {
  if(app.requestSingleInstanceLock())return true;
  try{
    // Native activation is already sent. Keep the old Medium->High filename
    // signal for an older primary, but NEVER let a High/unknown caller write it.
    if(platform==='win32'&&readElevation()==='user')requestActivation();
  }catch(error){onError(error);}
  finally{app.exit(0);}
  return false;
}
// One launcher may cause both Electron's native event and a legacy show-only
// marker. Do not reveal the old window while the new window is being built.
// A standalone marker after the native handoff must still work.
function createWindowActivationArbiter() {
  let nativePending = 0;
  return {
    async openNative(open) {
      nativePending++;
      try { return await open(); } finally { nativePending--; }
    },
    async showLegacy(show) {
      if (nativePending) return false;
      // Give an already queued native notification precedence.
      await new Promise(resolve => setImmediate(resolve));
      if (nativePending) return false;
      await show();
      return true;
    },
  };
}
module.exports = { forwardSecondInstance, claimDesktopInstance, createWindowActivationArbiter };
