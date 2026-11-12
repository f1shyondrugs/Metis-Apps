const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('the actual device-host token must match the grant before any client code is loaded',async()=>{
 for(const [permissionMode,elevated]of [['admin',false],['user',true],['admin',null],['invalid',false]]){
  let handler;const messages=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/device/runtime-host.cjs'),'utf8'),{
   require:name=>name.includes('windows-token-identity')?{currentTokenIdentity:()=>{if(elevated===null)throw Error('unknown token');return {elevated};}}:require(name),
   __dirname:path.join(__dirname,'../src/device'),process:{platform:'win32',parentPort:{on:(_name,fn)=>handler=fn,postMessage:message=>messages.push(message)}},Map,setTimeout,clearTimeout
  });
  await handler({data:{type:'start',config:{permissionMode},capabilities:{}}});
  assert.ok(messages.some(message=>message.value?.type==='connection'&&message.value.status==='error'));
  assert.equal(messages.some(message=>message.value?.status==='online'),false);
 }
});
