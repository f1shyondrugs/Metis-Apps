const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
app.setName('Metis Assistant Passkey Test');app.setAppUserModelId('ai.metis.assistant.passkeys.test');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'metis-passkey-electron-'));app.setPath('userData',data);
app.commandLine.appendSwitch('no-sandbox');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let win;const results=[];
const check=(condition,label)=>{assert.ok(condition,label);results.push(label);};
async function until(fn){for(let i=0;i<120;i++){try{if(await fn())return;}catch{}await pause(100);}throw Error('Timed out: '+fn);}
async function js(code){return win.webContents.executeJavaScript(code);}
async function open(view){console.log('VIEW',view);if(view!=='panel'&&process.platform!=='darwin')win.setShape([{x:0,y:0,width:win.getContentBounds().width,height:win.getContentBounds().height}]);await win.loadURL('http://localhost:3283/?view='+view);await until(()=>js('!!window.fixture'));}
async function click(selector){const r=await js('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...r});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...r});}
(async()=>{
 await app.whenReady();
 win=new BrowserWindow({width:1440,height:900,show:true,frame:false,webPreferences:{preload:path.resolve(__dirname,'../src/main/assistant-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(event,...args)=>console.log('RENDERER',event.message||args[1]||args[0]));
 win.setMinimumSize(0,0);
 let fullShape=false,latestRegions;
 ipcMain.on('assistant:regions',(_event,value)=>{latestRegions=value;if(win.webContents.getURL().includes('view=panel'))console.log('REGIONS',JSON.stringify(value.rects));fullShape=value.rects.length===1&&value.rects[0].width===value.width;if(process.platform!=='darwin'&&win.webContents.getURL().includes('view=panel'))win.setShape(require('../src/main/assistant-regions.cjs').interactionRegions(value,win.getContentBounds()));});
 // WebAuthn exercises the actual browser credential implementation and server verifier,
 // with a synthetic local account and authenticator, never owner credentials.
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('WebAuthn.enable');
 const {authenticatorId}=await win.webContents.debugger.sendCommand('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await open('settings');
 await js("fetch('/fixture/sign-in',{method:'POST'}).then(()=>true)");
 await win.reload();await until(()=>js("!!document.querySelector('input[placeholder=\"This device\"]')"));
 await until(()=>js("!!document.querySelector('section > button:not([disabled])')"));
 await click('section > button:not([disabled])'); // Add passkey.
 await until(()=>js("document.querySelector('section ul')?.textContent?.includes('Passkey')"));
 check((await win.webContents.debugger.sendCommand('WebAuthn.getCredentials',{authenticatorId})).credentials.length===1,'real resident passkey registered and server stored it');
 await win.webContents.session.cookies.remove('http://localhost:3283','ai_chat_auth');
 await open('login');await click('.metis-sign-in-form > section > button');
 await until(()=>js("document.body.dataset.signedIn==='true'"));
 check(await js("fetch('/fixture/session').then(r=>r.json()).then(b=>b.authenticated)"),'passkey assertion created the normal authenticated session');
 // Check responsive production components without changing product constraints.
 for(const width of [390,768,1440]){
  win.setContentSize(width,900);await open('login');await pause(200);
  check(await js("document.documentElement.scrollWidth<=innerWidth"),'login fits '+width);
  check(await js("(()=>{const f=document.querySelector('.metis-sign-in-form').getBoundingClientRect(),l=document.querySelector('.metis-wordmark').getBoundingClientRect();return Math.abs(l.x+l.width/2-(f.x+f.width/2))<2})()"),'logo centered '+width);
  await open('panel');await pause(400);const before=await js("document.querySelector('aside').getBoundingClientRect().toJSON()");
  await js('fixture.long()');await pause(700);const after=await js("document.querySelector('aside').getBoundingClientRect().toJSON()");
  console.log('AUTO',width,JSON.stringify({before,after,viewport:await js('({width:innerWidth,height:innerHeight})')}));
  check(after.height>before.height||after.width>before.width,'latest reply grows panel '+width);
  check(after.right<=width&&after.bottom<=900,'grown panel bounded '+width);
  await js('fixture.short()');await pause(350);
 }
 win.setContentSize(1440,900);await open('panel');await pause(400);
 let rect=await js("document.querySelector('[data-assistant-resize]').getBoundingClientRect().toJSON()");
 const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
 win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});await pause(80);
 console.log('GESTURE',await js("({gesture:document.querySelector('aside').dataset.gesture,active:document.activeElement?.outerHTML?.slice(0,120)})"));check(fullShape,'native shape expands during trusted resize gesture');
 win.webContents.sendInputEvent({type:'mouseMove',x:x-180,y:y+140,button:'left',modifiers:['leftButtonDown']});await pause(80);
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x-180,y:y+140});await pause(200);
 rect=await js("document.querySelector('aside').getBoundingClientRect().toJSON()");
 check(rect.width>=520&&rect.height>=470,'physical resize continues beyond old native hit region');
 check(!fullShape,'native click-through restored after pointer release');
 const original=rect;
 const handle=await js("document.querySelector('[data-assistant-move]').getBoundingClientRect().toJSON()");
 const mx=Math.round(handle.x+handle.width/2),my=Math.round(handle.y+handle.height/2);
 win.webContents.sendInputEvent({type:'mouseMove',x:mx,y:my});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:mx,y:my});await pause(60);
 win.webContents.sendInputEvent({type:'mouseMove',x:mx-240,y:my+70,button:'left',modifiers:['leftButtonDown']});await pause(60);
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:mx-240,y:my+70});await pause(200);
 rect=await js("document.querySelector('aside').getBoundingClientRect().toJSON()");
 check(rect.x<original.x-180&&rect.y>original.y+40,'physical header drag repositions panel');
 for(const width of [390,768,1440]){
  win.setContentSize(width,900);await open('tour');await pause(500);
  const a=await js("document.querySelector('.onboarding-tour').getBoundingClientRect().toJSON()");
  await js('fixture.setIndex(1)');await pause(500);
  const b=await js("document.querySelector('.onboarding-tour').getBoundingClientRect().toJSON()");
  console.log('TOUR',width,JSON.stringify({a,b}));check(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>20,'tour follows actual target '+width);
  await js('fixture.setIndex(5)');await pause(500);
  await js("Array.from(document.querySelectorAll('.onboarding-tour button')).find(e=>e.textContent==='Continue').click()");await pause(500);
  check(await js("(()=>{const r=document.querySelector('.onboarding-tour').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2&&parseFloat(getComputedStyle(document.querySelector('.onboarding-tour h2')).fontSize)>=28})()"),'large centered completion '+width);
 }
 fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/assistant-passkeys.json'),JSON.stringify({passed:results.length,results},null,2));
 console.log('ASSISTANT_PASSKEYS_NATIVE_OK',results.length);
 win.destroy();app.quit();
})().catch(async e=>{console.error(e);try{console.log('DOM',await js('document.body.innerText'));}catch{}app.exit(1)});
setTimeout(()=>{console.error('TEST_TIMEOUT');app.exit(1)},120000).unref();
app.on('will-quit',()=>{fs.rmSync(data,{recursive:true,force:true});});
