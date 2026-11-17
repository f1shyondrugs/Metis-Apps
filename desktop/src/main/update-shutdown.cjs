// One asynchronous before-quit gate for both normal Quit and updater handoff.
function createUpdateShutdown({ready,drain,cleanup,install,quit,onError}){
  let started=false,finished=false,completion=Promise.resolve();
  function beforeQuit(event){
    if(finished)return;
    event.preventDefault();
    if(started)return;
    started=true;
    const wantsInstall=ready();
    completion=Promise.resolve().then(()=>drain(wantsInstall)).then(async()=>{
      cleanup();
      // quitAndInstall emits another before-quit; that event must pass through.
      finished=true;
      if(wantsInstall){
        if(!await install())throw Error("The update installer could not be started");
      }else quit();
    }).catch(error=>{finished=false;started=false;onError(error);});
  }
  return{beforeQuit,get completion(){return completion;}};
}
module.exports={createUpdateShutdown};
