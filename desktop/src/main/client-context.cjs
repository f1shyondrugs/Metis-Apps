const fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Installation identity only. Never credentials, account names, or tour completion. */
function clientContext(directory){
 const file=path.join(directory,"client-context.json");
 try{if(fs.lstatSync(file).isSymbolicLink())throw Error("Onboarding identity must be a regular file.");const value=JSON.parse(fs.readFileSync(file,"utf8"));if(value?.version===1&&typeof value.installationId==="string"&&UUID.test(value.installationId))return Object.freeze({installationId:value.installationId});}catch(error){if(error.code!=="ENOENT"&&!(error instanceof SyntaxError))throw error;}
 const value={version:1,installationId:randomUUID()};
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const temporary=file+"."+randomUUID()+".tmp";try{fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:"wx"});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch{}}
 return Object.freeze({installationId:value.installationId});
}
module.exports={clientContext};
