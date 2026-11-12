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
    let frame, previous = '', dragging = false, dragTimer;
    const observed = new Set();
    const paneSelector='.assistant-input,.assistant-conversation,[data-slot="popover-content"],[data-slot="dialog-content"]';
    const resize = new ResizeObserver(() => schedule());
    function measure() {
      frame = null;
      const panes = [...document.querySelectorAll(paneSelector)]
        .filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,4);
      for (const node of observed) if (!panes.includes(node)) { resize.unobserve(node); observed.delete(node); }
      for (const node of panes) if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      const value = {width:innerWidth,height:innerHeight,rects:dragging ? [{x:0,y:0,width:innerWidth,height:innerHeight}] : panes.map(node => {
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
    // A captured resize/move must continue outside the old native shape.
    // Only a real pointer gesture on the current assistant controls enables this.
    const finishDrag = () => { if (!dragging) return; dragging=false; clearTimeout(dragTimer); schedule(); };
    addEventListener('pointerdown', event => {
      const target=event.target?.closest?.('[data-assistant-resize],[data-assistant-drag]');
      if (!event.isTrusted || event.button!==0 || !target?.closest('.assistant-conversation')) return;
      if (target.matches('[data-assistant-drag]') && event.target.closest('button:not([data-assistant-move]),input,a')) return;
      dragging=true;clearTimeout(dragTimer);dragTimer=setTimeout(finishDrag,15000);measure();
    },true);
    addEventListener('pointermove',event=>{if(!dragging||!event.isTrusted)return;if(!event.buttons)return;clearTimeout(dragTimer);dragTimer=setTimeout(finishDrag,15000);},true);
    addEventListener('pointerup',finishDrag,true);addEventListener('pointercancel',finishDrag,true);
    addEventListener('blur',finishDrag);addEventListener('pagehide',finishDrag);
    addEventListener('scroll',schedule,true);
    addEventListener('resize',schedule);
    document.addEventListener('visibilitychange',schedule);
    schedule();
  },{once:true});
}
