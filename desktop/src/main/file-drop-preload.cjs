const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('metisDrop',Object.freeze({
 deliver:payload=>ipcRenderer.send('file-drop:files',payload),
 error:()=>ipcRenderer.send('file-drop:error')
}));
