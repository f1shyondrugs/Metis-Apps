// Exercise the packaged device dispatch against a real shell, with no live account/device.
const assert = require("node:assert/strict"), fs = require("node:fs");
const os = require("node:os"), path = require("node:path");
const { once } = require("node:events"), { pathToFileURL } = require("node:url");
const { WebSocketServer } = require("ws");
const asar = require("@electron/asar");
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const mac=process.env.METIS_TEST_MAC_HISTORY==="1";
  assert.equal(process.platform,mac?"darwin":"linux");
  assert.notEqual(process.getuid(),0,"Use an unprivileged native test runner");
  if(mac){assert.equal(process.arch,"arm64");assert.equal(process.env.SHELL,"/bin/zsh");}
  else assert.ok(!process.env.SHELL&&!process.env.TERM,"Test a GUI-like environment without shell or TERM hints");
  assert.ok(path.isAbsolute(process.argv[2] || ""), "An exact packaged ASAR is required");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-linux-terminal-"));
  process.env.HOME = dir;
  process.env.HISTFILE = "/dev/null";
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.symlinkSync(path.dirname(require.resolve("ws/package.json")), path.join(dir, "node_modules/ws"), "dir");
  if(mac){
    // Load the exact physically installed module and spawn-helper, not a
    // source fixture or dependency from the runner's checkout.
    const dependency=path.join(process.argv[2]+".unpacked","node_modules","node-pty");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dependency,"package.json"),"utf8")).version,"1.1.0");
    fs.symlinkSync(dependency,path.join(dir,"node_modules","node-pty"),"dir");
  }
  for (const name of ["client.mjs", "notification-client.mjs"]) {
    const bytes = asar.extractFile(process.argv[2], name);
    assert.deepEqual(bytes, fs.readFileSync(path.join(__dirname, "../src/device", name)));
    fs.writeFileSync(path.join(dir,name),bytes);
  }
  const { startRemoteClient } = await import(pathToFileURL(path.join(dir,"client.mjs")));
  const server = new WebSocketServer({host:"127.0.0.1",port:0,path:"/ws/remote-client"});
  await once(server,"listening");
  let client,socket,output="",sequence=0,sessionId,exited=false;
  const waiting = new Map();
  const waitFor = async (condition,label) => {
    for (let count=0;count<120;count++) { if(condition())return;await delay(25); }
    throw Error("Timed out: "+label+" "+JSON.stringify(output.slice(-800)));
  };
  const matches = (id) => output.split("\n").filter(line => line.trimEnd().endsWith("TERM_FIXTURE_"+id)).length;
  try {
    const linked = once(server,"connection");
    client=startRemoteClient({config:{server:"http://127.0.0.1:"+server.address().port,clientId:"fixture",credential:"fixture-only"},
      configPath:path.join(dir,"synthetic.json"),logEvent:()=>{}});
    [socket]=await linked;
    const authenticated = once(socket,"message");
    const [bytes] = await authenticated;
    assert.deepEqual(JSON.parse(String(bytes)),{type:"auth",clientId:"fixture",credential:"fixture-only"});
    socket.on("message",raw=>{
      const msg=JSON.parse(String(raw));
      if(msg.type==="event"&&typeof msg.data==="string")output+=msg.data;
      if(msg.type==="event"&&msg.event==="exit")exited=true;
      if(msg.type==="response")waiting.get(msg.requestId)?.(msg);
    });
    socket.send(JSON.stringify({type:"authenticated",clientId:"fixture"}));
    const send = async(action,params)=>{
      const requestId=String(++sequence);
      let deadline;
      try{
        const answer=await new Promise((resolve,reject)=>{
          waiting.set(requestId,resolve);deadline=setTimeout(()=>reject(Error(action+" timed out")),3000);
          socket.send(JSON.stringify({type:"request",requestId,action,params}));
        });
        assert.equal(answer.ok,true,JSON.stringify(answer));
        return answer.result;
      }finally{clearTimeout(deadline);waiting.delete(requestId);}
    };
    ({sessionId}=await send("pty_open",{cwd:dir}));
    const input=(data)=>send("pty_input",{sessionId,data});
    const enter=mac?"\r":"\n";
    await input("printf '%s%s\\n' 'TERM_FIXTURE_' 'ALPHA'"+enter);
    await waitFor(()=>matches("ALPHA")===1,"first command");
    await input("printf '%s%s\\n' 'TERM_FIXTURE_' 'BRAVO'"+enter);
    await waitFor(()=>matches("BRAVO")===1,"second command");
    for(const key of ["\x1b[A","\x1b[A","\x1b[B",enter])await input(key);
    await waitFor(()=>matches("BRAVO")===2,"history up/up/down recalls second command");
    assert.equal(matches("ALPHA"),1);
    await input("exit"+enter);
    await waitFor(()=>exited,"fixture shell exit");
    console.log(mac?"MET96_PACKAGED_MAC_ARM64_ZSH_HISTORY_AND_EXIT_OK":"MET96_PACKAGED_LINUX_HISTORY_WITHOUT_SHELL_OR_TERM_OK");
  } finally{
    client?.stop();socket?.terminate();server.close();
  }
}
const deadline=setTimeout(()=>{console.error("Terminal-history fixture timed out");process.exit(1)},15000);
run().then(()=>clearTimeout(deadline),error=>{console.error(error);process.exit(1)});
