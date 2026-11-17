// Fixed Electron suites under the real standard token. Bound each child and
// retain its output so a native startup failure cannot silently stall CI.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
assert.equal(require('../src/main/windows-token-identity.cjs').currentTokenIdentity().elevated,false);
console.log('WINDOWS_E2E_STANDARD_TOKEN_CONFIRMED');
fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
for(const suite of ['update-native','native-modules','recent-servers','multi-windows','smoke','unified','assistant','voice-permissions','annotation-overlay','onboarding','onboarding-reduced']){
 console.log('WINDOWS_SUITE_START',suite);
 const updateTestDir=suite==='update-native'?fs.mkdtempSync(path.join(os.tmpdir(),'metis-update-native-')):null;
 const result=spawnSync(require('electron'),[path.join(__dirname,suite+'.cjs')],{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,env:{...process.env,...(updateTestDir?{METIS_UPDATE_TEST_DIR:updateTestDir}:{})}});
 if(updateTestDir&&!result.error)fs.rmSync(updateTestDir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 const output=(result.stdout||'')+(result.stderr||'');
 fs.writeFileSync(path.join(__dirname,'../test-results/windows-'+suite+'.log'),output);
 process.stdout.write(output);
 assert.equal(result.error,undefined,'Electron '+suite+' failed to finish: '+result.error?.message);
 assert.equal(result.status,0,'Electron '+suite+' exit '+result.status);
}
console.log('WINDOWS_ALL_STANDARD_TOKEN_E2E_OK');
