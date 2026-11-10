const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{once}=require('node:events');
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
app.setName('Metis microphone permission test');app.setAppUserModelId('ai.metis.permission.test');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'metis-media-e2e-')));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const {createWebPermissionPolicy}=require('../src/main/web-permissions.cjs');
const {createOverlayHtml}=require('../computer-use-overlay.cjs');
const timeout=setTimeout(()=>app.exit(1),60000);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 await app.whenReady();
 const fixture=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><body>Microphone permission fixture</body></html>');});
 fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
 const origin='http://127.0.0.1:'+fixture.address().port;
 let prompts=0;const policy=createWebPermissionPolicy({file:path.join(app.getPath('userData'),'microphone.json'),prompt:async()=>{prompts++;return {response:1};}});
 const make=async route=>{
  const win=new BrowserWindow({show:false,webPreferences:{partition:'persist:metis-media-test',sandbox:true}});
  policy.register(win.webContents,origin,win);await win.loadURL(origin+route);return win;
 };
 const capture=win=>win.webContents.executeJavaScript('(async()=>{const s=await navigator.mediaDevices.getUserMedia({audio:true});const n=s.getAudioTracks().length;s.getTracks().forEach(t=>t.stop());return n})()');
 const main=await make('/'),assistant=await make('/desktop-assistant');
 assert.equal(await capture(main),1);assert.equal(prompts,1);
 assert.equal(await capture(main),1);assert.equal(await capture(assistant),1);assert.equal(prompts,1);
 await main.reload();await new Promise(r=>main.webContents.once('did-finish-load',r));
 assert.equal(await capture(main),1);assert.equal(prompts,1);
 assistant.destroy();const reopened=await make('/desktop-assistant');
 assert.equal(await capture(reopened),1);assert.equal(prompts,1);
 main.destroy();reopened.destroy();fixture.close();
 console.log('REAL_MEDIA_MICROPHONE_CONSENT_REUSED_ACROSS_WINDOWS_AND_RELOAD_OK');

 const win=new BrowserWindow({show:true,width:1440,height:900,webPreferences:{sandbox:true,backgroundThrottling:false}});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(createOverlayHtml(undefined,'Escape','voice')));
 const wc=win.webContents;
 // CI hosts can default to reduced motion. Exercise both modes explicitly.
 wc.debugger.attach('1.3');
 await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 for(let i=0;i<50;i++){
  if(!await wc.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'))break;
  await pause(20);
 }
 const band=()=>wc.executeJavaScript('(()=>{const p=document.querySelector(".wave"),n=p.getTotalLength(),ys=[];for(let i=0;i<1000;i++){const q=p.getPointAtLength(n*i/1000);if(q.x>innerWidth*.1&&q.x<innerWidth*.9&&q.y<innerHeight*.2)ys.push(q.y)}return Math.max(...ys)})()');
 for(const [width,height] of [[390,844],[768,900],[1440,900]]){
  win.setSize(width,height);
  await wc.executeJavaScript('metisVoiceState(false,"Metis Assistant");metisVoiceLevel(0)');
  await pause(850);
  assert.equal(await wc.executeJavaScript('getComputedStyle(document.querySelector(".edge")).visibility'),'visible');
  assert.equal(await wc.executeJavaScript('getComputedStyle(document.querySelector("circle")).fill'),'rgb(255, 255, 255)');
  const idle=await band();
  await wc.executeJavaScript('metisVoiceState(true,"Metis is listening");metisVoiceLevel(1)');
  await pause(700);
  const loud=await band();
  assert.ok(loud>idle+3,`Audio should visibly increase the wave: ${idle} -> ${loud}`);
  assert.ok(loud<30,'Loud waves remain at the outer edge');
  await wc.executeJavaScript('metisVoiceState(false,"Metis Assistant")');
  await pause(800);
  assert.equal(await wc.executeJavaScript('getComputedStyle(document.querySelector(".edge")).visibility'),'visible');
 }
 await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(let i=0;i<50;i++){
  if(await wc.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'))break;
  await pause(20);
 }
 assert.equal(await wc.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'),true);
 await pause(250);
 const still=await wc.executeJavaScript('document.querySelector(".wave").getAttribute("d")');
 await pause(150);
 assert.equal(await wc.executeJavaScript('document.querySelector(".wave").getAttribute("d")'),still);
 console.log('ASSISTANT_WHITE_IDLE_BORDER_AUDIO_RESPONSE_AND_REDUCED_MOTION_OK');
 win.destroy();
}
main().then(()=>{clearTimeout(timeout);app.exit(0)}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
