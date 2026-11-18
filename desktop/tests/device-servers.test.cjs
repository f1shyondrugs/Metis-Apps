const assert=require("node:assert/strict"),test=require("node:test");
const {deviceServerRows}=require("../src/main/device-servers.cjs");
const recent=[
  {url:"https://lab.example/ui"},
  {url:"https://lab.example/other"},
  {url:"https://paired.example:8443/chat"},
  {url:"http://127.0.0.1:8080/"},
  {url:"https://user:secret@bad.example"},
];
test("device settings group by origin and never imply a second pairing",()=>{
  const rows=deviceServerRows(recent,{server:"https://paired.example:8443",credential:"private",clientId:"private"}, {connection:"online"}, "Fixture PC");
  assert.deepEqual(rows.map(({host,status,deviceName})=>[host,status,deviceName]),[
    ["paired.example:8443","online","Fixture PC"], ["lab.example","not-paired",""], ["127.0.0.1:8080","not-paired",""],
  ]);
  assert.equal(rows[0].url,"https://paired.example:8443/chat");
  assert.doesNotMatch(JSON.stringify(rows),/private|secret/);
});
test("keeps an offline registered server visible, even outside recent history",()=>{
  const config={server:"https://other.example"};
  const offline=deviceServerRows([],config,{connection:"offline"},"PC");
  assert.equal(offline[0].status,"offline");
  assert.equal(offline[0].paired,true);
  assert.equal(deviceServerRows([],config,{connection:"online",accessMismatch:true},"PC")[0].status,"paused");
  assert.deepEqual(deviceServerRows([],null,{connection:"online"},"PC"),[]);
});
