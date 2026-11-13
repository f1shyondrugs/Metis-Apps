// Run only the fixed CI suites under a genuine Medium token.
const {spawnSync}=require('node:child_process'),path=require('node:path');
const mode=process.argv[2];
if(!['e2e','installer','probe'].includes(mode))throw Error('Invalid test suite.');
const command=mode==='e2e'?'npm.cmd':'powershell.exe';
const args=mode==='e2e'?['run','test:e2e']:['-NoProfile','-NonInteractive','-File',path.join(__dirname,'installer-smoke.ps1')];
if(process.platform!=='win32')process.exit(spawnSync(command,args,{stdio:'inherit'}).status||0);
const koffi=require('koffi'),kernel=koffi.load('kernel32.dll');
const {launchStandard}=require('./windows-standard-token.cjs');
const executable=mode!=='installer'?process.execPath:(process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
const child=launchStandard(executable,mode!=='installer'?[path.join(__dirname,mode==='probe'?'windows-token-probe.cjs':'windows-e2e.cjs')]:args);
console.log('STANDARD_TOKEN_SUITE_START',mode,child.pid);
const waited=kernel.func('uint32_t WaitForSingleObject(uintptr_t,uint32_t)')(child.handle,600000);
if(waited!==0){kernel.func('bool TerminateProcess(uintptr_t,uint32_t)')(child.handle,1);child.close(child.handle);throw Error('Standard-token CI suite timed out.');}
const exit=Buffer.alloc(4);kernel.func('bool GetExitCodeProcess(uintptr_t,void *)')(child.handle,exit);child.close(child.handle);
process.exit(exit.readUInt32LE());
