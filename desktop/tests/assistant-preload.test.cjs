const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
test('trusted pointer gestures retain the native hit region until release; synthetic events cannot arm it',()=>{
 const listeners=new Map(),frames=[],sent=[];
 const pane={getBoundingClientRect:()=>({x:100,y:20,width:360,height:360})},control={closest:()=>pane,matches:()=>false};
 const context={require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{send:(name,value)=>sent.push(value),invoke(){},on(){},removeListener(){}}}),process:{isMainFrame:true},
 addEventListener:(name,fn)=>listeners.set(name,fn),document:{querySelectorAll:()=>[pane],body:{},addEventListener(){}},
 ResizeObserver:class{observe(){}unobserve(){}},MutationObserver:class{observe(){}},
 requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},setTimeout:()=>1,clearTimeout(){},innerWidth:1440,innerHeight:900};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/assistant-preload.cjs'),'utf8'),context);
 listeners.get('DOMContentLoaded')();while(frames.length)frames.shift()();
 const down={button:0,isTrusted:false,target:{closest:()=>control},buttons:1};
 listeners.get('pointerdown')(down);assert.equal(sent.length,1);
 listeners.get('pointerdown')({...down,isTrusted:true});
 assert.equal(sent.at(-1).rects[0].width,1440);
 // Native setShape may lose DOM capture: do not end the physical gesture.
 assert.equal(listeners.has('lostpointercapture'),false);
 listeners.get('pointermove')({isTrusted:true,buttons:1});
 listeners.get('pointerup')();while(frames.length)frames.shift()();
 assert.equal(sent.at(-1).rects[0].width,360);
 listeners.get('pointerdown')({...down,isTrusted:true});listeners.get('blur')();while(frames.length)frames.shift()();
 assert.equal(sent.at(-1).rects[0].width,360);
});
