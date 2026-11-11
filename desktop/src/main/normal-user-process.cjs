// Fixed-role launch only. No commands, credentials or arbitrary executable paths.
const {isMainThread,parentPort,workerData}=require('node:worker_threads');
const path=require('node:path');
function launch({development,nonce}) {
 if(process.platform!=='win32'||!/^[a-f0-9]{32}$/.test(nonce||''))throw Error('Invalid drop-helper launch.');
 const koffi=require('koffi'),user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll'),env=koffi.load('userenv.dll');
 const openProcess=kernel.func('uintptr_t OpenProcess(uint32_t,bool,uint32_t)'),close=kernel.func('bool CloseHandle(uintptr_t)'),current=kernel.func('uintptr_t GetCurrentProcess()');
 const open=adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)'),info=adv.func('bool GetTokenInformation(uintptr_t,uint32_t,void *,uint32_t,void *)'),duplicate=adv.func('bool DuplicateTokenEx(uintptr_t,uint32_t,void *,uint32_t,uint32_t,void *)');
 const getPid=user.func('uint32_t GetWindowThreadProcessId(uintptr_t,void *)'),shell=user.func('uintptr_t GetShellWindow()');
 const create=adv.func('bool CreateProcessWithTokenW(uintptr_t,uint32_t,void *,void *,uint32_t,uintptr_t,void *,void *,void *)'),createEnv=env.func('bool CreateEnvironmentBlock(void *,uintptr_t,bool)'),destroyEnv=env.func('bool DestroyEnvironmentBlock(uintptr_t)');
 const last=kernel.func('uint32_t GetLastError()'),ptr=b=>Number(b.readBigUInt64LE()),wide=s=>Buffer.from(s+'\0','utf16le');
 const own=Buffer.alloc(8),shellToken=Buffer.alloc(8),primary=Buffer.alloc(8),environment=Buffer.alloc(8),pid=Buffer.alloc(4),length=Buffer.alloc(4);
 let shellProcess=0;
 try{
  if(!open(current(),8,own))throw Error('Could not inspect launch identity.');
  getPid(shell(),pid);shellProcess=Number(openProcess(0x1000,false,pid.readUInt32LE()));
  if(!shellProcess||!open(shellProcess,0xA,shellToken))throw Error('The interactive shell is unavailable.');
  const {tokenIdentity}=require('./windows-token-identity.cjs'),ownIdentity=tokenIdentity(koffi,info,ptr(own)),normalIdentity=tokenIdentity(koffi,info,ptr(shellToken));
  if(normalIdentity.elevated||normalIdentity.sid!==ownIdentity.sid||normalIdentity.session!==ownIdentity.session)throw Error('Normal-user launch identity does not match this session.');
  if(!duplicate(ptr(shellToken),0x2000000,null,2,1,primary)||!createEnv(environment,ptr(primary),false))throw Error('Could not prepare normal-user launch ('+last()+').');
  const exe=process.execPath,args=[...(development?[path.join(__dirname,'../../bootstrap.cjs')]:[]),'--metis-drop-helper','--metis-drop-pipe='+nonce];
  const command=wide([exe,...args].map(arg=>'"'+arg.replace(/"/g,'')+'"').join(' '));
  const startup=Buffer.alloc(104),result=Buffer.alloc(24);startup.writeUInt32LE(104,0);startup.writeUInt32LE(1,60);
  if(!create(ptr(primary),0,wide(exe),command,0x400,ptr(environment),wide(path.dirname(exe)),startup,result))throw Error('Could not start normal-user file drops ('+last()+').');
  try{return result.readUInt32LE(16);}finally{close(Number(result.readBigUInt64LE(0)));close(Number(result.readBigUInt64LE(8)));}
 }finally{
  if(ptr(environment))destroyEnv(ptr(environment));if(ptr(primary))close(ptr(primary));if(ptr(shellToken))close(ptr(shellToken));if(shellProcess)close(shellProcess);if(ptr(own))close(ptr(own));
 }
}
module.exports={launch};
if(!isMainThread)try{parentPort.postMessage({ok:true,pid:launch(workerData)});}catch(error){parentPort.postMessage({ok:false,error:error.message});}finally{parentPort.close();}
