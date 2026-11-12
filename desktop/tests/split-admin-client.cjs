const {app,BrowserWindow,Tray,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.METIS_SPLIT_TEST_ROOT;
if(!root)throw Error('Isolated split test root required.');
app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'medium-ui'));app.setAppUserModelId('ai.metis.split.test');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+30000;while(!await fn()){if(Date.now()>end)throw Error('Split test timed out.');await sleep(25);}}
let controller,win,tray,sequence=0;
const timeout=setTimeout(()=>app.exit(1),90000);
async function main(){
 await app.whenReady();
 assert.equal(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().elevated,false);
 const {createAdminController,attachAdminRuntime}=require('../src/device/admin-controller.cjs');
 controller=createAdminController({developmentEntry:path.join(__dirname,'../bootstrap.cjs'),
  createChannel:options=>require('../src/device/windows-channel.cjs').createChannel(options),
  launch:async args=>{
   const id=++sequence,request=path.join(root,'launch-'+id+'.json'),receipt=path.join(root,'launched-'+id+'.json');
   fs.writeFileSync(request,JSON.stringify({args,parentPid:process.pid}));
   await until(()=>fs.existsSync(receipt));const result=JSON.parse(fs.readFileSync(receipt));if(result.error)throw Error(result.error);return result.pid;
  }});
 // Real synthetic UAC approval relay from the already-High test supervisor.
 // Product RunAs is not replaced, configured, or bypassed by a runtime setting.
 const pid=await controller.ensure();assert.ok(pid>0&&pid!==process.pid);
 win=new BrowserWindow({width:600,height:400,show:false});await win.loadURL('data:text/html,<h1>Own split-process fixture</h1>');
 tray=new Tray(nativeImage.createEmpty());
 let online=false,actual,annotations=0;
 const runtime=attachAdminRuntime(controller,{
  config:{server:process.env.METIS_SPLIT_TEST_SERVER,clientId:'split-device',credential:'synthetic-split-only',permissionMode:'admin'},
  capabilities:{desktopAvailable:true,overlayAnnotations:true,nativeNotifications:true},
  onEvent:async value=>{
   if(value.type==='device_access')actual=value.elevation;
   if(value.type==='connection'&&value.status==='online')online=true;
   if(value.type==='desktop_overlay'){annotations++;return {fromMedium:true,display:'test'};}
  },showNotification:async()=>true});
 await until(()=>online&&actual==='administrator');
 assert.equal(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().elevated,false);
 assert.equal(await controller.ensure(),pid);assert.equal(sequence,1);
 fs.writeFileSync(path.join(root,'client-online.json'),JSON.stringify({pid,mediumPid:process.pid}));
 // Hide/reopen presentation without touching the elevated host/connection.
 win.show();win.hide();await sleep(150);win.show();assert.equal(runtime.pid,pid);
 await until(()=>annotations===1&&fs.existsSync(path.join(root,'server-command-ok')));
 runtime.cancelComputerUse();
 runtime.stop();controller.shutdown();
 await until(()=>!controller.connected);
 fs.writeFileSync(path.join(root,'client-result.json'),JSON.stringify({medium:true,deviceHigh:true,oneLaunch:true,overlayRpc:true,hiddenSurvives:true,sharedTray:true}));
 tray.destroy();win.destroy();clearTimeout(timeout);app.exit(0);
}
main().catch(error=>{console.error(error);fs.writeFileSync(path.join(root,'client-error.txt'),error.stack);controller?.shutdown();clearTimeout(timeout);app.exit(1);});
