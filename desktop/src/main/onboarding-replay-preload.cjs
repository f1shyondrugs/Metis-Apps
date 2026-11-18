const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("metisOnboardingReplay", {
  state: () => ipcRenderer.invoke("onboarding-replay:state"),
  close: () => ipcRenderer.invoke("onboarding-replay:close"),
});
