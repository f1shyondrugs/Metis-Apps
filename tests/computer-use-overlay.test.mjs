import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import overlayPackage from "../desktop/computer-use-overlay.cjs";

const { createComputerUseOverlay } = overlayPackage;

function fixture(hideFromCapture = true) {
  const displays = [
    { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  ];
  const screen = new EventEmitter();
  screen.getAllDisplays = () => displays;
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.scripts = [];
      this.webContents = new EventEmitter();
      this.webContents.isLoading = () => false;
      this.webContents.executeJavaScript = (script) => { this.scripts.push(script); return Promise.resolve(); };
      windows.push(this);
    }
    setAlwaysOnTop(value, level) { this.level = value && level; }
    setIgnoreMouseEvents(value, options) { this.ignoreMouse = value; this.mouseOptions = options; }
    setContentProtection(value) { this.protected = value; }
    loadURL(url) { this.url = url; }
    setBounds(bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.visible = false; this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
    on() {}
  }
  const shortcuts = new Map();
  let escape;
  let cancelled = 0;
  const globalShortcut = {
    register(key, callback) { shortcuts.set(key, callback); escape = callback; return true; },
    unregister(key) { shortcuts.delete(key); escape = shortcuts.values().next().value; },
  };
  const overlay = createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel: () => { cancelled++; }, hideFromCapture });
  return { overlay, windows, screen, displays, getEscape: () => escape, getCancelled: () => cancelled, shortcuts, globalShortcut };
}

test("computer-use overlay covers every display and stays out of captures", () => {
  const { overlay, windows, getEscape, getCancelled } = fixture();

  overlay.touch();
  assert.equal(windows.length, 2);
  for (const item of windows) {
    assert.equal(item.visible, true);
    assert.equal(item.protected, true);
    assert.equal(item.ignoreMouse, true);
    assert.notEqual(item.mouseOptions?.forward, true, "Passive overlays must not forward native mouse events through Electron");
    assert.equal(item.level, "screen-saver");
    const html = decodeURIComponent(item.url);
    assert.match(html, /Metis is using your computer/);
    assert.match(html, /Press Esc to cancel/);
    assert.match(html, /class="edge"/);
    assert.match(html, /prefers-reduced-motion/);
    assert.match(html, /M7\.1 4\.15C4\.05 3\.4 1\.72 6\.15/);
  }
  assert.deepEqual(windows.map((item) => item.options.x), [-1920, 0]);

  windows[0].webContents.isLoading = () => true;
  overlay.updateCursor(-1800, 120);
  assert.equal(windows[0].scripts.length, 0);
  windows[0].webContents.isLoading = () => false;
  windows[0].webContents.emit("did-finish-load");
  assert.match(windows[0].scripts.at(-1), /window\.metisCursor\?\.\(120,120,true\)/);
  overlay.suspendCapture();
  assert.ok(windows.every((item) => !item.visible));
  overlay.resumeCapture();
  assert.ok(windows.every((item) => item.visible));

  getEscape()();
  assert.equal(getCancelled(), 1);
  assert.ok(windows.every((item) => !item.visible));
  assert.equal(getEscape(), undefined);
  overlay.resumeCapture();
  assert.ok(windows.every((item) => !item.visible));
});


test("stream visibility switches live and applies to new monitors without ending control", () => {
  const { overlay, windows, screen, displays, getEscape, getCancelled } = fixture(false);
  try {
    overlay.touch();
    assert.ok(windows.every(w => w.visible && !w.protected));
    overlay.setHideFromCapture(true);
    assert.ok(windows.every(w => w.visible && w.protected));
    overlay.suspendCapture();
    overlay.setHideFromCapture(false);
    assert.ok(windows.every(w => !w.visible && !w.protected));
    displays.push({ id: 3, bounds: { x: 2560, y: 0, width: 1920, height: 1080 } });
    screen.emit("display-added");
    assert.equal(windows.length, 3);
    assert.ok(windows.every(w => !w.visible && !w.protected));
    overlay.resumeCapture();
    assert.ok(windows.every(w => w.visible && !w.protected));
    windows[0].destroyed = true;
    windows[0].setContentProtection = () => { throw Error("Destroyed window touched"); };
    overlay.setHideFromCapture(true);
    assert.ok(windows.slice(1).every(w => w.protected));
    assert.equal(getCancelled(), 0);
    assert.equal(typeof getEscape(), "function");
    assert.throws(() => overlay.setHideFromCapture("false"), /boolean/);
  } finally { overlay.hide(); }
});

