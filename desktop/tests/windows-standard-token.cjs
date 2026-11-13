// Isolated Windows test helper, never packaged or reachable from product IPC.
// LUA_TOKEN + Medium integrity create real standard-user children even on hosted
// CI images whose Explorer/Task Scheduler run with Admin Approval Mode disabled.
function launchStandard(executable,args,{env=process.env,cwd=process.cwd()}={}){
 const koffi=require('koffi'),kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll');
 const close=kernel.func('bool CloseHandle(uintptr_t)'),open=adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)');
 const restrict=adv.func('bool CreateRestrictedToken(uintptr_t,uint32_t,uint32_t,void *,uint32_t,void *,uint32_t,void *,void *)');
 const convert=adv.func('bool ConvertStringSidToSidW(void *,void *)'),set=adv.func('bool SetTokenInformation(uintptr_t,uint32_t,void *,uint32_t)');
 const create=adv.func('bool CreateProcessAsUserW(uintptr_t,void *,void *,void *,void *,bool,uint32_t,void *,void *,void *,void *)');
 const wide=value=>Buffer.from(value+'\0','utf16le'),ptr=value=>Number(value.readBigUInt64LE());
 const original=Buffer.alloc(8),restricted=Buffer.alloc(8),sid=Buffer.alloc(8),adminSid=Buffer.alloc(8),descriptor=Buffer.alloc(8),sidTextPointer=Buffer.alloc(8),last=()=>kernel.func('uint32_t GetLastError()')();
 const free=kernel.func('uintptr_t LocalFree(uintptr_t)');
 const sidString=adv.func('bool ConvertSidToStringSidW(void *,void *)');
 const security=adv.func('bool ConvertStringSecurityDescriptorToSecurityDescriptorW(void *,uint32_t,void *,void *)');
 const setObject=adv.func('bool SetKernelObjectSecurity(uintptr_t,uint32_t,void *)');
 const getDacl=adv.func('bool GetSecurityDescriptorDacl(void *,void *,void *,void *)');
 try{
  if(!open(kernel.func('uintptr_t GetCurrentProcess()')(),0xF01FF,original))throw Error('Test token open '+last());
  if(!convert(wide('S-1-5-32-544'),adminSid))throw Error('Test administrator SID '+last());
  const disabled=Buffer.alloc(16);disabled.writeBigUInt64LE(BigInt(ptr(adminSid)));
  // Explicitly remove privileges and deny the admin group. Granting access to
  // this already-limited token below cannot restore those removed privileges.
  if(!restrict(ptr(original),5,1,disabled,0,null,0,null,restricted))throw Error('Test restricted token '+last());
  const ownSid=Buffer.from(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().sid,'hex');
  if(!sidString(ownSid,sidTextPointer))throw Error('Test owner SID '+last());
  const ownerName=koffi.decode(ptr(sidTextPointer),'str16');
  const owner=Buffer.alloc(8);owner.writeBigUInt64LE(koffi.address(ownSid));
  if(!set(ptr(restricted),4,owner,8))throw Error('Test token owner '+last());
  ownSid.fill(0);
  if(!security(wide('D:P(A;;GA;;;'+ownerName+')(A;;GA;;;SY)'),1,descriptor,null))throw Error('Test token DACL '+last());
  // A High-created restricted token otherwise retains a High-owned token DACL.
  // Chromium's still-enabled child sandbox must be able to duplicate the
  // process's OWN limited token, exactly as on a real filtered user account.
  if(!setObject(ptr(restricted),4,ptr(descriptor)))throw Error('Test token object access '+last());
  const acl=Buffer.alloc(8),present=Buffer.alloc(4),defaulted=Buffer.alloc(4);
  if(!getDacl(ptr(descriptor),present,acl,defaulted)||!present.readUInt32LE()||!set(ptr(restricted),6,acl,8))throw Error('Test default token access '+last());
  if(!convert(wide('S-1-16-8192'),sid))throw Error('Test integrity SID '+last());
  const label=Buffer.alloc(28);label.writeBigUInt64LE(BigInt(ptr(sid)));label.writeUInt32LE(0x20,8);
  if(!set(ptr(restricted),25,label,28))throw Error('Test medium integrity '+last());
  const startup=Buffer.alloc(104),result=Buffer.alloc(24),desktop=wide('winsta0\\default');
  startup.writeUInt32LE(104);startup.writeBigUInt64LE(koffi.address(desktop),16);startup.writeUInt32LE(0x100,60);
  const std=kernel.func('uintptr_t GetStdHandle(uint32_t)'),inherit=kernel.func('bool SetHandleInformation(uintptr_t,uint32_t,uint32_t)');
  for(const [offset,n]of [[80,0xFFFFFFF6],[88,0xFFFFFFF5],[96,0xFFFFFFF4]]){const handle=Number(std(n));inherit(handle,1,1);startup.writeBigUInt64LE(BigInt(handle),offset);}
  const environment=wide(Object.entries(env).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+'='+value).join('\0')+'\0');
  const command=wide([executable,...args].map(value=>'"'+value.replace(/"/g,'')+'"').join(' '));
  if(!create(ptr(restricted),wide(executable),command,null,null,true,0x400,environment,wide(cwd),startup,result))throw Error('Test standard launch '+last());
  desktop.fill(0); // Keep lpDesktop's backing Buffer live across the native call.
  close(Number(result.readBigUInt64LE(8)));
  // Give only this isolated test process normal foreground eligibility. A High
  // CI console is not a user click and otherwise blocks Medium focus tests.
  const allowed=koffi.load('user32.dll').func('bool AllowSetForegroundWindow(uint32_t)')(0xFFFFFFFF);
  console.log('TEST_FOREGROUND_ELIGIBILITY',Boolean(allowed));
  return {pid:result.readUInt32LE(16),handle:Number(result.readBigUInt64LE()),close};
 }finally{for(const value of [descriptor,sidTextPointer,adminSid,sid])if(ptr(value))free(ptr(value));if(ptr(restricted))close(ptr(restricted));if(ptr(original))close(ptr(original));}
}
module.exports={launchStandard};
