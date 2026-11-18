/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("metis", {
  replayOnboarding: () => ipcRenderer.invoke("hub:replay-onboarding"),
  state: () => ipcRenderer.invoke("hub:state"),
  restartAsAdministrator: (origin) => ipcRenderer.invoke("hub:restart-as-administrator", origin),
  snapshot: (origin) => ipcRenderer.invoke("hub:snapshot", origin),
  pair: (input) => ipcRenderer.invoke("hub:pair", input),
  unpair: (origin) => ipcRenderer.invoke("hub:unpair", origin),
  openServer: (origin) => ipcRenderer.invoke("hub:open-server", origin),
  exportAudit: (origin) => ipcRenderer.invoke("hub:export", origin),
  setOverlayCaptureHidden: (value) => ipcRenderer.invoke("hub:set-overlay-capture-hidden", value),
  setCancelShortcut: (value) => ipcRenderer.invoke("hub:set-cancel-shortcut", value),
  getAutostart: () => ipcRenderer.invoke("hub:get-autostart"),
  setAutostart: (value) => ipcRenderer.invoke("hub:set-autostart", value),
  desktopAccess: () => ipcRenderer.invoke("hub:desktop-access"),
  checkUpdates: () => ipcRenderer.invoke("hub:check-updates"),
  desktopPermissions: (input) => ipcRenderer.invoke("hub:desktop-permissions", input),
  onStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("hub:status", listener);
    return () => ipcRenderer.removeListener("hub:status", listener);
  },
});
