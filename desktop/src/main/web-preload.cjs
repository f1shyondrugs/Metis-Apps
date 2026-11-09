const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('metisDesktop', {
  state: () => ipcRenderer.invoke('desktop:state'),
  connect: (url) => ipcRenderer.invoke('desktop:connect', url),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  settings: () => ipcRenderer.invoke('desktop:settings'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state-changed', listener);
    return () => ipcRenderer.removeListener('desktop:state-changed', listener);
  }
});
