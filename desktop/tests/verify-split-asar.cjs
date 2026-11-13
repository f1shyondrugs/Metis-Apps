const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar'),archive=process.argv[2];
if(!archive||!path.isAbsolute(archive))throw Error('Installed test ASAR is required.');
const normalize=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const files=['bootstrap.cjs','main.cjs','src/main/normal-user-process.cjs','src/main/reopen.cjs','src/main/windows-token-identity.cjs','src/device/admin-controller.cjs','src/device/admin-host.cjs','src/device/windows-channel.cjs','src/device/windows-pipe-worker.cjs','src/device/pipe-protocol.cjs','src/device/runtime.cjs','src/device/runtime-host.cjs'];
for(const file of files){
 const shipped=normalize(asar.extractFile(archive,path.normalize(file))),source=normalize(fs.readFileSync(path.join(__dirname,'..',file)));
 assert.equal(crypto.createHash('sha256').update(shipped).digest('hex'),crypto.createHash('sha256').update(source).digest('hex'),file);
}
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,require('../package.json').version);
console.log('INSTALLED_SPLIT_ADMIN_ASAR_12_SOURCE_HASHES_AND_VERSION_OK');
