import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

test("only authenticated heartbeat replies update the desktop theme", () => {
  const instances = [], events = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState=1; this.sent=[]; instances.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState=3; }
  }
  const source = fs.readFileSync(new URL("../desktop/client.mjs",import.meta.url),"utf8")
    .replace(/\r\n/g,"\n").replace(/^#!.*\n/,"").replace(/^import .*;\n/gm,"")
    .replace("export function startRemoteClient","function startRemoteClient")
    .split("if (process.argv[1]")[0]
    .replaceAll("import.meta.url",JSON.stringify(new URL("../desktop/client.mjs",import.meta.url).href));
  const context = vm.createContext({fs:{appendFileSync(){}},os,path,process,console,promisify,execFile,
    WebSocket:Socket,createNotificationReceiver:()=>()=>{},setTimeout,clearTimeout,setInterval,clearInterval,
    URL,AbortController,Buffer});
  const start = vm.runInContext(source+";startRemoteClient",context);
  const runtime = start({config:{server:"https://fixture.invalid",clientId:"fixture",credential:"synthetic"},
    configPath:"/tmp/synthetic-config",onEvent:event=>events.push(event)});
  const socket=instances[0];
  const reply = msg => socket.emit("message",JSON.stringify(msg));
  const appearance={version:1,mode:"light",variables:{"--primary":"#685139"}};
  try {
    reply({type:"heartbeat_ack",appearance});
    assert.equal(events.some(event=>event.type==="appearance"),false);
    socket.emit("open");
    reply({type:"authenticated",clientId:"fixture"});
    assert.equal(socket.sent.find(msg=>msg.type==="heartbeat").appearance,true);
    reply({type:"heartbeat_ack",appearance});
    assert.deepEqual(JSON.parse(JSON.stringify(events.find(event=>event.type==="appearance").appearance)),appearance);
    reply({type:"heartbeat_ack"});
    assert.equal(events.filter(event=>event.type==="appearance").length,1);
  } finally {runtime.stop();}
});
