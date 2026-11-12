// Real sandboxed Electron windows, temporary profile, synthetic local server only.
const {app}=require("electron");app.disableHardwareAcceleration();
if(process.env.METIS_ONBOARDING_REDUCED==="1")app.commandLine.appendSwitch("force-prefers-reduced-motion");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),http=require("node:http");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-guided-onboarding-"));
app.on("window-all-closed",()=>{});
app.setPath("userData",root);app.setName("Metis onboarding test");app.setAppUserModelId("ai.metis.onboarding.test");
const {createDesktop}=require("../src/main/web-window.cjs");
const wait=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error("Onboarding wait timed out");};
let desktop,fixture,foreign,initialRequests=0;
async function captureSeries(contents,name,count=28){
 if(process.env.METIS_CAPTURE_ONBOARDING_MOTION!=="1")return;
 const folder=path.join(__dirname,"..","test-results","transition-media");fs.mkdirSync(folder,{recursive:true});
 const frames=[];for(let i=0;i<count;i++){const at=Date.now(),file=name+"-"+String(i).padStart(2,"0")+".png";fs.writeFileSync(path.join(folder,file),(await contents.capturePage()).toPNG());frames.push({file,at});await new Promise(resolve=>setTimeout(resolve,45));}
 fs.writeFileSync(path.join(folder,name+".json"),JSON.stringify(frames));
}
const timeout=setTimeout(()=>{console.error("ONBOARDING_TIMEOUT");app.exit(1);},60000);
async function run(){
 await app.whenReady();
 fixture=http.createServer((req,res)=>{if(req.url==="/")initialRequests++;res.setHeader("Content-Type","text/html");res.end(req.url==="/frame"?"<p>Untrusted child</p>":'<!doctype html><title>Fresh Metis fixture</title><h1>Fresh Metis server setup</h1><p id="setup">Create the first account</p><iframe src="/frame"></iframe>');});
 await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));const server="http://127.0.0.1:"+fixture.address().port+"/";
 let permissionCalls=0;
 desktop=await createDesktop({onDesktopPermissions:async()=>{permissionCalls++;return {available:false,reason:"Synthetic OS status"};}});
 await desktop.initialLoad;
 assert.equal(desktop.getState().mode,"welcome");assert.equal(desktop.getView(),undefined);
 // macOS has a global application menu, not a per-window menu bar.
 if(process.platform!=="darwin")assert.equal(desktop.win.isMenuBarVisible(),false);console.log("FRAMELESS_NATIVE_SPLASH_OK");
 const local=desktop.win.webContents;
 await wait(()=>local.executeJavaScript('Boolean(document.querySelector("#motion svg path"))'));
 await captureSeries(local,"intro");
 await wait(()=>local.executeJavaScript('document.getElementById("motion").dataset.onboardingEntrance==="done"&&document.querySelector("main").dataset.transition==="idle"'));
 assert.equal(await local.executeJavaScript('document.body.dataset.onboardingReady'),"true");
 console.log("NATIVE_LOAD_READY_EDGE_ENTRANCE_COMPLETED_OK");
 const reducedIntro=await local.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches');
 await local.executeJavaScript('document.dispatchEvent(new PointerEvent("pointerdown",{button:0,isPrimary:true,clientX:innerWidth/2,clientY:innerHeight/2,bubbles:true}))');
 assert.equal(await local.executeJavaScript('document.getElementById("motion").dataset.onboardingPulse'),reducedIntro?"idle":"active");
 if(!reducedIntro){console.log("NATIVE_CLICK_WAVE_IMPULSE_OK");await captureSeries(local,"pulse",18);}
 assert.ok(require("../package.json").build.files.includes("assets/metis-wordmark.svg"));
 const logoInfo=await local.executeJavaScript('(async()=>{const el=document.querySelector(".metis-wordmark"),image=new Image();image.src=new URL("../assets/metis-wordmark.svg",location.href).href;await image.decode();const r=el.getBoundingClientRect();return {label:el.getAttribute("aria-label"),mask:getComputedStyle(el).maskImage,width:r.width,height:r.height,x:r.x,y:r.y,naturalWidth:image.naturalWidth};})()');
 assert.equal(logoInfo.label,"Metis");assert.ok(logoInfo.mask.includes("metis-wordmark.svg"));assert.equal(logoInfo.width,190);assert.equal(logoInfo.height,64);assert.ok(logoInfo.naturalWidth>0);
 await local.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
 let logoPaint=0,logoPixels=0;
 await wait(async()=>{
  const logoImage=await local.capturePage({x:Math.floor(logoInfo.x),y:Math.floor(logoInfo.y),width:190,height:64}),bytes=logoImage.getBitmap();
  logoPaint=0;logoPixels=bytes.length/4;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>180)logoPaint++;
  return logoPaint>80&&logoPaint<logoPixels*.6;
 });
 assert.ok(logoPaint>80&&logoPaint<logoPixels*.6,`Canonical vector wordmark must paint as glyphs, not a blank or solid rectangle: ${logoPaint}/${logoPixels}`);
 const originalSize=desktop.win.getContentSize(),originalMinimum=desktop.win.getMinimumSize();
 // Test-only viewport emulation on macOS: AppKit constrains physical window resizing.
 // Other platforms exercise the actual isolated window. Product constraints stay unchanged.
 desktop.win.setMinimumSize(0,0);
 for(const width of [390,768,1440]){
  if(process.platform==="darwin")local.enableDeviceEmulation({screenPosition:"desktop",screenSize:{width,height:1000},viewPosition:{x:0,y:0},viewSize:{width,height:width===390?844:1000},deviceScaleFactor:1,scale:1});
  else desktop.win.setContentSize(width,width===390?844:1000);
  await wait(()=>local.executeJavaScript("innerWidth==="+width));await new Promise(resolve=>setTimeout(resolve,100));
  const layout=await local.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth+1,width:document.querySelector(".metis-wordmark").getBoundingClientRect().width})');
  assert.equal(layout.overflow,false);assert.equal(layout.width,190);
  assert.equal(await local.executeJavaScript('(()=>{const b=document.getElementById("begin").getBoundingClientRect(),p=document.getElementById("progress").getBoundingClientRect(),f=document.querySelector("footer").getBoundingClientRect();return Math.abs(b.x+b.width/2-innerWidth/2)<2&&p.top>b.bottom})()'),true);console.log("WORDMARK_RESPONSIVE_OK",width);
 }
 if(process.platform==="darwin")local.disableDeviceEmulation();
 desktop.win.setMinimumSize(...originalMinimum);desktop.win.setContentSize(...originalSize);await wait(()=>local.executeJavaScript("innerWidth==="+originalSize[0]));await new Promise(resolve=>setTimeout(resolve,100));
 console.log("CANONICAL_WEB_WORDMARK_DECODED_AND_PAINTED_OK",logoPaint);
 assert.equal(await local.executeJavaScript('document.getElementById("heading").textContent'),"Welcome to Metis");
 assert.equal(await local.executeJavaScript('getComputedStyle(document.documentElement).backgroundColor'),"rgb(0, 0, 0)");
 assert.equal(await local.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()'),"#fff");
 assert.equal(await local.executeJavaScript('document.querySelectorAll(".features,.brand").length'),0);
 console.log("MINIMAL_NATIVE_BLACK_WHITE_AND_ICONS_OK");
 assert.equal(await local.executeJavaScript('document.querySelector("footer").innerText.trim()'),"Start");
 assert.equal(await local.executeJavaScript('(()=>{const b=document.getElementById("begin").getBoundingClientRect(),p=document.getElementById("progress").getBoundingClientRect(),f=document.querySelector("footer").getBoundingClientRect();return Math.abs(b.x+b.width/2-innerWidth/2)<2&&p.top>b.bottom})()'),true);console.log("NATIVE_WELCOME_START_CENTERED_WITH_PROGRESS_OK");
 assert.deepEqual(await local.executeJavaScript('Array.from(document.querySelectorAll("button")).filter(el=>el.getClientRects().length).map(el=>el.textContent.trim())'),["Start"]);
 console.log("NATIVE_ONLY_START_AND_NO_FOOTER_TEXT_OK");
 assert.equal(await local.executeJavaScript('getComputedStyle(document.querySelector("#motion svg")).color'),"rgb(255, 255, 255)");
 assert.equal(await local.executeJavaScript('document.querySelector("#motion svg [data-onboarding-geometry]").getAttribute("stroke")'),"none");
 assert.equal(await local.executeJavaScript('document.querySelectorAll("#motion svg > g > rect").length'),1);
 console.log("WHITE_DOTS_ONLY_WITHOUT_CONTINUOUS_BORDER_OK");
 assert.equal(await local.executeJavaScript('document.querySelector("#motion feGaussianBlur").getAttribute("stdDeviation")'),"8");
 assert.notEqual(await local.executeJavaScript('getComputedStyle(document.querySelector("#motion [data-onboarding-glow]")).filter'),"none");
 console.log("SOFT_WHITE_EDGE_GLOW_WITHOUT_OUTLINE_OK");
 await new Promise(resolve=>setTimeout(resolve,100));
 const glowingImage=await local.capturePage(),glowSize=glowingImage.getSize(),glowPixel=(Math.floor(glowSize.height/2)*glowSize.width+24)*4;
 const glowPaint=glowingImage.getBitmap()[glowPixel];
 const innerPaint=glowingImage.getBitmap()[(Math.floor(glowSize.height/2)*glowSize.width+48)*4];
 console.log("GLOW_PIXEL_SAMPLE",JSON.stringify({glowSize,glowPaint,innerPaint}));
 assert.ok(glowPaint>innerPaint&&innerPaint===0,"One real frame must show the soft glow fading to black beyond the sharp dot band");
 console.log("SOFT_EDGE_GLOW_ACTUAL_PIXEL_VERIFIED");
 const before=await local.executeJavaScript('document.querySelector("#motion mask path").getAttribute("d")');
 const reduced=await local.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches');
 if(process.env.METIS_ONBOARDING_REDUCED==="1")assert.equal(reduced,true);
 if(reduced){
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(before,await local.executeJavaScript('document.querySelector("#motion mask path").getAttribute("d")'));
  assert.equal(await local.executeJavaScript('getComputedStyle(document.querySelector(".content")).animationName'),"none");console.log("ONBOARDING_REDUCED_MOTION_STATIC_OK");
 }else{
  await wait(async()=>before!==await local.executeJavaScript('document.querySelector("#motion mask path").getAttribute("d")'));
  console.log("ONBOARDING_VISIBLE_MOTION_ADVANCES_OK");
 }
 fs.mkdirSync(path.join(__dirname,"..","test-results"),{recursive:true});fs.writeFileSync(path.join(__dirname,"..","test-results","onboarding-welcome.png"),(await local.capturePage()).toPNG());
 await local.executeJavaScript('document.getElementById("begin").click()');await wait(()=>desktop.getState().mode==="settings");
 await captureSeries(local,"step");
 await wait(()=>desktop.win.webContents.executeJavaScript('document.getElementById("form").hidden===false'));
 assert.equal(await local.executeJavaScript('document.activeElement.id'),"server");
 console.log("NATIVE_FADE_STEP_AND_INPUT_FOCUS_OK");
 const invalid=await local.executeJavaScript('metisDesktop.connect("https://user:password@example.invalid/")');assert.equal(invalid.ok,false);
 assert.equal(await local.executeJavaScript('document.getElementById("connect").form===document.getElementById("form")'),true);
 await local.executeJavaScript('document.getElementById("server").value='+JSON.stringify(server)+';document.getElementById("connect").click()');
 await wait(()=>desktop.getState().mode==="ready");
 assert.equal(local.isDestroyed(),true,"Retired splash must be destroyed after handoff");assert.equal(desktop.win.isMenuBarVisible(),true);console.log("FRAMED_WORKSPACE_HANDOFF_WITHOUT_VIEW_RELOAD_OK");
 assert.equal(initialRequests,1,"Framing handoff must not reload the server page");let contents=desktop.getView().webContents;
 assert.match(await contents.executeJavaScript("document.body.textContent"),/Fresh Metis server setup/);
 const context=await contents.executeJavaScript("metisApp.onboardingContext()");
 assert.match(context.installationId,/^[a-f0-9-]{36}$/);assert.equal(context.server,server);assert.deepEqual(Object.keys(context).sort(),["installationId","server"]);
 assert.equal(permissionCalls,0);
 await contents.executeJavaScript("metisApp.requestDesktopPermissions()");assert.equal(permissionCalls,1);
 assert.equal(await contents.executeJavaScript("typeof document.querySelector('iframe').contentWindow.metisApp"),"undefined");
 console.log("FRESH_DESKTOP_DOMAIN_AND_SERVER_SETUP_OK");
 // Opening settings intentionally destroys this remote WebContents. Observe the surviving owner, not its evaluation reply.
 void contents.executeJavaScript("metisApp.openServerSettings()").catch(()=>{});await wait(()=>desktop.getState().mode==="settings");
 await wait(()=>desktop.win.webContents.executeJavaScript('document.getElementById("form").hidden===false'));
 assert.equal(await desktop.win.webContents.executeJavaScript('document.getElementById("server").value'),server);
 await desktop.load();contents=desktop.getView().webContents;
 foreign=http.createServer((req,res)=>res.end("<h1>Foreign origin</h1>"));await new Promise(resolve=>foreign.listen(0,"127.0.0.1",resolve));
 await contents.loadURL("http://127.0.0.1:"+foreign.address().port+"/");
 for(const code of ["metisApp.onboardingContext()","metisApp.openServerSettings()","metisApp.requestDesktopPermissions()"])await assert.rejects(contents.executeJavaScript(code),/Access denied/);
 assert.equal(permissionCalls,1);await desktop.load();
 desktop.win.destroy();
 desktop=await createDesktop();await desktop.initialLoad;
 assert.equal(desktop.getState().mode,"ready");
 assert.equal((await desktop.getView().webContents.executeJavaScript("metisApp.onboardingContext()")).installationId,context.installationId);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,"server.json"))).url,server);
 desktop.settings();await wait(()=>desktop.getState().mode==="settings");
 fs.mkdirSync(path.join(__dirname,"..","test-results"),{recursive:true});fs.writeFileSync(path.join(__dirname,"..","test-results","onboarding-server.png"),(await desktop.win.webContents.capturePage()).toPNG());
 console.log("ONBOARDING_MAIN_FRAME_GUARDS_IDENTITY_AND_EXISTING_INSTALL_OK");
 desktop.win.destroy();
 const identity=path.join(root,"client-context.json");fs.renameSync(identity,identity+".before");fs.mkdirSync(identity);
 desktop=await createDesktop();await desktop.initialLoad;assert.equal(desktop.getState().mode,"ready");
 assert.equal((await desktop.getView().webContents.executeJavaScript("metisApp.onboardingContext()")).installationId,"");
 desktop.win.destroy();fs.rmdirSync(identity);fs.renameSync(identity+".before",identity);
 console.log("OPTIONAL_CONTEXT_FAILURE_DOES_NOT_BLOCK_EXISTING_CLIENT_OK");
}
run().then(()=>{clearTimeout(timeout);desktop?.win.destroy();fixture?.close();foreign?.close();app.exit(0);}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1);});
