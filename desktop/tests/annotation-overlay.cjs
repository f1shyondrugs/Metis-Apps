// Real Electron test: isolated local fixture, no production profile or device traffic.
const {app,BrowserWindow,screen,session,ipcMain}=require('electron');
app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();app.setName('Metis Annotation Test');app.setAppUserModelId('ai.metis.annotations.test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{once}=require('node:events');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'metis-annotations-test-')));
const {createAnnotationOverlay}=require('../src/main/annotation-overlay.cjs');
const timeout=setTimeout(()=>app.exit(1),60000),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await pause(50);}throw Error('Timed out');}
async function main(){
 await app.whenReady();
 let escapedRequests=0;
 const fixture=http.createServer((req,res)=>{
  if(req.url==='/escape')escapedRequests++;
  res.setHeader('content-type','text/html');
  res.end('<!doctype html><html><body style="background:transparent"><iframe src="/frame"></iframe><script>window.received=[];if(window.metisOverlay){metisOverlay.onState(s=>received.push(s));metisOverlay.state().then(s=>{window.initial=s;received.push(s)});}</script></body></html>');
 });fixture.listen(0,'127.0.0.1');await once(fixture,'listening');const server='http://127.0.0.1:'+fixture.address().port;
 await session.fromPartition('persist:metis-web').cookies.set({url:server,name:'annotation-fixture',value:'private-test-session'});
 const overlay=createAnnotationOverlay({BrowserWindow,screen,ipcMain,getServer:()=>server,hideFromCapture:true});
 const id=overlay.status().displays[0].id;
 const rect={id:'box',type:'rect',x:10,y:20,width:100,height:60,color:'#ffcc00'};
 await overlay.execute({operation:'add',display_id:id,items:[rect]});
 let win=overlay.getWindows()[0],wc=win.webContents;
 await until(()=>win.isVisible());
 assert.equal(win.isFocusable(),false);assert.equal(await wc.executeJavaScript('initial.items[0].id'),'box');
 assert.deepEqual(await wc.executeJavaScript('[typeof require,typeof process,typeof document.querySelector("iframe").contentWindow.metisOverlay]'),['undefined','undefined','undefined']);
 assert.ok((await wc.session.cookies.get({url:server})).some(x=>x.name==='annotation-fixture'));
 await wc.executeJavaScript('document.querySelector("iframe").srcdoc='+JSON.stringify('<script>location.href="/escape"</script>'));
 await pause(100);assert.equal(escapedRequests,0);
 console.log('ANNOTATION_REAL_WINDOW_SANDBOX_SHARED_SESSION_PASSIVE_OK');
 console.log('ANNOTATION_SUBFRAME_NAVIGATION_STAYS_OFFLINE_OK');
 const card={id:'card',type:'card',x:20,y:60,width:300,height:200,content:{kind:'html',source:'<button>Local</button>'}};
 await overlay.execute({operation:'add',display_id:id,items:[card]});
 await overlay.execute({operation:'interact',display_id:id,interactive_id:'card'});
 assert.equal(win.isFocusable(),true);
 await wc.executeJavaScript('metisOverlay.interact(null)');assert.equal(win.isFocusable(),false);
 await wc.executeJavaScript('metisOverlay.remove("box")');assert.equal(overlay.status().displays[0].items.length,1);
 await wc.executeJavaScript('metisOverlay.undo()');assert.equal(overlay.status().displays[0].items.length,2);
 overlay.setHideFromCapture(false);assert.equal(win.isContentProtected(),false);overlay.setHideFromCapture(true);
 if(process.platform!=='linux')assert.equal(win.isContentProtected(),true);
 overlay.suspendCapture();assert.equal(win.isVisible(),false);overlay.resumeCapture();assert.equal(win.isVisible(),true);
 console.log('ANNOTATION_EXPLICIT_CARD_INTERACTION_CAPTURE_AND_UNDO_OK');
 await assert.rejects(overlay.execute({operation:'update',display_id:id,items:[{...rect,width:999999}]}));
 assert.equal(overlay.status().displays[0].items.length,2);
 await wc.loadURL(server+'/foreign');await assert.rejects(wc.executeJavaScript('metisOverlay.clear()'),/Access denied/);
 const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/main/annotation-preload.cjs'),sandbox:true,contextIsolation:true}});
 await foreign.loadURL(server+'/desktop-overlay');await assert.rejects(foreign.webContents.executeJavaScript('metisOverlay.clear()'),/Access denied/);foreign.destroy();
 console.log('ANNOTATION_PATH_SENDER_AND_ATOMIC_FAILURE_GUARDS_OK');
 overlay.clearAll();assert.equal(win.isVisible(),false);await overlay.execute({operation:'undo',display_id:id});assert.equal(overlay.status().displays[0].items.length,0);
 overlay.destroy();
 // No request may reappear after Escape while its renderer is still loading.
 let release;const gate=new Promise(r=>release=r);const delayServer=http.createServer(async(req,res)=>{await gate;res.setHeader('content-type','text/html');res.end('<script>metisOverlay.state()</script>');});
 delayServer.listen(0,'127.0.0.1');await once(delayServer,'listening');
 const delayed=createAnnotationOverlay({BrowserWindow,screen,ipcMain,getServer:()=>'http://127.0.0.1:'+delayServer.address().port});
 const pending=delayed.execute({operation:'add',display_id:id,items:[rect]});await until(()=>delayed.getWindows().length>0);delayed.clearAll();release();await pending;
 assert.equal(delayed.status().displays[0].items.length,0);assert.ok(delayed.getWindows().every(w=>!w.isVisible()));
 delayed.destroy();delayServer.close();fixture.close();console.log('ANNOTATION_ESCAPE_DURING_LOAD_NO_RESURRECTION_OK');console.log('ANNOTATION_NATIVE_OK');
}
main().then(()=>{clearTimeout(timeout);app.exit(0)}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
