/* eslint-disable @typescript-eslint/no-require-imports */
const { utilityProcess, app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, safeStorage, Notification, dialog, screen, globalShortcut, systemPreferences, desktopCapturer } = require("electron");
const { createComputerUseOverlay } = require("./computer-use-overlay.cjs");
const appearance = require("./appearance.cjs");
let currentAppearance = appearance.fallback;
const { getDesktopAutostart, setDesktopAutostart } = require("./platform.cjs");
const { autoUpdater } = require("electron-updater");
const { createCredentialStore } = require("./credential-store.cjs");
const { createOverlayPreferences } = require("./overlay-preferences.cjs");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");

const APP_NAME = "Metis";
const { createDesktop } = require("./src/main/web-window.cjs");
const { normalizeServer, sameOrigin } = require("./policy.cjs");
let desktop;
let desktopOpening;
let assistant;
async function showDesktop() {
  if (!desktop || desktop.win.isDestroyed()) {
    desktopOpening ||= createDesktop({ initialServer: config?.server, onDevices: showWindow, onDeviceState: publicState, onAssistant: () => assistant?.open(), onShortcutsChange: setDesktopShortcuts, onShortcutCapture: value => assistant?.pauseShortcuts(value), shouldHide: () => !quitting })
      .then(value => { desktop = value; return value; }).finally(() => { desktopOpening = null; });
    await desktopOpening;
  }
  if (desktop.win.isMinimized()) desktop.win.restore();
  desktop.win.show();
  desktop.win.focus();
}
async function openDesktopChat(id, expectedServer) {
  await showDesktop();
  const server = desktop.getState().server;
  if (expectedServer && !sameOrigin(server,expectedServer)) {
    desktop.settings();
    return;
  }
  if (id) await desktop.getView()?.webContents.loadURL(new URL("/?c="+encodeURIComponent(id),server).href);
}
const AUTOSTART_TASK = "Metis AI Remote Client";
let autostartEnabled = false;
let autostartLookup;
let autostartRevision = 0;
let autostartChange = Promise.resolve();
let lastTrayKey = "";

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // Windows process creation can itself take hundreds of milliseconds. Keep
    // both CreateProcess and command completion outside Electron's UI thread.
    const worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const { execFile } = require("node:child_process");
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", workerData],
        { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => parentPort.postMessage(error
          ? { ok: false, error: stderr?.trim() || error.message || "Windows task setting failed" }
          : { ok: true, stdout: stdout.trim() }));
    `, { eval: true, workerData: Buffer.from(script, "utf16le").toString("base64") });
    let settled = false;
    worker.once("message", result => {
      settled = true;
      if (result.ok) resolve(result.stdout);
      else reject(new Error(result.error));
      void worker.terminate();
    });
    worker.once("error", error => { settled = true; reject(error); });
    worker.once("exit", code => { if (!settled) reject(new Error("Windows settings worker exited (" + code + ")")); });
  });
}

async function isElevated() {
  if (process.platform !== "win32") return false;
  return await runPowerShell("$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)") === "True";
}

function getAutostart() {
  if (process.platform !== "win32") {
    autostartEnabled = getDesktopAutostart(app);
    return Promise.resolve(autostartEnabled);
  }
  if (autostartLookup) return autostartLookup;
  const revision = autostartRevision;
  autostartLookup = runPowerShell(`$task = Get-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK)} -ErrorAction SilentlyContinue; [bool]$task`)
    .then(value => { if (revision === autostartRevision) autostartEnabled = value === "True"; updateTray(); return autostartEnabled; })
    .catch(() => autostartEnabled)
    .finally(() => { autostartLookup = undefined; });
  return autostartLookup;
}

function setAutostart(enabled) {
  const revision = ++autostartRevision;
  const operation = autostartChange.catch(() => {}).then(async () => {
  if (process.platform !== "win32") {
    const value = await setDesktopAutostart(app, enabled);
    if (revision === autostartRevision) autostartEnabled = value;
    updateTray();
    return value;
  }
  const taskName = psQuote(AUTOSTART_TASK);
  if (enabled) {
    const runLevel = config?.permissionMode === "admin" ? "Highest" : "Limited";
    await runPowerShell(`$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; $action = New-ScheduledTaskAction -Execute ${psQuote(process.execPath)}; $trigger = New-ScheduledTaskTrigger -AtLogon -User $user; $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel ${runLevel}; Register-ScheduledTask -TaskName ${taskName} -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null`);
  } else {
    await runPowerShell(`Unregister-ScheduledTask -TaskName ${taskName} -Confirm:$false -ErrorAction SilentlyContinue`);
  }
  if (revision === autostartRevision) autostartEnabled = enabled;
  updateTray();
  return enabled;
  });
  autostartChange = operation;
  return operation;
}
// Preserve the OS keychain service and pairing identity used by installed clients.
app.setName("Metis AI Remote Client");
app.commandLine.appendSwitch("lang", "en-US");
const userDataDir = process.env.METIS_DESKTOP_TEST_DATA || path.join(app.getPath("appData"), "MetisAI", "RemoteClient");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
let window;
let tray;
let runtime;
let computerUseOverlay;
let overlayPreferences;
let computerUseCursorTimer;
let config;
let quitting = false;
let previousConnection = "offline";
const status = { connection: "offline", error: "", update: "", desktopAvailable: false, desktopReason: "Checking desktop permissions…", platform: process.platform };
let desktopProbeTimer;
async function probeDesktop() {
  try {
    if (process.platform === "win32") {
      status.desktopAvailable = screen.getAllDisplays().length > 0;
      status.desktopReason = status.desktopAvailable ? "" : "No interactive display";
    } else {
      const { unixComputerUse } = await import(pathToFileURL(path.join(__dirname, "computer-use-unix.mjs")).href);
      const result = await unixComputerUse({ operation: "status" });
      status.desktopAvailable = Boolean(result.available);
      status.desktopReason = result.reason || "";
    }
  } catch (error) { status.desktopAvailable = false; status.desktopReason = error.stderr?.trim() || error.message; }
  runtime?.setCapabilities({ desktopAvailable: status.desktopAvailable, nativeNotifications: screen.getAllDisplays().length > 0 && Notification.isSupported() });
  broadcast();
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

const credentialStore = createCredentialStore({ file: configPath(), safeStorage });
function loadConfig() { return credentialStore.load(); }
function saveConfig(next) { credentialStore.save(next); }

function setDesktopShortcuts(value) {
  const next = require("./assistant-shortcuts.cjs").normalize(value, overlayPreferences.getCancelShortcut());
  computerUseOverlay.setCancelShortcut(next.cancel, () => overlayPreferences.setAssistantShortcuts(next));
  assistant?.shortcutsChanged();
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById("metis-device-settings");
  if (menuItem) menuItem.accelerator = next.deviceSettings;
  broadcast();
  return next;
}

function setOverlayCaptureHidden(value) {
  if (typeof value !== "boolean") throw new TypeError("Capture visibility must be a boolean");
  const previous = overlayPreferences.get();
  try {
    computerUseOverlay.setHideFromCapture(value);
    overlayPreferences.set(value);
  } catch (error) {
    computerUseOverlay.setHideFromCapture(previous);
    throw error;
  }
  broadcast();
  return value;
}

function publicState() {
  return {
    paired: Boolean(config),
    server: config?.server || "",
    clientId: config?.clientId || "",
    version: app.getVersion(),
    assistant: assistant?.state(),
    permissionMode: config?.permissionMode || null,
    platform: process.platform,
    hideOverlayFromCapture: overlayPreferences?.get() ?? true,
    appearance: currentAppearance,
    cancelShortcut: overlayPreferences?.getCancelShortcut?.() ?? "Escape",
    ...status,
  };
}

async function openMacPrivacySettings() {
  if (process.platform !== "darwin") return;
  for (const url of [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  ]) {
    await new Promise((resolve, reject) => execFile("open", [url], { timeout: 8000 }, error => error ? reject(error) : resolve()));
  }
}

async function promptMacDesktopPermissions() {
  try { systemPreferences.isTrustedAccessibilityClient(true); } catch { /* prompt is best-effort */ }
  try {
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
  } catch { /* first Screen Recording prompt, or already denied */ }
  await openMacPrivacySettings();
}

async function desktopPermissionStatus(prompt = false) {
  if (process.platform === "win32") return { available: true, platform: "win32" };
  if (prompt && process.platform === "darwin") await promptMacDesktopPermissions();
  const { unixComputerUse } = await import(pathToFileURL(path.join(__dirname, "computer-use-unix.mjs")).href);
  const status = await unixComputerUse({ operation: prompt ? "request_permissions" : "status" });
  return prompt && process.platform === "darwin" ? { ...status, openedSettings: true } : status;
}

function desktopPermissionAlertText(status) {
  if (!status || status.available) return "";
  const missing = [];
  if (status.screenRecording === false) missing.push("Screen Recording");
  if (status.accessibility === false) missing.push("Accessibility");
  if (missing.length) {
    return `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not enabled. Desktop control will not work until you grant them in System Settings, then restart this app.`;
  }
  return status.reason || "Desktop control is blocked until OS permissions are granted.";
}

async function warnIfDesktopPermissionsMissing() {
  if (process.platform === "win32") return;
  try {
    const detail = desktopPermissionAlertText(await desktopPermissionStatus(false));
    if (!detail) return;
    const buttons = process.platform === "darwin" ? ["Grant permissions", "OK"] : ["OK"];
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: APP_NAME,
      message: "Desktop permissions are not enabled",
      detail,
      buttons,
      defaultId: 0,
      noLink: true,
    });
    if (process.platform === "darwin" && response === 0) await desktopPermissionStatus(true);
  } catch {
    // Older installs may not ship the in-process macOS desktop library.
  }
}

function broadcast() {
  window?.webContents.send("hub:status", publicState());
  tray?.setToolTip(`${APP_NAME} — ${status.connection}`);
  updateTray();
}

function cancelComputerUse() {
  runtime?.cancelComputerUse();
  clearInterval(computerUseCursorTimer);
  computerUseCursorTimer = undefined;
  computerUseOverlay?.hide();
}

function trayImage() {
  const file = path.join(__dirname, "assets", "brand.png");
  const size = process.platform === "darwin" ? 18 : 16;
  return nativeImage.createFromPath(file).resize({ width: size, height: size, quality: "best" });
}

function updateTray() {
  if (!tray) return;
  const key = JSON.stringify([status.connection, Boolean(config), autostartEnabled, overlayPreferences?.getAssistantShortcuts?.()]);
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Metis", click: () => void showDesktop() },
    { label: "Open Desktop Assistant", accelerator: assistant?.state().hotkey || "Control+Shift+Space", registerAccelerator: false, click: () => void assistant?.open() },
    { label: "Open Remote Client Device Settings", click: () => showWindow() },
    { label: `Connection: ${status.connection}`, enabled: false },
    { type: "separator" },
    { label: "Start at login", type: "checkbox", checked: autostartEnabled,
      click: async (item) => { try { await setAutostart(item.checked); } catch (error) { lastTrayKey = ""; status.error = error.message; broadcast(); } } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (!window) createWindow();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 390,
    minHeight: 560,
    title: "Metis — Remote Client Device Settings",
    icon: path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#fafafa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadFile(path.join(__dirname, "index.html"));
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => { window = null; });
}

function startComputerUseCursor() {
  clearInterval(computerUseCursorTimer);
  const update = () => {
    const point = screen.getCursorScreenPoint();
    computerUseOverlay?.updateCursor(point.x, point.y);
  };
  update();
  computerUseCursorTimer = setInterval(update, 24);
  computerUseCursorTimer.unref?.();
}

function stopComputerUseCursor() {
  clearInterval(computerUseCursorTimer);
  computerUseCursorTimer = undefined;
  const point = screen.getCursorScreenPoint();
  computerUseOverlay?.updateCursor(point.x, point.y);
  computerUseOverlay?.hideCursor(650);
}

async function startRuntime() {
  computerUseOverlay?.hide();
  runtime?.stop();
  runtime = null;
  currentAppearance = appearance.fallback;
  computerUseOverlay?.setAppearance(currentAppearance);
  broadcast();
  if (!config) return;
  const { startDeviceHost } = require("./src/device/runtime.cjs");
  const { showNativeNotification } = require("./notification-native.cjs");
  runtime = startDeviceHost({
    utilityProcess,
    config,
    configPath: configPath(),
    capabilities: { desktopAvailable: status.desktopAvailable, nativeNotifications: screen.getAllDisplays().length > 0 && Notification.isSupported() },
    showNotification: notification => showNativeNotification({ Notification, openChat: openDesktopChat, server: config.server, notification }),
    onEvent(event) {
      if (event.type === "appearance") {
        const next = appearance.normalize(event.appearance);
        if (next && JSON.stringify(next) !== JSON.stringify(currentAppearance)) {
          currentAppearance = next;
          computerUseOverlay?.setAppearance(next);
          assistant?.setAppearance(next);
          broadcast();
        }
        return;
      }
      if (event.type === "computer_use") {
        if (event.phase === "start") {
          computerUseOverlay?.touch();
          if (event.operation === "key") computerUseOverlay?.suppressInjectedShortcut(event.key);
          startComputerUseCursor();
        } else if (event.phase === "end") stopComputerUseCursor();
        else if (event.phase === "capture-start") computerUseOverlay?.suspendCapture();
        else if (event.phase === "capture-end") computerUseOverlay?.resumeCapture();
        return;
      }
      if (event.type !== "connection") return;
      if (event.status !== "online") {
        clearInterval(computerUseCursorTimer);
        computerUseCursorTimer = undefined;
        computerUseOverlay?.hide();
      }
      previousConnection = status.connection;
      status.connection = event.status;
      status.error = event.error || "";
      if (event.status === "online" && previousConnection === "offline" && Notification.isSupported()) {
        new Notification({ title: APP_NAME, body: "Connection restored" }).show();
      }
      broadcast();
    },
  });
}

async function fetchSnapshot() {
  if (!config) return { client: null, audit: [] };
  const response = await fetch(`${config.server}/api/remote-clients/hub`, {
    headers: {
      "x-metis-client-id": config.clientId,
      Authorization: `Bearer ${config.credential}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Hub request failed (${response.status})`);
  return data;
}

function registerIpc() {
  const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(path.join(__dirname, "index.html")).href) throw new Error("Access denied.");
    return handler(event, ...args);
  });
  handle("hub:state", () => publicState());
  handle("hub:snapshot", () => fetchSnapshot());
  handle("hub:pair", async (_event, input) => {
    const server = normalizeServer(input?.server).replace(/\/+$/, "");
    const token = String(input?.token || "").trim();
    let parsed;
    try { parsed = new URL(server); } catch { throw new Error("Enter a valid server URL"); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("Enter a valid HTTP or HTTPS server URL");
    }
    if (!token) throw new Error("Enter the pairing code from Metis");
    const permissionMode = token.startsWith("a_") ? "admin" : "user";
    if (process.platform === "win32") {
      const elevated = await isElevated();
      if (permissionMode === "admin" && !elevated) throw new Error("Admin access was selected in Metis. Start this app as administrator and confirm UAC, then enter the same code.");
      if (permissionMode === "user" && elevated) throw new Error("User access was selected in Metis. Start this app normally, without administrator rights, then enter the same code.");
    }
    const response = await fetch(`${parsed.origin}/api/remote-clients/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        name: os.hostname(),
        hostname: os.hostname(),
        os: `${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"} ${os.release()}`,
        architecture: os.arch(),
        version: app.getVersion(),
        permissionMode,
        capabilities: [
          ...(permissionMode === "admin"
            ? ["user_files", "user_processes", "user_directories", "system_files", "services", "disks", "admin_processes"]
            : ["user_files", "user_processes", "user_directories"]),
          ...(status.desktopAvailable ? ["desktop_gui"] : []),
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok || !data.client?.id || !data.credential) {
      throw new Error(data.error || "Pairing failed");
    }
    if (data.client.permissionMode !== permissionMode) throw new Error("The server returned a different access mode. Pairing was stopped.");
    const next = { server: parsed.origin, clientId: data.client.id, credential: data.credential, permissionMode: data.client.permissionMode };
    saveConfig(next);
    config = next;
    status.connection = "connecting";
    status.error = "";
    await startRuntime();
    broadcast();
    return publicState();
  });
  handle("hub:unpair", async () => {
    computerUseOverlay?.hide();
    runtime?.stop();
    runtime = null;
    config = null;
    currentAppearance = appearance.fallback;
    computerUseOverlay?.setAppearance(currentAppearance);
    assistant?.setAppearance(currentAppearance);
    fs.rmSync(configPath(), { force: true });
    status.connection = "offline";
    status.error = "";
    broadcast();
    return publicState();
  });
  handle("hub:open-server", () => showDesktop());
  handle("hub:export", async () => {
    const snapshot = await fetchSnapshot();
    const result = await dialog.showSaveDialog(window, {
      title: "Export command history",
      defaultPath: `metis-remote-commands-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), audit: snapshot.audit }, null, 2), "utf8");
    return true;
  });
  handle("hub:set-overlay-capture-hidden", (_event, value) => setOverlayCaptureHidden(value));
  handle("hub:set-cancel-shortcut", (_event, value) => {
    const next = computerUseOverlay.setCancelShortcut(value, key => overlayPreferences.setCancelShortcut(key));
    assistant?.shortcutsChanged();
    broadcast();
    return next;
  });
  handle("hub:get-autostart", () => getAutostart());
  handle("hub:set-autostart", async (_event, value) => {
    const enabled = await setAutostart(Boolean(value));
    updateTray();
    return enabled;
  });
  handle("hub:desktop-access", async () => {
    if (process.platform === "darwin") {
      systemPreferences.isTrustedAccessibilityClient(true);
      await desktopCapturer.getSources({ types: ["screen"] });
      await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    }
    await probeDesktop();
    return publicState();
  });
  handle("hub:check-updates", async () => {
    if (!app.isPackaged) return "Updates are available in installed builds";
    if (!configureUpdater()) return "Updates are unavailable in this build";
    try {
      await autoUpdater.checkForUpdates();
      return status.update || "Checking for updates";
    } catch (error) {
      status.update = error.message || "Update check failed";
      broadcast();
      return status.update;
    }
  });
  handle("hub:desktop-permissions", async (_event, input) => desktopPermissionStatus(Boolean(input?.prompt)));
}

function configureUpdater() {
  if (!app.isPackaged) return false;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "f1shyondrugs",
    repo: "Metis-Apps",
  });
  autoUpdater.disableDifferentialDownload = true;
  return true;
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", () => {
    status.update = "Downloading update";
    broadcast();
  });
  autoUpdater.on("update-not-available", () => {
    status.update = "Up to date";
    broadcast();
  });
  autoUpdater.on("update-downloaded", () => {
    status.update = "Update ready; restart the app to install";
    broadcast();
    if (Notification.isSupported()) new Notification({ title: APP_NAME, body: status.update }).show();
  });
  autoUpdater.on("error", (error) => {
    status.update = error.message || "Update check failed";
    broadcast();
  });
  const check = () => configureUpdater() && autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 20_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  const { forwardSecondInstance } = require("./src/main/reopen.cjs");
  void forwardSecondInstance({
    platform: process.platform,
    ready: () => app.whenReady(),
    isElevated,
    requestActivation: () => require("./src/main/window-activation.cjs").requestWindowActivation(userDataDir),
    reportError: () => dialog.showErrorBox(APP_NAME, "Metis is still running, but the window could not be reopened. Use Open Metis from the tray."),
    quit: () => app.quit(),
  });
} else {
  app.on("second-instance", () => void showDesktop());
  app.on("activate", () => void showDesktop());
  let markDesktopReady;
  const desktopReady = new Promise(resolve => { markDesktopReady = resolve; });
  const activationListener = process.platform === "win32"
    ? require("./src/main/window-activation.cjs").listenForWindowActivation({
      directory: userDataDir,
      activate: () => desktopReady.then(() => showDesktop()),
      onError: () => {}, // Native second-instance/tray activation remains available.
    }) : null;
  app.whenReady().then(async () => {
    app.setAppUserModelId(process.env.METIS_DESKTOP_TEST_DATA ? "ai.metis.remoteclient.test" : "ai.metis.remoteclient");
    try { config = loadConfig(); } catch (error) { status.error = error.message; }
    if (process.platform === "win32" && config?.permissionMode === "admin" && !(await isElevated())) {
      try {
        app.releaseSingleInstanceLock();
        await runPowerShell(`Start-Process -FilePath ${psQuote(process.execPath)} -Verb RunAs`);
      } catch (error) {
        dialog.showErrorBox(APP_NAME, error.message || "Administrator access was not confirmed.");
      }
      app.quit();
      return;
    }
    if (process.platform === "win32" && config?.permissionMode === "user" && await isElevated()) {
      dialog.showErrorBox(APP_NAME, "This device was paired with user access. Start the app normally, without administrator rights.");
      app.quit();
      return;
    }
    if (process.platform === "win32" && app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: false, path: process.execPath });
      try { await setAutostart(true); } catch (error) { status.error = error.message; }
    }
    try {
      overlayPreferences = createOverlayPreferences(path.join(app.getPath("userData"), "preferences.json"));
    } catch (error) {
      status.error = "Could not load capture visibility: " + error.message;
      // Keep the previous hidden default, while allowing a later save to recover.
      const recover = (method, value) => {
        const recovered = createOverlayPreferences(path.join(app.getPath("userData"), "preferences.json"));
        const result = recovered[method](value);
        overlayPreferences = recovered;
        return result;
      };
      overlayPreferences = {
        get: () => true, getCancelShortcut: () => "Escape",
        getAssistantShortcuts: () => require("./assistant-shortcuts.cjs").normalize(),
        setAssistantShortcuts: value => recover("setAssistantShortcuts",value),
        set: value => recover("set", value),
        setCancelShortcut: value => recover("setCancelShortcut", value),
      };
    }
    computerUseOverlay = createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel: cancelComputerUse, hideFromCapture: overlayPreferences.get(), cancelShortcut: overlayPreferences.getCancelShortcut() });
    const { createAssistant } = require("./src/main/assistant.cjs");
    assistant = createAssistant({
      getServer: () => desktop?.getState().server || config?.server || require("./policy.cjs").DEFAULT_SERVER,
      getDevice: () => ({ clientId:config?.clientId || "", hostname:os.hostname(), platform:process.platform, version:app.getVersion() }),
      computerOverlay:computerUseOverlay, appearance:currentAppearance,
      getShortcuts: () => overlayPreferences.getAssistantShortcuts(), onDevices: showWindow,
      onOpenChat: id => openDesktopChat(id)
    });
    await probeDesktop();
    desktopProbeTimer = setInterval(() => { probeDesktop().catch(() => {}); }, 20_000);
    desktopProbeTimer.unref?.();
    registerIpc();
    createWindow();
    tray = new Tray(trayImage());
    updateTray();
    void getAutostart();
    await showDesktop();
    markDesktopReady();
    if (config) {
      try { await startRuntime(); } catch (error) {
        status.connection = "error";
        status.error = error.message;
        broadcast();
      }
    }
    setupUpdates();
    // Device permissions are requested from local settings when explicitly needed.
  });
  app.on("before-quit", () => {
    activationListener?.close();
    quitting = true;
    computerUseOverlay?.hide();
    assistant?.destroy();
    runtime?.stop();
  });
  app.on("window-all-closed", () => {});
}

module.exports = { showDesktop, showWindow, getDesktop: () => desktop, getDeviceWindow: () => window, getRuntimePid: () => runtime?.pid, getAssistant: () => assistant, publicState };
