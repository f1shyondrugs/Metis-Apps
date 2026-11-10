// Visible Windows integration against the real foreground application.
// Supply the actual bundled renderer in METIS_ASSISTANT_UI. All API traffic
// and screenshot uploads stay on loopback; keys target only our own window.
const {app,BrowserWindow,screen}=require('electron');
app.setName('Metis Overlay Test');app.setAppUserModelId('ai.metis.overlay.passive.test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{once}=require('node:events'),koffi=require('koffi');
const output=process.env.METIS_OVERLAY_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'metis-overlay-proof-'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
const {createAssistant}=require('../src/main/assistant.cjs');
const {createOverlayPreferences}=require('../overlay-preferences.cjs');
const appearance=require('../appearance.cjs');
const user32=koffi.load('user32.dll'),getForeground=user32.func('uintptr_t GetForegroundWindow()');
const getStyle=user32.func('intptr_t GetWindowLongPtrW(uintptr_t,int)');
const keybd=user32.func('void keybd_event(uint8_t,uint8_t,uint32_t,uintptr_t)');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),proofs=[];
let assistant,server,submission,openedChat,uploads=0;
let initialForeground=0;
const deadline=setTimeout(()=>finish(Error('Visible overlay test timed out')),90000);
async function until(fn,label){for(let n=0;n<240;n++){if(await fn())return;await pause(50);}throw Error('Timed out: '+label);}
function finish(error){
 clearTimeout(deadline);
 fs.writeFileSync(path.join(output,'passive-result.json'),JSON.stringify({passed:!error,proofs,monitors:screen.getAllDisplays().length,
  initialForeground,...(error?{error:error.stack}:{}),finishedAt:new Date().toISOString()},null,2));
 assistant?.destroy();server?.close();app.exit(error?1:0);
}
async function main(){
 await app.whenReady();
 const ui=process.env.METIS_ASSISTANT_UI;assert.ok(ui&&fs.existsSync(path.join(ui,'desktop-assistant-native.browser.js')),'Actual renderer bundle missing');
 const prefs=createOverlayPreferences(path.join(output,'preferences.json'));
 prefs.setAssistantShortcuts({...prefs.getAssistantShortcuts(),focusInput:'F6',openChat:'F7'});
 const theme=appearance.fallback,styles=Object.entries(theme.variables).map(([name,value])=>name+':'+value).join(';');
 server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://fixture');
  const json=value=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
  if(url.pathname==='/api/preferences')return json({settings:{voiceInput:{enabled:true,provider:'openai',connectionId:'fixture-only',modelId:'fixture-only',realtime:false,maxDurationSeconds:60}}});
  if(url.pathname==='/api/chats')return json({chat:{id:'fixture-chat'}});
  if(url.pathname.startsWith('/api/chats/'))return json({chat:{runStatus:'completed',messages:submission?[{id:submission.messageId,role:'user',content:submission.message},{id:'fixture-answer',role:'assistant',content:'All monitor screenshots arrived in this same conversation.'}]:[]}});
  if(url.pathname==='/api/chat'){let body='';request.on('data',part=>body+=part);request.on('end',()=>{submission=JSON.parse(body);json({jobId:'fixture-job'});});return;}
  if(url.pathname==='/api/file-uploads'){request.resume();return json({id:'fixture-upload-'+(++uploads)});}
  if(url.pathname.startsWith('/api/file-uploads/')){request.resume();request.on('end',()=>json({id:url.pathname.split('/').pop(),offset:0,name:'Monitor.png',kind:'image',mimeType:'image/png'}));return;}
  if(url.pathname.startsWith('/asset/')){const name=path.basename(url.pathname),file=path.join(ui,name);if(fs.existsSync(file)){response.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(file).pipe(response);return;}}
  response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en" class="dark" style="'+styles+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/asset/theme.css"><link rel="stylesheet" href="/asset/desktop-assistant-native.browser.css"></head><body><div id="root"></div><script src="/asset/desktop-assistant-native.browser.js"></script></body></html>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
 assistant=createAssistant({getServer:()=>origin,getDevice:()=>({clientId:'fixture-device',hostname:'Windows test device',platform:'win32',version:'1.7.0'}),
  appearance:theme,getShortcuts:()=>prefs.getAssistantShortcuts(),onOpenChat:async id=>{openedChat=id;}});
 // The app/hook is already running when a player invokes the hotkey.
 // Exclude startup/tool-launch focus changes from the measured invocation.
 await pause(1500);initialForeground=Number(getForeground());
 assert.ok(initialForeground,'An interactive foreground application is required.');
 await assistant.open();const win=assistant.getWindow(),wc=win.webContents;
 const hwnd=Number(win.getNativeWindowHandle().readBigUInt64LE());
 await until(()=>wc.executeJavaScript('Boolean(document.querySelector("textarea"))'),'assistant renderer');
 await pause(250);
 assert.equal(win.isFocusable(),false);assert.equal(Number(getForeground()),initialForeground);
 const passiveStyle=Number(getStyle(hwnd,-20));
 assert.ok(passiveStyle&0x08000000,'Windows WS_EX_NOACTIVATE is set');
 assert.ok(passiveStyle&0x00000020,'Windows WS_EX_TRANSPARENT passes pointer input through');
 proofs.push('FOREGROUND_APP_UNCHANGED_WITH_NATIVE_NOACTIVATE_AND_CLICKTHROUGH');
 const tap=async(vk,scan)=>{assert.equal(Number(getForeground()),hwnd,'Inject keys only into the owned overlay');keybd(vk,scan,0,0);await pause(30);keybd(vk,scan,2,0);await pause(100);};
 assistant.focusInput();
 await until(()=>Number(getForeground())===hwnd,'explicit text focus');
 await until(()=>wc.executeJavaScript('document.activeElement===document.querySelector("textarea")'),'text caret after render');
 proofs.push('EXPLICIT_TEXT_MODE_FOCUSES_CARET');
 await tap(0x75,0x40);
 await until(()=>Number(getForeground())===initialForeground,'configured F6 returns foreground');
 assert.equal(win.isFocusable(),false);proofs.push('CUSTOM_F6_RETURNS_FOCUS_TO_PREVIOUS_APP');
 assistant.focusInput();await until(()=>Number(getForeground())===hwnd,'focus to compose');
 await wc.executeJavaScript('const field=document.querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"What is on all my monitors?");field.dispatchEvent(new Event("input",{bubbles:true}));');
 await pause(100);await wc.executeJavaScript('document.querySelector("[aria-label=\\"Send message with all monitors\\"]").click()');
 await until(()=>submission,'accepted submission');assert.equal(submission.uploadIds.length,screen.getAllDisplays().length);
 await until(()=>wc.executeJavaScript('Boolean(document.querySelector("[aria-label=\\"Metis reply\\"]"))'),'reply');
 assert.equal(Number(getForeground()),initialForeground);
 const info=await wc.executeJavaScript('({text:document.querySelector("[aria-label=\\"Your message\\"]").textContent,placeholder:document.querySelector("textarea").placeholder,right:document.querySelector(".assistant-conversation").getBoundingClientRect().right})');
 assert.equal(info.text,submission.message);assert.equal(info.placeholder,'Ask Metis');assert.ok(info.right>display.workArea.width-40);
 proofs.push('SAME_CANONICAL_MESSAGES_TOP_RIGHT_AND_ALL_MONITOR_CONTEXT');
 proofs.push('SEND_RESTORES_PREVIOUS_FOREGROUND');
 await wc.executeJavaScript('metisAssistant.voice({recording:true,level:.65,status:"Metis is listening"})');await pause(900);
 const edge=BrowserWindow.getAllWindows().find(item=>item!==win&&item.getBounds().x===display.bounds.x&&item.getBounds().y===display.bounds.y);
 assert.ok(edge,'Native badge exists');
 const nativeSurface=await edge.webContents.executeJavaScript('(()=>{const s=getComputedStyle(document.querySelector(".notice"));return [s.borderRadius,s.backgroundColor,s.borderTopColor]})()');
 const inputSurface=await wc.executeJavaScript('(()=>{const s=getComputedStyle(document.querySelector(".assistant-input"));return [s.borderRadius,s.backgroundColor,s.borderTopColor]})()');
 assert.deepEqual(nativeSurface,inputSurface);
 const first=await edge.webContents.executeJavaScript('document.querySelector(".wave").getAttribute("d")');await pause(400);
 assert.notEqual(first,await edge.webContents.executeJavaScript('document.querySelector(".wave").getAttribute("d")'));
 proofs.push('BADGE_AND_INPUT_SHARE_THEME_SURFACE_AND_WAVES_ANIMATE');
 const sharp=require('sharp'),overlay=(await wc.capturePage()).toPNG(),edges=(await edge.webContents.capturePage()).toPNG();
 const meta=await sharp(overlay).metadata(),edgeMeta=await sharp(edges).metadata(),scale=edgeMeta.width/display.bounds.width;
 const cropped=await sharp(edges).extract({left:Math.round((display.workArea.x-display.bounds.x)*scale),top:Math.round((display.workArea.y-display.bounds.y)*scale),width:meta.width,height:meta.height}).png().toBuffer();
 await sharp({create:{width:meta.width,height:meta.height,channels:4,background:'#111820'}}).composite([{input:cropped},{input:overlay}]).png().toFile(path.join(output,'passive-overlay.png'));
 await wc.executeJavaScript('metisAssistant.voice({recording:false,level:0})');
 assistant.focusInput();await until(()=>Number(getForeground())===hwnd,'focus for open-chat shortcut');
 await tap(0x76,0x41);await until(()=>openedChat==='fixture-chat','configured F7 opens exact chat');
 proofs.push('CUSTOM_F7_OPENS_SAME_PERSISTED_CHAT');
 console.log('PASSIVE_WINDOWS_OK');finish();
}
main().catch(finish);
