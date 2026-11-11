// Load the shipped native Node-API binaries under the actual Electron runtime.
// The Linux hook runs only in the test's Xvfb display and injects no input.
const {app}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
app.disableHardwareAcceleration();
app.setName('Metis native module test');app.setAppUserModelId('ai.metis.native.modules.test');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'metis-native-module-')));
const timeout=setTimeout(()=>app.exit(1),20000);
let hook;
async function main(){
 await app.whenReady();
 const req=process.env.METIS_NATIVE_TEST_ARCHIVE?require('node:module').createRequire(path.resolve(process.env.METIS_NATIVE_TEST_ARCHIVE,'package.json')):require;
 const koffi=req('koffi'),{uIOhook}=req('uiohook-napi');
 assert.equal(typeof uIOhook.start,'function');
 const win=process.platform==='win32';
 const lib=koffi.load(win?'kernel32.dll':process.platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6');
 const pid=lib.func(win?'uint32_t GetCurrentProcessId(void)':'int getpid(void)');
 assert.equal(pid(),process.pid);
 if(process.platform==='linux'){hook=uIOhook;hook.start();await new Promise(r=>setTimeout(r,80));hook.stop();hook=null;}
 console.log('NATIVE_NODE_API_BINDINGS_LOAD_AND_LINUX_HOOK_START_OK');
}
main().then(()=>{clearTimeout(timeout);app.exit(0)}).catch(error=>{try{hook?.stop()}catch{}console.error(error);clearTimeout(timeout);app.exit(1)});
