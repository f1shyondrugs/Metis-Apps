// Real Electron + device protocol, isolated files and a local fixture only.
const { app, safeStorage, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-unified-test-'));
process.env.METIS_DESKTOP_TEST_DATA = directory;
const timeout = setTimeout(() => { console.error('UNIFIED_TIMEOUT'); app.exit(1); }, 60000);
const waitFor = async predicate => {
  const end = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Unified state transition timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function main() {
  await app.whenReady();
  app.setName('Metis AI Remote Client');
  app.setVersion(require('../package.json').version);
  const fixture = http.createServer((request, response) => {
    if (request.url === '/api/remote-clients/hub') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ client: { name: 'Fixture device' }, audit: [] }));
    } else if(request.url === '/desktop-overlay') {
      response.setHeader('content-type','text/html');response.end('<!doctype html><script>window.scenes=[];metisOverlay.onState(s=>scenes.push(s));metisOverlay.state().then(s=>scenes.push(s));</script>');
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>Metis fixture</title><h1>Metis fixture</h1>');
    }
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const server = 'http://127.0.0.1:' + fixture.address().port;
  const wss = new WebSocketServer({ server: fixture });
  let socket, authentications = 0, overlayCapability=false;
  const responses = new Map();
  wss.on('connection', ws => {
    socket = ws;
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'auth') {
        assert.equal(message.clientId, 'fixture-device');
        assert.equal(message.credential, 'fixture-only-credential');
        authentications++;
        ws.send(JSON.stringify({ type: 'authenticated', clientId: message.clientId }));
      }
      if (message.type === 'heartbeat') { overlayCapability=message.overlayAnnotations===true;ws.send(JSON.stringify({ type: 'heartbeat_ack' })); }
      if (message.type === 'response') responses.set(message.requestId, message);
    });
  });
  const configFile = path.join(directory, 'config.json');
  const { createCredentialStore } = require('../credential-store.cjs');
  let permissionMode = 'user';
  if (process.platform === 'win32') {
    const { execFileSync } = require('node:child_process');
    const elevated = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { encoding: 'utf8', windowsHide: true }).trim();
    permissionMode = elevated === 'True' ? 'admin' : 'user';
  }
  createCredentialStore({ file: configFile, safeStorage }).save({
    server, clientId: 'fixture-device', credential: 'fixture-only-credential', permissionMode
  });
  const original = fs.readFileSync(configFile);
  fs.writeFileSync(path.join(directory, 'server.json'), JSON.stringify({ url: server }));
  const api = require('../main.cjs');
  try { await waitFor(() => api.getDesktop()?.getState().mode === 'ready' && api.publicState().connection === 'online'); }
  catch (error) { console.error({ desktop: api.getDesktop()?.getState(), device: api.publicState() }); throw error; }
  assert.equal(api.publicState().clientId, 'fixture-device');
  assert.deepEqual(fs.readFileSync(configFile), original);
  assert.ok(api.getRuntimePid() > 0 && api.getRuntimePid() !== process.pid);
  console.log('SEPARATE_DEVICE_PROCESS_OK');
  console.log('PAIRING_IDENTITY_PRESERVED_OK');
  const desktop = api.getDesktop();
  const remote = desktop.getView().webContents;
  assert.deepEqual(await remote.executeJavaScript('[typeof require, typeof process, typeof metis, typeof metisDesktop]'),
    ['undefined', 'undefined', 'undefined', 'undefined']);
  await remote.executeJavaScript('metisApp.openDeviceSettings()');
  const hub = api.getDeviceWindow();
  assert.equal(hub.isVisible(), true);
  console.log('WEB_SETTINGS_OPENS_LOCAL_DEVICE_HUB_OK');
  await waitFor(() => !hub.webContents.isLoading());
  const state = await hub.webContents.executeJavaScript('metis.state()');
  assert.equal(state.paired, true); assert.equal(state.credential, undefined);
  console.log('SEPARATE_RENDERERS_AND_IPC_OK');
  if(api.publicState().desktopAvailable){
  await waitFor(()=>overlayCapability);
  socket.send(JSON.stringify({type:'request',requestId:'overlay-status',action:'desktop_overlay',params:{operation:'status'}}));
  await waitFor(()=>responses.has('overlay-status'));assert.equal(responses.get('overlay-status').ok,true);
  const display=responses.get('overlay-status').result.displays[0];
  socket.send(JSON.stringify({type:'request',requestId:'overlay-add',action:'desktop_overlay',params:{operation:'add',display_id:display.id,items:[{id:'fixture',type:'rect',x:10,y:10,width:100,height:100}]}}));
  await waitFor(()=>responses.has('overlay-add'));assert.equal(responses.get('overlay-add').ok,true);
  assert.equal(api.getAnnotationOverlay().getWindows()[0].isVisible(),true);
  assert.equal(authentications,1);console.log('ANNOTATION_UTILITY_PROCESS_RPC_CAPABILITY_AND_ONE_CONNECTION_OK');
  }else{assert.equal(overlayCapability,false);console.log('ANNOTATION_UTILITY_RPC_SKIPPED_NO_INTERACTIVE_GUI');}
  const originalShortcuts=api.publicState().assistant.shortcuts;
  await remote.executeJavaScript('metisApp.setShortcuts('+JSON.stringify({...originalShortcuts,focusInput:'F6'})+')');
  assert.equal(api.publicState().assistant.shortcuts.focusInput,'F6');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'preferences.json'),'utf8')).assistantShortcuts.focusInput,'F6');
  const assistant=api.getAssistant();await assistant.open();
  await remote.executeJavaScript('metisApp.setOverlayCaptureHidden(false)');
  assert.equal(assistant.getWindow().isContentProtected(),false);
  assert.ok(BrowserWindow.getAllWindows().filter(w=>w!==desktop.win&&w!==hub).every(w=>!w.isContentProtected()),'Assistant and every voice perimeter share the visible preference');
  assert.equal(api.publicState().hideOverlayFromCapture,false);
  await remote.executeJavaScript('metisApp.setOverlayCaptureHidden(true)');
  if(process.platform!=='linux')assert.ok(BrowserWindow.getAllWindows().filter(w=>w!==desktop.win&&w!==hub).every(w=>w.isContentProtected()),'Assistant and every voice perimeter share the hidden preference');
  await assert.rejects(remote.executeJavaScript('metisApp.setOverlayCaptureHidden("false")'),/Invalid capture/);
  console.log('WEB_CAPTURE_SETTING_UPDATES_ASSISTANT_AND_PERSISTS_OK');
  await assistant.getWindow().webContents.executeJavaScript('metisAssistant.openChat("fixture-chat")');
  await waitFor(()=>new URL(remote.getURL()).searchParams.get('c')==='fixture-chat');
  console.log('ASSISTANT_SHORTCUTS_PERSIST_AND_OPEN_EXACT_CHAT_OK');
  async function command(id) {
    socket.send(JSON.stringify({ type: 'request', requestId: id, action: 'get_info', params: {} }));
    await waitFor(() => responses.has(id));
    assert.equal(responses.get(id).ok, true);
  }
  await command('before-reload');
  remote.reload();
  await waitFor(() => !remote.isLoading());
  await command('after-reload');
  desktop.win.close(); hub.close();
  assert.equal(desktop.win.isVisible(), false);
  assert.equal(hub.isVisible(), false);
  await command('windows-hidden');
  assert.equal(authentications, 1);
  await api.showDesktop();
  assert.equal(desktop.win.isVisible(), true);
  console.log('BACKGROUND_CONNECTION_SURVIVES_RELOAD_AND_CLOSE_OK');
  const {spawn}=require('node:child_process');
  for(let cycle=0;cycle<2;cycle++){
    desktop.win.close();
    assert.equal(desktop.win.isVisible(),false);
    const args=[...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[]),path.join(__dirname,'..')];
    const second=spawn(process.execPath,args,{env:{...process.env,METIS_DESKTOP_TEST_DATA:directory},stdio:'ignore'});
    const exited=new Promise((resolve,reject)=>{second.once('error',reject);second.once('exit',code=>code===0?resolve():reject(Error('Second launcher exit '+code)));});
    await waitFor(()=>desktop.win.isVisible());
    await exited;
    assert.equal(api.getDesktop(),desktop);
    assert.equal(desktop.getView().webContents,remote);
    await command('second-launch-'+cycle);
    assert.equal(authentications,1);
  }
  console.log('REAL_SECOND_PROCESS_REOPENS_SAME_WINDOW_AND_PRESERVES_CONNECTION_OK');
  const activation=require('../src/main/window-activation.cjs');
  const testListener=process.platform==='win32'?null:activation.listenForWindowActivation({directory,activate:()=>api.showDesktop()});
  try{
    desktop.win.close();assert.equal(desktop.win.isVisible(),false);
    // This channel has only one effect: show the same window. Its contents are
    // deliberately not trusted as commands or navigation parameters.
    fs.writeFileSync(path.join(directory,activation.REQUEST_FILE),'ignored untrusted contents');
    await waitFor(()=>desktop.win.isVisible());
    assert.equal(api.getDesktop(),desktop);assert.equal(desktop.getView().webContents,remote);
    await command('activation-signal');assert.equal(authentications,1);
    console.log('FIXED_PROFILE_SIGNAL_REOPENS_SAME_WINDOW_WITHOUT_ELEVATION_OK');
    if(process.platform==='win32'&&permissionMode==='admin'){
      const {promisify}=require('node:util'),{execFile}=require('node:child_process');
      const ps=script=>promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:20000});
      const quote=value=>"'"+value.replace(/'/g,"''")+"'";
      const taskName='Metis activation test '+path.basename(directory);
      const scriptFile=path.join(directory,'request-as-user.ps1'),proofFile=path.join(directory,'request-as-user.json'),requestFile=path.join(directory,activation.REQUEST_FILE);
      fs.rmSync(requestFile,{force:true});
      fs.writeFileSync(scriptFile,[
        "$ErrorActionPreference='Stop'",
        "$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())",
        "@{elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json | Set-Content -LiteralPath "+quote(proofFile),
        "[IO.File]::WriteAllText("+quote(requestFile)+",'show')"
      ].join('\n'));
      desktop.win.close();assert.equal(desktop.win.isVisible(),false);
      try{
        await ps("$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "+quote('-NoProfile -ExecutionPolicy Bypass -File "'+scriptFile+'"')+
          ";$p=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited"+
          ";Register-ScheduledTask -TaskName "+quote(taskName)+" -Action $action -Principal $p -Force | Out-Null;Start-ScheduledTask -TaskName "+quote(taskName));
        await waitFor(()=>desktop.win.isVisible()&&fs.existsSync(proofFile));
        const requester=JSON.parse(fs.readFileSync(proofFile,'utf8').replace(/^\uFEFF/,''));
        assert.equal(typeof requester.elevated,'boolean');
        // Hosted Windows images can disable Admin Approval Mode, in which case
        // even a Limited task receives an admin token. Do not call that a
        // medium-integrity test; the owner-machine fixture must still be limited.
        if(requester.elevated){
          assert.equal(process.env.GITHUB_ACTIONS,'true','A real Windows fixture must supply a limited requester');
          console.log('WINDOWS_CI_FILTERED_TOKEN_UNAVAILABLE_PROFILE_CHANNEL_TESTED_ONLY');
        }
        assert.equal(api.getDesktop(),desktop);assert.equal(api.getRuntimePid()>0,true);assert.equal(authentications,1);
        if(!requester.elevated)console.log('WINDOWS_MEDIUM_TO_ELEVATED_SHOW_WITHOUT_RUNAS_OR_UAC_OK');
      }finally{await ps("Unregister-ScheduledTask -TaskName "+quote(taskName)+" -Confirm:$false -ErrorAction SilentlyContinue");}
    }
  }finally{testListener?.close();}
  if (process.platform === 'darwin') {
    const { utilityProcess } = require('electron');
    const { startDeviceHost } = require('../src/device/runtime.cjs');
    let nativeOnline = false;
    const native = startDeviceHost({ utilityProcess,
      config: { server, clientId: 'fixture-device', credential: 'fixture-only-credential', permissionMode }, configPath: configFile,
      capabilities: { desktopAvailable: true, nativeNotifications: false },
      onEvent: event => { if (event.type === 'connection' && event.status === 'online') nativeOnline = true; }, showNotification: () => false });
    try {
      await waitFor(() => nativeOnline);
      socket.send(JSON.stringify({ type: 'request', requestId: 'native-status', action: 'computer_use', params: { operation: 'status' } }));
      await waitFor(() => responses.has('native-status'));
      assert.equal(responses.get('native-status').ok, true);
      assert.equal(typeof responses.get('native-status').result.available, 'boolean');
      console.log('MAC_NATIVE_DEVICE_PROCESS_OK');
    } finally { native.stop(); }
  }
  const output = path.join(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'unified-fixture.png'), (await remote.capturePage()).toPNG());
  console.log('UNIFIED_OK');
  app.quit();
}
main().then(() => { clearTimeout(timeout); setTimeout(() => app.exit(0), 200); })
  .catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
