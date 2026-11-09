import test from "node:test";
import assert from "node:assert/strict";
import history from "../desktop/command-history.cjs";
const audit=Array.from({length:27},(_,i)=>({id:String(i+1),clientId:"device-a",action:"execute_command",requestData:{command:"Echo task "+(i+1)},status:i%2?"completed":"error"}));
test("history shows at most ten entries and retains the full audit for later pages",()=>{
 const before=JSON.stringify(audit);
 const first=history.page(audit,{clientId:"device-a"}),second=history.page(audit,{clientId:"device-a",page:2}),last=history.page(audit,{clientId:"device-a",page:3});
 assert.deepEqual(first.items.map(x=>x.id),["1","2","3","4","5","6","7","8","9","10"]);
 assert.equal(second.items.length,10);assert.equal(second.from,11);assert.equal(second.to,20);
 assert.equal(last.items.length,7);assert.equal(last.from,21);assert.equal(last.to,27);assert.equal(last.pageCount,3);
 assert.equal(new Set([...first.items,...second.items,...last.items].map(x=>x.id)).size,27);
 assert.equal(JSON.stringify(audit),before);
});
test("client scope and search/status filters apply before pagination",()=>{
 const rows=[{...audit[0],id:"foreign",clientId:"other"},...audit];
 const page=history.page(rows,{clientId:"device-a",search:" echo TASK ",status:"completed",page:2});
 assert.equal(page.total,13);assert.equal(page.items.length,3);assert.ok(page.items.every(x=>x.clientId==="device-a"&&x.status==="completed"));
 assert.equal(history.page(rows,{clientId:"missing"}).total,0);
 assert.equal(history.page(rows,{}).total,0);
});
test("shrinking results and invalid page numbers clamp to an existing page",()=>{
 assert.equal(history.page(audit,{clientId:"device-a",page:100}).page,3);
 assert.equal(history.page(audit,{clientId:"device-a",page:-1}).page,1);
 assert.equal(history.page(audit,{clientId:"device-a",page:NaN}).page,1);
 const filtered=history.page(audit,{clientId:"device-a",search:"no match",page:3});
 assert.deepEqual([filtered.page,filtered.pageCount,filtered.total,filtered.from,filtered.to],[1,1,0,0,0]);
 assert.equal(history.page(audit.slice(0,10),{clientId:"device-a",page:2}).pageCount,1);
});
