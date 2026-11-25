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
    if (require('./metis-server-fixture.cjs').replyMetisVersion(request, response)) return;
    if (request.url === '/api/remote-clients/hub') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ client: { id: 'fixture-device', name: 'Fixture device' }, audit: [] }));
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
  // The first native host is visible before the application finishes adopting
  // it. Close that real window during the asynchronous startup handoff.
  let earlyClosed=false;
  const windowModule=require('../src/main/web-window.cjs');
  const createHost=windowModule.createDesktopWindow;
  windowModule.createDesktopWindow=async options=>{
    windowModule.createDesktopWindow=createHost;
    const entry=await createHost(options);
    assert.equal(entry.win.isVisible(),true);
    entry.win.close();
    await waitFor(()=>!entry.win.isDestroyed()&&!entry.win.isVisible());
    earlyClosed=true;
    return entry;
  };
  const api = require('../main.cjs');
  try { await waitFor(() => api.getDesktop()?.getState().mode === 'ready' && api.publicState().connection === 'online'); }
  catch (error) { console.error({ desktop: api.getDesktop()?.getState(), device: api.publicState() }); throw error; }
  assert.equal(api.publicState().clientId, 'fixture-device');
  assert.deepEqual(fs.readFileSync(configFile), original);
  assert.ok(api.getRuntimePid() > 0 && api.getRuntimePid() !== process.pid);
  if(process.platform==='win32'){assert.equal(api.publicState().deviceElevation,permissionMode==='admin'?'administrator':'user');console.log('ACTUAL_DEVICE_PROCESS_TOKEN_MATCHES_PAIRING_OK');}
  console.log('SEPARATE_DEVICE_PROCESS_OK');
  console.log('PAIRING_IDENTITY_PRESERVED_OK');
  const desktop = api.getDesktop();
  assert.equal(earlyClosed,true,'fixture must really close the first workspace during startup');
  assert.equal(desktop.win.isVisible(),false,'startup must not show a workspace that the user already closed');
  await api.showDesktop(); // An explicit later wake still reopens it.
  assert.equal(desktop.win.isVisible(),true);
  console.log('COLD_START_CLOSE_IS_NOT_UNDONE_WHEN_INITIAL_LOAD_COMPLETES_OK');
  const remote = desktop.getView().webContents;
  assert.deepEqual(await remote.executeJavaScript('[typeof require, typeof process, typeof metis, typeof metisDesktop]'),
    ['undefined', 'undefined', 'undefined', 'undefined']);
  await remote.executeJavaScript('metisApp.openDeviceSettings()');
  const hub = api.getDeviceWindow();
  const outsider=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../preload.cjs'),sandbox:true,contextIsolation:true}});
  await outsider.loadURL(server+'/foreign');
  await assert.rejects(outsider.webContents.executeJavaScript('metis.restartAsAdministrator()'),/Access denied/);
  outsider.destroy();console.log('ADMIN_RESTART_FOREIGN_FRAME_REJECTED_OK');
  assert.equal(hub.isVisible(), true);
  console.log('WEB_SETTINGS_OPENS_LOCAL_DEVICE_HUB_OK');
  await waitFor(() => !hub.webContents.isLoading());
  const headerBrand=await hub.webContents.executeJavaScript('(async()=>{const el=document.querySelector(".metis-wordmark"),img=new Image();img.src=new URL("./assets/metis-wordmark.svg",location.href).href;await img.decode();return {label:el.getAttribute("aria-label"),mask:getComputedStyle(el).maskImage,width:el.getBoundingClientRect().width,decoded:img.naturalWidth>0};})()');
  assert.equal(headerBrand.label,"Metis");assert.equal(headerBrand.width,72);assert.ok(headerBrand.mask.includes("metis-wordmark.svg")&&headerBrand.decoded);
  console.log("DEVICE_SETTINGS_WEB_WORDMARK_LOADED_OK");
  const state = await hub.webContents.executeJavaScript('metis.state()');
  assert.equal(state.paired, true); assert.equal(state.credential, undefined);
  console.log('SEPARATE_RENDERERS_AND_IPC_OK');
  const owner = desktop.activeWindow, host = owner.win, workspaceUrl = remote.getURL();
  const configFiles = ['config.json', 'server.json', 'preferences.json', 'client-context.json'];
  const savedFiles = () => configFiles.map(name => {
    const file = path.join(directory, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  });
  const beforeReplay = savedFiles(), runtimePid = api.getRuntimePid();
  await remote.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<input id="draft">'); document.querySelector('#draft').value = 'Unsent draft'; document.cookie = 'replay-account=fixture';`);
  async function replayFromSettings() {
    await remote.executeJavaScript('metisApp.openDeviceSettings()');
    await hub.webContents.executeJavaScript(`document.querySelector('#open-settings').click(); document.querySelector('#replay-onboarding').click();`);
    await waitFor(() => hub.getChildWindows().some(w => w.isVisible()));
    const replay = hub.getChildWindows().find(w => w.isVisible());
    const contents = replay.webContents;
    const run = source => contents.executeJavaScript(source);
    const waitForStep = async step => {
      for (let i = 0; i < 120; i++) {
        if (await run(`document.body.dataset.mode===${JSON.stringify(step)} && !document.querySelector('main').inert`)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw Error('Replay did not reach the ' + step + ' step');
    };
    await waitForStep('welcome');
    assert.equal(replay.getParentWindow(), hub);
    assert.equal(await run('metisOnboardingReplay.state()'), owner.getState().server);
    assert.deepEqual(await run('[typeof metis, typeof metisDesktop, typeof metisApp]'), ['undefined', 'undefined', 'undefined']);
    return { replay, run, waitForStep };
  }
  const firstReplay = await replayFromSettings();
  assert.equal(await firstReplay.run("document.querySelector('#heading').textContent"), 'Welcome to Metis');
  const foreign = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/main/onboarding-replay-preload.cjs'),sandbox:true,contextIsolation:true}});
  await foreign.loadURL(server+'/foreign-replay');
  await assert.rejects(foreign.webContents.executeJavaScript('metisOnboardingReplay.state()'), /Access denied/);
  await assert.rejects(foreign.webContents.executeJavaScript('metisOnboardingReplay.close()'), /Access denied/);
  assert.equal(firstReplay.replay.isDestroyed(), false);
  foreign.destroy();
  await firstReplay.run("void setTimeout(() => document.querySelector('#exit-replay').click(), 20)");
  await waitFor(() => firstReplay.replay.isDestroyed());
  assert.equal(hub.isVisible(), false);
  const {replay, run, waitForStep} = await replayFromSettings();
  await run("document.querySelector('#begin').click()");
  await waitForStep('settings');
  assert.deepEqual(await run("(() => { const input = document.querySelector('#server'); return [input.readOnly, input.value]; })()"), [true, owner.getState().server]);
  await run("document.querySelector('#form').requestSubmit()");
  await waitForStep('loading');
  assert.equal(await run("document.querySelector('#finish-replay').hidden || document.querySelector('#replay-actions').hidden"), false);
  await run("void setTimeout(() => document.querySelector('#finish-replay').click(), 20)");
  await waitFor(() => replay.isDestroyed());
  assert.equal(owner.win, host);
  assert.equal(owner.getView().webContents, remote);
  assert.equal(remote.getURL(), workspaceUrl);
  assert.equal(await remote.executeJavaScript("document.querySelector('#draft').value"), 'Unsent draft');
  assert.match(await remote.executeJavaScript("document.cookie"), /replay-account=fixture/);
  assert.deepEqual(savedFiles(), beforeReplay);
  assert.equal(api.getRuntimePid(), runtimePid);
  assert.equal(authentications, 1);
  assert.equal(hub.isVisible(), false);
  assert.equal(host.isVisible(), true);
  console.log('NATIVE_ONBOARDING_REPLAY_PRESERVES_LIVE_WORKSPACE_OK');
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
    const closing=desktop.activeWindow;
    closing.win.close();
    await waitFor(()=>closing.win.isDestroyed()||!closing.win.isVisible());
    const survivors=desktop.getWindows().map(entry=>({entry,contents:entry.getView()?.webContents}));
    const args=[...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[]),path.join(__dirname,'..')];
    const second=spawn(process.execPath,args,{env:{...process.env,METIS_DESKTOP_TEST_DATA:directory},stdio:'ignore'});
    const exited=new Promise((resolve,reject)=>{second.once('error',reject);second.once('exit',code=>code===0?resolve():reject(Error('Second launcher exit '+code)));});
    await waitFor(()=>desktop.getWindows().length===survivors.length+1&&desktop.win.isVisible()&&desktop.getState().mode==='ready'&&Boolean(desktop.getView()));
    await exited;
    assert.equal(api.getDesktop(),desktop);
    for(const saved of survivors)assert.equal(saved.entry.getView()?.webContents,saved.contents);
    assert.notEqual(desktop.getView().webContents,remote);
    await command('second-launch-'+cycle);
    assert.equal(authentications,1);
  }
  console.log('REAL_SECOND_PROCESS_OPENS_NEW_WINDOW_AND_PRESERVES_CONNECTION_OK');
  const activation=require('../src/main/window-activation.cjs');
  const testListener=process.platform==='win32'?null:activation.listenForWindowActivation({directory,activate:()=>api.showDesktop({preferVisible:true})});
  try{
    // The native launch has completed. Routing to an existing server can
    // select the hidden original without showing it; simulate that stale selection.
    const foreground=desktop.activeWindow;
    const visible=()=>desktop.getWindows().filter(entry=>!entry.win.isDestroyed()&&entry.win.isVisible());
    assert.deepEqual(visible(),[foreground]);
    const original=await desktop.openServer(server);
    assert.equal(original.getView().webContents,remote);
    assert.equal(original.win.isVisible(),false);
    const shown=[], originalShow=desktop.show;
    desktop.show=async (...args)=>{const entry=await originalShow.apply(desktop,args);shown.push(entry);return entry;};
    try{
      fs.writeFileSync(path.join(directory,activation.REQUEST_FILE),'ignored untrusted contents');
      await waitFor(()=>shown.length>0);
      assert.equal(shown[0].win.id,foreground.win.id,'late show must select the visible workspace');
      assert.equal(original.win.isVisible(),false,'late show must not reveal the hidden workspace');
      assert.deepEqual(visible(),[foreground]);
      await command('late-activation-signal');assert.equal(authentications,1);
      console.log('LATE_LEGACY_SHOW_PRESERVES_ONE_VISIBLE_WORKSPACE_OK');
    }finally{desktop.show=originalShow;}
    const closing=desktop.activeWindow;closing.win.close();await waitFor(()=>closing.win.isDestroyed()||!closing.win.isVisible());
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
  // Browser-server switching must not reconnect or re-pair the device runtime.
  const savedRuntimePid = api.getRuntimePid();
  const alternate = server + '/alternate';
  assert.equal((await desktop.win.webContents.executeJavaScript('metisDesktop.connect(' + JSON.stringify(alternate) + ')')).ok, true);
  await waitFor(() => desktop.getState().mode === 'ready' && desktop.getState().server === alternate);
  await command('after-server-switch');
  assert.equal(api.getRuntimePid(), savedRuntimePid);
  assert.equal(authentications, 1);
  assert.deepEqual(fs.readFileSync(configFile), original);
  const remembered = desktop.getRecentServers().find(entry => entry.url === new URL(server).href);
  assert.ok(remembered);
  assert.equal(desktop.switchServer(remembered.id), true);
  await waitFor(() => desktop.getState().mode === 'ready' && desktop.getState().server === new URL(server).href);
  await command('after-recent-server-switch');
  assert.equal(authentications, 1);
  console.log('RECENT_SERVER_SWITCH_PRESERVES_DEVICE_PID_CONNECTION_AND_CREDENTIALS_OK');
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
  fs.writeFileSync(path.join(output, 'unified-fixture.png'), (await desktop.getView().webContents.capturePage()).toPNG());
  console.log('UNIFIED_OK');
  app.quit();
}
main().then(() => { clearTimeout(timeout); setTimeout(() => app.exit(0), 200); })
  .catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
