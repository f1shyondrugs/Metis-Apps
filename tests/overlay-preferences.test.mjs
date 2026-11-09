import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import preferencesPackage from "../desktop/overlay-preferences.cjs";
const { createOverlayPreferences } = preferencesPackage;

test("capture preference defaults hidden, survives restarts, and is independent from pairing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "metis-overlay-"));
  const file = path.join(dir, "preferences.json");
  try {
    const store = createOverlayPreferences(file);
    assert.equal(store.get(), true);
    store.set(false);
    assert.equal(createOverlayPreferences(file).get(), false);
    writeFileSync(path.join(dir, "config.json"), "{}");
    rmSync(path.join(dir, "config.json"));
    assert.equal(createOverlayPreferences(file).get(), false);
    assert.throws(() => store.set("false"), /boolean/);
    assert.equal(createOverlayPreferences(file).get(), false);
    for (const content of ["{broken", "null", '{"hideOverlayFromCapture":"false"}']) {
      writeFileSync(file, content);
      const recovered = createOverlayPreferences(file);
      assert.equal(recovered.get(), true);
      recovered.set(false);
      assert.equal(createOverlayPreferences(file).get(), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failed preference save keeps the last value and cleans temporary data", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "metis-overlay-"));
  const file = path.join(dir, "preferences.json");
  try {
    const store = createOverlayPreferences(file);
    mkdirSync(file);
    assert.throws(() => store.set(false));
    assert.equal(store.get(), true);
    assert.equal(existsSync(file + ".tmp"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real main IPC validates, broadcasts a successful toggle, and rolls back failed saves", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "metis-overlay-ipc-"));
  const require = createRequire(new URL("../desktop/main.cjs", import.meta.url));
  const handlers = new Map();
  const sent = [];
  let applied = true;
  const electron = {
    app: { getPath: () => dir, setPath() {}, setName() {}, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => false, quit() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    safeStorage: {},
  };
  const context = vm.createContext({
    require: name => name === "electron" ? electron : name === "electron-updater" ? {autoUpdater:{}} : require(name),
    process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval,
    __dirname: path.resolve(new URL("../desktop", import.meta.url).pathname),
    module: { exports: {} },
  });
  try {
    vm.runInContext(readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8") +
      '\nmodule.exports = { registerIpc, publicState, configure(p, o, w) { overlayPreferences=p; computerUseOverlay=o; window=w; } };', context);
    const main = context.module.exports;
    const store = createOverlayPreferences(path.join(dir, "preferences.json"));
    const overlay = {
      setHideFromCapture: value => { applied = value; },
      setCancelShortcut: (value,persist) => {
        const key=require("../desktop/cancel-shortcut.cjs").normalize(value);
        persist(key);
        return key;
      },
    };
    const window = { webContents: { mainFrame: { url: new URL("../desktop/index.html", import.meta.url).href }, send: (channel, value) => sent.push({channel,value}) } };
    main.configure(store, overlay, window);
    main.registerIpc();
    const toggle = handlers.get("hub:set-overlay-capture-hidden");
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    assert.throws(() => toggle({}, false), /Access denied/);
    assert.throws(() => toggle({ ...event, senderFrame: { url: event.senderFrame.url } }, false), /Access denied/);
    assert.equal(toggle(event, false), false);
    assert.equal(applied, false);
    assert.equal(main.publicState().hideOverlayFromCapture, false);
    assert.equal(sent.at(-1).value.hideOverlayFromCapture, false);
    assert.equal(createOverlayPreferences(path.join(dir, "preferences.json")).get(), false);
    assert.throws(() => toggle(event, "false"), /boolean/);
    assert.equal(applied, false);
    const shortcutHandler=handlers.get("hub:set-cancel-shortcut");
    assert.equal(shortcutHandler(event,"Ctrl+Shift+X"),"Control+Shift+X");
    assert.equal(main.publicState().cancelShortcut,"Control+Shift+X");
    assert.equal(sent.at(-1).value.cancelShortcut,"Control+Shift+X");
    assert.equal(createOverlayPreferences(path.join(dir,"preferences.json")).getCancelShortcut(),"Control+Shift+X");
    main.configure({get: () => false, set: () => {throw Error("Disk full");}}, overlay, window);
    const broadcasts = sent.length;
    assert.throws(() => toggle(event, true), /Disk full/);
    assert.equal(applied, false);
    assert.equal(sent.length, broadcasts);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
