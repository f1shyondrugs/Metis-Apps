const { BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, dialog } = require('electron');
const path = require('node:path');
const { sameOrigin, normalizeServer } = require('../../policy.cjs');
const { registerWebPermissions } = require('./web-permissions.cjs');
const { createComputerUseOverlay } = require('../../computer-use-overlay.cjs');
const { createHoldGesture } = require('./assistant-hold.cjs');

function createAssistant({ getServer, getDevice, onOpenChat, computerOverlay, appearance, hook, captureSources = options => desktopCapturer.getSources(options) }) {
  let win, server, opening, ready = false, visible = false, recording = false, capturing = false;
  let pending = [], hookStarted = false, error = '';
  const channel = 'assistant:gesture';
  const edges = createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, mode: 'voice', hideFromCapture: true, onCancel: () => close() });
  edges.setAppearance(appearance);
  const gesture = createHoldGesture(value => {
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
  async function open(initialGesture) {
    if (opening) return opening;
    const next = normalizeServer(getServer());
    if (win && !win.isDestroyed() && next !== server) { win.destroy(); win = null; }
    const created = !win || win.isDestroyed();
    if (created) {
      server = next; ready = false; pending = [];
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const width = Math.min(640, display.workArea.width - 32);
      win = new BrowserWindow({
        x: Math.round(display.workArea.x + (display.workArea.width-width)/2),
        y: display.workArea.y + display.workArea.height - Math.min(620,display.workArea.height-40) - 20,
        width, height: Math.min(620,display.workArea.height-40),
        transparent: true, backgroundColor: '#00000000', frame: false, show: false,
        resizable: false, skipTaskbar: true, hasShadow: false, title: 'Metis Assistant',
        webPreferences: { partition: 'persist:metis-web', preload: path.join(__dirname,'assistant-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
      });
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.setContentProtection(true);
      registerWebPermissions(win.webContents, server, win);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const navigation = (event, url) => {
        if (!sameOrigin(url, server) || new URL(url).pathname !== '/desktop-assistant') event.preventDefault();
      };
      win.webContents.on('will-navigate', navigation);
      win.webContents.on('will-redirect', navigation);
      win.on('close', event => { event.preventDefault(); close(); });
      win.webContents.on('render-process-gone', () => { close(); ready=false; });
      if (initialGesture) pending.push(initialGesture);
      opening = win.loadURL(new URL('/desktop-assistant',server).href).finally(() => { opening=null; });
      await opening;
    }
    if (!created && initialGesture) send(initialGesture);
    visible = true;
    edges.touch();
    win.show(); win.focus();
    // Every invocation gets a fresh motion entrance, but preserves unsent text.
    send('open');
  }
  function close() {
    visible = false; recording=false; pending=[];
    gesture.cancel(); edges.hide(); send('cancel');
    if (win && !win.isDestroyed()) win.hide();
  }
  async function capture() {
    if (capturing) throw new Error('Screen capture is already in progress.');
    capturing=true;
    const wasVisible = visible;
    try {
      if (!getDevice().clientId) throw new Error('Pair this device before sending screen context.');
      const displays=screen.getAllDisplays();
      if (!displays.length || displays.length>10) throw new Error('Screen context supports 1–10 connected monitors.');
      win.hide(); edges.suspendCapture(); computerOverlay?.suspendCapture();
      await new Promise(resolve=>setTimeout(resolve,180));
      const sources=await captureSources({ types:['screen'], thumbnailSize:{width:1920,height:1080}, fetchWindowIcons:false });
      const monitors=displays.map(display=>{
        const source=sources.find(source=>source.display_id===String(display.id));
        if(!source || source.thumbnail.isEmpty()) throw new Error('Could not capture every monitor. Check screen recording permissions and retry.');
        return { id:String(display.id), name:display.label || source.name, primary:display.id===screen.getPrimaryDisplay().id,
          bounds:display.bounds, scaleFactor:display.scaleFactor, image:source.thumbnail.toDataURL() };
      });
      return { device:getDevice(), capturedAt:new Date().toISOString(), monitors };
    } finally {
      capturing=false; edges.resumeCapture(); computerOverlay?.resumeCapture();
      if(wasVisible && visible && win && !win.isDestroyed()) win.show();
    }
  }
  const handlers = {
    'assistant:ready': event => { assertSender(event); ready=true; const queue=pending; pending=[]; return { gestures:queue, device:getDevice() }; },
    'assistant:resize': (event,height) => {
      assertSender(event);
      if(typeof height!=='number'||!Number.isFinite(height))return;
      const display=screen.getDisplayMatching(win.getBounds());
      const size=Math.min(Math.max(160,Math.ceil(height)),display.workArea.height-40);
      const bounds=win.getBounds();
      win.setBounds({x:bounds.x,y:display.workArea.y+display.workArea.height-size-20,width:bounds.width,height:size});
    },
    'assistant:capture': event => { assertSender(event); if(!visible)throw new Error('Open the assistant before capturing.'); return capture(); },
    'assistant:close': event => { assertSender(event); close(); },
    'assistant:open-chat': (event,id) => { assertSender(event); if(id !== null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))throw new Error('Invalid chat.'); close(); return onOpenChat(id); }
  };
  for(const [key,value] of Object.entries(handlers)) ipcMain.handle(key,value);
  const voiceListener = (event,value) => {
    try {
      assertSender(event);
      if(!visible || !value || typeof value.recording!=='boolean' || typeof value.level!=='number' || !Number.isFinite(value.level))return;
      if(value.recording!==recording) {
        recording=value.recording;
        if(!recording)gesture.finish();
      }
      const allowed=["Metis Assistant","Metis is listening","Voice is not configured","Metis is working"];
      edges.setVoiceState(recording,recording?"Metis is listening":allowed.includes(value.status)?value.status:"Metis Assistant");
      if(recording)edges.setVoiceLevel(value.level);
    } catch { /* Untrusted or stale renderer. */ }
  };
  ipcMain.on('assistant:voice',voiceListener);
  function startHook() {
    try {
      if(process.platform==='linux' && !process.env.DISPLAY) throw new Error('Global assistant hotkey requires an X11 desktop.');
      const {uIOhook,UiohookKey:keys}=hook || require('uiohook-napi');
      const down=event=>{
        if(event.keycode===keys.Space && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) gesture.down();
        if(event.keycode===keys.Escape && visible)close();
      };
      const up=event=>{ if([keys.Space,keys.Ctrl,keys.CtrlRight,keys.Shift,keys.ShiftRight].includes(event.keycode))gesture.up(); };
      // A shared native key listener also works when another app has registered
      // the accelerator. Do not disable hold-to-talk on that computer.
      try {uIOhook.on('keydown',down);uIOhook.on('keyup',up);uIOhook.start();hookStarted=true;}
      catch(cause){uIOhook.removeListener('keydown',down);uIOhook.removeListener('keyup',up);throw cause;}
      return ()=>{uIOhook.removeListener('keydown',down);uIOhook.removeListener('keyup',up);uIOhook.stop();};
    } catch(cause) {error=cause.message;return ()=>{};}
  }
  const stopHook=startHook();
  return {
    open, close, capture, getWindow:()=>win, gesture,
    state:()=>({hotkey:'Ctrl+Shift+Space',hotkeyAvailable:hookStarted,error}),
    destroy(){close();stopHook();for(const key of Object.keys(handlers))ipcMain.removeHandler(key);ipcMain.removeListener('assistant:voice',voiceListener);win?.destroy();},
  };
}
module.exports={createAssistant};
