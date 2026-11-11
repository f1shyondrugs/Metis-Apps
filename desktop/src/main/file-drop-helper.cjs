// This entry never loads pairing credentials, remote commands, or the web app.
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),net=require('node:net');
const {pathToFileURL}=require('node:url');
const {receiveLines,send,MAX_BYTES}=require('./file-drop-protocol.cjs');
function bootstrap(){
 const nonce=process.argv.find(value=>value.startsWith('--metis-drop-pipe='))?.split('=')[1];
 if(!/^[a-f0-9]{32}$/.test(nonce||'')){app.quit();return;}
 app.setName('Metis file drop');app.setAppUserModelId('ai.metis.file-drop-helper');
 const data=path.join(app.getPath('temp'),'metis-file-drop-'+nonce);require('node:fs').mkdirSync(data,{recursive:true});app.setPath('userData',data);
 const pipe='\\\\.\\pipe\\metis-file-drop-'+nonce;
 let win,socket,server,show=false;
 const file=path.join(__dirname,'../../ui/file-drop.html'),url=pathToFileURL(file).href;
 const stop=()=>{socket?.destroy();server?.close();if(win&&!win.isDestroyed())win.destroy();app.quit();};
 const deadline=setTimeout(stop,20000);deadline.unref?.();
 app.whenReady().then(async()=>{
  // Refuse an accidentally elevated helper rather than broadening file access.
  const koffi=require('koffi'),kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll');
  const token=Buffer.alloc(8),value=Buffer.alloc(4),size=Buffer.alloc(4);
  if(!adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)')(kernel.func('uintptr_t GetCurrentProcess()')(),8,token)){stop();return;}
  let elevated=true;
  try{if(adv.func('bool GetTokenInformation(uintptr_t,uint32_t,void *,uint32_t,void *)')(Number(token.readBigUInt64LE()),20,value,4,size))elevated=Boolean(value.readUInt32LE());}finally{kernel.func('bool CloseHandle(uintptr_t)')(Number(token.readBigUInt64LE()));}
  win=new BrowserWindow({width:300,height:150,show:false,frame:false,transparent:true,backgroundColor:'#00000000',focusable:true,skipTaskbar:true,resizable:false,hasShadow:false,webPreferences:{preload:path.join(__dirname,'file-drop-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.setAlwaysOnTop(true,'pop-up-menu');
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  await win.loadFile(file);
  const uiReady=await win.webContents.executeJavaScript('Boolean(window.metisDropReady)');
  server=net.createServer(candidate=>{
   if(socket){candidate.destroy();return;}socket=candidate;clearTimeout(deadline);
   send(socket,{type:'ready',elevated,pid:process.pid,uiReady,hwnd:Number(win.getNativeWindowHandle().readBigUInt64LE())});
   if(elevated){setTimeout(stop,100);return;}
   receiveLines(socket,message=>{
    if(message?.type==='bounds'){
     const b=message.bounds;
     if(!b||!['x','y','width','height'].every(key=>Number.isSafeInteger(b[key]))||b.width<1||b.height<1||b.width>16000||b.height>16000||Math.abs(b.x)>100000||Math.abs(b.y)>100000)return;
     win.setBounds(b);
    }else if(message?.type==='presentation'){
     if(typeof message.hideFromCapture==='boolean')win.setContentProtection(message.hideFromCapture);
     const theme=require('../../appearance.cjs').normalize(message.appearance);
     if(theme)win.webContents.executeJavaScript('window.MetisAppearance?.apply(document.documentElement,'+JSON.stringify(theme)+')').catch(()=>{});
    }else if(message?.type==='show'){show=true;win.showInactive();win.moveTop();}
    else if(message?.type==='hide'){show=false;win.hide();}
    else if(message?.type==='quit')stop();
   },16384);
   socket.on('close',stop);socket.on('error',stop);
  });
  server.on('error',stop);server.listen(pipe);
  ipcMain.on('file-drop:files',(event,payload)=>{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==url||!socket||!payload||!Array.isArray(payload.files)||payload.files.length>10)return;
   let total=0;
   try{
    const files=payload.files.map(file=>{
     if(typeof file.name!=='string'||file.name.length>255||!(file.bytes instanceof Uint8Array))throw Error('Invalid drop.');
     total+=file.bytes.byteLength;if(total>MAX_BYTES)throw Error('Drop too large.');
     return {name:file.name,data:Buffer.from(file.bytes).toString('base64'),lastModified:file.lastModified};
    });
    send(socket,{type:'drop',files,point:payload.point});show=false;win.hide();
   }catch{send(socket,{type:'error'});win.hide();}
  });
  ipcMain.on('file-drop:error',event=>{if(event.sender===win.webContents){send(socket,{type:'error'});win.hide();}});
 }).catch(stop);
 app.on('window-all-closed',()=>app.quit());
}
module.exports={bootstrap};
