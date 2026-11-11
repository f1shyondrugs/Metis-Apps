const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createAnnotationOverlay}=require('../src/main/annotation-overlay.cjs');
test('native pointer policy uses monitor-local DIP coordinates and only explicit card/control regions',async()=>{
 const handlers=new Map(),ipc=new EventEmitter();ipc.handle=(k,f)=>handlers.set(k,f);ipc.removeHandler=k=>handlers.delete(k);
 const screen=new EventEmitter();let point={x:500,y:500};
 screen.getAllDisplays=()=>[{id:2,label:'HiDPI left',scaleFactor:2,bounds:{x:-960,y:0,width:960,height:540}}];
 screen.getPrimaryDisplay=()=>({id:2});screen.getCursorScreenPoint=()=>point;
 let win;
 class Window extends EventEmitter{
  constructor(options){super();win=this;this.bounds=options;this.visible=false;this.ignored=true;this.focusable=options.focusable;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};this.webContents.focus=()=>{};}
  async loadURL(url){this.webContents.mainFrame.url=url;handlers.get('overlay:state')({sender:this.webContents,senderFrame:this.webContents.mainFrame});}
  setAlwaysOnTop(){}setContentProtection(v){this.protected=v;}setIgnoreMouseEvents(v){this.ignored=v;}setVisibleOnAllWorkspaces(){}
  getBounds(){return this.bounds;}setBounds(b){this.bounds=b;}isDestroyed(){return false;}isVisible(){return this.visible;}
  showInactive(){this.visible=true;}show(){this.visible=true;}hide(){this.visible=false;}setFocusable(v){this.focusable=v;}focus(){}destroy(){this.visible=false;}
 }
 const api=createAnnotationOverlay({BrowserWindow:Window,screen,ipcMain:ipc,getServer:()=> 'http://localhost:1234'});
 try{
  await api.execute({operation:'add',display_id:'2',items:[{id:'card',type:'card',x:100,y:100,width:300,height:200,content:{kind:'html',source:'local'}}]});
  assert.equal(win.ignored,true);assert.equal(win.focusable,false);
  await api.execute({operation:'interact',display_id:'2',interactive_id:'card'});
  point={x:-850,y:110};await new Promise(r=>setTimeout(r,35));assert.equal(win.ignored,false,'inside selected DIP rectangle');
  point={x:-950,y:10};await new Promise(r=>setTimeout(r,35));assert.equal(win.ignored,true,'outside card passes through');
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  ipc.emit('overlay:regions',event,[{x:0,y:0,width:50,height:50}]);assert.equal(win.ignored,false,'trusted toolbar hit region');
  ipc.emit('overlay:regions',{...event,senderFrame:{}},[{x:0,y:0,width:960,height:540}]);
  point={x:-300,y:400};await new Promise(r=>setTimeout(r,35));assert.equal(win.ignored,true,'subframe cannot expand hit regions');
  await api.execute({operation:'interact',display_id:'2',interactive_id:null});assert.equal(win.ignored,true);assert.equal(win.focusable,false);
  api.suspendCapture();assert.equal(win.visible,false);api.resumeCapture();assert.equal(win.visible,true);
  api.clearAll();assert.equal(win.visible,false);
 }finally{api.destroy();}
 assert.equal(handlers.size,0);assert.equal(screen.listenerCount('display-metrics-changed'),0);
});
