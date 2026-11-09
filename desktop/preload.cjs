/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("metis", {
  state: () => ipcRenderer.invoke("hub:state"),
  snapshot: () => ipcRenderer.invoke("hub:snapshot"),
  pair: (input) => ipcRenderer.invoke("hub:pair", input),
  unpair: () => ipcRenderer.invoke("hub:unpair"),
  openServer: () => ipcRenderer.invoke("hub:open-server"),
  exportAudit: () => ipcRenderer.invoke("hub:export"),
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
