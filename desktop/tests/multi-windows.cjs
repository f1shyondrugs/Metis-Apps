const {app,Menu,BrowserWindow}=require('electron');
app.disableHardwareAcceleration();
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {once}=require('node:events');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metis-multi-window-'));
process.env.METIS_DESKTOP_TEST_DATA=dir;app.setPath('userData',dir);
app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(p){for(let i=0;i<300;i++){if(p())return;await pause(50)}throw Error('Multi-window timeout')}
const timer=setTimeout(()=>app.exit(1),60000);
async function main(){
  await app.whenReady();
  const servers=[];
  for(const label of ['A','B']){
    const server=http.createServer((_req,res)=>{
      if (require('./metis-server-fixture.cjs').replyMetisVersion(_req, res)) return;
      res.setHeader('content-type','text/html');
      res.end('<!doctype html><h1>'+label+'</h1><textarea id="draft"></textarea><script>window.localClicks=0;document.addEventListener("click",()=>localClicks++)</script>');
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);
  }
  const [a,b]=servers.map(s=>'http://127.0.0.1:'+s.address().port+'/');
  fs.writeFileSync(path.join(dir,'server.json'),JSON.stringify({url:a,recentServers:[b]}));
  let settings=0,mode=false;
  const desktop=await require('../src/main/web-window.cjs').createDesktop({onDevices:()=>settings++,onCaptureHidden:value=>(mode=value)});
  await desktop.initialLoad;
  const first=desktop.activeWindow,wc=first.getView().webContents;
  await wc.executeJavaScript('document.querySelector("#draft").value="Unsaved window A"');
  await wc.session.cookies.set({url:a,name:'session',value:'fixture-login'});
  const bid=desktop.getRecentServers().find(e=>e.url===b).id;
  const second=await desktop.newWindow({serverId:bid});await second.initialLoad;
  assert.equal(desktop.getWindows().length,2);assert.equal(first.getState().server,a);assert.equal(second.getState().server,b);
  assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'),'Unsaved window A');
  await second.getView().webContents.executeJavaScript('document.querySelector("#draft").value="Window B draft";metisApp.openDeviceSettings()');
  await wc.executeJavaScript('metisApp.setOverlayCaptureHidden(true)');
  assert.equal(settings,1);assert.equal(mode,true);
  // Each native menu remains bound to its own window, even when another window is active.
  first.getMenu().getMenuItemById('metis-server-'+bid).click();
  await waitFor(()=>first.getState().mode==='ready'&&first.getState().server===b);
  assert.equal(await second.getView().webContents.executeJavaScript('document.querySelector("#draft").value'),'Window B draft');
  assert.equal(desktop.getWindows().length,2);
  const third=await desktop.newWindow({serverUrl:a});await third.initialLoad;
  assert.equal((await third.getView().webContents.session.cookies.get({url:a})).find(c=>c.name==='session').value,'fixture-login');
  assert.equal(await third.getView().webContents.executeJavaScript('document.querySelector("#draft").value'),'');
  // A foreign main frame cannot use another window's configured-origin native bridge.
  await second.getView().webContents.loadURL(a);
  await assert.rejects(second.getView().webContents.executeJavaScript('metisApp.openDeviceSettings()'),/Access denied/);
  assert.equal(settings,1);
  const outsider=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/main/web-preload.cjs'),sandbox:true,contextIsolation:true}});
  await outsider.loadFile(path.join(__dirname,'../ui/index.html'));
  await assert.rejects(outsider.webContents.executeJavaScript('metisDesktop.connect('+JSON.stringify(a)+')'),/Access denied/);
  outsider.destroy();
  assert.equal(await desktop.newWindow({serverId:'0'.repeat(24)}),null);
  assert.equal(desktop.getWindows().length,3);
  second.win.close();await waitFor(()=>desktop.getWindows().length===2);
  assert.equal(third.getState().server,a);
  // Native menu and same-origin target=_blank create independent windows.
  await desktop.show();
  const count=desktop.getWindows().length;
  Menu.getApplicationMenu().getMenuItemById('metis-new-window').click();
  await waitFor(()=>desktop.getWindows().length===count+1);
  const fourth=desktop.activeWindow;await fourth.initialLoad;
  await fourth.getView().webContents.executeJavaScript('window.open("/new-chat","_blank")');
  await waitFor(()=>desktop.getWindows().length===count+2);
  const fifth=desktop.activeWindow;await fifth.initialLoad;
  assert.equal(new URL(fifth.getView().webContents.getURL()).pathname,'/new-chat');
  console.log('MULTI_WINDOWS_ORIGIN_IPC_DRAFTS_SESSIONS_MENUS_AND_LIFECYCLE_OK');
  const output=path.join(__dirname,'../test-results');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'multi-window-server-a.png'),(await third.getView().webContents.capturePage()).toPNG());
  for(const entry of desktop.getWindows())entry.win.destroy();
  const reopened=await desktop.newWindow({serverUrl:a});await reopened.initialLoad;
  assert.equal(reopened.getState().mode,'ready');reopened.win.destroy();
  console.log('MULTI_WINDOWS_IPC_REREGISTRATION_OK');
  servers.forEach(s=>s.close());
}
main().then(()=>{clearTimeout(timer);app.exit(0)}).catch(e=>{console.error(e);clearTimeout(timer);app.exit(1)});
