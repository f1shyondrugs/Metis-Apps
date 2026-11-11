// Real Explorer drag into an elevated, isolated Electron window. Only test windows/files.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const root=process.env.METIS_DROP_TEST_ROOT;
if(!root)throw Error('Explicit isolated root required.');
app.disableHardwareAcceleration();app.setAppUserModelId('ai.metis.explorer.drop.test');app.setPath('userData',path.join(root,'explorer-electron-data'));
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const ps=s=>promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(s,'utf16le').toString('base64')],{windowsHide:true,timeout:30000});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<400;i++){if(await fn())return;await pause(100);}throw Error('Explorer fixture timed out');}
let task='',win,mouse,cursor,saved;
const timeout=setTimeout(()=>app.exit(1),90000);
async function main(){
 await app.whenReady();
 const koffi=require('koffi'),user=koffi.load('user32.dll');
 mouse=user.func('void mouse_event(uint32_t,uint32_t,uint32_t,uint32_t,uintptr_t)');
 cursor=user.func('bool SetCursorPos(int,int)');saved=Buffer.alloc(8);user.func('bool GetCursorPos(void *)')(saved);
 const http=require('node:http');
 const fixture=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Own Metis drop fixture</h1><script>metisApp.onFilesDropped(p=>window.dropped=p)</script>');});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 const desktop=await require(process.env.METIS_FILE_DROP_ARCHIVE?path.join(process.env.METIS_FILE_DROP_ARCHIVE,'src/main/web-window.cjs'):'../src/main/web-window.cjs').createDesktop({initialServer:'http://127.0.0.1:'+fixture.address().port});
 await desktop.initialLoad;console.log('FIXTURE_WEB_READY');win=desktop.win;win.setTitle('Metis isolated Explorer drop target');
 const contents=desktop.getView().webContents;
 let payload,error;
 const stop=()=>fixture.close();
 const source=path.join(root,'explorer-source-'+process.pid);fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'drop-fixture.txt'),'EXPLORER FILE CONTENTS');
 const windowReady=path.join(root,'explorer-window.json');fs.rmSync(windowReady,{force:true});
 const ready=path.join(root,'explorer-ready.json'),done=path.join(root,'explorer-close.request');fs.rmSync(ready,{force:true});fs.rmSync(done,{force:true});
 const script=path.join(root,'explorer-source.ps1');
 fs.writeFileSync(script,`$ErrorActionPreference='Stop'
trap {$_|Out-String|Set-Content ${quote(path.join(root,'explorer-error.txt'))};exit 1}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$folder=${quote(source)}
Start-Process -FilePath "$env:WINDIR/explorer.exe" -ArgumentList ('/n,/separate,"'+$folder+'"')
$shell=New-Object -ComObject Shell.Application
$view=$null
for($i=0;$i -lt 100;$i++){ $view=@($shell.Windows())|Where-Object {$_.LocationURL -and [IO.Path]::GetFullPath(([Uri]$_.LocationURL).LocalPath) -eq [IO.Path]::GetFullPath($folder) }|Select-Object -First 1;if($view){break};Start-Sleep -Milliseconds 100 }
if(!$view){throw 'Owned Explorer window not found'}
try{
 $view.Left=850;$view.Top=100;$view.Width=550;$view.Height=500
 @{hwnd=[long]$view.HWND}|ConvertTo-Json|Set-Content -Encoding UTF8 ${quote(windowReady)}
 Start-Sleep -Milliseconds 1000
 $view.Document.CurrentViewMode=4
 $item=$view.Document.Folder.ParseName('drop-fixture.txt');$view.Document.SelectItem($item,29)
 Start-Sleep -Milliseconds 500
 $element=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$view.HWND)
 $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'drop-fixture.txt')
 $target=$element.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
 if(!$target){$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'drop-fixture');$target=$element.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)}
 if(!$target){$target=@($element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition))|Where-Object {$_.Current.Name -like 'drop-fixture*' -and $_.Current.BoundingRectangle.Width -gt 0}|Select-Object -First 1}
 if(!$target){throw 'Owned file item not found'}
 $rect=$target.Current.BoundingRectangle
 $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 @{x=$rect.X+[Math]::Min(18,($rect.Width/2));y=$rect.Y+($rect.Height/2);hwnd=[long]$view.HWND;elevated=$admin}|ConvertTo-Json|Set-Content -Encoding UTF8 ${quote(ready)}
 for($i=0;$i -lt 200 -and !(Test-Path ${quote(done)});$i++){Start-Sleep -Milliseconds 100}
}finally{$view.Quit()}
`);
 task='Metis Explorer Drop Isolated '+process.pid;
 try{
 await ps(`$u=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${quote('-NoProfile -ExecutionPolicy Bypass -File "'+script+'"')};$p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited;Register-ScheduledTask -TaskName ${quote(task)} -Action $a -Principal $p -Force|Out-Null;Start-ScheduledTask -TaskName ${quote(task)}`);
 await until(()=>fs.existsSync(windowReady));console.log('FIXTURE_EXPLORER_READY');
 const sourceWindow=JSON.parse(fs.readFileSync(windowReady,'utf8').replace(/^\uFEFF/,''));
 const sourceHandle=Buffer.alloc(8);sourceHandle.writeBigUInt64LE(BigInt(sourceWindow.hwnd));
 require('../src/main/assistant-focus.cjs').createForegroundRestore().activate({getNativeWindowHandle:()=>sourceHandle});
 await until(()=>fs.existsSync(ready));
 const origin=JSON.parse(fs.readFileSync(ready,'utf8').replace(/^\uFEFF/,''));assert.equal(origin.elevated,false);
 const hwnd=Number(win.getNativeWindowHandle().readBigUInt64LE()),rect=Buffer.alloc(16),point=Buffer.alloc(8);
 user.func('bool GetClientRect(uintptr_t,void *)')(hwnd,rect);point.writeInt32LE(rect.readInt32LE(8)/2,0);point.writeInt32LE(rect.readInt32LE(12)/2,4);user.func('bool ClientToScreen(uintptr_t,void *)')(hwnd,point);
 const setPosition=user.func('bool SetWindowPos(uintptr_t,intptr_t,int,int,int,int,uint32_t)');
 const sourceRect=Buffer.alloc(16);user.func('bool GetWindowRect(uintptr_t,void *)')(origin.hwnd,sourceRect);
 setPosition(hwnd,-1,50,100,600,400,0x10);setPosition(origin.hwnd,-1,850,100,550,500,0x10);
 origin.x+=850-sourceRect.readInt32LE(0);origin.y+=100-sourceRect.readInt32LE(4);
 user.func('bool GetClientRect(uintptr_t,void *)')(hwnd,rect);point.writeInt32LE(rect.readInt32LE(8)/2,0);point.writeInt32LE(rect.readInt32LE(12)/2,4);user.func('bool ClientToScreen(uintptr_t,void *)')(hwnd,point);
 const x=point.readInt32LE(0),y=point.readInt32LE(4);
 const handle=Buffer.alloc(8);handle.writeBigUInt64LE(BigInt(origin.hwnd));
 require('../src/main/assistant-focus.cjs').createForegroundRestore().activate({getNativeWindowHandle:()=>handle});
 const fromPoint=user.func('uintptr_t WindowFromPoint(uint64_t)'),ancestor=user.func('uintptr_t GetAncestor(uintptr_t,uint32_t)');
 const rootAt=(px,py)=>{const p=Buffer.alloc(8);p.writeInt32LE(Math.round(px),0);p.writeInt32LE(Math.round(py),4);return Number(ancestor(fromPoint(p.readBigUInt64LE()),2));};
 assert.equal(rootAt(origin.x,origin.y),origin.hwnd,'source pointer must hit only our Explorer fixture');
 assert.equal(rootAt(x,y),hwnd,'target pointer must hit only our Electron fixture');
 console.log('FIXTURE_EXTERNAL_DRAG_START');cursor(Math.round(origin.x),Math.round(origin.y));await pause(200);mouse(2,0,0,0,0);await pause(200);
 for(let i=1;i<=30;i++){cursor(Math.round(origin.x+(x-origin.x)*i/30),Math.round(origin.y+(y-origin.y)*i/30));await pause(20);}
 mouse(4,0,0,0,0);
 await until(async()=>{payload=await contents.executeJavaScript('window.dropped');return Boolean(payload);});
 assert.equal(Buffer.from(payload.files[0].bytes).toString(),'EXPLORER FILE CONTENTS');console.log('FIXTURE_EXTERNAL_BYTES_OK');
 await contents.executeJavaScript(`document.body.innerHTML='<div id="source" draggable="true" style="position:absolute;left:20px;top:30px;width:100px;height:60px;background:#444">Own drag source</div><div id="target" style="position:absolute;left:300px;top:30px;width:150px;height:80px;background:#888">Own drop target</div>';document.getElementById('source').ondragstart=e=>e.dataTransfer.setData('text/plain','internal');document.getElementById('target').ondragover=e=>e.preventDefault();document.getElementById('target').ondrop=e=>{e.preventDefault();window.internalDrop=e.dataTransfer.getData('text/plain');};true;`);
 const dims=await contents.executeJavaScript('({width:innerWidth,height:innerHeight})');
 const corner=Buffer.alloc(8);user.func('bool ClientToScreen(uintptr_t,void *)')(hwnd,corner);
 const sx=corner.readInt32LE(0)+60*rect.readInt32LE(8)/dims.width,sy=corner.readInt32LE(4)+55*rect.readInt32LE(12)/dims.height,tx=corner.readInt32LE(0)+350*rect.readInt32LE(8)/dims.width;
 require('../src/main/assistant-focus.cjs').createForegroundRestore().activate(win);
 assert.equal(rootAt(sx,sy),hwnd);assert.equal(rootAt(tx,sy),hwnd);
 // The native OLE source nests Electron's UI loop. Inject only into this own
 // window from an independent test process, not Node timers in that same loop.
 await ps(`Add-Type -TypeDefinition @'
using System;using System.Threading;using System.Runtime.InteropServices;
public static class OwnDrag {
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public static void Run(){try{SetCursorPos(${Math.round(sx)},${Math.round(sy)});Thread.Sleep(100);mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(150);for(int i=1;i<=30;i++){SetCursorPos(${Math.round(sx)}+(${Math.round(tx-sx)})*i/30,${Math.round(sy)});Thread.Sleep(20);}}finally{mouse_event(4,0,0,0,UIntPtr.Zero);}}
}
'@
[OwnDrag]::Run()`);
 await until(async()=>await contents.executeJavaScript('window.internalDrop')==='internal');
 console.log('INTERNAL_HTML_DRAG_REMAINS_WORKING_OK');
 fs.writeFileSync(path.join(root,'explorer-result.json'),JSON.stringify({passed:true,mediumExplorer:true,normalUserHelper:true,internalDrag:true,contents:true,actualWebContentsView:true,bytesOnly:true}));
 console.log('REAL_EXPLORER_DRAG_INTO_ELEVATED_ELECTRON_OK');
 }finally{mouse(4,0,0,0,0);cursor(saved.readInt32LE(0),saved.readInt32LE(4));fs.writeFileSync(done,'close');await ps(`Unregister-ScheduledTask -TaskName ${quote(task)} -Confirm:$false -ErrorAction SilentlyContinue`);stop();win.destroy();}
}
main().then(()=>{clearTimeout(timeout);app.exit(0);}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1);});
