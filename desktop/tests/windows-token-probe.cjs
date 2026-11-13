// Prove the CI Medium token can perform the same self-token duplication that
// Chromium requires. This does not launch Electron or change any OS policy.
const assert=require('node:assert/strict'),koffi=require('koffi');
const kernel=koffi.load('kernel32.dll'),adv=koffi.load('advapi32.dll');
const current=kernel.func('uintptr_t GetCurrentProcess()'),close=kernel.func('bool CloseHandle(uintptr_t)'),last=kernel.func('uint32_t GetLastError()');
const open=adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)'),restrict=adv.func('bool CreateRestrictedToken(uintptr_t,uint32_t,uint32_t,void *,uint32_t,void *,uint32_t,void *,void *)');
const token=Buffer.alloc(8),child=Buffer.alloc(8),ptr=value=>Number(value.readBigUInt64LE());
assert.equal(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().elevated,false);
try{
 assert.ok(open(current(),0xF01FF,token),'Own TOKEN_ALL_ACCESS failed: '+last());
 assert.ok(restrict(ptr(token),1,0,null,0,null,0,null,child),'Nested token derivation failed: '+last());
 console.log('MEDIUM_SELF_TOKEN_DUPLICATION_AND_NESTED_SANDBOX_OK');
}finally{if(ptr(child))close(ptr(child));if(ptr(token))close(ptr(token));}
