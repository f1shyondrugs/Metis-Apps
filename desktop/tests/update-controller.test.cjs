const assert=require('node:assert/strict'),test=require('node:test'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createUpdateController,waitForProcessExit}=require('../src/main/update-controller.cjs');
const {createUpdateState}=require('../src/main/app-updates.cjs');
function fixture(options={}){
 const updater=new EventEmitter();let checks=0,downloads=0,installs=0;
 updater.checkForUpdates=async()=>{checks++;};
 updater.downloadUpdate=async()=>{downloads++;updater.emit('update-downloaded',{version:'2.0.0'});};
 updater.quitAndInstall=(silent,runAfter)=>{assert.equal(silent,false);assert.equal(runAfter,true);installs++;};
 const state=createUpdateState();
 const controller=createUpdateController({updater,state,version:'1.7.19',sleep:async()=>{},...options});
 return {updater,state,controller,counts:()=>({checks,downloads,installs})};
}
test('parallel update checks coalesce and a ready update is not checked again',async()=>{
 const f=fixture();await Promise.all([f.controller.check(),f.controller.check()]);
 assert.equal(f.counts().checks,1);
 f.updater.emit('update-available',{version:'2.0.0'});await new Promise(setImmediate);
 assert.equal(f.state.value.phase,'ready');await f.controller.check();
 assert.equal(f.counts().checks,1);assert.equal(f.counts().downloads,1);
});
test('transient downloads retry a bounded number of times without duplicate event retries',async()=>{
 const f=fixture();let calls=0;
 f.updater.downloadUpdate=async()=>{if(++calls<3){const e=Object.assign(Error('contains-private-url?token=secret'),{code:'ECONNRESET'});f.updater.emit('error',e);throw e;}f.updater.emit('update-downloaded',{version:'2.0.0'});};
 f.updater.emit('update-available',{version:'2.0.0'});await new Promise(setImmediate);
 assert.equal(calls,3);assert.equal(f.state.value.phase,'ready');
 assert.ok(!JSON.stringify(f.controller.report()).includes('secret'));
});
test('checksum/signature and permission errors never trigger retry loops',async()=>{
 for(const code of ['ERR_UPDATER_CHECKSUM_MISMATCH','ERR_UPDATER_INVALID_SIGNATURE','EACCES','ENOSPC']){
  const f=fixture();let calls=0;f.updater.downloadUpdate=async()=>{calls++;throw Object.assign(Error('sensitive text'),{code});};
  f.updater.emit('update-available',{version:'2.0.0'});await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(f.state.value.phase,'error');assert.ok(!f.state.value.message.includes('sensitive'));
 }
});
test('download is not installation; install waits for owned process shutdown exactly once',async()=>{
 let finish;const f=fixture({beforeInstall:()=>new Promise(resolve=>finish=resolve)});
 assert.equal(await f.controller.install(),false);
 f.updater.emit('update-available',{version:'2.0.0'});await new Promise(setImmediate);
 assert.equal(f.counts().installs,0);const pending=f.controller.install();
 assert.equal(f.counts().installs,0);assert.equal(await f.controller.install(),false);
 finish();assert.equal(await pending,true);assert.equal(f.counts().installs,1);
});
test('a failed process drain never invokes the installer',async()=>{
 const f=fixture({beforeInstall:async()=>{throw Object.assign(Error('busy'),{code:'ETIMEDOUT'});}});
 f.updater.emit('update-available',{version:'2.0.0'});await new Promise(setImmediate);
 assert.equal(await f.controller.install(),false);assert.equal(f.counts().installs,0);
});
test('diagnostics are bounded and contain no URLs, paths, raw errors or account data',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-update-report-'));
 try{
  const file=path.join(root,'report.json'),f=fixture({diagnosticsFile:file});
  f.updater.checkForUpdates=async()=>{throw Error('https://secret.test/?token=PRIVATE C:\\Users\\name\\config.json');};
  for(let i=0;i<120;i++)await f.controller.check();
  const text=fs.readFileSync(file,'utf8'),report=JSON.parse(text);
  assert.ok(report.events.length<=100);assert.ok(text.length<64000);
  assert.ok(!/PRIVATE|secret.test|Users|config.json/.test(text));
  assert.equal(f.updater.autoInstallOnAppQuit,false);
 }finally{fs.rmSync(root,{recursive:true});}
});
test('bounded diagnostics preserve previous failure codes across app restarts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-update-restart-'));
 try{
  const file=path.join(root,'report.json'),first=fixture({diagnosticsFile:file});
  first.updater.checkForUpdates=async()=>{throw Object.assign(Error('private'),{code:'ENOSPC'});};
  await first.controller.check();first.controller.dispose();
  const second=fixture({diagnosticsFile:file});
  assert.ok(second.controller.report().events.some(event=>event.code==='ENOSPC'));
 }finally{fs.rmSync(root,{recursive:true});}
});
test('process exit wait refuses live children and never signals unrelated processes',async()=>{
 let calls=0;
 await waitForProcessExit([123456],{isAlive:()=>++calls<3,sleep:async()=>{}});
 assert.equal(calls,3);
 await assert.rejects(waitForProcessExit([123456],{timeout:0,isAlive:()=>true}),/did not stop/);
});
test('before-quit coordinator drains once and permits the updater reentrant quit',async()=>{
 const {createUpdateShutdown}=require('../src/main/update-shutdown.cjs');
 const events=[];let coordinator;
 function quit(){const event={preventDefault(){events.push('prevent');}};coordinator.beforeQuit(event);events.push('quit');}
 coordinator=createUpdateShutdown({ready:()=>true,drain:async()=>events.push('drain'),cleanup:()=>events.push('cleanup'),install:async()=>{events.push('install');quit();return true;},quit,onError:error=>{throw error;}});
 quit();await coordinator.completion;
 assert.deepEqual(events,['prevent','quit','drain','cleanup','install','quit']);
});
test('failed update drain does not clean up windows or hand off an installer',async()=>{
 const {createUpdateShutdown}=require('../src/main/update-shutdown.cjs');let failures=0;
 const coordinator=createUpdateShutdown({ready:()=>true,drain:async()=>{throw Error('busy');},cleanup:()=>assert.fail('cleanup too early'),install:()=>assert.fail('installed too early'),quit:()=>assert.fail('quit too early'),onError:()=>failures++});
 coordinator.beforeQuit({preventDefault(){}});await coordinator.completion;assert.equal(failures,1);
});
test('disposed controller does not retry or install',async()=>{
 const f=fixture();f.controller.dispose();await f.controller.check();assert.equal(f.counts().checks,0);
});
