const crypto=require('node:crypto');
const path=require('node:path');
// Owns only the elevated device host. Never quits/restarts the normal UI.
function createAdminController({launch,createChannel,developmentEntry,parentPid=process.pid,onClosed=()=>{}}){
  let channel,opening,hostPid=null,stopped=false,handler=()=>{};
  function close(error){
    const hadHost=hostPid!==null;hostPid=null;
    if(channel){const current=channel;channel=null;current.close();}
    if(hadHost&&!stopped)onClosed(error||Error('Administrator Remote Client stopped.'));
  }
  async function ensure(){
    if(stopped)throw Error('Desktop app is quitting.');
    if(channel?.connected&&hostPid)return hostPid;
    if(opening)return opening;
    opening=(async()=>{
      const nonce=crypto.randomBytes(16).toString('hex');
      const current=createChannel({server:true,nonce,onMessage:message=>handler(message),onClose:error=>{if(channel===current)close(error);}});
      channel=current;
      try{
        await current.listening;
        const pid=await launch([...(developmentEntry?[developmentEntry]:[]),'--metis-device-host='+nonce+':'+parentPid]);
        if(!Number.isSafeInteger(pid)||pid<2||pid===parentPid)throw Error('Administrator Remote Client was not started.');
        if(stopped)throw Error('Desktop app is quitting.');
        current.expectPeer(pid);
        const connectedPid=await current.ready;
        if(connectedPid!==pid)throw Error('Administrator Remote Client identity mismatch.');
        hostPid=pid;return pid;
      }catch(error){if(channel===current)close();throw error;}
    })();
    try{return await opening;}finally{opening=null;}
  }
  return {
    ensure,
    setHandler(value){handler=value;},
    send(message){channel?.send(message);},
    get pid(){return hostPid;},
    get connected(){return Boolean(channel?.connected&&hostPid);},
    close(){close();},
    shutdown(){stopped=true;if(channel?.connected)channel.send({type:'quit'});setTimeout(()=>close(),300).unref?.();},
  };
}
function attachAdminRuntime(controller,{config,capabilities,onEvent,showNotification,receiveNotification}){
  let stopped=false;
  const session=crypto.randomBytes(16).toString('hex');
  controller.setHandler(async message=>{
    if(stopped||!['event','notification','notification-message'].includes(message.type))return;
    if(message.session!==session){
      if(message.id)controller.send({type:'reply',id:message.id,session:message.session,error:'Device session changed.'});
      return;
    }
    try{
      const value=await (message.type==='event'?onEvent(message.value):message.type==='notification-message'?receiveNotification(message.value):showNotification(message.value));
      if(message.id&&!stopped)controller.send({type:'reply',id:message.id,session,value});
    }catch(error){if(message.id&&!stopped)controller.send({type:'reply',id:message.id,session,error:error.message});}
  });
  controller.send({type:'start',session,config,capabilities});
  return{
    get pid(){return controller.pid;},
    setCapabilities(value){if(!stopped)controller.send({type:'capabilities',session,value});},
    cancelComputerUse(){if(!stopped)controller.send({type:'cancel',session});},
    stop(){if(stopped)return;stopped=true;if(controller.connected)controller.send({type:'stop',session});}
  };
}
module.exports={createAdminController,attachAdminRuntime};