test("account theme reaches existing, loading and newly attached displays without ending control", () => {
  const { overlay, windows, screen, displays, getEscape, getCancelled } = fixture();
  try {
    overlay.touch();
    const theme = {version:1, mode:"light", variables:{"--primary":"#685139"}};
    windows[0].webContents.isLoading = () => true;
    assert.equal(overlay.setAppearance(theme), true);
    assert.match(windows[1].scripts.at(-1), /#685139/);
    windows[0].webContents.isLoading = () => false;
    windows[0].webContents.emit("did-finish-load");
    assert.ok(windows[0].scripts.some(script => /#685139/.test(script)));
    displays.push({id:3, bounds:{x:2560,y:0,width:1920,height:1080}});
    screen.emit("display-added");
    assert.match(decodeURIComponent(windows[2].url), /#685139/);
    assert.equal(overlay.setAppearance({version:2}),false);
    assert.ok(windows.every(w => w.visible && w.protected && w.ignoreMouse));
    assert.equal(typeof getEscape(), "function");
    assert.equal(getCancelled(),0);
  } finally { overlay.hide(); }
});

test("changing the cancellation shortcut reserves the new key and preserves the old one on conflict or save failure", () => {
  const {overlay,windows,shortcuts,globalShortcut,getCancelled}=fixture();
  try {
    overlay.touch();
    overlay.setCancelShortcut("Ctrl+Shift+X");
    assert.equal(shortcuts.has("Escape"),false);
    assert.equal(shortcuts.has("Control+Shift+X"),true);
    assert.ok(windows.every(w=>w.scripts.some(s=>s.includes("Ctrl + Shift + X"))));
    globalShortcut.register=()=>false;
    assert.throws(()=>overlay.setCancelShortcut("F9"),/unavailable/);
    assert.equal(shortcuts.has("Control+Shift+X"),true);
    globalShortcut.register=(key,callback)=>{shortcuts.set(key,callback);return true;};
    assert.throws(()=>overlay.setCancelShortcut("F8",()=>{throw Error("Disk full");}),/Disk full/);
    assert.equal(shortcuts.has("F8"),false);
    assert.equal(shortcuts.has("Control+Shift+X"),true);
    shortcuts.get("Control+Shift+X")();
    assert.equal(getCancelled(),1);
    assert.equal(shortcuts.size,0);
  } finally {overlay.hide();}
});

test("injected cancellation keys do not cancel the agent's own input", async () => {
  const {overlay,shortcuts,getCancelled}=fixture();
  try {
    overlay.setCancelShortcut("F8");
    assert.equal(shortcuts.size,0,"Idle shortcut checks release the reservation");
    overlay.touch();
    overlay.suppressInjectedShortcut("F8");
    shortcuts.get("F8")();
    assert.equal(getCancelled(),0);
    await new Promise(resolve=>setTimeout(resolve,1050));
    shortcuts.get("F8")();
    assert.equal(getCancelled(),1);
  } finally {overlay.hide();}
});

test("slow overlay renderers retain only the newest cursor update", async () => {
  const { overlay, windows } = fixture();
  try {
    overlay.touch();
    const calls=[]; let finish;
    windows[1].webContents.executeJavaScript=script=>{calls.push(script);return new Promise(resolve=>{finish=resolve})};
    overlay.updateCursor(100,100);
    for(let i=0;i<10000;i++)overlay.updateCursor(100+i%100,100);
    assert.equal(calls.length,1);
    finish(); for(let i=0;i<8;i++)await Promise.resolve();
    assert.equal(calls.length,2);
    assert.match(calls[1],/199,100,true/);
  } finally {overlay.hide()}
});
test("ending control releases every overlay renderer and the next action recreates only current displays",()=>{
  const {overlay,windows}=fixture();
  overlay.touch();overlay.hide();
  assert.ok(windows.every(w=>w.destroyed&&!w.visible));
  overlay.touch();
  assert.equal(windows.length,4);
  assert.ok(windows.slice(2).every(w=>!w.destroyed&&w.visible));
  overlay.hide();
});
