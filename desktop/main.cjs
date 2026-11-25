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
const { pairingOrigin, enroll, fetchPairingSnapshot } = require("./src/main/device-pairing.cjs");
const { createAdminController, attachAdminRuntime } = require("./src/device/admin-controller.cjs");
const { serverArgument } = require("./src/main/recent-servers.cjs");
let desktop;
let desktopOpening;
let deviceSettingsWorkspace;
let onboardingReplay;
let assistant;
async function showDesktop() {
  if (!desktop || desktop.win.isDestroyed()) {
    desktopOpening ||= createDesktop({ initialServer: primarySession()?.config?.server, initialServerId: serverArgument(process.argv), onDevices: showWindow, onDeviceState: publicState, onAssistant: () => assistant?.open(), onShortcutsChange: setDesktopShortcuts, onShortcutCapture: value => assistant?.pauseShortcuts(value), onCaptureHidden: setOverlayCaptureHidden, onAutostart: setAutostart, onCheckUpdates: checkUpdates, onDesktopPermissions: async () => {await desktopPermissionStatus(true);await probeDesktop();return { desktopAvailable: status.desktopAvailable, desktopReason: status.desktopReason, platform: process.platform };}, shouldHide: () => !quitting && (!desktop || desktop.getWindows().length <= 1) })
      .then(value => { desktop = value; return value; }).finally(() => { desktopOpening = null; });
    await desktopOpening;
  }
  await desktop.show();
}
async function openDesktopChat(id, expectedServer) {
  await showDesktop();
  const entry = await desktop.openServer(expectedServer || desktop.getState().server);
  if(entry.getState().mode !== 'ready') await entry.load();
  if(entry.win.isMinimized())entry.win.restore();entry.win.show();entry.win.focus();
  if (id) await entry.getView()?.webContents.loadURL(new URL("/?c="+encodeURIComponent(id),entry.getState().server).href);
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

function runPowerShell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    // Windows process creation can itself take hundreds of milliseconds. Keep
    // both CreateProcess and command completion outside Electron's UI thread.
    const worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const { execFile } = require("node:child_process");
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", workerData.script],
        { encoding: "utf8", windowsHide: true, timeout: workerData.timeout, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => parentPort.postMessage(error
          ? { ok: false, error: stderr?.trim() || error.message || "Windows task setting failed" }
          : { ok: true, stdout: stdout.trim() }));
    `, { eval: true, workerData: {script:Buffer.from(script, "utf16le").toString("base64"),timeout} });
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

let windowsElevation;
function getWindowsElevation() {
 if(process.platform!=="win32")return null;
 if(windowsElevation)return windowsElevation;
 try{windowsElevation=require("./src/main/windows-token-identity.cjs").currentTokenIdentity().elevated?"administrator":"user";}catch{return "unknown";}
 return windowsElevation;
}
async function isElevated() {
 const value=getWindowsElevation();
 if(value==="unknown")throw Error("Windows administrator status could not be verified.");
 return value==="administrator";
}
function newAdministratorHost(session) {
  return createAdminController({
    developmentEntry: app.isPackaged ? undefined : path.join(__dirname, "bootstrap.cjs"),
    createChannel: options => require("./src/device/windows-channel.cjs").createChannel(options),
    launch: async args => Number(await runPowerShell(`$child = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(args.map(arg=>'"'+arg+'"').join(" "))} -Verb RunAs -PassThru; $child.Id`,120000)),
    onClosed: error => {
      if (sessions.get(session.origin) !== session || quitting) return;
      stopRuntime(session);
      Object.assign(session.status, { deviceElevation: null, connection: "error", accessMismatch: true, error: error.message });
      broadcast();
    },
  });
}

async function enableAdministratorClient(origin) {
  const session = requireSession(origin);
  if (process.platform !== "win32" || getWindowsElevation() !== "user" || session.config?.permissionMode !== "admin")
    throw Error("Select a saved Administrator pairing to approve Windows access.");
  if (session.admin?.connected && session.runtime) return hubState();
  session.admin ||= newAdministratorHost(session);
  await session.admin.ensure();
  if (!session.admin.connected) throw Error("Administrator Remote Client disconnected.");
  if (quitting || sessions.get(origin) !== session) throw Error("This pairing has changed.");
  session.status.accessMismatch = false;
  if (!session.runtime) await startOrReport(session);
  return hubState();
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
    // Autostart belongs to the normal UI. UAC applies only to the device host.
    const runLevel = "Limited";
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
const traceStartup=phase=>{if(process.env.METIS_DESKTOP_TEST_DATA)console.error("METIS_STARTUP",phase);};
traceStartup("profile-configured");
if(process.env.METIS_DESKTOP_TEST_DATA)traceStartup("profile-id-"+require("node:crypto").createHash("sha256").update(path.resolve(userDataDir).toLowerCase()).digest("hex").slice(0,12));
let window;
let tray;
const sessions = new Map();
const pendingPairings = new Map();
let sessionRevision = 0;
let inputOwner;
let captureOwner;
let annotationOwner;
let annotationRequests = 0;
const primarySession = () => sessions.values().next().value;
function sessionFor(server) {
  try { return sessions.get(pairingOrigin(server)); } catch { return undefined; }
}
function requireSession(origin) {
  const session = sessions.get(origin);
  if (!session) throw Error("Select a paired server.");
  return session;
}
let computerUseOverlay;
let annotationOverlay;
let overlayPreferences;
let computerUseCursorTimer;
let quitting = false;
const updates = require('./src/main/app-updates.cjs').createUpdateState();
const appUpdate = updates.value;
let updateController;
const updateWindow = require("./src/main/update-window.cjs").createUpdateWindow(BrowserWindow);
let installingUpdate = false;
let updateCheckTimer, updateInterval;
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
  for (const session of sessions.values()) session.runtime?.setCapabilities(runtimeCapabilities());
  broadcast();
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

const credentialStore = createCredentialStore({ file: configPath(), safeStorage });
function makeSession(origin, { config, error }) {
  const mismatch = process.platform === "win32" && getWindowsElevation() !== "user";
  const approval = process.platform === "win32" && config?.permissionMode === "admin";
  return { origin, config, revision: ++sessionRevision, epoch: 0, status: {
    connection: error ? "error" : "offline", accessMismatch: mismatch || approval,
    error: error || (mismatch ? "Windows process rights could not be verified. Device access is paused." : ""),
  } };
}

function originDataPath(origin) {
  const key = require("node:crypto").createHash("sha256").update(origin).digest("hex");
  const directory = path.join(userDataDir, "device-connections", key);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, "config.json");
}

function runtimeCapabilities() {
  return { desktopAvailable: status.desktopAvailable, overlayAnnotations: Boolean(annotationOverlay && status.desktopAvailable), nativeNotifications: screen.getAllDisplays().length > 0 && Notification.isSupported() };
}

function setDesktopShortcuts(value) {
  const next = require("./assistant-shortcuts.cjs").normalize(value, overlayPreferences.getCancelShortcut());
  computerUseOverlay.setCancelShortcut(next.cancel, () => overlayPreferences.setAssistantShortcuts(next));
  assistant?.shortcutsChanged();
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById("metis-device-settings");
  if (menuItem) menuItem.accelerator = next.deviceSettings;
  desktop?.refreshMenus();
  broadcast();
  return next;
}

function setOverlayCaptureHidden(value) {
  if (typeof value !== "boolean") throw new TypeError("Capture visibility must be a boolean");
  const previous = overlayPreferences.get();
  try {
    computerUseOverlay.setHideFromCapture(value);
    assistant?.setHideFromCapture(value);
    annotationOverlay?.setHideFromCapture(value);
    overlayPreferences.set(value);
  } catch (error) {
    computerUseOverlay.setHideFromCapture(previous);
    assistant?.setHideFromCapture(previous);
    annotationOverlay?.setHideFromCapture(previous);
    throw error;
  }
  broadcast();
  return value;
}

function publicState(server) {
  const session = server === undefined ? primarySession() : sessionFor(server);
  const config = session?.config;
  const device = session?.status;
  return {
    paired: Boolean(config) && !device?.accessMismatch,
    windowsElevation: getWindowsElevation(),
    backgroundClient: { running: Boolean(session?.runtime?.pid), elevation: device?.deviceElevation || null },
    server: config?.server || "",
    clientId: config?.clientId || "",
    version: app.getVersion(),
    autostartEnabled,
    appUpdate: { ...appUpdate },
    fileDrop: desktop?.getFileDropState?.(),
    assistant: assistant?.state(),
    permissionMode: config?.permissionMode || null,
    platform: process.platform,
    hideOverlayFromCapture: overlayPreferences?.get() ?? true,
    appearance: currentAppearance,
    cancelShortcut: overlayPreferences?.getCancelShortcut?.() ?? "Escape",
    ...status,
    ...device,
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

function hubState() {
  const serverRows = require("./src/main/device-servers.cjs").deviceServerRows(
    desktop?.getRecentServers() || [], sessions, os.hostname());
  return { ...publicState(), serverRows };
}

function broadcast() {
  window?.webContents.send("hub:status", hubState());
  tray?.setToolTip(`${APP_NAME} — ${[...sessions.values()].filter(session => session.status.connection === "online").length} connected`);
  updateTray();
}

function cancelComputerUse() {
  for (const session of sessions.values()) session.runtime?.cancelComputerUse();
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
  const connections = [...sessions.values()].map(session => session.status.connection);
  const key = JSON.stringify([connections, autostartEnabled, appUpdate.phase, overlayPreferences?.getAssistantShortcuts?.(), annotationOverlay?.status()]);
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Metis", click: () => void showDesktop() },
    { label: "New Window", click: () => { void showDesktop().then(()=>desktop.newWindow()).catch(error=>{status.error=error.message;broadcast();}); } },
    { label: "Open Desktop Assistant", accelerator: assistant?.state().hotkey || "Control+Shift+Space", registerAccelerator: false, click: () => void assistant?.open() },
    { label: "Open Remote Client Device Settings", click: () => showWindow() },
    { label: "Screen annotations", submenu: [
      { label: "Clear all annotations", click: () => annotationOverlay?.clearAll() },
      ...(annotationOverlay?.status().displays || []).flatMap(d => d.items.filter(i=>i.type==="card").map(i=>({ label: "Interact: "+d.name+" / "+i.id, click: () => { annotationOverlay.execute({operation:"interact",display_id:d.id,interactive_id:i.id}).catch(error=>{status.error=error.message;broadcast();}); } }))),
    ] },
    { label: `Desktop app: ${getWindowsElevation()==="administrator"?"Administrator":getWindowsElevation()==="unknown"?"Unverified":"Standard user"}`, enabled: false },
    { label: `Remote Client: ${connections.filter(value => value === "online").length} of ${connections.length} connected`, enabled: false },
    { type: "separator" },
    { label: "Start at login", type: "checkbox", checked: autostartEnabled,
      click: async (item) => { try { await setAutostart(item.checked); } catch (error) { lastTrayKey = ""; status.error = error.message; broadcast(); } } },
    { type: "separator" },
    { label: "Check for updates", click: () => void checkUpdates() },
    { label: "Install downloaded update", enabled: Boolean(updateController?.ready), click: () => { quitting=true;app.quit(); } },
    { label: "Export update diagnostics…", click: async () => {
      const result=await dialog.showSaveDialog({title:"Export update diagnostics",defaultPath:"metis-update-diagnostics.json",filters:[{name:"JSON",extensions:["json"]}]});
      if(!result.canceled && result.filePath)try{fs.writeFileSync(result.filePath,JSON.stringify(updateController?.report()||{phase:"not-initialized"},null,2),{mode:0o600});}
      catch{dialog.showErrorBox(APP_NAME,"The update diagnostics could not be saved.");}
    } },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}

function deviceSettingsOrigin() {
  try { return pairingOrigin(deviceSettingsWorkspace?.getState().server); } catch { return undefined; }
}

function showWindow(workspace) {
  deviceSettingsWorkspace = desktop?.getWindows().includes(workspace) ? workspace : desktop?.activeWindow;
  if (installingUpdate) { void updateWindow.show(); return; }
  if (!window) createWindow();
  window.webContents.send("hub:status", { ...hubState(), preferredOrigin: deviceSettingsOrigin() });
  window.show();
  window.focus();
}

async function showOnboardingReplay() {
  if (quitting || installingUpdate) throw new Error("Metis is closing.");
  if (onboardingReplay) { onboardingReplay.window.focus(); return; }
  const workspace = deviceSettingsWorkspace && !deviceSettingsWorkspace.win.isDestroyed()
    ? deviceSettingsWorkspace : desktop?.activeWindow;
  if (!workspace) throw new Error("No desktop window is available.");
  // A separate local shell keeps the live workspace WebContents mounted.
  const settings = window;
  const replay = new BrowserWindow({
    parent: settings, modal: true, show: false, frame: false,
    width: 860, height: 660, minWidth: 390, minHeight: 540,
    title: "Metis — Replay onboarding", backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "src", "main", "onboarding-replay-preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const page = path.join(__dirname, "ui", "index.html");
  onboardingReplay = { window: replay, url: pathToFileURL(page).href, server: workspace.getState().server };
  replay.webContents.on("will-navigate", event => event.preventDefault());
  replay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.platform !== "darwin") replay.setMenu(null);
  let loaded = false;
  replay.on("closed", () => {
    onboardingReplay = undefined;
    if (!loaded || quitting || installingUpdate || workspace.win.isDestroyed()) return;
    if (!settings.isDestroyed()) settings.hide();
    if (workspace.win.isMinimized()) workspace.win.restore();
    workspace.win.show();
    workspace.win.focus();
    workspace.getView()?.webContents.focus();
  });
  try { await replay.loadFile(page); }
  catch (error) { if (!replay.isDestroyed()) replay.destroy(); throw error; }
  if (replay.isDestroyed()) return;
  loaded = true;
  replay.show();
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

function releasePresentation(session) {
  if (captureOwner === session) {
    captureOwner = undefined;
    computerUseOverlay?.resumeCapture();
    annotationOverlay?.resumeCapture();
  }
  if (inputOwner === session) {
    inputOwner = undefined;
    clearInterval(computerUseCursorTimer);
    computerUseCursorTimer = undefined;
    computerUseOverlay?.hide();
  }
  if (annotationOwner === session) {
    annotationOwner = undefined;
    annotationOverlay?.clearAll();
  }
}

function stopRuntime(session) {
  ++session.epoch;
  session.runtime?.stop();
  session.runtime = undefined;
  releasePresentation(session);
}

async function startRuntime(session) {
  const selected = session.config;
  if (!selected || session.status.accessMismatch || quitting) return;
  stopRuntime(session);
  const epoch = session.epoch;
  const live = () => !quitting && sessions.get(session.origin) === session && session.epoch === epoch;
  const { startDeviceHost } = require("./src/device/runtime.cjs");
  const { showNativeNotification } = require("./notification-native.cjs");
  const admin = process.platform === "win32" && selected.permissionMode === "admin";
  const startHost = admin ? options => attachAdminRuntime(session.admin, options) : startDeviceHost;
  const { createNotificationReceiver } = await import(pathToFileURL(path.join(__dirname, "notification-client.mjs")).href);
  if (!live()) return;
  const configPath = originDataPath(session.origin);
  const show = notification => live() && showNativeNotification({ Notification, openChat: (id, server) => { if (live()) return openDesktopChat(id, server); }, server: session.origin, notification });
  session.status.connection = "connecting";
  session.status.error = "";
  session.status.deviceElevation = null;
  session.runtime = startHost({
    utilityProcess, config: selected, configPath, capabilities: runtimeCapabilities(),
    receiveNotification: createNotificationReceiver({ config: selected, configPath, available: () => live() && status.desktopAvailable && Notification.isSupported(), show }),
    showNotification: show,
    onEvent(event) {
      if (!live()) throw Error("Device pairing changed.");
      if (event.type === "device_access") { session.status.deviceElevation = event.elevation; broadcast(); return; }
      if (event.type === "desktop_overlay") {
        if (!annotationOverlay) throw Error("Desktop annotations are not available.");
        if (annotationOwner && annotationOwner !== session && annotationRequests === 0 &&
            annotationOverlay.status().displays.every(display => display.items.length === 0)) {
          annotationOverlay.clearAll();
          annotationOwner = undefined;
        }
        if (annotationOwner && annotationOwner !== session) throw Error("Another paired server owns the desktop annotations.");
        if (event.params?.operation !== "status") annotationOwner = session;
        annotationRequests++;
        return annotationOverlay.execute(event.params, session.origin).finally(() => { annotationRequests--; });
      }
      if (event.type === "appearance") {
        const active = desktop?.getState().server;
        if (sessionFor(active) !== session) return;
        const next = appearance.normalize(event.appearance);
        if (next && JSON.stringify(next) !== JSON.stringify(currentAppearance)) {
          currentAppearance = next;
          computerUseOverlay?.setAppearance(next);
          assistant?.setAppearance(next);
          annotationOverlay?.setAppearance(next);
          broadcast();
        }
        return;
      }
      if (event.type === "computer_use") {
        if (event.phase === "start") {
          if (inputOwner && inputOwner !== session) throw Error("Another paired server is using the desktop.");
          inputOwner = session;
          computerUseOverlay?.touch();
          if (event.operation === "key") computerUseOverlay?.suppressInjectedShortcut(event.key);
          startComputerUseCursor();
        } else if (inputOwner === session && event.phase === "end") {
          inputOwner = undefined;
          stopComputerUseCursor();
        } else if (inputOwner === session && event.phase === "capture-start") {
          captureOwner = session;
          computerUseOverlay?.suspendCapture(); annotationOverlay?.suspendCapture();
        } else if (captureOwner === session && event.phase === "capture-end") {
          captureOwner = undefined;
          computerUseOverlay?.resumeCapture(); annotationOverlay?.resumeCapture();
        }
        return;
      }
      if (event.type !== "connection") return;
      if (event.status !== "online") {
        if (inputOwner === session) session.runtime?.cancelComputerUse();
        releasePresentation(session);
      }
      const previous = session.status.connection;
      session.status.connection = event.status;
      session.status.error = event.error || "";
      if (event.status === "online" && previous === "offline" && Notification.isSupported()) {
        new Notification({ title: APP_NAME, body: "Connection restored" }).show();
      }
      broadcast();
    },
  });
  broadcast();
}

async function startOrReport(session) {
  try { await startRuntime(session); }
  catch (error) {
    if (sessions.get(session.origin) === session && !quitting) {
      Object.assign(session.status, { connection: "error", error: error.message });
      broadcast();
    }
  }
}

async function fetchSnapshot(origin) {
  const session = requireSession(origin);
  if (!session.config || session.status.accessMismatch) throw Error("Access is paused for this server.");
  const snapshot = await fetchPairingSnapshot(session.config);
  if (sessions.get(origin) !== session || quitting) throw Error("This pairing has changed.");
  return snapshot;
}

function registerIpc() {
  const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(path.join(__dirname, "index.html")).href) throw new Error("Access denied.");
    return handler(event, ...args);
  });
  function ownsReplay(event) {
    const contents = onboardingReplay?.window.webContents;
    return Boolean(contents && event.sender === contents && event.senderFrame === contents.mainFrame &&
      event.senderFrame.url === onboardingReplay.url);
  }
  ipcMain.handle("onboarding-replay:state", event => {
    if (!ownsReplay(event)) throw new Error("Access denied.");
    return onboardingReplay.server;
  });
  ipcMain.handle("onboarding-replay:close", event => {
    if (!ownsReplay(event)) throw new Error("Access denied.");
    const replay = onboardingReplay.window;
    setImmediate(() => { if (!replay.isDestroyed()) replay.close(); });
  });
  handle("hub:replay-onboarding", showOnboardingReplay);
  handle("hub:state", () => ({ ...hubState(), preferredOrigin: deviceSettingsOrigin() }));
  handle("hub:restart-as-administrator", (_event, origin) => enableAdministratorClient(origin));
  handle("hub:snapshot", (_event, origin) => fetchSnapshot(origin));
  handle("hub:pair", async (_event, input) => {
    const origin = pairingOrigin(input?.server);
    if (quitting || pendingPairings.has(origin)) throw Error("Pairing is already in progress or Metis is closing.");
    if (process.platform === "win32" && await isElevated()) throw Error("Open Metis normally before pairing a device.");
    if (quitting || pendingPairings.has(origin)) throw Error("Pairing is already in progress or Metis is closing.");
    const request = new AbortController();
    pendingPairings.set(origin, request);
    const assertCurrent = () => {
      if (request.signal.aborted || quitting) throw Error("Pairing was cancelled.");
    };
    const next = makeSession(origin, {});
    try {
      const config = await enroll({ server: origin, token: input.token }, {
        name: os.hostname(), hostname: os.hostname(),
        os: `${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"} ${os.release()}`,
        architecture: os.arch(), version: app.getVersion(), desktopAvailable: status.desktopAvailable,
      }, { signal: request.signal, authorize: async mode => {
        if (process.platform !== "win32" || mode !== "admin") return;
        // UAC cancellation must not spend the one-shot pairing code or touch existing sessions.
        next.admin = newAdministratorHost(next);
        await next.admin.ensure();
        assertCurrent();
        if (!next.admin.connected) throw Error("Administrator Remote Client disconnected.");
      } });
      assertCurrent();
      if (process.platform === "win32" && config.permissionMode === "admin" && !next.admin?.connected)
        throw Error("Administrator Remote Client disconnected.");
      const previous = sessions.get(origin);
      next.config = config;
      credentialStore.save(config);
      sessions.set(origin, next);
      if (previous) { stopRuntime(previous); previous.admin?.shutdown(); }
      await startOrReport(next);
      return { ...hubState(), pairedOrigin: origin };
    } finally {
      if (next && sessions.get(origin) !== next) next.admin?.shutdown();
      if (pendingPairings.get(origin) === request) pendingPairings.delete(origin);
    }
  });
  handle("hub:unpair", async (_event, origin) => {
    const session = requireSession(origin);
    credentialStore.remove(origin);
    pendingPairings.get(origin)?.abort();
    sessions.delete(origin);
    stopRuntime(session);
    session.admin?.shutdown();
    broadcast();
    return hubState();
  });
  handle("hub:open-server", async (_event, origin) => {
    if (installingUpdate) { await updateWindow.show(); return; }
    if (origin === undefined) { await showDesktop(); return; }
    const entry = hubState().serverRows.find(row => row.origin === origin);
    if (!entry) throw Error("Select a saved server.");
    if (!desktop) await showDesktop();
    await desktop.openServer(entry.url);
    await desktop.show();
  });
  handle("hub:export", async (_event, origin) => {
    const session = requireSession(origin);
    const snapshot = await fetchSnapshot(origin);
    const result = await dialog.showSaveDialog(window, {
      title: "Export command history",
      defaultPath: `metis-remote-commands-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath || sessions.get(origin) !== session) return false;
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
  handle("hub:check-updates", () => checkUpdates());
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

async function checkUpdates() {
  if (!app.isPackaged) return "Updates are available in installed builds";
  if(!updateController)setupUpdates();
  if(!updateController)return "Updates are unavailable in this build";
  await updateController.check();
  return status.update;
}

function setupUpdates() {
  if (!app.isPackaged) return;
  if(updateController)return;
  configureUpdater();
  updateController=require("./src/main/update-controller.cjs").createUpdateController({
    updater:autoUpdater,state:updates,version:app.getVersion(),
    diagnosticsFile:path.join(userDataDir,"update-diagnostics.json"),
    changed:()=>{status.update=appUpdate.message;broadcast();},
    ready:()=>{if(Notification.isSupported())new Notification({title:APP_NAME,body:appUpdate.message}).show();},
  });
  const check=()=>void checkUpdates();
  updateCheckTimer=setTimeout(check,20_000);
  updateInterval=setInterval(check,6*60*60*1000);
}

const { claimDesktopInstance, shouldListenForLegacyWindowActivation } = require("./src/main/reopen.cjs");
const ownsDesktopInstance=claimDesktopInstance({
 app,platform:process.platform,
 readElevation:()=>{
  const {execFileSync}=require("node:child_process");
  const value=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",
   "$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
   {encoding:"utf8",windowsHide:true,timeout:1500,maxBuffer:4096}).trim();
  return value==="False"?"user":value==="True"?"administrator":"unknown";
 },
 requestActivation:()=>require("./src/main/window-activation.cjs").requestWindowActivation(userDataDir),
 onError:error=>traceStartup("secondary-activation-"+error.message)
});
if(ownsDesktopInstance)void (async()=>{
traceStartup("primary-lock");
await app.whenReady();
traceStartup("electron-ready");
if(process.platform==="win32"){
 try{
  const value=await runPowerShell("$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
  windowsElevation=value==="True"?"administrator":value==="False"?"user":"unknown";
 }catch{windowsElevation="unknown";}
 traceStartup("rights-"+windowsElevation);
 if(windowsElevation==="administrator"){
  // A cold High launcher has no UI/runtime to preserve. Release its startup
  // lock before handing off to the verified normal shell token; cancellation
  // of device UAC never enters this path and never releases the normal lock.
  app.releaseSingleInstanceLock();
  await new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,"src/main/normal-user-process.cjs"),{workerData:{development:!app.isPackaged,role:"desktop"}});
   worker.once("message",result=>result.ok?resolve(result.pid):reject(Error(result.error||"Start Metis normally from the Start menu.")));
   worker.once("error",reject);
  });
  app.exit(0);return;
 }
}
  app.on("second-instance", (_event,_argv,_cwd,hint) => {
    if (installingUpdate || updateWindow.active) { void updateWindow.show(); return; }
    // This untrusted hint changes presentation only, never permissions or UAC.
    if(getWindowsElevation()==="user"&&hint?.windowsElevation==="administrator"){
      status.error="The desktop app stays in Standard user mode. Enable the Administrator Remote Client here and confirm Windows UAC.";
      void desktopReady.then(()=>{showWindow();broadcast();});
    }else void desktopReady.then(async()=>{
      const id = serverArgument(_argv);
      await desktop.newWindow(id ? {serverId:id} : {});
    }).catch(error=>{status.error=error.message;broadcast();});
  });
  app.on("activate", () => { if (installingUpdate || updateWindow.active) void updateWindow.show(); else void showDesktop(); });
  let markDesktopReady;
  const desktopReady = new Promise(resolve => { markDesktopReady = resolve; });
  const activationListener = shouldListenForLegacyWindowActivation(process.platform, getWindowsElevation())
    ? require("./src/main/window-activation.cjs").listenForWindowActivation({
      directory: userDataDir,
      activate: () => installingUpdate || updateWindow.active ? updateWindow.show() : desktopReady.then(() => showDesktop()),
      onError: () => {}, // Native second-instance/tray activation remains available.
    }) : null;
  app.whenReady().then(async () => {
    app.setAppUserModelId(process.env.METIS_DESKTOP_TEST_DATA ? "ai.metis.remoteclient.test" : "ai.metis.remoteclient");
    if (process.platform === "win32" && process.argv.includes("--updated")) void updateWindow.show("opening");
    try {
      for (const [origin, entry] of credentialStore.load()) sessions.set(origin, makeSession(origin, entry));
    } catch (error) { status.error = error.message; }
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
    annotationOverlay = require('./src/main/annotation-overlay.cjs').createAnnotationOverlay({
      BrowserWindow, screen, ipcMain, getServer: () => annotationOwner?.origin || desktop?.getState().server || null,
      appearance: currentAppearance, hideFromCapture: overlayPreferences.get(), onChange: () => { lastTrayKey = ''; updateTray(); }
    });
    const { createAssistant } = require("./src/main/assistant.cjs");
    assistant = createAssistant({
      getServer: () => desktop?.getState().server || primarySession()?.origin || null,
      getDevice: server => {
        const session = sessionFor(server);
        return { clientId: session?.status.accessMismatch ? "" : session?.config?.clientId || "", hostname: os.hostname(), platform: process.platform, version: app.getVersion() };
      },
      annotationOverlay, onEscape: () => annotationOverlay?.clearAll(),
      computerOverlay:computerUseOverlay, appearance:currentAppearance, hideFromCapture:overlayPreferences.get(),
      getShortcuts: () => overlayPreferences.getAssistantShortcuts(), onDevices: showWindow,
      onOpenChat: (id,server) => openDesktopChat(id,server)
    });
    await probeDesktop();
    desktopProbeTimer = setInterval(() => { probeDesktop().catch(() => {}); }, 20_000);
    desktopProbeTimer.unref?.();
    registerIpc();
    traceStartup("creating-windows");
    createWindow();
    tray = new Tray(trayImage());
    updateTray();
    void getAutostart();
    try { await showDesktop(); }
    finally { updateWindow.close(); }
    traceStartup("desktop-visible-"+desktop.win.isVisible());
    markDesktopReady();
    setupUpdates();
    await Promise.all([...sessions.values()].map(startOrReport));
    if (process.platform === "win32" && getWindowsElevation() === "user") {
      // Retain cold-start reconnect for saved Administrator pairings; UAC prompts
      // are serialized and a cancellation leaves this and later pairings paused.
      for (const session of sessions.values()) {
        if (quitting) break;
        if (session.config?.permissionMode !== "admin") continue;
        try { await enableAdministratorClient(session.origin); }
        catch (error) {
          if (sessions.get(session.origin) === session && !quitting) {
            Object.assign(session.status, { connection: "error", error: error.message });
            broadcast();
          }
          break;
        }
      }
    }
    if (!quitting && [...sessions.values()].some(session => session.status.accessMismatch)) showWindow();
    // Device permissions are requested from local settings when explicitly needed.
  });
  const updateShutdown=require("./src/main/update-shutdown.cjs").createUpdateShutdown({
    ready:()=>Boolean(updateController?.ready),
    drain:async wantsInstall=>{
      if(wantsInstall){
        installingUpdate = true;
        await updateWindow.show();
      }
      const current = [...sessions.values()];
      const pids = current.flatMap(session => [session.runtime?.pid, session.admin?.pid]);
      const hadAdministrator = current.some(session => session.admin?.connected);
      quitting = true;
      for (const request of pendingPairings.values()) request.abort();
      for (const session of current) { stopRuntime(session); session.admin?.shutdown(); }
      if(wantsInstall)await require("./src/main/update-controller.cjs").waitForProcessExit(pids);
      else if(hadAdministrator)await new Promise(resolve=>setTimeout(resolve,400));
    },
    cleanup:()=>{
      clearTimeout(updateCheckTimer);clearInterval(updateInterval);
      activationListener?.close();computerUseOverlay?.hide();
      assistant?.destroy();annotationOverlay?.destroy();
    },
    install:()=>updateController.install(),
    quit:()=>app.quit(),
    onError:error=>{
      installingUpdate=false;updateWindow.close();
      quitting=false;updates.error({message:"Update installation could not finish. Quit and reopen Metis to retry."});
      status.update=appUpdate.message;broadcast();
      dialog.showErrorBox(APP_NAME, appUpdate.message);
    },
  });
  app.on("before-quit",updateShutdown.beforeQuit);
  app.on("window-all-closed", () => {});
})().catch(error=>{traceStartup("failed-"+error.message);dialog.showErrorBox(APP_NAME,error.message||"Metis could not start.");app.quit();});

module.exports = { showDesktop, showWindow, getDesktop: () => desktop, getDeviceWindow: () => window, getRuntimePid: () => primarySession()?.runtime?.pid, getAssistant: () => assistant, getAnnotationOverlay: () => annotationOverlay, publicState };
