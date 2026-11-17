const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{spawn}=require("node:child_process"),{EventEmitter,once}=require("node:events");
const {createUpdateState}=require("../src/main/app-updates.cjs");
const {createUpdateController,waitForProcessExit}=require("../src/main/update-controller.cjs");
const {createUpdateShutdown}=require("../src/main/update-shutdown.cjs");
const directory=process.env.METIS_UPDATE_TEST_DIR||fs.mkdtempSync(path.join(os.tmpdir(),"metis-update-native-"));
app.setName("Metis isolated update test");app.setAppUserModelId("ai.metis.update.native.test");app.setPath("userData",directory);app.disableHardwareAcceleration();
let child,installs=0,cleaned=false,exited=false;
const trace=phase=>console.error("UPDATE_NATIVE_PHASE",phase);
// Match the production main process: closing windows must not bypass the quit gate.
app.on("window-all-closed",()=>{});
const timer=setTimeout(()=>{child?.kill();console.error("UPDATE_NATIVE_TIMEOUT");app.exit(1);},15000);
app.whenReady().then(async()=>{trace("ready");
 child=spawn(process.execPath,["-e","process.stdout.write('ready');setInterval(()=>{},1000)"],{env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},stdio:["ignore","pipe","ignore"]});
 child.on("exit",()=>{exited=true;});await once(child.stdout,"data");trace("child-ready");
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 await win.loadURL("data:text/html,<title>Isolated update test</title>");
 const updater=new EventEmitter(),state=createUpdateState();
 updater.checkForUpdates=async()=>{};updater.downloadUpdate=async()=>{};
 updater.quitAndInstall=()=>{trace("installer-handoff");assert.ok(exited);assert.ok(cleaned);installs++;app.quit();};
 const controller=createUpdateController({updater,state,version:"fixture",diagnosticsFile:path.join(directory,"diagnostics.json")});
 updater.emit("update-downloaded",{version:"9.0.0"});
 const shutdown=createUpdateShutdown({
  ready:()=>controller.ready,
  // Windows can retire the OS process before Node delivers ChildProcess.exit
  // during Electron's quit sequence. Verify the actual OS lifetime, not event timing.
  drain:async()=>{trace("drain");const pid=child.pid;child.kill();await waitForProcessExit([pid]);assert.throws(()=>process.kill(pid,0),{code:"ESRCH"});exited=true;trace("child-stopped");},
  cleanup:()=>{trace("cleanup");cleaned=true;win.destroy();},
  install:()=>controller.install(),quit:()=>app.quit(),
  onError:error=>{console.error(error);app.exit(1);},
 });
 app.on("before-quit",shutdown.beforeQuit);
 app.on("will-quit",()=>{trace("will-quit");
  assert.equal(installs,1);assert.ok(exited&&cleaned);clearTimeout(timer);
  // Windows keeps Chromium profile files locked until the app process exits.
  // The fixed standard-user parent runner owns that temporary directory cleanup.
  if(process.platform!=="win32")fs.rmSync(directory,{recursive:true,force:true});
  console.log("REAL_ELECTRON_UPDATE_DRAIN_AND_REENTRANT_QUIT_OK");
 });
 trace("request-quit");app.quit();
}).catch(error=>{child?.kill();console.error(error);clearTimeout(timer);app.exit(1);});
