const {test}=require('node:test'),assert=require('node:assert/strict');
const {forwardSecondInstance}=require('../src/main/reopen.cjs');
function scenario(values={}){
 const calls=[];
 const options={platform:'win32',ready:async()=>calls.push('ready'),isElevated:async()=>false,
  permissionMode:()=>{calls.push('config');return 'admin';},elevate:async()=>calls.push('elevate'),
  reportError:error=>calls.push('error:'+error.message),quit:()=>calls.push('quit'),...values};
 return {calls,options};
}
test('normal Windows shortcut forwards an admin-paired background instance at its existing integrity level',async()=>{
 const {calls,options}=scenario();await forwardSecondInstance(options);
 assert.deepEqual(calls,['ready','config','elevate','quit']);
});
test('the elevated retry quits after the native activation, without another elevation or configuration read',async()=>{
 const {calls,options}=scenario({isElevated:async()=>true});await forwardSecondInstance(options);
 assert.deepEqual(calls,['ready','quit']);
});
test('user-mode or unpaired devices never gain administrator access',async()=>{
 for(const mode of ['user',undefined,null,'unknown']){
  const {calls,options}=scenario({permissionMode:()=>mode});await forwardSecondInstance(options);
  assert.deepEqual(calls,['ready','quit']);
 }
});
test('other platforms keep the native single-instance behavior',async()=>{
 for(const platform of ['linux','darwin']){
  const {calls,options}=scenario({platform});await forwardSecondInstance(options);assert.deepEqual(calls,['quit']);
 }
});
test('cancelled elevation leaves the original instance alone and always exits the short-lived launcher',async()=>{
 const {calls,options}=scenario({elevate:async()=>{throw Error('UAC cancelled');}});
 await forwardSecondInstance(options);assert.deepEqual(calls,['ready','config','error:UAC cancelled','quit']);
});
test('configuration failure does not attempt an elevation or leave a hidden duplicate running',async()=>{
 const {calls,options}=scenario({permissionMode:()=>{throw Error('Unavailable config');}});
 await forwardSecondInstance(options);assert.deepEqual(calls,['ready','error:Unavailable config','quit']);
});
