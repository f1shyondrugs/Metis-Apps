// Test-only CreateProcess launch. ShellExecute/Start-Process can substitute a
// different logon token on hosted images; use the same inheritance as real
// standard Electron integration tests and prove this parent is actually Medium.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
assert.ok(process.env.RUNNER_TEMP,'Restricted to an isolated Windows CI runner.');
assert.equal(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().elevated,false);
const [exe,out,err,...input]=process.argv.slice(2);
assert.equal(path.basename(exe),'Metis AI Remote Client.exe');
for(const file of [exe,out,err])assert.ok(path.resolve(file).toLowerCase().startsWith(path.resolve(process.env.RUNNER_TEMP).toLowerCase()+path.sep));
const args=input.flatMap(value=>value.split(' ')).filter(Boolean);
for(const arg of args)assert.ok(['--disable-gpu','--disable-software-rasterizer','--in-process-gpu'].includes(arg));
const stdout=fs.openSync(out,'w'),stderr=fs.openSync(err,'w');
const child=spawn(exe,args,{env:{...process.env},stdio:['ignore',stdout,stderr],windowsHide:false});
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('spawn',()=>{console.log(JSON.stringify({pid:child.pid,mediumParent:true}));child.unref();fs.closeSync(stdout);fs.closeSync(stderr);});
