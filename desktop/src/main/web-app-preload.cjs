const { contextBridge, ipcRenderer } = require('electron');

// Narrow local presentation/startup/update controls; device commands and credentials stay private.
if (process.isMainFrame) contextBridge.exposeInMainWorld('metisApp', Object.freeze({
  openDeviceSettings: () => ipcRenderer.invoke('desktop:open-device-settings'),
  setOverlayCaptureHidden: value => ipcRenderer.invoke('desktop:set-capture-hidden', value),
  setAutostart: value => ipcRenderer.invoke('desktop:set-autostart', value),
  onFilesDropped: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected callback');
    const listener=(_event,payload)=>callback(payload);
    ipcRenderer.on('desktop:files-dropped',listener);
    return ()=>ipcRenderer.removeListener('desktop:files-dropped',listener);
  },
  checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  deviceState: () => ipcRenderer.invoke('desktop:device-state'),
  setShortcuts: value => ipcRenderer.invoke('desktop:shortcuts', value),
  setShortcutCapture: value => ipcRenderer.invoke('desktop:shortcut-capture', value),
  openAssistant: () => ipcRenderer.invoke('desktop:assistant'),
}));
