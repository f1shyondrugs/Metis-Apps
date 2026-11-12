// Elevated background role only: no window, renderer, tray, URL or CLI command.
// Pairing data comes only from the verified normal desktop process over a
// kernel-authenticated pipe; the remote server's grant remains authoritative.
const path=require('node:path');
const {app,utilityProcess}=require('electron');
const {roleArgument}=require('./pipe-protocol.cjs');
function bootstrap() {
  const {nonce,parentPid}=roleArgument(process.argv);
  let host,channel,stopping=false;
  function stop(){if(stopping)return;stopping=true;host?.stop();channel?.close();app.exit(0);}
  app.setName('Metis Device Connection');
  app.setPath('userData',path.join(app.getPath('appData'),'MetisAI','DeviceHost'));
  app.whenReady().then(()=>{
    if(process.platform!=='win32'||!require('../main/windows-token-identity.cjs').currentTokenIdentity().elevated)
      throw Error('Windows approval was not confirmed.');
    channel=require('./windows-channel.cjs').createChannel({
      server:false,nonce,peerPid:parentPid,onClose:stop,
      async onMessage(message){
        if(message.type==='quit'){stop();return;}
        if(message.type==='start'){
          const config=message.config;
          const {normalizeServer}=require('../../policy.cjs');
          if(!config||config.permissionMode!=='admin'||typeof config.clientId!=='string'||!config.clientId||
            typeof config.credential!=='string'||!config.credential||config.credential.length>8192||
            normalizeServer(config.server).replace(/\/+$/,'')!==config.server)
            throw Error('Invalid Administrator pairing.');
          host?.stop();
          host=require('./runtime.cjs').startDeviceHost({
            utilityProcess,config,
            configPath:path.join(process.env.METIS_DESKTOP_TEST_DATA || path.join(app.getPath('appData'),'MetisAI','RemoteClient'),'config.json'),
            capabilities:message.capabilities, presentationOwned:true,
            receiveNotification:value=>request('notification-message',value),
            onEvent:value=>request('event',value),
            showNotification:value=>request('notification',value)
          });
        }else if(message.type==='capabilities')host?.setCapabilities(message.value);
        else if(message.type==='cancel')host?.cancelComputerUse();
        else if(message.type==='stop'){host?.stop();host=null;}
        else if(message.type==='reply'){
          const pending=requests.get(message.id);if(!pending)return;
          requests.delete(message.id);clearTimeout(pending.timer);
          message.error?pending.reject(Error(message.error)):pending.resolve(message.value);
        }else throw Error('Unsupported background device operation.');
      }
    });
    return channel.ready;
  }).then(()=>channel.send({type:'ready',pid:process.pid,elevation:'administrator'})).catch(stop);
  const requests=new Map();let sequence=0;
  function request(type,value){
    if(!channel?.connected)return Promise.reject(Error('Desktop presentation is disconnected.'));
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{requests.delete(id);reject(Error('Desktop presentation did not acknowledge the device event.'));},10000);
      requests.set(id,{resolve,reject,timer});channel.send({type,id,value});
    });
  }
  app.on('before-quit',()=>{host?.stop();channel?.close();});
  app.on('window-all-closed',()=>{});
}
module.exports={bootstrap};
