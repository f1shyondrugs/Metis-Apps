// High CI supervisor + genuine Medium Electron client + production High host.
// Only synthetic local HTTP/WebSocket traffic. No owner's UAC, account or data.
if(process.platform!=='win32')process.exit(0);
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {spawn}=require('node:child_process'),{WebSocketServer}=require('ws');
const {launchStandard}=require('./windows-standard-token.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-split-ci-')),electron=require('electron');
const high=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const fixture=http.createServer((_req,res)=>res.end('{}'));
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 const server='http://127.0.0.1:'+fixture.address().port,wss=new WebSocketServer({server:fixture});
 let auth=0,responses=0;
 wss.on('connection',socket=>socket.on('message',raw=>{
  const message=JSON.parse(raw);
  if(message.type==='auth'){assert.equal(message.credential,'synthetic-split-only');auth++;socket.send(JSON.stringify({type:'authenticated',clientId:'split-device'}));}
  if(message.type==='heartbeat')socket.send(JSON.stringify({type:'heartbeat_ack'}));
  if(message.type==='response'){
   assert.equal(message.ok,true);
   if(message.requestId==='info'){responses++;socket.send(JSON.stringify({type:'request',requestId:'overlay',action:'desktop_overlay',params:{operation:'status'}}));}
   else if(message.requestId==='overlay'){assert.equal(message.result.fromMedium,true);responses++;fs.writeFileSync(path.join(root,'server-command-ok'),'ok');}
  }
 }));
 const child=launchStandard(electron,[path.join(__dirname,'split-admin-client.cjs')],{env:{...process.env,METIS_SPLIT_TEST_ROOT:root,METIS_SPLIT_TEST_SERVER:server}});
 const koffi=require('koffi'),kernel=koffi.load('kernel32.dll'),wait=kernel.func('uint32_t WaitForSingleObject(uintptr_t,uint32_t)');
 let launchCount=0,commandSent=false;
 const end=Date.now()+85000;
 try{
  while(Date.now()<end){
   const request=path.join(root,'launch-'+(launchCount+1)+'.json');
   if(fs.existsSync(request)){
    const input=JSON.parse(fs.readFileSync(request));assert.equal(input.parentPid,child.pid);
    assert.equal(input.args.length,2);assert.equal(input.args[0],path.join(__dirname,'../bootstrap.cjs'));
    assert.match(input.args[1],new RegExp('^--metis-device-host=[a-f0-9]{32}:'+child.pid+'$'));
    launchCount++;
    const host=spawn(electron,input.args,{env:{...process.env,METIS_DESKTOP_TEST_DATA:root},stdio:'inherit'});high.push(host);
    fs.writeFileSync(path.join(root,'launched-'+launchCount+'.json'),JSON.stringify({pid:host.pid}));
   }
   if(!commandSent&&fs.existsSync(path.join(root,'client-online.json'))){
    commandSent=true;for(const socket of wss.clients)socket.send(JSON.stringify({type:'request',requestId:'info',action:'get_info',params:{}}));
   }
   if(wait(child.handle,0)===0)break;
   await sleep(20);
  }
  const code=Buffer.alloc(4);kernel.func('bool GetExitCodeProcess(uintptr_t,void *)')(child.handle,code);
  assert.equal(code.readUInt32LE(),0,fs.existsSync(path.join(root,'client-error.txt'))?fs.readFileSync(path.join(root,'client-error.txt'),'utf8'):'Medium client exit');
  assert.equal(auth,1);assert.equal(responses,2);assert.equal(launchCount,1);
  for(const host of high){for(let i=0;i<100&&host.exitCode===null;i++)await sleep(25);assert.equal(host.exitCode,0,'High host must stop when shared desktop quits');}
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'client-result.json'))),{medium:true,deviceHigh:true,oneLaunch:true,overlayRpc:true,hiddenSurvives:true,sharedTray:true});
  console.log('REAL_MEDIUM_UI_HIGH_DEVICE_PIPE_ONE_CONNECTION_AND_SHARED_SHUTDOWN_OK');
 }finally{child.close(child.handle);for(const socket of wss.clients)socket.terminate();wss.close();fixture.close();for(const host of high)if(host.exitCode===null)host.kill();}
}
main().catch(error=>{console.error('SPLIT_WINDOWS_FAILURE',root,error);process.exitCode=1;});
