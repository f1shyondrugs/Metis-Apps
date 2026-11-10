// Real Electron + device protocol, isolated files and a local fixture only.
const { app, safeStorage } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-unified-test-'));
process.env.METIS_DESKTOP_TEST_DATA = directory;
const timeout = setTimeout(() => { console.error('UNIFIED_TIMEOUT'); app.exit(1); }, 60000);
const waitFor = async predicate => {
  const end = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Unified state transition timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function main() {
  await app.whenReady();
  app.setName('Metis AI Remote Client');
  app.setVersion(require('../package.json').version);
  const fixture = http.createServer((request, response) => {
    if (request.url === '/api/remote-clients/hub') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ client: { name: 'Fixture device' }, audit: [] }));
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>Metis fixture</title><h1>Metis fixture</h1>');
    }
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const server = 'http://127.0.0.1:' + fixture.address().port;
  const wss = new WebSocketServer({ server: fixture });
  let socket, authentications = 0;
  const responses = new Map();
  wss.on('connection', ws => {
    socket = ws;
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'auth') {
        assert.equal(message.clientId, 'fixture-device');
        assert.equal(message.credential, 'fixture-only-credential');
        authentications++;
        ws.send(JSON.stringify({ type: 'authenticated', clientId: message.clientId }));
      }
      if (message.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
      if (message.type === 'response') responses.set(message.requestId, message);
    });
  });
  const configFile = path.join(directory, 'config.json');
  const { createCredentialStore } = require('../credential-store.cjs');
  let permissionMode = 'user';
  if (process.platform === 'win32') {
    const { execFileSync } = require('node:child_process');
    const elevated = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { encoding: 'utf8', windowsHide: true }).trim();
    permissionMode = elevated === 'True' ? 'admin' : 'user';
  }
  createCredentialStore({ file: configFile, safeStorage }).save({
    server, clientId: 'fixture-device', credential: 'fixture-only-credential', permissionMode
  });
  const original = fs.readFileSync(configFile);
  fs.writeFileSync(path.join(directory, 'server.json'), JSON.stringify({ url: server }));
  const api = require('../main.cjs');
  try { await waitFor(() => api.getDesktop()?.getState().mode === 'ready' && api.publicState().connection === 'online'); }
  catch (error) { console.error({ desktop: api.getDesktop()?.getState(), device: api.publicState() }); throw error; }
  assert.equal(api.publicState().clientId, 'fixture-device');
  assert.deepEqual(fs.readFileSync(configFile), original);
  assert.ok(api.getRuntimePid() > 0 && api.getRuntimePid() !== process.pid);
  console.log('SEPARATE_DEVICE_PROCESS_OK');
  console.log('PAIRING_IDENTITY_PRESERVED_OK');
  const desktop = api.getDesktop();
  const remote = desktop.getView().webContents;
  assert.deepEqual(await remote.executeJavaScript('[typeof require, typeof process, typeof metis, typeof metisDesktop]'),
    ['undefined', 'undefined', 'undefined', 'undefined']);
  await remote.executeJavaScript('metisApp.openDeviceSettings()');
  const hub = api.getDeviceWindow();
  assert.equal(hub.isVisible(), true);
  console.log('WEB_SETTINGS_OPENS_LOCAL_DEVICE_HUB_OK');
  await waitFor(() => !hub.webContents.isLoading());
  const state = await hub.webContents.executeJavaScript('metis.state()');
  assert.equal(state.paired, true); assert.equal(state.credential, undefined);
  console.log('SEPARATE_RENDERERS_AND_IPC_OK');
  async function command(id) {
    socket.send(JSON.stringify({ type: 'request', requestId: id, action: 'get_info', params: {} }));
    await waitFor(() => responses.has(id));
    assert.equal(responses.get(id).ok, true);
  }
  await command('before-reload');
  remote.reload();
  await waitFor(() => !remote.isLoading());
  await command('after-reload');
  desktop.win.close(); hub.close();
  assert.equal(desktop.win.isVisible(), false);
  assert.equal(hub.isVisible(), false);
  await command('windows-hidden');
  assert.equal(authentications, 1);
  await api.showDesktop();
  assert.equal(desktop.win.isVisible(), true);
  console.log('BACKGROUND_CONNECTION_SURVIVES_RELOAD_AND_CLOSE_OK');
  if (process.platform === 'darwin') {
    const { utilityProcess } = require('electron');
    const { startDeviceHost } = require('../src/device/runtime.cjs');
    let nativeOnline = false;
    const native = startDeviceHost({ utilityProcess,
      config: { server, clientId: 'fixture-device', credential: 'fixture-only-credential', permissionMode }, configPath: configFile,
      capabilities: { desktopAvailable: true, nativeNotifications: false },
      onEvent: event => { if (event.type === 'connection' && event.status === 'online') nativeOnline = true; }, showNotification: () => false });
    try {
      await waitFor(() => nativeOnline);
      socket.send(JSON.stringify({ type: 'request', requestId: 'native-status', action: 'computer_use', params: { operation: 'status' } }));
      await waitFor(() => responses.has('native-status'));
      assert.equal(responses.get('native-status').ok, true);
      assert.equal(typeof responses.get('native-status').result.available, 'boolean');
      console.log('MAC_NATIVE_DEVICE_PROCESS_OK');
    } finally { native.stop(); }
  }
  const output = path.join(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'unified-fixture.png'), (await remote.capturePage()).toPNG());
  console.log('UNIFIED_OK');
  app.quit();
}
main().then(() => { clearTimeout(timeout); setTimeout(() => app.exit(0), 200); })
  .catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
