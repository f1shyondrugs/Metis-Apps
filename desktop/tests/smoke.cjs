// Run inside Electron against an isolated local fixture; never uses a real account.
const { app } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { createDesktop } = require('../src/main/web-window.cjs');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-apps-test-'));
app.setPath('userData', testData);
app.setName('Metis AI Test');
app.setAppUserModelId('ai.metis.smoke.test');
const timeout = setTimeout(() => { console.error('SMOKE_TIMEOUT'); app.exit(1); }, 60000);
async function waitFor(predicate) {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('State transition timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function main() {
  await app.whenReady();
  const fixture = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'metis_fixture=session; Max-Age=3600; SameSite=Lax' });
    response.end(_request.url === '/frame' ? '<!doctype html><p>Frame</p>' : '<!doctype html><title>Metis fixture</title><h1 id="app">Metis test server</h1><iframe id="child" src="/frame"></iframe>');
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const url = 'http://127.0.0.1:' + fixture.address().port + '/';
  fs.writeFileSync(path.join(testData, 'server.json'), JSON.stringify({ url }));
  let openedDevices = 0;
  let hidden=true,startup=false,checks=0;
  let desktop = await createDesktop({ onDevices: () => { openedDevices++; }, onCaptureHidden:value=>(hidden=value),onAutostart:value=>(startup=value),onCheckUpdates:()=>{checks++;return 'Fixture update check';} });
  await desktop.initialLoad;
  assert.equal(desktop.getState().mode, 'ready');
  let wc = desktop.getView().webContents;
  assert.equal(await wc.executeJavaScript('document.getElementById("app").textContent'), 'Metis test server');
  assert.deepEqual(await wc.executeJavaScript('[typeof require, typeof process, typeof metisDesktop]'), ['undefined', 'undefined', 'undefined']);
  console.log('REMOTE_RENDER_AND_ISOLATION_OK');
  assert.deepEqual(await wc.executeJavaScript('Object.keys(metisApp).sort()'), ['openDeviceSettings','deviceState','setShortcuts','setShortcutCapture','openAssistant','setOverlayCaptureHidden','setAutostart','checkUpdates','onFilesDropped'].sort());
  assert.equal(await wc.executeJavaScript('typeof document.getElementById("child").contentWindow.metisApp'), 'undefined');
  await wc.executeJavaScript('metisApp.openDeviceSettings()');
  assert.equal(openedDevices, 1);
  await wc.executeJavaScript('metisApp.setOverlayCaptureHidden(false)');assert.equal(hidden,false);
  await wc.executeJavaScript('metisApp.setAutostart(true)');assert.equal(startup,true);
  await wc.executeJavaScript('metisApp.checkUpdates()');assert.equal(checks,1);
  await assert.rejects(wc.executeJavaScript('metisApp.setAutostart(1)'),/Invalid startup/);
  const foreign = http.createServer((_request, response) => response.end('<!doctype html><title>Other origin</title>'));
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening');
  await wc.loadURL('http://127.0.0.1:' + foreign.address().port + '/');
  await assert.rejects(wc.executeJavaScript('metisApp.openDeviceSettings()'), /Access denied/);
  for(const expression of ['metisApp.setAutostart(false)','metisApp.setOverlayCaptureHidden(true)','metisApp.checkUpdates()'])await assert.rejects(wc.executeJavaScript(expression),/Access denied/);
  assert.equal(hidden,false);assert.equal(startup,true);assert.equal(checks,1);
  assert.equal(openedDevices, 1);
  foreign.close(); await once(foreign, 'close');
  await desktop.load();
  console.log('WEB_DEVICE_SETTINGS_BRIDGE_AND_ORIGIN_GUARD_OK');
  desktop.win.setSize(900, 650);
  await new Promise(resolve => setTimeout(resolve, 100));
  const [width, height] = desktop.win.getContentSize();
  assert.deepEqual(desktop.getView().getBounds(), { x: 0, y: 0, width, height });
  console.log('RESIZE_OK');
  desktop.settings();
  await waitFor(() => desktop.getState().mode === 'settings');
  const local = desktop.win.webContents;
  const invalid = await local.executeJavaScript('metisDesktop.connect("file:///tmp/invalid")');
  assert.equal(invalid.ok, false);
  const valid = await local.executeJavaScript('metisDesktop.connect(' + JSON.stringify(url) + ')');
  assert.equal(valid.ok, true);
  await waitFor(() => desktop.getState().mode === 'ready');
  assert.equal(JSON.parse(fs.readFileSync(path.join(testData, 'server.json'))).url, url);
  wc = desktop.getView().webContents;
  await wc.session.flushStorageData();
  assert.equal((await wc.session.cookies.get({ url })).some(cookie => cookie.name === 'metis_fixture'), true);
  { const closed = once(desktop.win, 'closed'); desktop.win.close(); await closed; }
  desktop = await createDesktop(); await desktop.initialLoad;
  assert.equal(desktop.getState().server, url);
  assert.equal(desktop.getState().mode, 'ready');
  console.log('SERVER_AND_SESSION_PERSISTENCE_OK');
  fixture.close(); await once(fixture, 'close');
  await desktop.load();
  assert.equal(desktop.getState().mode, 'error');
  assert.match(desktop.getState().message, /server/i);
  console.log('OFFLINE_RECOVERY_OK');
  fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });
  const output = path.join(__dirname, '..', 'test-results');
  fs.writeFileSync(path.join(output, 'offline.png'), (await desktop.win.webContents.capturePage()).toPNG());
  desktop.settings();
  await new Promise(resolve => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(output, 'server-settings.png'), (await desktop.win.webContents.capturePage()).toPNG());
  { const closed = once(desktop.win, 'closed'); desktop.win.close(); await closed; }
  if (process.env.METIS_CAPTURE_PUBLIC === '1') {
    fs.writeFileSync(path.join(testData, 'server.json'), JSON.stringify({ url: 'https://ai.f1shy312.com/' }));
    desktop = await createDesktop(); await desktop.initialLoad;
    assert.equal(desktop.getState().mode, 'ready');
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.match(await desktop.getView().webContents.executeJavaScript('document.title'), /Metis/i);
    fs.writeFileSync(path.join(output, 'metis-desktop.png'), (await desktop.getView().webContents.capturePage()).toPNG());
    console.log('PUBLIC_METIS_RENDER_OK');
    desktop.win.close();
  }
  console.log('SMOKE_OK');
}
main().then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
