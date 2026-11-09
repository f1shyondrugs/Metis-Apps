import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../desktop/main.cjs", import.meta.url));
const main = fs.readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
test("Linux hub:pair without keyring or X11 saves, resumes and unpairs a terminal-capable client", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "metis-linux-pairing-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = { appData: directory };
  const handlers = new Map();
  let enrollment;
  const electron = {
    app: { getPath: name => paths[name], setPath: (name, value) => paths[name] = value,
      setName() {}, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => false, quit() {}, getVersion: () => "1.4.7" },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => "basic_text" },
    screen: { getAllDisplays: () => [] },
  };
  const context = vm.createContext({
    require: name => name === "electron" ? electron : name === "electron-updater" ? { autoUpdater: {} }
      : name === "./computer-use-overlay.cjs" ? { createComputerUseOverlay() {} }
      : name === "./credential-store.cjs" ? { createCredentialStore: options => require("./credential-store.cjs").createCredentialStore({ ...options, platform: "linux" }) } : require(name),
    process: { platform: "linux", env: { WAYLAND_DISPLAY: "wayland-1", XDG_SESSION_TYPE: "wayland" } },
    module: { exports: {} }, __dirname: path.dirname(new URL("../desktop/main.cjs", import.meta.url).pathname), Buffer, URL, AbortSignal, console,
    fetch: async (url, init) => { enrollment = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ client: { id: "test-device", permissionMode: "user" }, credential: "test-only-secret" }) }; },
  });
  vm.runInContext(main + '\nstartRuntime = async () => { globalThis.runtimeConfig = config; }; registerIpc();', context);
  const webContents = { mainFrame: { url: new URL("../desktop/index.html", import.meta.url).href }, send() {} };
  context.testWindow = { webContents };
  vm.runInContext("window = testWindow;", context);
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  assert.throws(() => handlers.get("hub:state")({ sender: {}, senderFrame: webContents.mainFrame }), /Access denied/);
  const paired = await handlers.get("hub:pair")(event, { server: "https://metis.example", token: "u_test" });
  assert.equal(paired.paired, true); assert.equal(paired.connection, "connecting");
  assert.equal(paired.credential, undefined);
  assert.equal(enrollment.url, "https://metis.example/api/remote-clients/enroll");
  assert.equal(enrollment.body.capabilities.includes("desktop_gui"), false);
  assert.equal(enrollment.body.capabilities.includes("user_files"), true);
  assert.equal(context.runtimeConfig.credential, "test-only-secret");
  vm.runInContext("config = loadConfig();", context);
  assert.equal(handlers.get("hub:state")(event).paired, true);
  assert.equal(vm.runInContext("config.credential", context), "test-only-secret");
  assert.equal((await handlers.get("hub:unpair")(event)).paired, false);
  assert.equal(fs.existsSync(path.join(paths.userData, "config.json")), false);
});
