const path = require('node:path');
const { Worker } = require('node:worker_threads');
function createChannel({ server, nonce, peerPid, onMessage=()=>{}, onClose=()=>{} }) {
  const worker = new Worker(path.join(__dirname,'windows-pipe-worker.cjs'), {workerData:{server,nonce,peerPid}});
  let connected=false, ended=false, resolveReady, rejectReady, resolveListening, rejectListening;
  const ready = new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const listening = new Promise((resolve,reject)=>{resolveListening=resolve;rejectListening=reject;});
  // A client has no listening event. Attach catches even before its caller awaits.
  ready.catch(()=>{}); listening.catch(()=>{});
  function close(error) {
    if(ended)return;ended=true;connected=false;
    rejectReady(error||Error('Background device channel closed.'));
    rejectListening(error||Error('Background device channel closed.'));
    onClose(error);
  }
  worker.on('message',value=>{
    if(value.type==='listening')resolveListening();
    else if(value.type==='connected'){connected=true;resolveReady(value.pid);}
    else if(value.type==='message')Promise.resolve().then(()=>onMessage(value.message)).catch(error=>{api.close();close(error);});
    else if(value.type==='error')close(Error(value.error));
  });
  worker.once('error',close);
  worker.once('exit',()=>close());
  const api={
    ready,listening,
    expectPeer(pid){worker.postMessage({type:'peer',pid});},
    send(message){if(!connected||ended)throw Error('Background device is not connected.');worker.postMessage({type:'send',message});},
    close(){worker.postMessage({type:'close'});close();},
    get connected(){return connected&&!ended;}
  };
  return api;
}
module.exports={createChannel};
