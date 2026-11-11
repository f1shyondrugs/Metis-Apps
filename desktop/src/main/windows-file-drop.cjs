// Keep Chromium's OLE target intact. Elevated windows delegate only external file
// drops to a normal-user, local helper; the elevated process never reads a path.
const path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {decodeDrop,receiveLines,send}=require('./file-drop-protocol.cjs');
function registerWindowsFileDrop(win,{onFiles,onError=()=>{},onReady=()=>{},platform=process.platform,getBounds,getPresentation=()=>({}),getEnabled=()=>true}={}) {
 if(platform!=='win32'){onReady({native:true});return ()=>{};}
 const koffi=require('koffi'),user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll');
 const open=adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)'),info=adv.func('bool GetTokenInformation(uintptr_t,uint32_t,void *,uint32_t,void *)'),close=kernel.func('bool CloseHandle(uintptr_t)');
 const {tokenIdentity}=require('./windows-token-identity.cjs');
 const token=Buffer.alloc(8);
 if(!open(kernel.func('uintptr_t GetCurrentProcess()')(),8,token))throw Error('Could not check file-drop permissions.');
 let ownIdentity;
 try{ownIdentity=tokenIdentity(koffi,info,Number(token.readBigUInt64LE()));}finally{close(Number(token.readBigUInt64LE()));}
 if(!ownIdentity.elevated){onReady({native:true});return ()=>{};}
 const point=user.func('bool GetCursorPos(void *)'),key=user.func('int16_t GetAsyncKeyState(int)'),from=user.func('uintptr_t WindowFromPoint(uint64_t)'),ancestor=user.func('uintptr_t GetAncestor(uintptr_t,uint32_t)');
 const desktop=user.func('uintptr_t GetDesktopWindow()')(),childAt=user.func('uintptr_t ChildWindowFromPointEx(uintptr_t,uint64_t,uint32_t)');
 const hwnd=Number(win.getNativeWindowHandle().readBigUInt64LE()),nonce=crypto.randomBytes(16).toString('hex'),pipe='\\\\.\\pipe\\metis-file-drop-'+nonce;
 function normalPeer(pid){
  if(!Number.isSafeInteger(pid)||pid<=0||pid>0xFFFFFFFF)return false;
  const processHandle=Number(kernel.func('uintptr_t OpenProcess(uint32_t,bool,uint32_t)')(0x1000,false,pid));if(!processHandle)return false;
  const peer=Buffer.alloc(8);
  try {
   if(!open(processHandle,8,peer))return false;
   const identity=tokenIdentity(koffi,info,Number(peer.readBigUInt64LE()));
   return !identity.elevated&&identity.sid===ownIdentity.sid&&identity.session===ownIdentity.session;
  }finally{if(peer.readBigUInt64LE())close(Number(peer.readBigUInt64LE()));close(processHandle);}
 }
 let socket,launcher,closed=false,timer,retry,hideTimer,wasDown=false,external=false,shown=false,lastBounds='',helperHwnd=0,attempts=0,debugged=false;
 function fail(error){if(!closed)onError(error);}
 function connect(){
  if(closed)return;
  const candidate=net.createConnection(pipe);
  candidate.on('error',()=>{if(closed)return;if(++attempts<100)retry=setTimeout(connect,100);else{fail(Error('File drops could not start. Use Attach files.'));cleanup();}});
  candidate.on('connect',()=>{
   if(closed){candidate.destroy();return;}socket=candidate;
   receiveLines(candidate,value=>{
    if(value?.type==='ready'){
     if(process.env.METIS_DROP_TEST_ROOT)console.error('DROP_HELPER_READY',JSON.stringify(value));
     if(value.uiReady!==true||value.elevated!==false||!normalPeer(value.pid)||!Number.isSafeInteger(value.hwnd)||value.hwnd<=0){fail(Error('Normal-user file drops are unavailable. Use Attach files.'));cleanup();return;}
     if(helperHwnd)return;helperHwnd=value.hwnd;onReady({pid:value.pid,normal:true});timer=setInterval(tick,25);timer.unref?.();
    }else if(value?.type==='drop'){
     shown=false;
     if(getEnabled()&&!win.isDestroyed()&&win.isVisible()){const payload=decodeDrop(value),b=getBounds?.()||win.getContentBounds();if(payload.point.x>=0&&payload.point.y>=0&&payload.point.x<b.width&&payload.point.y<b.height)onFiles(payload);}
    }else if(value?.type==='error'){if(process.env.METIS_DROP_TEST_ROOT)console.error('DROP_HELPER_FILE_ERROR',value.reason);fail(Error('Could not read dropped files. Use Attach files or retry.'));}
   });
   candidate.on('close',()=>{socket=undefined;clearInterval(timer);timer=undefined;if(!closed)fail(Error('File drops stopped. Use Attach files.'));});
  });
 }
 function tick(){
  if(closed||win.isDestroyed())return;
  const p=Buffer.alloc(8);if(!point(p))return;
  const down=Boolean(key(1)&0x8000),root=Number(ancestor(childAt(desktop,p.readBigUInt64LE(),7)||from(p.readBigUInt64LE()),2));
  if(down&&!wasDown)external=root!==hwnd&&root!==helperHwnd;
  wasDown=down;
  const enabled=down&&external&&getEnabled()&&win.isVisible()&&!win.isMinimized()&&(root===hwnd||root===helperHwnd);
  const bounds=getBounds?.()||win.getContentBounds();
  if(process.env.METIS_DROP_TEST_ROOT&&down&&external&&!enabled&&!debugged&&p.readInt32LE(0)>=bounds.x&&p.readInt32LE(0)<bounds.x+bounds.width&&p.readInt32LE(4)>=bounds.y&&p.readInt32LE(4)<bounds.y+bounds.height){debugged=true;const name=Buffer.alloc(256);user.func('int GetClassNameW(uintptr_t,void *,int)')(root,name,128);console.error('DROP_BLOCKED_ROOT',root,name.toString('utf16le').split('\0')[0],getEnabled(),win.isVisible(),win.isMinimized());}
  const serialized=JSON.stringify(bounds);
  if(enabled&&serialized!==lastBounds){send(socket,{type:'bounds',bounds});lastBounds=serialized;}
  if(enabled){clearTimeout(hideTimer);hideTimer=undefined;if(!shown){shown=true;const p=getPresentation(),input=p.appearance;const variables={};for(const key of ['--background','--foreground','--muted-foreground','--border'])if(typeof input?.variables?.[key]==='string'&&input.variables[key].length<=512)variables[key]=input.variables[key];send(socket,{type:'presentation',appearance:{version:1,mode:input?.mode==='light'?'light':'dark',variables},hideFromCapture:p.hideFromCapture!==false});send(socket,{type:'show'});}}
  else if(shown&&!hideTimer){hideTimer=setTimeout(()=>{hideTimer=undefined;shown=false;send(socket,{type:'hide'});},250);}
  if(!down)external=false;
 }
 function cleanup(){
  if(closed)return;closed=true;clearTimeout(retry);clearTimeout(hideTimer);clearInterval(timer);send(socket,{type:'quit'});socket?.end();socket=undefined;void launcher?.terminate();
 }
 const {app}=require('electron');
 // Use only the current interactive user's verified normal token. Process
 // creation stays off Electron's UI thread; no RunAs, task or UAC bypass.
 launcher=new Worker(path.join(__dirname,'normal-user-process.cjs'),{workerData:{development:!app.isPackaged,nonce}});
 launcher.once('message',result=>{if(process.env.METIS_DROP_TEST_ROOT)console.error('DROP_HELPER_LAUNCH',JSON.stringify(result));if(closed)return;if(result.ok)connect();else fail(Error(result.error||'Normal-user file drops are unavailable.'));});
 launcher.once('error',error=>fail(error));
 win.once('closed',cleanup);
 return cleanup;
}
module.exports={registerWindowsFileDrop};
