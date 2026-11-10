const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) contextBridge.exposeInMainWorld('metisAssistant', Object.freeze({
  ready: () => ipcRenderer.invoke('assistant:ready'),
  resize: height => ipcRenderer.invoke('assistant:resize', height),
  configure: value => ipcRenderer.invoke('assistant:configure', value),
  focusInput: value => ipcRenderer.invoke('assistant:focus', value),
  capture: () => ipcRenderer.invoke('assistant:capture'),
  close: () => ipcRenderer.invoke('assistant:close'),
  openChat: id => ipcRenderer.invoke('assistant:open-chat', id),
  voice: value => ipcRenderer.send('assistant:voice', value),
  onGesture: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('assistant:gesture', listener);
    return () => ipcRenderer.removeListener('assistant:gesture', listener);
  }
}));
