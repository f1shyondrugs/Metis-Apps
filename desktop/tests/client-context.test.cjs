const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {clientContext}=require("../src/main/client-context.cjs");
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-context-test-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test("installation identity is stable, per OS profile and metadata-only",t=>{
 const a=temp(t),b=temp(t),first=clientContext(a);
 assert.equal(clientContext(a).installationId,first.installationId);assert.notEqual(clientContext(b).installationId,first.installationId);
 assert.deepEqual(Object.keys(first),["installationId"]);assert.ok(Object.isFrozen(first));
 const saved=JSON.parse(fs.readFileSync(path.join(a,"client-context.json")));assert.deepEqual(Object.keys(saved).sort(),["installationId","version"]);
});
test("corrupt/invalid identities recover without touching server or pairing state",t=>{
 const dir=temp(t);fs.writeFileSync(path.join(dir,"server.json"),"existing-server");
 for(const value of ["broken","null",'{"version":1,"installationId":"bad"}']){fs.writeFileSync(path.join(dir,"client-context.json"),value);assert.match(clientContext(dir).installationId,/^[0-9a-f-]{36}$/);}
 assert.equal(fs.readFileSync(path.join(dir,"server.json"),"utf8"),"existing-server");
 assert.ok(!fs.readdirSync(dir).some(f=>f.endsWith(".tmp")));
});
test("identity does not follow a pre-existing symlink",t=>{
 if(process.platform==="win32")return t.skip("Symlink creation depends on Windows host policy");
 const dir=temp(t),target=path.join(dir,"target");fs.writeFileSync(target,"must-not-change");
 fs.symlinkSync(target,path.join(dir,"client-context.json"));assert.throws(()=>clientContext(dir),/regular file/);
 assert.equal(fs.readFileSync(target,"utf8"),"must-not-change");
});
