// TOKEN_USER contains an interior SID pointer. Keep its native allocation alive
// until the SID bytes are copied; never retain a pointer into FFI scratch data.
function tokenIdentity(koffi,info,token) {
 const memory=koffi.alloc('uint8_t',2048),length=Buffer.alloc(4);
 try{
  if(!info(token,1,memory,2048,length))throw Error('Could not inspect Windows identity.');
  const count=length.readUInt32LE();if(count<16||count>2048)throw Error('Invalid Windows identity.');
  const data=Buffer.from(koffi.decode(memory,'uint8_t',count));
  const offset=Number(data.readBigUInt64LE(0)-BigInt(koffi.address(memory)));
  if(!Number.isSafeInteger(offset)||offset<0||offset+8>count)throw Error('Invalid Windows SID.');
  const size=8+4*data[offset+1];
  if(data[offset]!==1||size>68||offset+size>count)throw Error('Invalid Windows SID.');
  const session=Buffer.alloc(4),elevation=Buffer.alloc(4);
  if(!info(token,12,session,4,length)||!info(token,20,elevation,4,length))throw Error('Could not inspect Windows token.');
  return {sid:data.subarray(offset,offset+size).toString('hex'),session:session.readUInt32LE(),elevated:Boolean(elevation.readUInt32LE())};
 }finally{koffi.free(memory);}
}
function currentTokenIdentity() {
 const koffi=require('koffi'),kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll');
 const token=Buffer.alloc(8),open=adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)'),info=adv.func('bool GetTokenInformation(uintptr_t,uint32_t,void *,uint32_t,void *)'),close=kernel.func('bool CloseHandle(uintptr_t)');
 if(!open(kernel.func('uintptr_t GetCurrentProcess()')(),8,token))throw Error('Could not inspect Windows token.');
 try{return tokenIdentity(koffi,info,Number(token.readBigUInt64LE()));}finally{close(Number(token.readBigUInt64LE()));}
}
module.exports={tokenIdentity,currentTokenIdentity};
