const { app, BrowserWindow, WebContentsView, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.join(__dirname, '../..');
const { DEFAULT_SERVER, normalizeServer, sameOrigin, externalUrl } = require(path.join(ROOT, 'policy.cjs'));
const APP_ID = process.env.METIS_DESKTOP_TEST_DATA ? 'ai.metis.desktop.test' : 'ai.metis.desktop';
const { registerWebPermissions } = require('./web-permissions.cjs');
const shellPath = path.join(ROOT, 'ui', 'index.html');
const shellUrl = pathToFileURL(shellPath).href;

async function createDesktop({ onDevices = () => {}, onDeviceState = () => ({}), onAssistant = () => {}, onShortcutsChange = () => {}, onShortcutCapture = () => {}, onCaptureHidden, onAutostart, onCheckUpdates, onDesktopPermissions, shouldHide = () => false, initialServer } = {}) {
  const configPath = path.join(app.getPath('userData'), 'server.json');
  let server = initialServer ? normalizeServer(initialServer) : DEFAULT_SERVER;
  let serverConfigured=Boolean(initialServer);
  try { server = normalizeServer(JSON.parse(fs.readFileSync(configPath, 'utf8')).url);serverConfigured=true; } catch {}
  let context;
  try { context=require('./client-context.cjs').clientContext(app.getPath('userData')); }
  catch { context=Object.freeze({installationId:''}); } // Optional identity must never stop an existing background client.
  let launcher = !serverConfigured;
  const windowOptions = {
    width: 1360, height: 900, minWidth: 600, minHeight: 480,
    title: 'Metis', icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'web-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  };
  let win = new BrowserWindow({...windowOptions, frame:!launcher, autoHideMenuBar:launcher});
  win.setMenuBarVisibility(!launcher);
  let view;
  let dropCleanup=()=>{};
  let dropState={available:false,error:''};
  let dropRegistered=false;
  const refreshDropTarget=()=>{if(dropRegistered)return;try { dropCleanup=require('./windows-file-drop.cjs').registerWindowsFileDrop(win,{
    onReady:()=>{dropState={available:true,error:''};},
    getPresentation:()=>{const state=onDeviceState();return {appearance:state.appearance,hideFromCapture:state.hideOverlayFromCapture};},
    getEnabled:()=>state.mode==='ready'&&Boolean(view)&&sameOrigin(view.webContents.getURL(),server),
    getBounds:()=>{const b=win.getContentBounds(),v=view?.getBounds();return v?{x:b.x+v.x,y:b.y+v.y,width:v.width,height:v.height}:b;},
    onFiles: payload => {
      const contents=view?.webContents;
      if(!contents||state.mode!=='ready'||!sameOrigin(contents.getURL(),server))return;
      const zoom=contents.getZoomFactor();
      const point={x:payload.point.x/zoom,y:payload.point.y/zoom};
      contents.send('desktop:files-dropped',{files:payload.files,point});
    },
    onError: error => { dropState={available:false,error:String(error.message||'File drops are unavailable. Use Attach files.').slice(0,512)}; }
  });dropRegistered=true; } catch(error) { dropState={available:false,error:'File drops are unavailable. Use Attach files.'};if(process.env.METIS_DROP_TEST_ROOT)console.error('DROP_HELPER_SETUP_ERROR',error); }};
  let generation = 0;
  let state = { mode: serverConfigured ? 'loading' : 'welcome', server, message: '', firstRun:!serverConfigured };
  const update = (mode, message = '') => {
    state = { mode, server, message, firstRun:!serverConfigured };
    if (!win.isDestroyed()) win.webContents.send('desktop:state-changed', state);
  };
  const disposeView = () => {
    onShortcutCapture(false);
    generation++;
    if (!view) return;
    if (!win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
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
        preload: path.join(__dirname, 'web-app-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true
      }
    });
    view = remote;
    win.contentView.addChildView(remote);
    remote.setVisible(false);
    resize();
    const contents = remote.webContents;
    registerWebPermissions(contents, server, win);
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
    contents.on('page-title-updated', (event) => { event.preventDefault(); win.setTitle('Metis'); });
    contents.on('did-finish-load', () => {
      void (async () => {
        if (generation !== currentGeneration) return;
        if (launcher) {
          // Frame style is immutable. Transfer the existing authorized WebContents
          // into the ordinary app host, without reloading login or touching data.
          const previous = win;
          const next = new BrowserWindow({...windowOptions, ...previous.getBounds(), show:false});
          next.setMenuBarVisibility(true);
          previous.contentView.removeChildView(remote);
          next.contentView.addChildView(remote);
          win = next; launcher = false; bindWindow(next); resize();
          try { await next.loadFile(shellPath); }
          catch(error) {
            if (!previous.isDestroyed() && !next.isDestroyed()) {
              next.contentView.removeChildView(remote); previous.contentView.addChildView(remote);
              win = previous; launcher = true; next.destroy(); resize();
            }
            throw error;
          }
          previous.destroy();
          if (generation !== currentGeneration || next.isDestroyed()) return;
          next.show(); next.focus();
        }
        remote.setVisible(true); update('ready'); refreshDropTarget(); contents.focus();
      })().catch(() => failure('The workspace window could not be opened. Try again.'));
    });
    const failure = (message) => {
      if (generation !== currentGeneration || win.isDestroyed()) return;
      remote.setVisible(false); update('error', message);
    };
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) failure('The server is unreachable. Check your connection or change the server address.');
    });
    contents.on('render-process-gone', () => failure('The page stopped working. You can reload it.'));
    let timer = setTimeout(() => {
      if (generation === currentGeneration && state.mode === 'loading') {
        contents.stop(); failure('The server is not responding. Try again or change the server address.');
      }
    }, 30000);
    contents.once('destroyed', () => clearTimeout(timer));
    try { await contents.loadURL(server); } catch {
      failure('The server could not be loaded. Check your connection or change the server address.');
    } finally { clearTimeout(timer); }
  }
  function assertLocal(event) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== shellUrl) throw new Error('Access denied.');
  }
  function assertRemote(event) {
    const contents = view?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !sameOrigin(event.senderFrame.url, server)) throw new Error('Access denied.');
  }
  const handlers = {
    'desktop:onboarding-context': event => {assertRemote(event);return {...context,server};},
    'desktop:open-server-settings': event => {assertRemote(event);setTimeout(settings,0);},
    'desktop:request-desktop-permissions': event => {assertRemote(event);if(!onDesktopPermissions)throw new Error('Permission checks are unavailable.');return onDesktopPermissions();},
    'desktop:welcome': event => {assertLocal(event);disposeView();update('welcome');},
    'desktop:set-capture-hidden': (event,value) => {
      assertRemote(event);
      if (typeof value !== 'boolean' || !onCaptureHidden) throw new Error('Invalid capture preference.');
      return onCaptureHidden(value);
    },
    'desktop:set-autostart': (event,value) => {
      assertRemote(event);
      if (typeof value !== 'boolean' || !onAutostart) throw new Error('Invalid startup preference.');
      return onAutostart(value);
    },
    'desktop:check-updates': event => { assertRemote(event); return onCheckUpdates?.(); },
    'desktop:open-device-settings': (event) => {
      const contents = view?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !sameOrigin(event.senderFrame.url, server)) throw new Error('Access denied.');
      onDevices();
    },
    'desktop:device-state': event => {
      const contents = view?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !sameOrigin(event.senderFrame.url, server)) throw new Error('Access denied.');
      return onDeviceState();
    },
    'desktop:shortcut-capture': (event,value) => {
      const contents = view?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !sameOrigin(event.senderFrame.url, server) || typeof value !== 'boolean') throw new Error('Access denied.');
      return onShortcutCapture(value);
    },
    'desktop:shortcuts': (event,value) => {
      const contents = view?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !sameOrigin(event.senderFrame.url, server)) throw new Error('Access denied.');
      return onShortcutsChange(value);
    },
    'desktop:assistant': event => {
      const contents = view?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !sameOrigin(event.senderFrame.url, server)) throw new Error('Access denied.');
      return onAssistant();
    },
    'desktop:state': (event) => { assertLocal(event); return state; },
    'desktop:connect': (event, value) => {
      assertLocal(event);
      try {
        const next = normalizeServer(value);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath + '.tmp', JSON.stringify({ url: next }, null, 2));
        fs.renameSync(configPath + '.tmp', configPath);
        server = next; serverConfigured=true;void load();
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
    },
    'desktop:retry': (event) => { assertLocal(event); void load(); },
    'desktop:settings': (event) => { assertLocal(event); settings(); }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Metis', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+Home', click: () => { void load(); } },
      { id: 'metis-device-settings', label: 'Open Remote Client Device Settings', accelerator: onDeviceState().assistant?.shortcuts?.deviceSettings || 'CmdOrCtrl+Shift+D', registerAccelerator: !onDeviceState().assistant?.hotkeyAvailable, click: onDevices },
      { label: 'Change server…', accelerator: 'CmdOrCtrl+,', click: settings },
      { label: 'Open in browser', click: () => openExternal(server) },
      { type: 'separator' },
      { label: 'About Metis', click: () => dialog.showMessageBox(win, { title: 'Metis', message: 'Metis ' + app.getVersion(), detail: 'Desktop app · ' + server }) },
      { role: 'quit', label: 'Quit' }
    ] },
    { role: 'editMenu', label: 'Edit' },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { if (view && state.mode === 'ready') view.webContents.reload(); else void load(); } },
      { role: 'togglefullscreen', label: 'Full screen' },
      { role: 'resetZoom', label: 'Actual size' },
      { role: 'zoomIn', label: 'Zoom in' },
      { role: 'zoomOut', label: 'Zoom out' }
    ] }
  ]));
  if (launcher) win.setMenu(null); // Alt must not reveal a hidden native menu on the splash.
  function bindWindow(host) {
    host.webContents.on('will-navigate', event => event.preventDefault());
    host.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    host.on('resize', resize);
    host.on('close', event => { if (shouldHide()) { event.preventDefault(); host.hide(); } });
    host.on('closed', () => {
      if (host !== win) return; // Retiring the splash must not close the app view.
      dropCleanup(); disposeView();
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    });
  }
  bindWindow(win);
  await win.loadFile(shellPath);
  const initialLoad = serverConfigured ? load() : Promise.resolve(update('welcome'));
  return { get win(){return win;}, getView: () => view, getState: () => state, getFileDropState:()=>({...dropState}), settings, load, initialLoad };
}
function bootstrap() {
  app.commandLine.appendSwitch('lang', 'en-US');
  app.setName('Metis');
  app.setAppUserModelId(APP_ID);
  if (!app.requestSingleInstanceLock()) return app.quit();
  let desktop;
  app.on('second-instance', () => {
    if (desktop && !desktop.win.isDestroyed()) { if (desktop.win.isMinimized()) desktop.win.restore(); desktop.win.show(); desktop.win.focus(); }
  });
  const open = async () => { desktop = await createDesktop(); };
  app.whenReady().then(open).catch((error) => { dialog.showErrorBox('Metis could not start', error.message); app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void open(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
module.exports = { createDesktop, bootstrap };
if (require.main === module) bootstrap();
