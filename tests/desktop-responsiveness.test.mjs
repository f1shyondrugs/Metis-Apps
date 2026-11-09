import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {EventEmitter} from "node:events";
import {createRequire} from "node:module";
import test from "node:test";
const require=createRequire(new URL("../desktop/main.cjs",import.meta.url));
const source=fs.readFileSync(new URL("../desktop/main.cjs",import.meta.url),"utf8");
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"metis-ui-responsiveness-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let syncCalls=0;const pending=[],menus=[],sent=[];
 const electron={app:{getPath:()=>directory,setPath(){},setName(){},commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>false,quit(){}},safeStorage:{},
  Menu:{buildFromTemplate:template=>template},Notification:{isSupported:()=>false}};
 class Worker extends EventEmitter { constructor(){super();pending.push((error,stdout)=>this.emit("message",error?{ok:false,error:error.message}:{ok:true,stdout:stdout.trim()}))} terminate(){return Promise.resolve()} }
 const child={spawnSync(){syncCalls++;return{status:0,stdout:"True",stderr:""}},execFile(_file,_args,_options,callback){pending.push(callback);return{}}};
 const context=vm.createContext({require:name=>name==="electron"?electron:name==="electron-updater"?{autoUpdater:{}}:name==="node:child_process"?child:name==="node:worker_threads"?{Worker}:require(name),
  process:{platform:"win32",env:{}},Buffer,URL,AbortSignal,console,setTimeout,clearTimeout,setInterval,clearInterval,__dirname:fileURLToPath(new URL("../desktop",import.meta.url)),module:{exports:{}}});
 vm.runInContext(source+'\nmodule.exports={broadcast,getAutostart,setAutostart,setup(t,w){tray=t;window=w;}};',context);
 const api=context.module.exports;api.setup({setToolTip(){},setContextMenu:template=>menus.push(template)},{webContents:{send:(...args)=>sent.push(args)}});
 return{api,pending,menus,sent,get syncCalls(){return syncCalls}};
}
test("connection and permission broadcasts never launch blocking native queries",t=>{
 const f=fixture(t);
 for(let i=0;i<100;i++)f.api.broadcast();
 assert.equal(f.syncCalls,0);
 assert.equal(f.pending.length,0);
 assert.equal(f.sent.length,100);
 assert.equal(f.menus.length,1,"Unchanged tray contents are not rebuilt for every status event");
});
test("autostart discovery coalesces while the hub remains responsive",async t=>{
 const f=fixture(t);
 const reads=Array.from({length:20},()=>f.api.getAutostart());
 assert.equal(f.syncCalls,0);assert.equal(f.pending.length,1);
 f.api.broadcast();assert.equal(f.sent.length,1);
 f.pending.shift()(null,"True","");assert.ok((await Promise.all(reads)).every(Boolean));
 f.api.broadcast();assert.equal(f.menus.at(-1).find(i=>i.label==="Start at login").checked,true);
});

test("a stale initial autostart read cannot overwrite a completed setting change",async t=>{
 const f=fixture(t),read=f.api.getAutostart(),write=f.api.setAutostart(true);
 await Promise.resolve();await Promise.resolve();
 assert.equal(f.pending.length,2);
 f.pending[1](null,"","");await write;
 f.pending[0](null,"False","");await read;
 f.api.broadcast();
 assert.equal(f.menus.at(-1).find(i=>i.label==="Start at login").checked,true);
});
