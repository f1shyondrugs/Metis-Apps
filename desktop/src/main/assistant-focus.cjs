// Activate only on an explicit text action; restore only what Metis displaced.
function createForegroundRestore() {
  if (process.platform !== 'win32') return { remember() {}, restore() {}, keepPassive() {}, activate() { return true; } };
  const koffi = require('koffi'), user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
  const get = user32.func('uintptr_t GetForegroundWindow()');
  const set = user32.func('bool SetForegroundWindow(uintptr_t)');
  const valid = user32.func('bool IsWindow(uintptr_t)');
  const thread = user32.func('uint32_t GetWindowThreadProcessId(uintptr_t, void *)');
  const currentThread = kernel32.func('uint32_t GetCurrentThreadId()');
  const attach = user32.func('bool AttachThreadInput(uint32_t, uint32_t, bool)');
  const bring = user32.func('bool BringWindowToTop(uintptr_t)');
  const focus = user32.func('uintptr_t SetFocus(uintptr_t)');
  const active = user32.func('uintptr_t SetActiveWindow(uintptr_t)');
  const visible = user32.func('bool IsWindowVisible(uintptr_t)');
  const style = user32.func('intptr_t GetWindowLongPtrW(uintptr_t,int)');
  let previous, history=[];
  const handle = win => Number(win.getNativeWindowHandle().readBigUInt64LE());
  const eligible = hwnd => hwnd && valid(hwnd) && visible(hwnd) && !(Number(style(hwnd,-20))&0x08000000);
  function rememberTarget(hwnd) {
    if (eligible(hwnd)) history=[hwnd,...history.filter(x=>x!==hwnd)].slice(0,4);
  }
  function keepPassive(win) {
    const own=handle(win), current=get();
    if(Number(current)!==own) { rememberTarget(current); return; }
    const target=history.find(hwnd=>Number(hwnd)!==own&&valid(hwnd)&&visible(hwnd));
    if(target)set(target);
  }
  function activate(win) {
    const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    const current = currentThread(), linked = [];
    try {
      for (const id of new Set([thread(get(), null), thread(hwnd, null)])) {
        if (id && id !== current && attach(current, id, true)) linked.push(id);
      }
      bring(hwnd); active(hwnd); set(hwnd); focus(hwnd);
    } finally {
      for (const id of linked.reverse()) attach(current, id, false);
    }
    // Detaching input queues can restore their previous active window. Commit
    // the explicit activation in our own queue before reporting success.
    active(hwnd); set(hwnd); focus(hwnd);
    return Number(get()) === hwnd;
  }
  return {
    remember(win) { const current=get(); previous=(!win||Number(current)!==handle(win))&&eligible(current)?current:history.find(hwnd=>eligible(hwnd)&&(!win||Number(hwnd)!==handle(win))); rememberTarget(previous); },
    keepPassive,
    activate,
    isActive: win => Number(get())===handle(win),
    restore() { if (eligible(previous)) set(previous); previous = null; }
  };
}
module.exports = { createForegroundRestore };
