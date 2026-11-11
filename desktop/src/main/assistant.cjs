const { BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, dialog } = require('electron');
const path = require('node:path');
const { sameOrigin, normalizeServer } = require('../../policy.cjs');
const { registerWebPermissions } = require('./web-permissions.cjs');
const { createComputerUseOverlay } = require('../../computer-use-overlay.cjs');
const { createToggleGesture } = require('./assistant-toggle.cjs');
const { interactionRegions } = require('./assistant-regions.cjs');
const shortcuts = require('../../assistant-shortcuts.cjs');
const { createForegroundRestore } = require('./assistant-focus.cjs');

function createAssistant({
  getServer, getDevice, onOpenChat, onDevices = () => {}, computerOverlay, appearance, hook,
  hideFromCapture = true, annotationOverlay, onEscape = () => {}, getShortcuts = () => shortcuts.defaults, foreground = createForegroundRestore(),
  captureSources = options => desktopCapturer.getSources(options)
}) {
  let win, server, opening, ready = false, visible = false, recording = false, capturing = false;
  let pending = [], hookStarted = false, error = '', editing = false, autoFocusPending = false, currentChat = null;
  let captureHidden = hideFromCapture;
  let currentAppearance = appearance, shortcutsPaused = false, shortcutCaptureTimer;
  let regions = [], shaped = false, pointerTimer, blurTimer, pointerIgnored = true, nativeShape = '';
  const channel = 'assistant:gesture', held = new Set();
  const bindings = () => shortcuts.normalize(getShortcuts());
  const edges = createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, mode: 'voice', hideFromCapture: captureHidden, cancelShortcut: bindings().cancel, onCancel: () => close() });
  edges.setAppearance(currentAppearance);
  const gesture = createToggleGesture(value => {
    if (value === 'start') void open('start').catch(reportError);
    else send(value);
  });
  function reportError(cause) { error = cause.message || String(cause); dialog.showErrorBox('Metis Assistant', error); }
  function send(value) {
    if (!win || win.isDestroyed()) return;
    if (!ready) { pending.push(value); return; }
    win.webContents.send(channel, value);
  }
  function assertSender(event) {
    if (!win || win.isDestroyed() || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame || !sameOrigin(event.senderFrame.url, server) ||
        new URL(event.senderFrame.url).pathname !== '/desktop-assistant') throw new Error('Access denied.');
  }
  function ignorePointer(value) {
    if (pointerIgnored !== value && win && !win.isDestroyed()) { win.setIgnoreMouseEvents(value); pointerIgnored=value; }
  }
  function pointerPolicy() {
    if (!win || win.isDestroyed()) return;
    if (shaped) { ignorePointer(!regions.length); return; }
    const point = screen.getCursorScreenPoint(), bounds = win.getBounds();
    const x = point.x-bounds.x, y = point.y-bounds.y;
    ignorePointer(!regions.some(r => x>=r.x && y>=r.y && x<r.x+r.width && y<r.y+r.height));
  }
  function focusInput() {
    if (!visible || !win || win.isDestroyed()) return;
    autoFocusPending = false;
    if (!editing) foreground.remember(win);
    editing = true;
    if (!win.isFocusable()) win.setFocusable(true);
    ignorePointer(false);
    if (!win.isVisible()) win.show();
    const activated=foreground.activate?.(win);
    if (activated===false) { editing=false; win.setFocusable(false); pointerPolicy(); send('passive'); return; }
    win.focus(); win.webContents.focus();
    send('focus-input');
  }
  function releaseInput(restore = Boolean(win && !win.isDestroyed() && win.isFocused())) {
    editing = false;
    if (win && !win.isDestroyed()) {
      if (win.isFocusable()) win.setFocusable(false);
      pointerPolicy();
    }
    if (restore) foreground.restore();
    send('passive');
  }
  function bounds() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return display.workArea;
  }
  async function open(initialGesture) {
    if (opening) return opening;
    const next = normalizeServer(getServer());
    if (win && !win.isDestroyed() && next !== server) { close(); win.destroy(); win = null; }
    const created = !win || win.isDestroyed();
    autoFocusPending = !visible;
    if (created) {
      server = next; ready = false; pending = []; regions = []; shaped = false; pointerIgnored = true; nativeShape = '';
      win = new BrowserWindow({
        ...bounds(), transparent: true, backgroundColor: '#00000000', frame: false, show: false,
        focusable: false, resizable: false, skipTaskbar: true, hasShadow: false, title: 'Metis Assistant',
        webPreferences: { partition: 'persist:metis-web', preload: path.join(__dirname,'assistant-preload.cjs'),
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required' }
      });
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.setContentProtection(captureHidden);
      win.setIgnoreMouseEvents(true);
      registerWebPermissions(win.webContents, server, win);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const navigation = (event, url) => {
        if (!sameOrigin(url, server) || new URL(url).pathname !== '/desktop-assistant') event.preventDefault();
      };
      win.webContents.on('will-navigate', navigation);
      win.webContents.on('will-redirect', navigation);
      win.on('close', event => { event.preventDefault(); close(); });
      win.on('blur', () => {
        clearTimeout(blurTimer);
        blurTimer=setTimeout(()=>{if(editing&&!capturing&&win&&!win.isDestroyed()&&!(foreground.isActive?foreground.isActive(win):win.isFocused()))releaseInput(false);},100);
      });
      win.webContents.on('render-process-gone', () => { close(); ready = false; });
      if (initialGesture) pending.push(initialGesture);
      opening = win.loadURL(new URL('/desktop-assistant',server).href).finally(() => { opening = null; });
      await opening;
    } else if (!visible) win.setBounds(bounds());
    if (!editing) foreground.keepPassive?.(win);
    visible = true;
    // showInactive never takes foreground away from a game.
    if (!win.isVisible()) win.showInactive();
    edges.touch(); pointerPolicy();
    if (!pointerTimer) { pointerTimer=setInterval(()=>{pointerPolicy();if(!editing&&!capturing)foreground.keepPassive?.(win);},25); pointerTimer.unref?.(); }
    if (!created && initialGesture) send(initialGesture);
    send('open');
  }
  function close() {
    const restore = Boolean(editing && win && !win.isDestroyed() && win.isFocused());
    visible = false; recording = false; autoFocusPending = false; pending = [];
    clearInterval(pointerTimer); clearTimeout(blurTimer); pointerTimer=null;
    gesture.cancel(); edges.hide(); send('cancel');
    if (win && !win.isDestroyed()) win.hide();
    releaseInput(restore);
  }
  async function capture() {
    if (capturing) throw new Error('Screen capture is already in progress.');
    capturing = true;
    const wasVisible = visible;
    try {
      if (!getDevice().clientId) throw new Error('Pair this device before sending screen context.');
      const displays = screen.getAllDisplays();
      if (!displays.length || displays.length > 10) throw new Error('Screen context supports 1–10 connected monitors.');
      win.hide(); edges.suspendCapture(); computerOverlay?.suspendCapture(); annotationOverlay?.suspendCapture();
      await new Promise(resolve => setTimeout(resolve,180));
      const sources = await captureSources({ types:['screen'], thumbnailSize:{width:1920,height:1080}, fetchWindowIcons:false });
      const monitors = displays.map(display => {
        const source = sources.find(source => source.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture every monitor. Check screen recording permissions and retry.');
        return { id:String(display.id), name:display.label || source.name, primary:display.id === screen.getPrimaryDisplay().id,
          bounds:display.bounds, scaleFactor:display.scaleFactor, image:source.thumbnail.toDataURL() };
      });
      return { device:getDevice(), capturedAt:new Date().toISOString(), monitors };
    } finally {
      capturing = false; edges.resumeCapture(); computerOverlay?.resumeCapture(); annotationOverlay?.resumeCapture();
      if (wasVisible && visible && win && !win.isDestroyed()) {
        if (editing) { win.show(); win.focus(); } else win.showInactive();
      }
    }
  }
  function validChat(id) {
    if (id !== null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('Invalid chat.');
    return id;
  }
  function openChat() { const id = currentChat; close(); return onOpenChat(id); }
  const handlers = {
    'assistant:ready': event => {
      assertSender(event); ready = true;
      const queue = pending; pending = [];
      return { gestures:queue, device:getDevice(), shortcuts:bindings(), editing };
    },
    // Retain compatibility with the earlier renderer; layout now fills its display.
    'assistant:resize': event => { assertSender(event); },
    'assistant:configure': (event,value) => {
      assertSender(event);
      if (!value || typeof value.voiceConfigured !== 'boolean') throw new Error('Invalid assistant mode.');
      if (Object.hasOwn(value,'chatId')) currentChat = validChat(value.chatId);
      if (autoFocusPending && visible) {
        autoFocusPending = false;
        if (!value.voiceConfigured) focusInput();
        else releaseInput(false);
      }
      return { editing, shortcuts:bindings() };
    },
    'assistant:focus': (event,value) => {
      assertSender(event);
      if (typeof value !== 'boolean') throw new Error('Invalid input mode.');
      autoFocusPending = false;
      if (value) focusInput(); else releaseInput();
    },
    'assistant:capture': event => { assertSender(event); if (!visible) throw new Error('Open the assistant before capturing.'); return capture(); },
    'assistant:close': event => { assertSender(event); close(); },
    'assistant:open-chat': (event,id) => { assertSender(event); currentChat = validChat(id); return openChat(); }
  };
  for (const [key,value] of Object.entries(handlers)) ipcMain.handle(key,value);
  const voiceListener = (event,value) => {
    try {
      assertSender(event);
      if (!visible || !value || typeof value.recording !== 'boolean' || typeof value.level !== 'number' || !Number.isFinite(value.level)) return;
      if (value.recording !== recording) { recording = value.recording; if (recording) gesture.started(); else gesture.finish(); }
      const allowed = ['Metis Assistant','Metis is listening','Voice is not configured','Metis is working'];
      edges.setVoiceState(recording,recording ? 'Metis is listening' : allowed.includes(value.status) ? value.status : 'Metis Assistant');
      if (recording) edges.setVoiceLevel(value.level);
    } catch { /* Ignore stale or untrusted renderers. */ }
  };
  ipcMain.on('assistant:voice',voiceListener);
  const regionListener = (event,value) => {
    try {
      assertSender(event);
      regions=interactionRegions(value,win.getContentBounds());
      const shape=JSON.stringify(regions);
      if (process.platform!=='darwin' && win.setShape && shape!==nativeShape) { win.setShape(regions); shaped=true; nativeShape=shape; }
      pointerPolicy();
    } catch { /* Stale frames and invalid layout updates have no native effect. */ }
  };
  ipcMain.on('assistant:regions',regionListener);
  function startHook() {
    try {
      if (process.platform === 'linux' && !process.env.DISPLAY) throw new Error('Global assistant hotkey requires an X11 desktop.');
      const {uIOhook,UiohookKey:keys} = hook || require('uiohook-napi');
      const down = event => {
        if (event.keycode === keys.Escape) onEscape();
        if (shortcutsPaused) return;
        const repeat = held.has(event.keycode); held.add(event.keycode);
        const map = bindings();
        if (shortcuts.matches(map.assistant,event,keys)) gesture.down();
        else if (!repeat && shortcuts.matches(map.focusInput,event,keys)) {
          if (!visible) void open().then(focusInput).catch(reportError);
          else if (editing) releaseInput(); else focusInput();
        } else if (!repeat && shortcuts.matches(map.openChat,event,keys) && visible) void openChat().catch(reportError);
        else if (!repeat && shortcuts.matches(map.deviceSettings,event,keys)) onDevices();
        else if (!repeat && shortcuts.matches(map.cancel,event,keys) && visible) close();
      };
      const up = event => { held.delete(event.keycode); if (shortcuts.releases(bindings().assistant,event,keys)) gesture.up(); };
      try { uIOhook.on('keydown',down); uIOhook.on('keyup',up); uIOhook.start(); hookStarted = true; }
      catch (cause) { uIOhook.removeListener('keydown',down); uIOhook.removeListener('keyup',up); throw cause; }
      return () => { uIOhook.removeListener('keydown',down); uIOhook.removeListener('keyup',up); uIOhook.stop(); };
    } catch (cause) { error = cause.message; return () => {}; }
  }
  const stopHook = startHook();
  return {
    open, close, capture, focusInput, releaseInput, getWindow:() => win, gesture,
    setHideFromCapture(value) {
      if (typeof value !== 'boolean') throw new TypeError('Capture visibility must be a boolean');
      edges.setHideFromCapture(value);
      if (win && !win.isDestroyed()) win.setContentProtection(value);
      captureHidden = value;
    },
    setAppearance(value) { currentAppearance = value; edges.setAppearance(value); },
    shortcutsChanged() { gesture.cancel(); held.clear(); edges.setCancelShortcut(bindings().cancel); send('stop'); send('shortcuts-changed'); },
    pauseShortcuts(value) { clearTimeout(shortcutCaptureTimer); shortcutsPaused=Boolean(value); gesture.cancel(); held.clear(); if(shortcutsPaused)send('stop'); if(shortcutsPaused){shortcutCaptureTimer=setTimeout(()=>{shortcutsPaused=false;},30000);shortcutCaptureTimer.unref?.();} },
    state:() => ({ hotkey:bindings().assistant, shortcuts:bindings(), defaults:shortcuts.defaults, hotkeyAvailable:hookStarted, error, editing }),
    destroy() { close(); clearTimeout(shortcutCaptureTimer); stopHook(); for (const key of Object.keys(handlers)) ipcMain.removeHandler(key); ipcMain.removeListener('assistant:voice',voiceListener); ipcMain.removeListener('assistant:regions',regionListener); win?.destroy(); }
  };
}
module.exports = { createAssistant };
