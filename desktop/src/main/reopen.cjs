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
// Medium-to-Medium launch already delivers Electron's second-instance event.
// Also acting on the legacy marker can show the old window while the native
// handler is opening a new one. The secondary still sends the marker for
// older elevated primaries.
function shouldListenForLegacyWindowActivation(platform, elevation) {
  return platform === 'win32' && elevation !== 'user';
}
module.exports = { forwardSecondInstance, claimDesktopInstance, shouldListenForLegacyWindowActivation };
