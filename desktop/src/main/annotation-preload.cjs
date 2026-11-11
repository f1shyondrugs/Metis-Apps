const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame){
  contextBridge.exposeInMainWorld('metisOverlay',Object.freeze({
    state:()=>ipcRenderer.invoke('overlay:state'),
    onState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('overlay:state',listener);return()=>ipcRenderer.removeListener('overlay:state',listener);},
    interact:id=>ipcRenderer.invoke('overlay:interact',id),
    remove:id=>ipcRenderer.invoke('overlay:remove',id),
    clear:()=>ipcRenderer.invoke('overlay:clear'),
    undo:()=>ipcRenderer.invoke('overlay:undo')
  }));
  addEventListener('DOMContentLoaded',()=>{
    let scheduled;
    function measure(){
      scheduled=null;
      const regions=[...document.querySelectorAll('[data-overlay-interactive]')].slice(0,4).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0);
      ipcRenderer.send('overlay:regions',regions);
    }
    function schedule(){if(!scheduled)scheduled=requestAnimationFrame(measure);}
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','data-overlay-interactive','hidden']});
    new ResizeObserver(schedule).observe(document.documentElement);
    addEventListener('scroll',schedule,true);addEventListener('resize',schedule);schedule();
  });
}
