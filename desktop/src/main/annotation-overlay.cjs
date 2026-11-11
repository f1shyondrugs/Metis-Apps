const path=require('node:path');
const {normalizeServer,sameOrigin}=require('../../policy.cjs');
const {createOverlayScene}=require('./overlay-scene.cjs');
function createAnnotationOverlay({BrowserWindow,screen,ipcMain,getServer,appearance,hideFromCapture=true,onChange=()=>{}}){
  const store=createOverlayScene(),windows=new Map();
  let currentAppearance=appearance,captureHidden=hideFromCapture,destroyed=false,queue=Promise.resolve(),timer,suspended=0,epoch=0;
  const monitors=()=>screen.getAllDisplays().slice(0,10);
  function sync(){store.sync(monitors());for(const [id,r]of windows)if(!monitors().some(d=>String(d.id)===id)){r.win.destroy();windows.delete(id);}}
  function state(id){return {...store.state(id),appearance:currentAppearance};}
  function publicState(){
    sync();return {available:true,version:1,displays:monitors().map(d=>{
      const s=store.state(String(d.id));return {id:String(d.id),name:d.label||'Display '+d.id,...d.bounds,scaleFactor:d.scaleFactor,primary:d.id===screen.getPrimaryDisplay().id,revision:s.revision,interactiveId:s.interactiveId,
        items:s.items.map(({id,type,group,x,y,width,height})=>({id,type,group,x,y,width,height}))};
    })};
  }
  function sender(event){
    for(const [id,r] of windows)if(!r.win.isDestroyed()&&event.sender===r.win.webContents&&event.senderFrame===r.win.webContents.mainFrame&&sameOrigin(event.senderFrame.url,r.server)&&new URL(event.senderFrame.url).pathname==='/desktop-overlay')return {id,r};
    throw Error('Access denied.');
  }
  function ignore(r,value){if(r.ignored!==value&&!r.win.isDestroyed()){r.win.setIgnoreMouseEvents(value);r.ignored=value;}}
  function pointer(r,s){
    const interactive=s.items.find(x=>x.id===s.interactiveId&&x.type==='card');
    if(!interactive||suspended){ignore(r,true);r.win.setFocusable(false);return;}
    const b=r.win.getBounds(),p=screen.getCursorScreenPoint(),x=p.x-b.x,y=p.y-b.y;
    const regions=r.regions.length?r.regions:[interactive];
    ignore(r,!regions.some(v=>x>=v.x&&y>=v.y&&x<v.x+v.width&&y<v.y+v.height));
  }
  function publish(id){
    const r=windows.get(id);if(!r||r.win.isDestroyed())return;
    const s=store.peek(id);
    if(!s.items.length||suspended||!r.ready){ignore(r,true);r.win.hide();return;}
    if(s.revision!==r.revision||currentAppearance!==r.appearance){
      r.revision=s.revision;r.appearance=currentAppearance;r.win.webContents.send('overlay:state',{revision:s.revision,items:s.items,display:s.display,interactiveId:s.interactiveId,appearance:currentAppearance});
    }
    if(!s.interactiveId)r.win.setFocusable(false);
    pointer(r,s);
    if(!r.win.isVisible())r.win.showInactive();
  }
  function tick(){if(destroyed)return;for(const id of windows.keys())publish(id);if(!store.hasItems()){clearInterval(timer);timer=null;} }
  function startTimer(){if(!timer){timer=setInterval(tick,25);timer.unref?.();}}
  async function ensure(id){
    const server=normalizeServer(getServer());
    let r=windows.get(id);
    if(r&&(!sameOrigin(r.server,server)||r.win.isDestroyed()||!r.ready)){if(!r.win.isDestroyed())r.win.destroy();windows.delete(id);r=null;}
    if(r)return r;
    const d=monitors().find(x=>String(x.id)===id);if(!d)throw Error('Display disconnected');
    const win=new BrowserWindow({...d.bounds,transparent:true,backgroundColor:'#00000000',frame:false,show:false,focusable:false,resizable:false,skipTaskbar:true,hasShadow:false,title:'Metis Screen Annotations',
      webPreferences:{partition:'persist:metis-web',preload:path.join(__dirname,'annotation-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    r={win,server,ready:false,ignored:true,regions:[],revision:-1};windows.set(id,r);
    win.setAlwaysOnTop(true,'pop-up-menu');win.setContentProtection(captureHidden);win.setIgnoreMouseEvents(true);
    win.setVisibleOnAllWorkspaces?.(true,{visibleOnFullScreen:true});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const nav=(event,url)=>{if(!sameOrigin(url,server)||new URL(url).pathname!=='/desktop-overlay')event.preventDefault();};
    win.webContents.on('will-navigate',nav);win.webContents.on('will-redirect',nav);
    win.webContents.on('will-attach-webview',e=>e.preventDefault());
    win.webContents.on('will-frame-navigate',(event,details)=>{
      const url=typeof details==='string'?details:details?.url||event.url;
      const main=details?.isMainFrame??event.isMainFrame;
      if(main)return;
      if(url==='about:blank'||url==='about:srcdoc')return;
      if(typeof url==='string'&&sameOrigin(url,server)&&/^\/api\/(?:file-uploads\/[a-zA-Z0-9_-]+\/file|uploads\/[a-zA-Z0-9_-]+\/[^/?#]+)$/.test(new URL(url).pathname))return;
      event.preventDefault();
    });
    win.webContents.on('render-process-gone',()=>{r.ready=false;ignore(r,true);win.hide();});
    win.on('close',event=>{if(!destroyed){event.preventDefault();clearAll();}});
    win.on('blur',()=>{if(destroyed||!windows.has(id))return;const s=store.state(id);if(s.interactiveId){store.apply({operation:'interact',display_id:id,interactive_id:null});r.regions=[];publish(id);}});
    try{
      let loadTimeout;
      try { await Promise.race([win.loadURL(new URL('/desktop-overlay',server).href),new Promise((_,reject)=>{loadTimeout=setTimeout(()=>reject(Error('Overlay renderer load timed out')),7000);})]); }
      finally { clearTimeout(loadTimeout); }
      for(let i=0;i<100&&!r.ready;i++)await new Promise(resolve=>setTimeout(resolve,50));
      if(!r.ready)throw Error('The web overlay renderer is unavailable. Update the Metis server and retry.');
      return r;
    }catch(error){win.destroy();windows.delete(id);throw error;}
  }
  function clearAll(){
    epoch++;
    store.reset();
    for(const id of windows.keys())publish(id);onChange();return publicState();
  }
  async function execute(params){
    const requestedEpoch=epoch;
    const run=async()=>{
      if(requestedEpoch!==epoch)throw Error('Overlay request cancelled by clear');
      if(destroyed)throw Error('Overlay closed');sync();
      if(params.operation==='status')return publicState();
      const previous=store.checkpoint();
      try{
        store.apply(params);
        for(const s of store.states())if(s.items.length)await ensure(s.display.id);
        for(const id of windows.keys())publish(id);
        if(params.operation==='interact'&&params.interactive_id){
          const r=windows.get(String(params.display_id));r.win.setFocusable(true);r.win.show();r.win.focus();r.win.webContents.focus();
        }
        if(store.states().some(s=>s.items.length))startTimer();onChange();return publicState();
      }catch(error){if(requestedEpoch===epoch)store.restore(previous);for(const id of windows.keys())publish(id);throw error;}
    };
    const result=queue.catch(()=>{}).then(run);queue=result;return result;
  }
  const handlers={
    'overlay:state':(e)=>{const {id,r}=sender(e);r.ready=true;return state(id);},
    'overlay:interact':(e,id)=>{const s=sender(e);return execute({operation:'interact',display_id:s.id,interactive_id:id});},
    'overlay:remove':(e,id)=>{const s=sender(e);return execute({operation:'remove',display_id:s.id,ids:[id]});},
    'overlay:clear':e=>{sender(e);return clearAll();},
    'overlay:undo':e=>{const s=sender(e);return execute({operation:'undo',display_id:s.id});}
  };
  for(const [channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);
  const regions=(event,value)=>{
    try{
      const {id,r}=sender(event),s=state(id);if(!s.interactiveId||!Array.isArray(value)||value.length>4)return;
      r.regions=value.filter(v=>v&&['x','y','width','height'].every(k=>Number.isFinite(v[k]))&&v.x>=0&&v.y>=0&&v.width>0&&v.height>0&&v.x+v.width<=s.display.width+1&&v.y+v.height<=s.display.height+1);
      pointer(r,s);
    }catch{/* Untrusted subframes/stale measurements cannot change native hit regions. */}
  };
  ipcMain.on('overlay:regions',regions);
  const topology=()=>{for(const id of windows.keys()){const d=monitors().find(x=>String(x.id)===id);if(d)windows.get(id).win.setBounds(d.bounds);}sync();tick();onChange();};
  screen.on('display-added',topology);screen.on('display-removed',topology);screen.on('display-metrics-changed',topology);
  sync();
  return {
    execute,status:publicState,clearAll,getWindows:()=>[...windows.values()].map(r=>r.win),
    setAppearance(value){currentAppearance=value;for(const id of windows.keys())publish(id);},
    setHideFromCapture(value){if(typeof value!=='boolean')throw Error('Capture visibility must be boolean');for(const r of windows.values())r.win.setContentProtection(value);captureHidden=value;},
    suspendCapture(){suspended++;for(const id of windows.keys())publish(id);},
    resumeCapture(){suspended=Math.max(0,suspended-1);for(const id of windows.keys())publish(id);},
    destroy(){destroyed=true;clearInterval(timer);for(const key of Object.keys(handlers))ipcMain.removeHandler(key);ipcMain.removeListener('overlay:regions',regions);screen.removeListener('display-added',topology);screen.removeListener('display-removed',topology);screen.removeListener('display-metrics-changed',topology);for(const r of windows.values())r.win.destroy();windows.clear();}
  };
}
module.exports={createAnnotationOverlay};
