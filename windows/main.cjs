const { app, BrowserWindow, WebContentsView, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_SERVER, normalizeServer, sameOrigin, externalUrl } = require('./policy.cjs');
const APP_ID = 'ai.metis.desktop';
const shellPath = path.join(__dirname, 'ui', 'index.html');
const shellUrl = pathToFileURL(shellPath).href;

async function createDesktop() {
  const configPath = path.join(app.getPath('userData'), 'server.json');
  let server = DEFAULT_SERVER;
  try { server = normalizeServer(JSON.parse(fs.readFileSync(configPath, 'utf8')).url); } catch {}
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 600, minHeight: 480,
    title: 'Metis AI', icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#111111',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  let view;
  let generation = 0;
  let state = { mode: 'loading', server, message: '' };
  let permissionGrants = new Set();
  const update = (mode, message = '') => {
    state = { mode, server, message };
    if (!win.isDestroyed()) win.webContents.send('desktop:state-changed', state);
  };
  const disposeView = () => {
    generation++;
    if (!view) return;
    if (!win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
    permissionGrants.clear();
  };
  const resize = () => {
    if (view) { const [width, height] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width, height }); }
  };
  const openExternal = (url) => {
    if (externalUrl(url)) shell.openExternal(url).catch(() => {});
  };
  const settings = () => { disposeView(); update('settings'); };
  async function load() {
    disposeView();
    update('loading');
    const currentGeneration = generation;
    const remote = new WebContentsView({
      webPreferences: {
        partition: 'persist:metis-web',
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true
      }
    });
    view = remote;
    win.contentView.addChildView(remote);
    remote.setVisible(false);
    resize();
    const contents = remote.webContents;
    const ses = contents.session;
    const permissionKey = (permission, details) => permission + ':' + (details.mediaTypes || []).join(',');
    ses.setPermissionCheckHandler((wc, permission, origin, details) =>
      wc === contents && sameOrigin(origin, server) && permissionGrants.has(permissionKey(permission, details)));
    ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      const allowed = ['media', 'notifications', 'clipboard-sanitized-write'];
      if (wc !== contents || !sameOrigin(wc.getURL(), server) ||
          !sameOrigin(details.requestingUrl || wc.getURL(), server) || !allowed.includes(permission)) return callback(false);
      if (permission === 'clipboard-sanitized-write') return callback(true);
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', title: 'Metis AI',
        message: permission === 'media' ? 'Mikrofon oder Kamera erlauben?' : 'Benachrichtigungen erlauben?',
        detail: server, buttons: ['Nicht erlauben', 'Erlauben'], defaultId: 0, cancelId: 0
      });
      const accepted = response === 1 && generation === currentGeneration;
      if (accepted) permissionGrants.add(permissionKey(permission, details));
      callback(accepted);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (sameOrigin(url, server)) contents.loadURL(url).catch(() => {});
      else openExternal(url);
      return { action: 'deny' };
    });
    const navigation = (event, url) => {
      if (!sameOrigin(url, server)) { event.preventDefault(); openExternal(url); }
    };
    contents.on('will-navigate', navigation);
    contents.on('will-redirect', navigation);
    contents.on('page-title-updated', (event) => { event.preventDefault(); win.setTitle('Metis AI'); });
    contents.on('did-finish-load', () => {
      if (generation !== currentGeneration) return;
      remote.setVisible(true); update('ready'); contents.focus();
    });
    const failure = (message) => {
      if (generation !== currentGeneration || win.isDestroyed()) return;
      remote.setVisible(false); update('error', message);
    };
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) failure('Der Server ist nicht erreichbar. Prüfe die Verbindung oder ändere die Serveradresse.');
    });
    contents.on('render-process-gone', () => failure('Die Seite wurde beendet. Du kannst sie erneut laden.'));
    let timer = setTimeout(() => {
      if (generation === currentGeneration && state.mode === 'loading') {
        contents.stop(); failure('Der Server antwortet nicht. Versuche es erneut oder ändere die Serveradresse.');
      }
    }, 30000);
    contents.once('destroyed', () => clearTimeout(timer));
    try { await contents.loadURL(server); } catch {
      failure('Der Server konnte nicht geladen werden. Prüfe die Verbindung oder ändere die Serveradresse.');
    } finally { clearTimeout(timer); }
  }
  function assertLocal(event) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== shellUrl) throw new Error('Unzulässiger Zugriff.');
  }
  const handlers = {
    'desktop:state': (event) => { assertLocal(event); return state; },
    'desktop:connect': (event, value) => {
      assertLocal(event);
      try {
        const next = normalizeServer(value);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath + '.tmp', JSON.stringify({ url: next }, null, 2));
        fs.renameSync(configPath + '.tmp', configPath);
        server = next; void load();
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
    },
    'desktop:retry': (event) => { assertLocal(event); void load(); },
    'desktop:settings': (event) => { assertLocal(event); settings(); }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Metis', submenu: [
      { label: 'Startseite', accelerator: 'CmdOrCtrl+Home', click: () => { void load(); } },
      { label: 'Serveradresse ändern…', accelerator: 'CmdOrCtrl+,', click: settings },
      { label: 'Im Browser öffnen', click: () => openExternal(server) },
      { type: 'separator' },
      { label: 'Über Metis AI', click: () => dialog.showMessageBox(win, { title: 'Metis AI', message: 'Metis AI ' + app.getVersion(), detail: 'Desktop-Prototyp · ' + server }) },
      { role: 'quit', label: 'Beenden' }
    ] },
    { role: 'editMenu', label: 'Bearbeiten' },
    { label: 'Ansicht', submenu: [
      { label: 'Neu laden', accelerator: 'CmdOrCtrl+R', click: () => { if (view && state.mode === 'ready') view.webContents.reload(); else void load(); } },
      { role: 'togglefullscreen', label: 'Vollbild' },
      { role: 'resetZoom', label: 'Originalgröße' },
      { role: 'zoomIn', label: 'Vergrößern' },
      { role: 'zoomOut', label: 'Verkleinern' }
    ] }
  ]));
  win.on('resize', resize);
  win.on('closed', () => {
    disposeView();
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
  });
  await win.loadFile(shellPath);
  const initialLoad = load();
  return { win, getView: () => view, getState: () => state, settings, load, initialLoad };
}
function bootstrap() {
  app.setName('Metis AI');
  app.setAppUserModelId(APP_ID);
  if (!app.requestSingleInstanceLock()) return app.quit();
  let desktop;
  app.on('second-instance', () => {
    if (desktop && !desktop.win.isDestroyed()) { if (desktop.win.isMinimized()) desktop.win.restore(); desktop.win.show(); desktop.win.focus(); }
  });
  const open = async () => { desktop = await createDesktop(); };
  app.whenReady().then(open).catch((error) => { dialog.showErrorBox('Metis AI konnte nicht starten', error.message); app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void open(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
module.exports = { createDesktop, bootstrap };
if (require.main === module) bootstrap();
