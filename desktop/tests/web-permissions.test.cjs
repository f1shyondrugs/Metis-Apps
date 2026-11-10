const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createWebPermissionPolicy } = require('../src/main/web-permissions.cjs');
const origin = 'https://metis.example';
function fixture(t, prompt = async () => ({response:1})) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'metis-permissions-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'permissions.json');
  const calls=[];
  const policy=createWebPermissionPolicy({file,prompt:async (...args)=>{calls.push(args);return prompt(...args);}});
  const session={
    setPermissionCheckHandler(fn){this.check=fn;},
    setPermissionRequestHandler(fn){this.request=fn;}
  };
  const window = (server=origin, target=session) => {
    const wc=new EventEmitter();wc.session=target;wc.url=server+'/';wc.getURL=()=>wc.url;wc.isDestroyed=()=>Boolean(wc.destroyed);
    policy.register(wc,server,{});return wc;
  };
  const request=(wc,permission='media',details={mediaTypes:['audio']})=>new Promise(resolve=>wc.session.request(wc,permission,resolve,{requestingUrl:wc.getURL(),isMainFrame:true,...details}));
  return {policy,file,calls,session,window,request};
}
test('one microphone approval covers main, assistant, reload and process restart',async t=>{
  const f=fixture(t),main=f.window(),assistant=f.window();
  assert.equal(f.session.check(main,'media',origin,{mediaType:'audio'}),false);
  assert.equal(await f.request(main),true);
  assert.equal(f.session.check(main,'media',origin,{mediaType:'audio'}),true);
  assert.equal(f.session.check(assistant,'media',origin,{mediaType:'audio'}),true);
  assert.equal(await f.request(assistant),true);
  main.destroyed=true;main.emit('destroyed');
  assert.equal(await f.request(f.window()),true);
  assert.equal(f.calls.length,1);
  const next=createWebPermissionPolicy({file:f.file,prompt:()=>{throw Error('Repeated prompt');}});
  const wc=f.window();next.register(wc,origin,{});
  assert.equal(f.session.check(wc,'media',origin,{mediaType:'audio'}),true);
  assert.equal(await f.request(wc),true);
});
test('audio grants do not authorize camera, another origin, embedded frames or foreign contents',async t=>{
  const f=fixture(t),wc=f.window();
  await f.request(wc);
  assert.equal(f.session.check(wc,'media',origin,{mediaType:'video'}),false);
  assert.equal(f.session.check(wc,'media',origin,{mediaType:'audio',isMainFrame:false}),false);
  assert.equal(await f.request(wc,'media',{mediaTypes:['audio'],requestingUrl:'https://foreign.example'}),false);
  assert.equal(await f.request(wc,'media',{mediaTypes:['audio'],isMainFrame:false}),false);
  assert.equal(await f.request(wc,'media',{mediaTypes:[]}),false);
  assert.equal(await f.request(wc,'media',{mediaTypes:['unknown']}),false);
  assert.equal(await f.request(wc,'geolocation'),false);
  assert.equal(f.session.check(new EventEmitter(),'media',origin,{mediaType:'audio'}),false);
  const other=f.window('https://another.example');
  assert.equal(f.session.check(other,'media','https://another.example',{mediaType:'audio'}),false);
  assert.equal(await f.request(wc,'media',{mediaTypes:['video']}),true);
  assert.equal(f.calls.length,2);
  assert.match(f.calls[1][1].message,/camera/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).microphones,[origin]);
});
test('simultaneous microphone requests share a single consent dialog',async t=>{
  let answer;
  const f=fixture(t,()=>new Promise(resolve=>answer=resolve));
  const a=f.request(f.window()),b=f.request(f.window());
  assert.equal(f.calls.length,1);
  answer({response:1});
  assert.deepEqual(await Promise.all([a,b]),[true,true]);
});
test('denial, navigation and failed persistence never become remembered consent',async t=>{
  const denied=fixture(t,async()=>({response:0})),wc=denied.window();
  assert.equal(await denied.request(wc),false);
  assert.equal(fs.existsSync(denied.file),false);
  let answer;
  const stale=fixture(t,()=>new Promise(resolve=>answer=resolve)),page=stale.window();
  const p=stale.request(page);page.url='https://foreign.example';answer({response:1});
  assert.equal(await p,false);assert.equal(fs.existsSync(stale.file),false);
  const disk=fixture(t);fs.mkdirSync(disk.file);
  assert.equal(await disk.request(disk.window()),false);
  assert.equal(disk.session.check(disk.window(),'media',origin,{mediaType:'audio'}),false);
});
