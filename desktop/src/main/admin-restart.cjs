// Explicit UAC consent only. This role can wait for the old process, never kill it,
// execute a caller-provided command, carry a URL/code, or edit a pairing grant.
const FLAG='--metis-admin-restart-from=';
function parentArgument(argv){
 const args=argv.filter(arg=>arg.startsWith(FLAG));if(!args.length)return null;
 if(args.length!==1||!/^\d{1,10}$/.test(args[0].slice(FLAG.length)))throw Error('Invalid administrator restart.');
 const pid=Number(args[0].slice(FLAG.length));if(!Number.isSafeInteger(pid)||pid<2||pid>0xFFFFFFFF||pid===process.pid)throw Error('Invalid administrator restart.');
 return pid;
}
async function waitForRestartParent({argv=process.argv,platform=process.platform,elevated,alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}){
 const pid=parentArgument(argv);if(pid===null)return;
 if(platform!=='win32'||elevated!==true)throw Error('Windows administrator approval was not confirmed.');
 const deadline=now()+30000;
 while(alive(pid)){if(now()>=deadline)throw Error('The previous Metis process is still running. No process was stopped. Please try again.');await sleep(75);}
}
function createAdminRestart({platform,readElevation,launch,quit,parentPid=process.pid,developmentEntry}){
 let pending;
 return async function request(){
  if(platform!=='win32')throw Error('Administrator restart is available on Windows only.');
  if(readElevation()==='administrator')return {alreadyElevated:true};
  if(readElevation()!=='user')throw Error('Windows administrator status could not be verified.');
  if(pending)return pending;
  const args=[...(developmentEntry?[developmentEntry]:[]),FLAG+parentPid];
  pending=(async()=>{const pid=await launch(args);if(!Number.isSafeInteger(pid)||pid<2||pid===parentPid)throw Error('Could not confirm the administrator launch. Metis is still running.');quit();return {restarting:true};})();
  try{return await pending;}finally{pending=null;}
 };
}
module.exports={FLAG,parentArgument,waitForRestartParent,createAdminRestart};
