if(process.platform==='win32'&&process.argv.includes('--metis-drop-helper'))require('./src/main/file-drop-helper.cjs').bootstrap();
else if(process.argv.some(arg=>arg.startsWith('--metis-admin-restart-from='))){
 const {app,dialog}=require('electron');
 const {waitForRestartParent}=require('./src/main/admin-restart.cjs');
 app.whenReady().then(()=>waitForRestartParent({elevated:require('./src/main/windows-token-identity.cjs').currentTokenIdentity().elevated}))
  .then(()=>{process.argv=process.argv.filter(arg=>!arg.startsWith('--metis-admin-restart-from='));require('./main.cjs');}).catch(error=>{app.whenReady().then(()=>{dialog.showErrorBox('Metis',error.message);app.exit(1);});});
}else require('./main.cjs');
