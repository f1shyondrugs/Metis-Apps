const test=require('node:test'),assert=require('node:assert/strict');
const {createAdminController,attachAdminRuntime}=require('../src/device/admin-controller.cjs');
const {encode,decoder,MAX_FRAME,roleArgument}=require('../src/device/pipe-protocol.cjs');
function fixture({launch=async()=>600,peer=600}={}){
 let options,closed=0,sends=[],calls=0;
 const channel={connected:false,listening:Promise.resolve(),ready:Promise.resolve(peer),
   expectPeer(pid){this.connected=true;assert.equal(pid,600);},close(){closed++;this.connected=false;},send(value){sends.push(value);}};
 const control=createAdminController({parentPid:500,createChannel:value=>{options=value;return channel;},launch:args=>{calls++;assert.match(args[0],/^--metis-device-host=[a-f0-9]{32}:500$/);return launch(args);}});
 return {control,channel,sends,get options(){return options;},get closed(){return closed;},get calls(){return calls;}};
}
test('UAC cancel closes only the new private channel; normal app and existing User runtime are not touched',async()=>{
 const f=fixture({launch:async()=>{throw Error('cancelled');}});
 await assert.rejects(f.control.ensure(),/cancelled/);assert.equal(f.calls,1);assert.equal(f.control.pid,null);assert.equal(f.closed,1);
});
test('concurrent admin requests launch one fixed background role and reuse its verified PID',async()=>{
 let resolve;const f=fixture({launch:()=>new Promise(r=>resolve=r)});
 const first=f.control.ensure(),second=f.control.ensure();await new Promise(setImmediate);resolve(600);
 assert.deepEqual(await Promise.all([first,second]),[600,600]);assert.equal(f.calls,1);
 await f.control.ensure();assert.equal(f.calls,1);
});
test('a different kernel peer PID cannot receive configuration',async()=>{
 const f=fixture({peer:999});await assert.rejects(f.control.ensure(),/identity mismatch/);assert.equal(f.sends.length,0);assert.equal(f.control.pid,null);
});
test('runtime replies and cancellation use only the verified host; stopping never quits the UI',async()=>{
 const f=fixture();await f.control.ensure();
 const events=[];const runtime=attachAdminRuntime(f.control,{config:{permissionMode:'admin'},capabilities:{},
 onEvent:async value=>{events.push(value);return {ok:true};},showNotification:async()=>true});
 assert.equal(runtime.pid,600);assert.equal(f.sends[0].type,'start');
 await f.options.onMessage({type:'event',id:1,value:{type:'desktop_overlay'}});
 assert.equal(events.length,1);assert.deepEqual(f.sends[1],{type:'reply',id:1,value:{ok:true}});
 runtime.cancelComputerUse();runtime.stop();runtime.stop();
 assert.deepEqual(f.sends.slice(2),[{type:'cancel'},{type:'stop'}]);
 runtime.setCapabilities({});assert.equal(f.sends.length,4);
 f.control.shutdown();assert.equal(f.sends[4].type,'quit');
 await assert.rejects(f.control.ensure(),/quitting/);
});
test('private frames are bounded and survive fragmented Unicode or coalesced reads',()=>{
 const output=[],receive=decoder(value=>output.push(value));
 const bytes=Buffer.concat([encode({type:'event',text:'Ä👋'}),encode({type:'stop'})]);
 for(let i=0;i<bytes.length;i+=3)receive(bytes.subarray(i,i+3));
 assert.deepEqual(output,[{type:'event',text:'Ä👋'},{type:'stop'}]);
 assert.throws(()=>encode({text:'x'.repeat(MAX_FRAME)}));
 const bad=Buffer.alloc(4);bad.writeUInt32LE(MAX_FRAME+1);assert.throws(()=>decoder(()=>{})(bad));
 assert.throws(()=>decoder(()=>{})(Buffer.from([1,0,0,0,91])));
});
test('role arguments cannot carry commands, URLs, paths or a second role',()=>{
 assert.deepEqual(roleArgument(['--metis-device-host='+'a'.repeat(32)+':500']),{nonce:'a'.repeat(32),parentPid:500});
 for(const arg of ['x','a'.repeat(32)+':0','a'.repeat(32)+':123;whoami','a'.repeat(32)+':4294967296'])
 assert.throws(()=>roleArgument(['--metis-device-host='+arg]));
 assert.throws(()=>roleArgument(['--metis-device-host='+'a'.repeat(32)+':500','--metis-device-host='+'a'.repeat(32)+':500']));
});
