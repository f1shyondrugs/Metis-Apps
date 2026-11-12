// Give focus tests a real, bounded input gesture on their own isolated window.
// No foreign window is focused/clicked; the cursor is restored even on failure.
async function ownForeground() {
 if(process.platform!=='win32')return ()=>{};
 const {BrowserWindow}=require('electron'),assert=require('node:assert/strict');
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const koffi=require('koffi'),user=koffi.load('user32.dll');
 const getCursor=user.func('bool GetCursorPos(void *)'),setCursor=user.func('bool SetCursorPos(int,int)');
 const mouse=user.func('void mouse_event(uint32_t,uint32_t,uint32_t,uint32_t,uintptr_t)');
 const from=user.func('uintptr_t WindowFromPoint(uint64_t)'),ancestor=user.func('uintptr_t GetAncestor(uintptr_t,uint32_t)');
 const getRect=user.func('bool GetWindowRect(uintptr_t,void *)'),get=user.func('uintptr_t GetForegroundWindow()');
 const win=new BrowserWindow({width:120,height:100,x:24,y:24,frame:false,show:false,backgroundColor:'#333333',webPreferences:{sandbox:true,contextIsolation:true}});
 await win.loadURL('data:text/html,<title>Own focus fixture</title><p>Own focus fixture</p>');
 win.setAlwaysOnTop(true,'screen-saver');win.show();
 const hwnd=Number(win.getNativeWindowHandle().readBigUInt64LE()),saved=Buffer.alloc(8),rect=Buffer.alloc(16);
 getCursor(saved);getRect(hwnd,rect);
 const point=Buffer.alloc(8);point.writeInt32LE((rect.readInt32LE(0)+rect.readInt32LE(8))/2);point.writeInt32LE((rect.readInt32LE(4)+rect.readInt32LE(12))/2,4);
 try{
  // Native show/stack updates complete on the next Windows message turn.
  for(let i=0;i<30&&Number(ancestor(from(point.readBigUInt64LE()),2))!==hwnd;i++)await pause(50);
  const actual=Number(ancestor(from(point.readBigUInt64LE()),2));
  if(actual!==hwnd){
   const name=Buffer.alloc(512);user.func('int GetClassNameW(uintptr_t,void *,int)')(actual,name,256);
   console.error('OWN_FOCUS_NOT_PRESENT',{actual,expected:hwnd,className:name.toString('utf16le').split('\\0')[0],visible:win.isVisible(),bounds:win.getBounds()});
  }
  assert.equal(actual,hwnd,'Focus input must hit only the owned fixture');
  setCursor(point.readInt32LE(0),point.readInt32LE(4));mouse(2,0,0,0,0);await pause(30);mouse(4,0,0,0,0);await pause(80);
  assert.equal(Number(get()),hwnd,'Own input gesture must activate the standard fixture');
 }catch(error){win.destroy();throw error;}
 finally{mouse(4,0,0,0,0);setCursor(saved.readInt32LE(0),saved.readInt32LE(4));}
 return ()=>win.destroy();
}
module.exports={ownForeground};
