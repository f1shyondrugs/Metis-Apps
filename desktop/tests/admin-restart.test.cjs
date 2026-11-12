const test=require('node:test'),assert=require('node:assert/strict');
const {createAdminRestart,waitForRestartParent,parentArgument}=require('../src/main/admin-restart.cjs');
test('only explicit UAC launch success quits; cancellation preserves the current process',async()=>{
 let quit=0,calls=0;const request=createAdminRestart({platform:'win32',readElevation:()=> 'user',parentPid:500,launch:async args=>{calls++;assert.deepEqual(args,['--metis-admin-restart-from=500']);throw Error('cancelled');},quit:()=>quit++});
 await assert.rejects(request());assert.equal(calls,1);assert.equal(quit,0);
 const success=createAdminRestart({platform:'win32',readElevation:()=> 'user',parentPid:500,launch:async()=>600,quit:()=>quit++});
 await success();assert.equal(quit,1);
});
test('concurrent clicks prompt once; no arbitrary path, URL, credential or command is accepted',async()=>{
 let calls=0,quit=0,done;const request=createAdminRestart({platform:'win32',readElevation:()=> 'user',parentPid:400,launch:args=>{calls++;assert.deepEqual(args,['--metis-admin-restart-from=400']);return new Promise(resolve=>done=resolve);},quit:()=>quit++});
 const first=request(),second=request();done(600);await Promise.all([first,second]);assert.equal(calls,1);assert.equal(quit,1);
});
test('unknown and non-Windows elevation fail closed; an already high process never requests UAC',async()=>{
 for(const [platform,value]of [['linux','user'],['win32','unknown']]){
  const request=createAdminRestart({platform,readElevation:()=>value,launch:()=>{throw Error('must not launch')},quit:()=>assert.fail('must not quit')});await assert.rejects(request());
 }
 assert.deepEqual(await createAdminRestart({platform:'win32',readElevation:()=> 'administrator',launch:()=>assert.fail(),quit:()=>assert.fail()})(),{alreadyElevated:true});
});
test('restart child requires actual elevation and waits only; it never kills or edits the parent',async()=>{
 assert.equal(parentArgument(['app','--metis-admin-restart-from=500']),500);
 for(const value of ['0','-1','abc','123;whoami','4294967296'])assert.throws(()=>parentArgument(['--metis-admin-restart-from='+value]));
 await assert.rejects(waitForRestartParent({argv:['--metis-admin-restart-from=500'],platform:'win32',elevated:false}));
 let alive=2;await waitForRestartParent({argv:['--metis-admin-restart-from=500'],platform:'win32',elevated:true,alive:()=>alive-->0,sleep:async()=>{}});
 let now=0;await assert.rejects(waitForRestartParent({argv:['--metis-admin-restart-from=500'],platform:'win32',elevated:true,alive:()=>true,sleep:async()=>{now+=10000},now:()=>now}));
});
