const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {forwardSecondInstance}=require('../src/main/reopen.cjs');
const {REQUEST_FILE,requestWindowActivation,listenForWindowActivation}=require('../src/main/window-activation.cjs');
function scenario(values={}){
 const calls=[];
 const options={platform:'win32',ready:async()=>calls.push('ready'),isElevated:async()=>false,
  requestActivation:async()=>calls.push('show-request'),reportError:error=>calls.push('error:'+error.message),quit:()=>calls.push('quit'),...values};
 return {calls,options};
}
test('normal Windows reopening signals the existing instance without configuration or elevation',async()=>{
 const {calls,options}=scenario({permissionMode:()=>{throw Error('must not read credentials');},elevate:()=>{throw Error('must not request UAC');}});
 await forwardSecondInstance(options);assert.deepEqual(calls,['ready','show-request','quit']);
});
test('same-integrity elevated retries use native activation, without writing a high-integrity marker',async()=>{
 const {calls,options}=scenario({isElevated:async()=>true});await forwardSecondInstance(options);assert.deepEqual(calls,['ready','quit']);
});
test('other platforms keep native second-instance behavior',async()=>{
 for(const platform of ['linux','darwin']){const {calls,options}=scenario({platform});await forwardSecondInstance(options);assert.deepEqual(calls,['quit']);}
});
test('a failed activation reports the problem without elevating or stopping the primary',async()=>{
 const {calls,options}=scenario({requestActivation:async()=>{throw Error('read-only profile');}});
 await forwardSecondInstance(options);assert.deepEqual(calls,['ready','error:read-only profile','quit']);
});
test('readiness and token failures always exit the short-lived launcher',async()=>{
 const {calls,options}=scenario({isElevated:async()=>{throw Error('token error');}});
 await forwardSecondInstance(options);assert.deepEqual(calls,['ready','error:token error','quit']);
});
test('profile-scoped signal accepts only its fixed filename and never interprets contents',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metis-activation-')),other=fs.mkdtempSync(path.join(os.tmpdir(),'metis-activation-other-'));
 t.after(()=>{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});});
 const calls=[],errors=[];
 const listener=listenForWindowActivation({directory:dir,activate:()=>calls.push('show'),onError:error=>errors.push(error)});
 t.after(()=>listener.close());
 fs.writeFileSync(path.join(dir,'preferences.json'),'{}');requestWindowActivation(other);
 await new Promise(r=>setTimeout(r,60));assert.equal(calls.length,0);
 fs.writeFileSync(path.join(dir,REQUEST_FILE),'{"command":"never execute","url":"https://foreign.invalid"}');
 const deadline=Date.now()+2000;while(!calls.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.ok(calls.length>0);assert.deepEqual(errors,[]);
 listener.close();const before=calls.length;requestWindowActivation(dir);await new Promise(r=>setTimeout(r,60));assert.equal(calls.length,before);
});
test('an unavailable watcher cannot terminate the primary app',()=>{
 const errors=[];const listener=listenForWindowActivation({directory:path.join(os.tmpdir(),'metis-missing-'+process.pid+'-'+Date.now()),activate:()=>assert.fail(),onError:error=>errors.push(error)});
 assert.equal(listener.available,false);assert.equal(errors.length,1);listener.close();
});
test('activation handler rejection stays contained',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metis-activation-failure-'));const errors=[];
 const listener=listenForWindowActivation({directory:dir,activate:async()=>{throw Error('window gone');},onError:error=>errors.push(error.message)});
 t.after(()=>{listener.close();fs.rmSync(dir,{recursive:true,force:true});});requestWindowActivation(dir);
 const deadline=Date.now()+2000;while(!errors.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.ok(errors.includes('window gone'));
});
