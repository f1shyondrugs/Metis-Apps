const fs = require('node:fs');
const path = require('node:path');
const SAFE_CODES = new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENETUNREACH','EACCES','EPERM','ENOSPC','ERR_UPDATER_INVALID_SIGNATURE','ERR_UPDATER_CHECKSUM_MISMATCH']);
function errorCode(error) {
  if (SAFE_CODES.has(error?.code)) return error.code;
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? 'HTTP_' + status : 'UPDATE_FAILED';
}
function transient(error) { return ['ENOTFOUND','EAI_AGAIN','ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENETUNREACH'].includes(error?.code) || [408,429,500,502,503,504].includes(Number(error?.statusCode || error?.status)); }
function createUpdateController({ updater, state, version, platform=process.platform, arch=process.arch, diagnosticsFile, changed=()=>{}, ready=()=>{}, beforeInstall=async()=>{}, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }) {
  let checking, downloading, installing=false, disposed=false;
  const records = [];
  if(diagnosticsFile)try{
    if(fs.statSync(diagnosticsFile).size<=64000){
      const old=JSON.parse(fs.readFileSync(diagnosticsFile,'utf8'));
      for(const entry of (Array.isArray(old.events)?old.events:[]).slice(-50)){
        if(typeof entry.time!=='string'||!/^\d{4}-\d\d-\d\dT/.test(entry.time)||typeof entry.event!=='string'||!/^[a-z-]{1,40}$/.test(entry.event))continue;
        const value={time:entry.time.slice(0,30),event:entry.event};
        if(SAFE_CODES.has(entry.code)||/^HTTP_[45]\d\d$/.test(entry.code))value.code=entry.code;
        if(Number.isInteger(entry.attempt)&&entry.attempt>=1&&entry.attempt<=3)value.attempt=entry.attempt;
        records.push(value);
      }
    }
  }catch{}
  // Persist ONLY allowlisted metadata, never raw errors, URLs, headers, paths or config.
  function record(event, extra={}) {
    records.push({ time:new Date().toISOString(), event, ...extra });
    if (records.length > 100) records.shift();
    if (diagnosticsFile) try {
      fs.mkdirSync(path.dirname(diagnosticsFile),{recursive:true});
      const temporary=diagnosticsFile+'.tmp';
      fs.writeFileSync(temporary,JSON.stringify(report(),null,2),{mode:0o600});
      fs.renameSync(temporary,diagnosticsFile);
    } catch {}
  }
  function report() { return { schemaVersion:1, appVersion:version, platform, arch, phase:state.value.phase, targetVersion:state.value.version, events:records.slice() }; }
  const publish = () => changed();
  function failure(error) { const code=errorCode(error);state.error({message:'Update failed ('+code+'). Retry or export update diagnostics.'});record('error',{code});publish(); }
  async function download() {
    if (downloading) return downloading;
    downloading = (async()=>{
      for (let attempt=1;attempt<=3 && !disposed;attempt++) {
        state.value.phase='downloading';state.value.message='Downloading update';publish();
        record('download-start',{attempt});
        try { await updater.downloadUpdate(); return; }
        catch(error) {
          if (!transient(error) || attempt===3) { failure(error);return; }
          record('download-retry',{attempt,code:errorCode(error)});
          state.value.phase='retrying';state.value.message='Download interrupted; retrying ('+attempt+'/2)…';publish();
          await sleep(attempt*2000);
        }
      }
    })().finally(()=>{downloading=undefined;});
    return downloading;
  }
  const listeners = {
    'update-available':info=>{
      const safeInfo={version:/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(info?.version)?info.version:''};
      state.available(safeInfo);record('available');publish();void download();
    },
    'update-not-available':()=>{if(!downloading && state.value.phase!=='ready'){state.current();record('current');publish();}},
    'update-downloaded':info=>{state.ready({version:/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(info?.version)?info.version:state.value.version});record('downloaded');publish();ready();},
    'download-progress':info=>{const value=Math.floor(Number(info?.percent));if(Number.isFinite(value)&&value!==state.value.progress){state.value.progress=Math.max(0,Math.min(100,value));publish();}},
    // downloadUpdate/checkForUpdates promises own errors; this listener prevents
    // unhandled EventEmitter errors without initiating duplicate retries.
    error:error=>{record('updater-error',{code:errorCode(error)});},
  };
  updater.autoDownload=false;
  // Updates install through the drained before-quit flow, never a hidden early hook.
  updater.autoInstallOnAppQuit=false;
  updater.allowDowngrade=false;
  updater.allowPrerelease=false;
  for(const [event,listener] of Object.entries(listeners))updater.on(event,listener);
  function check() {
    if(disposed)return Promise.resolve();
    if(checking)return checking;
    if(downloading)return downloading;
    if(state.value.phase==='ready' || installing)return Promise.resolve();
    state.checking();record('check');publish();
    checking=Promise.resolve().then(()=>updater.checkForUpdates()).catch(failure).finally(()=>{checking=undefined;});
    return checking;
  }
  async function install() {
    if(installing || state.value.phase!=='ready')return false;
    installing=true;record('install-request');
    try {
      await beforeInstall();
      if(disposed)return false;
      // electron-updater 6 API: explicit normal installer, restart afterwards.
      updater.quitAndInstall(false,true);
      return true;
    } catch(error) {installing=false;failure(error);return false;}
  }
  record('started');
  return { check, install, report, get ready(){return state.value.phase==='ready';}, dispose(){disposed=true;for(const [event,listener] of Object.entries(listeners))updater.removeListener(event,listener);} };
}
async function waitForProcessExit(pids,{timeout=10000,isAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=="ESRCH";}},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const pending=[...new Set(pids.filter(pid=>Number.isSafeInteger(pid)&&pid>0&&pid!==process.pid))];
  const deadline=Date.now()+timeout;
  while(pending.some(isAlive)){
    if(Date.now()>=deadline)throw Object.assign(new Error("Device processes did not stop"),{code:"ETIMEDOUT"});
    await sleep(50);
  }
}
module.exports={createUpdateController,errorCode,transient,waitForProcessExit};
