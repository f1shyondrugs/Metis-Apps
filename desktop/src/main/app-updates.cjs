// Structured updater state; badges must not infer availability from human text.
function createUpdateState() {
  const value = { phase: 'idle', available: false, version: '', message: '' };
  const set = patch => Object.assign(value, patch);
  return {
    value,
    checking() { set({ phase:'checking', message:'Checking for updates…' }); },
    available(info) { set({ phase:'downloading', available:true, version:typeof info?.version==='string'?info.version:'', message:'Downloading update' }); },
    current() { set({ phase:'current', available:false, version:'', message:'Up to date' }); },
    ready(info) { set({ phase:'ready', available:true, version:typeof info?.version==='string'?info.version:value.version, message:'Update ready; restart the app to install' }); },
    error(error) { set({ phase:'error', message:error?.message || 'Update check failed' }); },
  };
}
module.exports = { createUpdateState };
