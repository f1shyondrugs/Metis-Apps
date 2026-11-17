// Real Electron: remembered-server navigation, native menu, sessions and launcher dispatch.
const { app, Menu } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-recent-servers-'));
process.env.METIS_DESKTOP_TEST_DATA = directory;
const timeout = setTimeout(() => { console.error('RECENT_SERVERS_TIMEOUT'); app.exit(1); }, 60000);
const waitFor = async predicate => {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Recent server state timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function main() {
  await app.whenReady();
  const fixtures = [];
  for (const name of ['First', 'Second']) {
    const fixture = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>' + name + '</title><h1>' + name + '</h1>');
    });
    fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
    fixtures.push(fixture);
  }
  const urls = fixtures.map(f => 'http://127.0.0.1:' + f.address().port + '/');
  fs.writeFileSync(path.join(directory, 'server.json'), JSON.stringify({ url: urls[0] }));
  const api = require('../main.cjs');
  await waitFor(() => api.getDesktop()?.getState().mode === 'ready');
  const desktop = api.getDesktop();
  assert.equal(desktop.getRecentServers().length, 1);
  const local = desktop.win.webContents;
  assert.equal((await local.executeJavaScript('metisDesktop.connect(' + JSON.stringify(urls[1]) + ')')).ok, true);
  await waitFor(() => desktop.getState().mode === 'ready' && desktop.getState().server === urls[1]);
  assert.deepEqual(desktop.getRecentServers().map(e => e.url), [urls[1], urls[0]]);
  const first = desktop.getRecentServers().find(e => e.url === urls[0]);
  const menu = Menu.getApplicationMenu().getMenuItemById('metis-recent-servers');
  assert.equal(menu.submenu.items.length, 2);
  const selected = menu.submenu.items.find(item => item.checked);
  assert.equal(selected.label, new URL(urls[1]).host);
  const firstItem = Menu.getApplicationMenu().getMenuItemById('metis-server-' + first.id);
  firstItem.click();
  await waitFor(() => desktop.getState().mode === 'ready' && desktop.getState().server === urls[0]);
  assert.equal(await desktop.getView().webContents.executeJavaScript('document.querySelector("h1").textContent'), 'First');
  assert.equal(desktop.switchServer('https://untrusted.example/'), false);
  assert.equal(desktop.switchServer('0'.repeat(24)), false);
  assert.equal(desktop.getState().server, urls[0]);
  console.log('RECENT_SERVERS_NATIVE_MENU_SWITCH_AND_UNKNOWN_ID_REJECTED_OK');
  const second = desktop.getRecentServers().find(e => e.url === urls[1]);
  desktop.win.hide();
  const child = require('node:child_process').spawn(process.execPath, [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    path.join(__dirname, '..'), '--metis-server=' + second.id
  ], { env: { ...process.env, METIS_DESKTOP_TEST_DATA: directory }, stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('launcher exit ' + code)));
  });
  await waitFor(() => desktop.win.isVisible() && desktop.getState().mode === 'ready' && desktop.getState().server === urls[1]);
  await exited;
  assert.equal(api.getDesktop(), desktop);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'server.json'))).url, urls[1]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'server.json'))).recentServers, [urls[1], urls[0]]);
  console.log('RECENT_SERVERS_REAL_SECOND_INSTANCE_QUICK_SWITCH_OK');
  // Native desktop host intentionally retains its existing 600px minimum width.
  for (const width of [768, 1440]) {
    desktop.win.setSize(width, 800);
    await new Promise(resolve => setTimeout(resolve, 80));
    const [w, h] = desktop.win.getContentSize();
    assert.deepEqual(desktop.getView().getBounds(), { x: 0, y: 0, width: w, height: h });
  }
  // Changing the web server never creates or modifies device-pairing credentials.
  assert.equal(fs.existsSync(path.join(directory, 'config.json')), false);
  console.log('RECENT_SERVERS_RESPONSIVE_HOST_AND_PAIRING_UNCHANGED_OK');
  for (const fixture of fixtures) fixture.close();
  console.log('RECENT_SERVERS_E2E_OK');
}
main().then(() => { clearTimeout(timeout); app.quit(); setTimeout(() => app.exit(0), 500); })
  .catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
