if(process.platform==='win32'&&process.argv.includes('--metis-drop-helper'))require('./src/main/file-drop-helper.cjs').bootstrap();
else if(process.argv.some(arg=>arg.startsWith('--metis-device-host=')))require('./src/device/admin-host.cjs').bootstrap();
else if(process.platform==='win32'){
 const {app,dialog}=require('electron');
 app.whenReady().then(async()=>{
  // An elevated launcher must not turn the web UI into an admin process.
  // Only the fixed, separately consented background role remains elevated.
  const {execFile}=require('node:child_process');
  const elevated=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',
   '$identity=[Security.Principal.WindowsIdentity]::GetCurrent(); ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
   {encoding:'utf8',windowsHide:true,timeout:15000},(error,stdout)=>error?reject(error):stdout.trim()==='True'?resolve(true):stdout.trim()==='False'?resolve(false):reject(Error('Could not verify Windows process rights.'))));
  if(!elevated){require('./main.cjs');return;}
  const {Worker}=require('node:worker_threads'),path=require('node:path');
  const worker=new Worker(path.join(__dirname,'src/main/normal-user-process.cjs'),{workerData:{development:!app.isPackaged,role:'desktop'}});
  worker.once('message',result=>{if(result.ok)app.exit(0);else{dialog.showErrorBox('Metis',result.error||'Start Metis normally from the Start menu.');app.exit(1);}});
  worker.once('error',error=>{dialog.showErrorBox('Metis',error.message);app.exit(1);});
 }).catch(error=>{dialog.showErrorBox('Metis',error.message);app.exit(1);});
}else require('./main.cjs');
