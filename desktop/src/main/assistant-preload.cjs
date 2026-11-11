const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('metisAssistant', Object.freeze({
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
  // Native hit regions keep the rest of the desktop clickable without forwarding
  // global mouse events through Electron. No page-controlled native API is exposed.
  addEventListener('DOMContentLoaded', () => {
    let frame, previous = '';
    const observed = new Set();
    const paneSelector='.assistant-input,.assistant-conversation,[data-slot="popover-content"],[data-slot="dialog-content"]';
    const resize = new ResizeObserver(() => schedule());
    function measure() {
      frame = null;
      const panes = [...document.querySelectorAll(paneSelector)]
        .filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,4);
      for (const node of observed) if (!panes.includes(node)) { resize.unobserve(node); observed.delete(node); }
      for (const node of panes) if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      const value = {width:innerWidth,height:innerHeight,rects:panes.map(node => {
        const r = node.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height};
      }).filter(r => r.width>0 && r.height>0)};
      const text = JSON.stringify(value);
      if (text !== previous) { previous=text; ipcRenderer.send('assistant:regions',value); }
    }
    function schedule() { if (!frame) frame=requestAnimationFrame(measure); }
    new MutationObserver(records=>{
      if(records.some(record=>record.type==='childList'||record.target.matches?.(paneSelector+',[data-radix-popper-content-wrapper]')))schedule();
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','data-state','hidden']});
    addEventListener('scroll',schedule,true);
    addEventListener('resize',schedule);
    document.addEventListener('visibilitychange',schedule);
    schedule();
  },{once:true});
}
