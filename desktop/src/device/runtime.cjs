const path = require('node:path');
function startDeviceHost({ utilityProcess, config, configPath, capabilities, onEvent, showNotification, receiveNotification, presentationOwned = false }) {
  let child;
  let stopped = false;
  let restart;
  let failures = 0;
  function start() {
    if (stopped) return;
    const current = utilityProcess.fork(path.join(__dirname, 'runtime-host.cjs'), [], { serviceName: 'Metis Device Connection', stdio: 'ignore' });
    child = current;
    current.on('spawn', () => {
      if (stopped || child !== current) return;
      current.postMessage({ type: 'start', config, configPath, capabilities, presentationOwned });
    });
    current.on('message', async message => {
      if (stopped || child !== current) return;
      try {
        let value;
        if (message.type === 'event') {
          if (message.value.type === 'connection' && message.value.status === 'online') failures = 0;
          value = await onEvent(message.value);
        } else if (message.type === 'notification') value = await showNotification(message.value);
        else if (message.type === 'notification-message' && presentationOwned) value = await receiveNotification(message.value);
        if (message.id && !stopped && child === current) current.postMessage({ type: 'reply', id: message.id, value });
      } catch (error) {
        if (message.id && !stopped && child === current) current.postMessage({ type: 'reply', id: message.id, error: error.message });
      }
    });
    current.on('exit', () => {
      if (stopped || child !== current) return;
      child = undefined;
      onEvent({ type: 'connection', status: 'error', error: 'Device connection process stopped.' });
      if (++failures <= 3) restart = setTimeout(start, 1000 * failures);
    });
  }
  start();
  return {
    get pid() { return child?.pid; },
    setCapabilities(value) { capabilities = value; child?.postMessage({ type: 'capabilities', value }); },
    cancelComputerUse() { child?.postMessage({ type: 'cancel' }); },
    stop() { stopped = true; clearTimeout(restart); child?.kill(); child = undefined; }
  };
}
module.exports = { startDeviceHost };
