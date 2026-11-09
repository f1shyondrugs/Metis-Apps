// Runs only as an Electron utility process. Pairing data arrives over private IPC.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let runtime;
let capabilities = {};
let sequence = 0;
const pending = new Map();
function request(type, value) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Desktop app did not acknowledge ' + type)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    process.parentPort.postMessage({ type, id, value });
  });
}
process.parentPort.on('message', async ({ data }) => {
  try {
    if (data.type === 'reply') {
      const item = pending.get(data.id);
      if (item) { pending.delete(data.id); clearTimeout(item.timer); data.error ? item.reject(Error(data.error)) : item.resolve(data.value); }
    } else if (data.type === 'capabilities') capabilities = data.value;
    else if (data.type === 'cancel') runtime?.cancelComputerUse();
    else if (data.type === 'start' && !runtime) {
      capabilities = data.capabilities;
      const { startRemoteClient } = await import(pathToFileURL(path.join(__dirname, '../../client.mjs')).href);
      runtime = startRemoteClient({
        config: data.config, configPath: data.configPath,
        desktopGuiAvailable: () => capabilities.desktopAvailable === true,
        nativeNotificationsAvailable: () => capabilities.nativeNotifications === true,
        showNotification: value => request('notification', value),
        onEvent: value => value.type === 'computer_use'
          ? request('event', value)
          : process.parentPort.postMessage({ type: 'event', value })
      });
    }
  } catch (error) {
    process.parentPort.postMessage({ type: 'event', value: { type: 'connection', status: 'error', error: error.message } });
  }
});
