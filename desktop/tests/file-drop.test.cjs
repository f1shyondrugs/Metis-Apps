const test=require('node:test'),assert=require('node:assert/strict'),{decodeDrop}=require('../src/main/file-drop-protocol.cjs');
test('file-drop bridge transports bytes, never resolves a supplied path',()=>{
 const packet={files:[{name:'test.txt',data:Buffer.from('abc').toString('base64'),lastModified:123}],point:{x:5,y:10}};
 const files=decodeDrop(packet).files;assert.equal(files[0].bytes.toString(),'abc');assert.equal(files[0].lastModified,123);
 for(const name of ['C:\\secret','../secret','file\0.txt'])assert.throws(()=>decodeDrop({...packet,files:[{...packet.files[0],name}]}),/Invalid/);
 assert.throws(()=>decodeDrop({...packet,files:[{name:'secret.txt',path:'C:\\secret'}]}),/Invalid/);
 assert.throws(()=>decodeDrop({...packet,files:[{name:'x',data:'not base64!'}]}),/Invalid/);
 assert.throws(()=>decodeDrop({...packet,files:Array(11).fill(packet.files[0])}),/Invalid/);
 assert.throws(()=>decodeDrop({...packet,point:{x:NaN,y:10}}),/Invalid/);
});
test('token identity copies SID bytes before freeing native storage',()=>{
 const {tokenIdentity}=require('../src/main/windows-token-identity.cjs');let freed=0,bad=false;
 const native={alloc:()=>({data:Buffer.alloc(2048)}),address:()=>1000n,decode:(memory,type,count)=>Array.from(memory.data.subarray(0,count)),free:()=>freed++};
 const info=(token,kind,memory,capacity,length)=>{
  if(kind===1){memory.data.writeBigUInt64LE(bad?9999n:1016n);memory.data.set([1,1,0,0,0,0,0,5,32,0,0,0],16);length.writeUInt32LE(28);return true;}
  memory.writeUInt32LE(kind===12?7:0);return true;
 };
 assert.deepEqual(tokenIdentity(native,info,1),{sid:'010100000000000520000000',session:7,elevated:false});
 assert.equal(freed,1);bad=true;assert.throws(()=>tokenIdentity(native,info,1),/SID/);assert.equal(freed,2);
});
test('framed file-drop protocol handles fragmentation and rejects oversized messages',()=>{
 const {EventEmitter}=require('node:events'),{receiveLines}=require('../src/main/file-drop-protocol.cjs');
 const socket=new EventEmitter();let closed=false;socket.destroy=()=>{closed=true;};const received=[];
 receiveLines(socket,value=>received.push(value),100);
 socket.emit('data',Buffer.from('{"type":'));socket.emit('data',Buffer.from('"ready"}\n{"type":"hide"}\n'));
 assert.deepEqual(received,[{type:'ready'},{type:'hide'}]);socket.emit('data',Buffer.alloc(101));assert.equal(closed,true);
});
test('fixed-role launch rejects arbitrary arguments before loading Windows APIs',()=>{
 const {launch}=require('../src/main/normal-user-process.cjs');
 assert.throws(()=>launch({nonce:'not a pipe token',executable:'anything'}),/Invalid/);
});
test('native helper does not alter normal-window OLE or other platforms',()=>{
 const {registerWindowsFileDrop}=require('../src/main/windows-file-drop.cjs');
 assert.equal(typeof registerWindowsFileDrop({}, {platform:'linux'}),'function');
});
test('update availability survives a download failure but a completed current check clears it',()=>{
 const {createUpdateState}=require('../src/main/app-updates.cjs');const state=createUpdateState();
 state.available({version:'2.0.0'});state.error(Error('offline'));assert.equal(state.value.available,true);
 state.ready({version:'2.0.0'});assert.equal(state.value.phase,'ready');state.current();assert.equal(state.value.available,false);
});
