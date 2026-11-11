const {test}=require('node:test'),assert=require('node:assert/strict');
const {interactionRegions}=require('../src/main/assistant-regions.cjs');
test('interactive panels scale with page zoom and stay bounded by their own window',()=>{
 const regions=interactionRegions({width:1000,height:600,rects:[{x:300,y:530,width:400,height:60}]},{width:1500,height:900});
 assert.deepEqual(regions,[{x:414,y:759,width:672,height:141}]);
});
test('empty layouts leave the desktop passive and malformed frames cannot set a native shape',()=>{
 assert.deepEqual(interactionRegions({width:500,height:500,rects:[]},{width:500,height:500}),[]);
 for(const value of [null,{width:0,height:500,rects:[]},{width:500,height:500,rects:[{x:NaN,y:2,width:4,height:4}]},{width:500,height:500,rects:Array(5).fill({x:0,y:0,width:4,height:4})}])assert.throws(()=>interactionRegions(value,{width:500,height:500}));
});
