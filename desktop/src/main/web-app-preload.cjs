const { contextBridge, ipcRenderer } = require('electron');

// The website can only open local settings; device commands and credentials stay private.
if (process.isMainFrame) contextBridge.exposeInMainWorld('metisApp', Object.freeze({
  openDeviceSettings: () => ipcRenderer.invoke('desktop:open-device-settings'),
  deviceState: () => ipcRenderer.invoke('desktop:device-state'),
  openAssistant: () => ipcRenderer.invoke('desktop:assistant'),
}));
