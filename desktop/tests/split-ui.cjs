// Actual local Device Settings renderer, synthetic state, isolated profile only.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-split-ui-'));
app.disableHardwareAcceleration();app.setPath('userData',root);app.setAppUserModelId('ai.metis.split.ui.test');
const directory=path.join(__dirname,'../test-results/split-ui');fs.mkdirSync(directory,{recursive:true});
let state={platform:'win32',windowsElevation:'user',paired:false,connection:'offline',server:'',permissionMode:null,desktopAvailable:true,cancelShortcut:'Escape'};
for(const name of ['state','snapshot','get-autostart','desktop-access'])
 ipcMain.handle('hub:'+name,()=>name==='state'?state:name==='snapshot'?{client:null,audit:[]}:false);
async function main(){
 await app.whenReady();
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.join(__dirname,'../preload.cjs'),sandbox:true,contextIsolation:true}});
 await win.loadFile(path.join(__dirname,'../index.html'));await new Promise(resolve=>setTimeout(resolve,150));
 const results=[];
 for(const width of [390,768,1440]){
  win.setContentSize(width,900);
  await new Promise(resolve=>setTimeout(resolve,60));
  for(const mode of ['user','admin']){
   state={...state,paired:mode==='admin',permissionMode:mode,deviceElevation:mode==='admin'?'administrator':'user',connection:'online',clientId:'synthetic'};
   await win.webContents.executeJavaScript('setConnection('+JSON.stringify(state)+')');
   const result=await win.webContents.executeJavaScript('(()=>{const box=document.getElementById("windows-access"),button=document.getElementById("restart-as-administrator");return {overflow:document.documentElement.scrollWidth>innerWidth,title:document.getElementById("windows-access-title").textContent,detail:document.getElementById("windows-access-detail").textContent,buttonHidden:button.hidden,bounds:box.getBoundingClientRect().toJSON()};})()');
   assert.equal(result.overflow,false);assert.equal(result.title,'Desktop app: Standard user');assert.equal(result.buttonHidden,mode==='admin');
   assert.ok(result.bounds.right<=width&&result.bounds.x>=0);
   const contentLeft=await win.webContents.executeJavaScript('document.querySelector("#windows-access strong").getBoundingClientRect().left');
   assert.ok(contentLeft>=24,'Access copy must align with the page gutter');
   results.push({width,mode,...result});
   fs.writeFileSync(path.join(directory,width+'-'+mode+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 fs.writeFileSync(path.join(directory,'proof.json'),JSON.stringify({passed:true,results},null,2));
 console.log('SPLIT_UI_390_768_1440_NO_OVERFLOW_AND_ACTUAL_PROCESS_LABELS_OK');win.destroy();app.exit(0);
}
main().catch(error=>{console.error(error);app.exit(1);});
