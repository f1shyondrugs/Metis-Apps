// Actual Electron window, sandbox, native monitor capture and origin guards.
// This test never uses an account or submits real user screenshots to a server.
const {app,BrowserWindow,screen,session}=require('electron');
app.disableHardwareAcceleration();
app.setName('Metis Assistant Test');app.setAppUserModelId('ai.metis.assistant.test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{once,EventEmitter}=require('node:events');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'metis-assistant-test-')));
const timeout=setTimeout(()=>app.exit(1),60000);
const {createAssistant}=require('../src/main/assistant.cjs');
const pause=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await pause();}throw Error('Timed out');}
async function main(){
 await app.whenReady();
 const fixture=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><p>Assistant fixture</p><iframe src="/frame"></iframe><script>window.events=[];metisAssistant.onGesture(value=>events.push(value));metisAssistant.ready().then(value=>events.push(...value.gestures));</script></body></html>');});
 fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
 const server='http://127.0.0.1:'+fixture.address().port;
 const emitter=new EventEmitter();emitter.start=()=>{};emitter.stop=()=>{};
 const hook={uIOhook:emitter,UiohookKey:{Space:57,Escape:1,Ctrl:29,CtrlRight:3613,Shift:42,ShiftRight:54}};
 const assistant=createAssistant({getServer:()=>server,getDevice:()=>({clientId:'fixture',hostname:'Fixture PC',platform:process.platform,version:'fixture'}),onOpenChat:()=>{},hook});
 await session.fromPartition('persist:metis-web').cookies.set({url:server,name:'metis_fixture',value:'session'});
 assistant.gesture.down();assistant.gesture.up();assistant.gesture.down();assistant.gesture.up();
 await until(()=>assistant.getWindow()?.isVisible());
 const win=assistant.getWindow(),wc=win.webContents;
 await until(()=>wc.executeJavaScript('window.events?.includes("stop")'));
 assert.deepEqual(await wc.executeJavaScript('[typeof require,typeof process,typeof document.querySelector("iframe").contentWindow.metisAssistant]'),['undefined','undefined','undefined']);
 assert.equal((await wc.session.cookies.get({url:server}))[0].value,'session');
 const events=await wc.executeJavaScript('events');assert.equal(events.filter(value=>value==='start').length,1);assert.ok(events.indexOf('start')<events.indexOf('stop'));
 console.log('ASSISTANT_SANDBOX_SESSION_AND_TOGGLE_DURING_LOAD_OK');
 assert.equal(win.isFocusable(),false);
 await wc.executeJavaScript('metisAssistant.configure({voiceConfigured:true,chatId:"fixture-chat"})');
 assert.equal(win.isFocusable(),false);
 await wc.executeJavaScript('metisAssistant.focusInput(true)');
 assert.equal(win.isFocusable(),true);
 await wc.executeJavaScript('metisAssistant.focusInput(false)');
 assert.equal(win.isFocusable(),false);
 await wc.executeJavaScript('metisAssistant.configure({voiceConfigured:false,chatId:"fixture-chat"})');
 // Explicit focus changes are not overridden by later settings refreshes.
 assert.equal(win.isFocusable(),false);
 console.log('ASSISTANT_PASSIVE_AND_EXPLICIT_INPUT_MODE_OK');
 assistant.close(); await assistant.open();
 await wc.executeJavaScript('metisAssistant.configure({voiceConfigured:false,chatId:"fixture-chat"})');
 assert.equal(win.isFocusable(),true);
 console.log('ASSISTANT_WITHOUT_VOICE_AUTOFOCUSES_OK');
 const context=await wc.executeJavaScript('metisAssistant.capture()');
 assert.equal(context.device.clientId,'fixture');
 assert.equal(context.monitors.length,screen.getAllDisplays().length);
 for(const monitor of context.monitors){assert.ok(monitor.image.startsWith('data:image/png;base64,'));assert.ok(monitor.bounds.width>0);}
 assert.ok(win.isVisible());
 console.log('ASSISTANT_ALL_MONITORS_AND_CAPTURE_RESTORE_OK');
 await wc.loadURL(server+'/foreign-path');
 await assert.rejects(wc.executeJavaScript('metisAssistant.capture()'),/Access denied/);
 await assert.rejects(wc.executeJavaScript('metisAssistant.focusInput(true)'),/Access denied/);
 await assert.rejects(wc.executeJavaScript('metisAssistant.configure({voiceConfigured:false,chatId:null})'),/Access denied/);
 const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/main/assistant-preload.cjs'),sandbox:true,contextIsolation:true}});
 await foreign.loadURL(server+'/desktop-assistant');
 await assert.rejects(foreign.webContents.executeJavaScript('metisAssistant.capture()'),/Access denied/);foreign.destroy();
 console.log('ASSISTANT_PATH_AND_SENDER_GUARDS_OK');
 assistant.destroy();fixture.close();
 console.log('ASSISTANT_OK');
}
main().then(()=>{clearTimeout(timeout);app.exit(0);}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1);});
