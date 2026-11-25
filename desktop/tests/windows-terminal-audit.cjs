// Diagnostic for the released standard-user Windows device terminal.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {once}=require("node:events"),{pathToFileURL}=require("node:url");
const {WebSocketServer}=require("ws"),asar=require("@electron/asar");
const {currentTokenIdentity}=require("../src/main/windows-token-identity.cjs");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normalized=bytes=>bytes.toString("utf8").replace(/\r\n/g,"\n");
async function run(){
  assert.equal(process.platform,"win32");
  assert.equal(currentTokenIdentity().elevated,false);
  assert.equal(process.env.METIS_TERMINAL_PROBE_RELEASE,"v1.7.33");
  const dir=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,"met96-terminal-"));
  const archive=path.join(process.env.RUNNER_TEMP,"metis-terminal-install","resources","app.asar");
  assert.equal(JSON.parse(asar.extractFile(archive,"package.json")).version,"1.7.33");
  for(const name of ["client.mjs","notification-client.mjs"]){
    const bytes=asar.extractFile(archive,name);
    assert.equal(normalized(bytes),normalized(fs.readFileSync(path.join(__dirname,"../src/device",name))));
    fs.writeFileSync(path.join(dir,name),bytes);
  }
  fs.mkdirSync(path.join(dir,"node_modules"));
  fs.cpSync(path.dirname(require.resolve("ws/package.json")),path.join(dir,"node_modules","ws"),{recursive:true});
  process.env.ComSpec=path.join(process.env.SystemRoot,"System32","cmd.exe");
  const {startRemoteClient}=await import(pathToFileURL(path.join(dir,"client.mjs")));
  const server=new WebSocketServer({host:"127.0.0.1",port:0,path:"/ws/remote-client"});
  await once(server,"listening");
  let client,socket,output="",serial=0,sessionId,exited=false;
  const pending=new Map();
  const count=id=>output.split(/\r?\n/).filter(l=>l.trim()==="MET96_TERMINAL_"+id).length;
  const waitFor=async(predicate,label)=>{
    for(let i=0;i<140;i++){if(predicate())return;await sleep(25);}
    throw Error(label+"; transcript tail "+JSON.stringify(output.slice(-700)));
  };
  try{
    const connection=once(server,"connection");
    client=startRemoteClient({config:{server:"http://127.0.0.1:"+server.address().port,clientId:"fixture",credential:"fixture-only"},
      configPath:path.join(dir,"synthetic.json"),logEvent:()=>{}});
    [socket]=await connection;
    const [first]=await once(socket,"message");
    assert.deepEqual(JSON.parse(String(first)),{type:"auth",clientId:"fixture",credential:"fixture-only"});
    socket.on("message",raw=>{
      const msg=JSON.parse(String(raw));
      if(msg.type==="response")pending.get(msg.requestId)?.(msg);
      if(msg.type==="event"&&typeof msg.data==="string")output+=msg.data;
      if(msg.type==="event"&&msg.event==="exit")exited=true;
    });
    socket.send(JSON.stringify({type:"authenticated",clientId:"fixture"}));
    const request=async(action,params={})=>{
      const requestId=String(++serial);
      let timeout;
      try{
        const response=await new Promise((resolve,reject)=>{
          pending.set(requestId,resolve);timeout=setTimeout(()=>reject(Error(action+" reply timeout")),3500);
          socket.send(JSON.stringify({type:"request",requestId,action,params}));
        });
        assert.equal(response.ok,true,JSON.stringify(response));
        return response.result;
      }finally{clearTimeout(timeout);pending.delete(requestId);}
    };
    ({sessionId}=await request("pty_open",{cwd:dir}));
    const input=data=>request("pty_input",{sessionId,data});
    for(const id of ["ALPHA","BRAVO"]){
      await input("echo MET96_TERMINAL_"+id+"\r\n");
      await waitFor(()=>count(id)===1,"baseline command "+id);
    }
    for(const key of ["\x1b[A","\x1b[A","\x1b[B","\r\n"])await input(key);
    await input("echo MET96_TERMINAL_BARRIER\r\n");
    await waitFor(()=>count("BARRIER")===1,"output barrier after arrow/Enter");
    const received={alpha:count("ALPHA"),bravo:count("BRAVO"),arrows:["up","up","down"],sameSession:true};
    console.log("MET96_WINDOWS_V133_HISTORY_RESULT",JSON.stringify(received));
    assert.equal(received.alpha,1);
    assert.ok([1,2].includes(received.bravo));
    console.log(received.bravo===1?"MET96_WINDOWS_V133_HISTORY_NOT_RECALLED":"MET96_WINDOWS_V133_HISTORY_ALREADY_WORKS");
    await input("exit\r\n");
    await waitFor(()=>exited,"owned terminal exit");
  }finally{client?.stop();socket?.terminate();server.close();}
}
const deadline=setTimeout(()=>{console.error("Windows terminal audit timed out");process.exit(1)},18000);
run().then(()=>clearTimeout(deadline),error=>{console.error(error);process.exit(1)});
