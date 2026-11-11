const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOverlayScene,validateItem}=require('../src/main/overlay-scene.cjs');
const d={width:1000,height:800};
const rect=(id,extra={})=>({id,type:'rect',x:10,y:20,width:100,height:80,...extra});
function scene(now){const s=createOverlayScene(now?{now}:{});s.sync([{id:11,bounds:d},{id:22,bounds:d}]);return s;}
test('atomic add/update/replace/remove/group/clear/undo with monitor scoped IDs',()=>{
 const s=scene();s.apply({operation:'add',display_id:'11',items:[rect('a',{group:'g'}),rect('b')]});
 s.apply({operation:'add',display_id:'22',items:[rect('a')]});
 assert.equal(s.state('11').items.length,2);assert.equal(s.state('22').items.length,1);
 assert.throws(()=>s.apply({operation:'add',display_id:'11',items:[rect('c'),rect('a')]}),/exists/);
 assert.equal(s.state('11').items.length,2);
 s.apply({operation:'update',display_id:'11',items:[rect('a',{x:40,group:'g'})]});assert.equal(s.state('11').items[0].x,40);
 s.apply({operation:'remove',display_id:'11',group:'g'});assert.deepEqual(s.state('11').items.map(x=>x.id),['b']);
 s.apply({operation:'undo',display_id:'11'});assert.equal(s.state('11').items.length,2);
 s.apply({operation:'replace',display_id:'11',items:[rect('c')]});assert.deepEqual(s.state('11').items.map(x=>x.id),['c']);
 s.apply({operation:'clear',all:true});assert.ok(s.states().every(x=>!x.items.length));
 s.apply({operation:'undo',display_id:'11'});assert.equal(s.state('11').items[0].id,'c');
 s.reset();s.apply({operation:'undo',display_id:'11'});assert.equal(s.state('11').items.length,0);
});
test('strict geometry, IDs, types, colors, points, payload bounds and no prototype pollution',()=>{
 for(const bad of [rect('__proto__'),rect('constructor'),rect('__proto__',{type:'bad'}),rect('a',{width:2000}),rect('a',{x:NaN}),rect('a',{opacity:2}),rect('a',{color:'url(https://evil)'}),rect('a',{onClick:'alert(1)'})])assert.throws(()=>validateItem(bad,d));
 assert.throws(()=>validateItem(JSON.parse('{"__proto__":{},"id":"x"}'),d));
 assert.throws(()=>validateItem(rect('a',{type:'arrow',points:[{x:1,y:1}]}),d));
 assert.throws(()=>validateItem(rect('a',{type:'spotlight',holes:[{shape:'rect',x:990,y:1,width:100,height:100}]}),d));
 const s=scene();assert.throws(()=>s.apply({operation:'add',display_id:'11',items:Array.from({length:101},(_,i)=>rect('a'+i))}));
 assert.throws(()=>s.apply({operation:'clear',display_id:'invented'}),/actual connected/);
 assert.throws(()=>s.apply({operation:'unknown'}));
});
test('supported card types and file route restrictions',()=>{
 for(const c of [{kind:'markdown',source:'# Example'},{kind:'html',source:'<button>local</button>'},{kind:'graph',spec:{elements:[{type:'function',fn:'sin(x)'}]}},{kind:'chart',spec:{type:'bar',x:['A'],series:[{name:'x',values:[1]}]}},{kind:'file',file:{id:'file-id',name:'Example.png',mimeType:'image/png',url:'/api/file-uploads/file-id/file'}}])assert.equal(validateItem(rect('card',{type:'card',content:c}),d).content.kind,c.kind);
 for(const url of ['https://evil/image.png','file:///etc/passwd','/api/uploads/../../config.json','javascript:alert(1)'])assert.throws(()=>validateItem(rect('card',{type:'card',content:{kind:'file',file:{id:'id',name:'a',mimeType:'image/png',url}}}),d));
});
test('TTL expiry survives undo, clears interaction and cannot resurrect via reset',()=>{
 let t=1000;const s=scene(()=>t);
 s.apply({operation:'add',display_id:'11',items:[rect('card',{type:'card',content:{kind:'html',source:'local'},ttlMs:100})]});
 s.apply({operation:'interact',display_id:'11',interactive_id:'card'});assert.equal(s.state('11').interactiveId,'card');
 t=1101;assert.equal(s.state('11').items.length,0);assert.equal(s.state('11').interactiveId,null);
 s.apply({operation:'undo',display_id:'11'});assert.equal(s.state('11').items.length,0);
 assert.throws(()=>s.apply({operation:'interact',display_id:'11',interactive_id:'absent'}));
});
test('UTF-8 cumulative budgets and empty replacement are atomic',()=>{
 const s=scene(),content={kind:'html',source:'界'.repeat(100000)};
 for(let i=0;i<3;i++)s.apply({operation:'add',display_id:'11',items:[rect('card'+i,{type:'card',content})]});
 assert.throws(()=>s.apply({operation:'add',display_id:'11',items:[rect('card4',{type:'card',content})]}),/limits/);
 assert.equal(s.state('11').items.length,3);
 s.apply({operation:'replace',display_id:'11',items:[]});assert.equal(s.state('11').items.length,0);
});
test('display topology changes discard stale coordinates and history',()=>{
 const s=scene();s.apply({operation:'add',display_id:'11',items:[rect('a')]});
 s.sync([{id:11,bounds:{width:800,height:600}}]);assert.equal(s.state('11').items.length,0);
 s.apply({operation:'undo',display_id:'11'});assert.equal(s.state('11').items.length,0);
 assert.throws(()=>s.state('22'));assert.equal(s.state('11').display.width,800);
});
