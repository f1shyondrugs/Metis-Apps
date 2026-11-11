// Native keyboard, hit testing and real Chromium audio analysis. All data stays
// in an isolated profile on loopback; keys target only windows owned by this test.
const {app,BrowserWindow,screen,session,ipcMain}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict');
const hostMode=process.argv.includes('--input-host');
const output=process.env.METIS_INPUT_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'metis-input-proof-'));
fs.mkdirSync(output,{recursive:true});
app.setName(hostMode?'Metis input host':'Metis assistant input test');
app.setAppUserModelId(hostMode?'ai.metis.input.host.test':'ai.metis.input.assistant.test');
app.setPath('userData',path.join(output,hostMode?'host-profile':'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// Sustained PCM tone, rather than Chromium's very short default beep pulses.
const sampleRate=48000,samples=sampleRate*8,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/sampleRate)*12000),44+i*2);
const audioFile=path.join(output,'synthetic-microphone.wav');fs.writeFileSync(audioFile,wav);
app.commandLine.appendSwitch('use-file-for-fake-audio-capture',audioFile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
if(hostMode){
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1100,height:760,title:'Metis input host',backgroundColor:'#15202b'});
  await win.loadURL('data:text/html,<body style="background:%2315202b;color:white;font:20px sans-serif"><p>Owned input test window</p><button autofocus>Keyboard stays here during voice capture</button></body>');
  win.show();win.focus();
  const activation=require('../src/main/assistant-focus.cjs').createForegroundRestore();
  activation.activate(win);
  await pause(1200);
  activation.activate(win);
  fs.writeFileSync(path.join(output,'host-ready.json'),JSON.stringify({hwnd:Number(win.getNativeWindowHandle().readBigUInt64LE()),pid:process.pid}));
  setTimeout(()=>app.exit(0),90000);
 });
}else{
 const koffi=require('koffi'),user32=koffi.load('user32.dll'),gdi=koffi.load('gdi32.dll');
 const foreground=user32.func('uintptr_t GetForegroundWindow()');
 const keybd=user32.func('void keybd_event(uint8_t,uint8_t,uint32_t,uintptr_t)');
 const cursor=user32.func('bool SetCursorPos(int,int)');
 const mouse=user32.func('void mouse_event(uint32_t,uint32_t,uint32_t,uint32_t,uintptr_t)');
 const point=koffi.struct('METIS_INPUT_POINT',{x:'long',y:'long'});
 const atPoint=user32.func('uintptr_t WindowFromPoint(METIS_INPUT_POINT)');
 const ancestor=user32.func('uintptr_t GetAncestor(uintptr_t,uint32_t)');
 const makeRegion=gdi.func('uintptr_t CreateRectRgn(int,int,int,int)');
 const readRegion=user32.func('int GetWindowRgn(uintptr_t,uintptr_t)');
 const contains=gdi.func('bool PtInRegion(uintptr_t,int,int)');
 const deleteRegion=gdi.func('bool DeleteObject(uintptr_t)');
 const {createAssistant}=require('../src/main/assistant.cjs');
 const appearance=require('../appearance.cjs');
 let assistant,server,host;const proofs=[],trace=[],levels=[];
 const deadline=setTimeout(()=>finish(Error('Input fixture timed out')),90000);
 async function until(fn,label){for(let n=0;n<240;n++){if(await fn())return;await pause(50);}throw Error('Timed out: '+label);}
 function finish(error){
  clearTimeout(deadline);
  fs.writeFileSync(path.join(output,'input-result.json'),JSON.stringify({passed:!error,proofs,trace,maxAudioLevel:Math.max(0,...levels),foreground:Number(foreground()),state:assistant?.state(),...(error?{error:error.stack}:{})}));
  assistant?.destroy();server?.close();host?.kill();app.exit(error?1:0);
 }
 async function tap(hwnd,vk,scan){
  assert.equal(Number(foreground()),hwnd,'Send keyboard input only into an owned test window');
  keybd(vk,scan,0,0);await pause(40);keybd(vk,scan,2,0);await pause(100);
 }
 async function main(){
  await app.whenReady();
  const ui=process.env.METIS_ASSISTANT_UI;
  assert.ok(ui&&fs.existsSync(path.join(ui,'desktop-assistant-native.browser.js')));
  const styles=Object.entries(appearance.fallback.variables).map(([k,v])=>k+':'+v).join(';');
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://fixture');
   const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
   if(url.pathname==='/api/models')return json({models:[{id:'fixture/native-last',providerId:'fixture',displayName:'Native last model',parameters:[],defaultParams:[]},{id:'fixture/native-first',providerId:'fixture',displayName:'Native first model',parameters:[],defaultParams:[]}]});
   if(url.pathname==='/api/preferences')return setTimeout(()=>json({settings:{voiceInput:{enabled:true,provider:'openai',connectionId:'fixture',modelId:'fixture',realtime:false,maxDurationSeconds:60}}}),650);
   if(url.pathname==='/api/voice/transcribe'){req.resume();return json({transcript:'Fixture voice transcript',job:{id:'fixture-voice',status:'completed',transcript:'Fixture voice transcript'}});}
   if(url.pathname.startsWith('/asset/')){
    const name=path.basename(url.pathname),p=path.join(ui,name);
    if(fs.existsSync(p)){res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(p).pipe(res);return;}
   }
   res.setHeader('content-type','text/html');
   res.end('<!doctype html><html class="dark" style="'+styles+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/asset/theme.css"><link rel="stylesheet" href="/asset/desktop-assistant-native.browser.css"></head><body><div id="root"></div><script src="/asset/desktop-assistant-native.browser.js"></script></body></html>');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const handle=ipcMain.handle.bind(ipcMain);
  ipcMain.handle=(channel,callback)=>handle(channel,(...args)=>{
   if(channel==='assistant:configure'||channel==='assistant:focus')trace.push({channel,input:args[1],before:assistant?.state(),foreground:Number(foreground())});
   const result=callback(...args);
   if(channel==='assistant:configure'||channel==='assistant:focus')trace.push({channel,after:assistant?.state(),foreground:Number(foreground())});
   return result;
  });
  ipcMain.on('assistant:voice',(_e,value)=>{if(value?.recording&&Number.isFinite(value.level))levels.push(value.level);});
  assistant=createAssistant({getServer:()=>origin,getDevice:()=>({clientId:'fixture',hostname:'Owned test',platform:'win32',version:'fixture'}),appearance:appearance.fallback,getShortcuts:()=>({assistant:'F8',focusInput:'F6',openChat:'F7',deviceSettings:'F9',cancel:'Escape'})});
  // Fake Chromium device: no actual microphone, account or provider is involved.
  const media=session.fromPartition('persist:metis-web');
  host=spawn(process.execPath,[__filename,'--input-host'],{env:{...process.env,METIS_INPUT_TEST_OUTPUT:output},stdio:'ignore'});
  await until(()=>fs.existsSync(path.join(output,'host-ready.json')),'owned host');
  const hostHwnd=JSON.parse(fs.readFileSync(path.join(output,'host-ready.json'))).hwnd;
  await until(()=>Number(foreground())===hostHwnd,'host foreground');
  await pause(500);
  await assistant.open();const win=assistant.getWindow(),wc=win.webContents;
  media.setPermissionCheckHandler(()=>true);media.setPermissionRequestHandler((_wc,_permission,cb)=>cb(true));
  const hwnd=Number(win.getNativeWindowHandle().readBigUInt64LE());
  win.on('focus',()=>trace.push({event:'native-focus',state:assistant.state(),foreground:Number(foreground())}));
  win.on('blur',()=>trace.push({event:'native-blur',state:assistant.state(),foreground:Number(foreground())}));
  trace.push({hostHwnd,hwnd});
  await until(()=>wc.executeJavaScript('Boolean(document.querySelector("textarea"))'),'renderer');
  // Request input before the intentionally delayed settings reply.
  assistant.focusInput();
  await until(()=>Number(foreground())===hwnd,'native keyboard focus');
  await pause(1100);
  assert.equal(Number(foreground()),hwnd,'Late voice configuration must not revoke explicit focus');
  assert.equal(await wc.executeJavaScript('document.hasFocus()&&document.activeElement===document.querySelector("textarea")'),true);
  await tap(hwnd,0x58,0x2d);
  assert.equal(await wc.executeJavaScript('document.querySelector("textarea").value'),'x');
  proofs.push('COLD_TEXT_MODE_ACCEPTS_REAL_KEYS_AFTER_DELAYED_SETTINGS');
  await tap(hwnd,0x75,0x40);
  await until(()=>Number(foreground())===hostHwnd,'F6 returns keyboard to host');

  const region=makeRegion(0,0,0,0);
  assert.ok(readRegion(hwnd,region)>0,'Native input region exists');
  const scale=screen.getDisplayMatching(win.getBounds()).scaleFactor;
  assert.equal(contains(region,Math.round(win.getBounds().width*scale/2),Math.round(win.getBounds().height*scale/2)),false);
  deleteRegion(region);
  proofs.push('EMPTY_DESKTOP_AREA_IS_OUTSIDE_NATIVE_HIT_REGION');
  const rect=await wc.executeJavaScript('(()=>{const r=document.querySelector("textarea").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  const b=win.getBounds(),p=screen.dipToScreenPoint({x:Math.round(b.x+rect.x),y:Math.round(b.y+rect.y)});
  cursor(p.x,p.y);await pause(100);
  assert.equal(Number(ancestor(atPoint(p),2)),hwnd,'Click only the owned assistant input');
  mouse(2,0,0,0,0);await pause(50);mouse(4,0,0,0,0);
  await until(()=>Number(foreground())===hwnd,'click activates text input');
  await until(()=>wc.executeJavaScript('document.hasFocus()&&document.activeElement===document.querySelector("textarea")'),'clicked text caret');
  await tap(hwnd,0x59,0x15);
  assert.notEqual(await wc.executeJavaScript('document.querySelector("textarea").value'),'x','Physical typing must update the controlled field');
  proofs.push('CLICKING_PASSIVE_INPUT_ACCEPTS_REAL_KEYBOARD_TEXT');
  await tap(hwnd,0x75,0x40);await until(()=>Number(foreground())===hostHwnd,'return before voice');

  await tap(hostHwnd,0x77,0x42);
  await until(()=>wc.executeJavaScript('Boolean(document.querySelector("[aria-label=\\"Stop assistant recording\\"]"))'),'one press starts voice');
  await until(()=>Number(foreground())===hostHwnd,'voice leaves keyboard with the host');
  await pause(1000);
  assert.equal(await wc.executeJavaScript('Boolean(document.querySelector("[aria-label=\\"Stop assistant recording\\"]"))'),true,'Key release must leave voice recording');
  const edge=BrowserWindow.getAllWindows().find(item=>item!==win&&item.webContents.getURL().startsWith('data:text/html'));
  assert.ok(edge);
  let peak=0;
  for(let sample=0;sample<20;sample++){
  peak=Math.max(peak,await edge.webContents.executeJavaScript('(()=>{const p=document.querySelector(".wave"),n=p.getTotalLength(),ys=[];for(let i=0;i<800;i++){const q=p.getPointAtLength(n*i/800);if(q.x>innerWidth*.1&&q.x<innerWidth*.9&&q.y<innerHeight*.2)ys.push(q.y)}return Math.max(...ys)})()'));
  await pause(75);
  }
  trace.push({audioMax:Math.max(0,...levels),wavePeak:peak,edgeState:await edge.webContents.executeJavaScript('({level:voiceLevel,smooth:smoothLevel,reduced:reduced.matches,hidden:document.hidden,elapsed})')});
  assert.ok(peak>19,'Real synthetic microphone audio must reach the native waves: '+peak);
  proofs.push('HOTKEY_RELEASE_KEEPS_RECORDING_AND_REAL_AUDIO_DRIVES_WAVES');
  await tap(hostHwnd,0x75,0x40);await until(()=>Number(foreground())===hwnd,'type during voice');
  await tap(hwnd,0x41,0x1e);
  assert.equal(await wc.executeJavaScript('Array.from(document.querySelectorAll("button")).some(b=>b.ariaLabel==="Stop assistant recording")'),true,'Text focus keeps capture active');
  proofs.push('REAL_TYPING_WORKS_WHILE_MICROPHONE_KEEPS_RECORDING');
  await tap(hwnd,0x77,0x42);
  await until(()=>wc.executeJavaScript('document.querySelector("textarea").value.includes("Fixture voice transcript")'),'second press stops and transcribes');
  assert.equal(Number(foreground()),hwnd,'Editing keeps a reviewable draft instead of automatic send');
  proofs.push('SECOND_HOTKEY_PRESS_STOPS_AND_INSERTS_TRANSCRIPTION');
  console.log('ASSISTANT_NATIVE_INPUT_AUDIO_TOGGLE_OK');finish();
 }
 main().catch(finish);
}
