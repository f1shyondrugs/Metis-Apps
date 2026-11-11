const {test}=require('node:test'),assert=require('node:assert/strict');
const {createToggleGesture}=require('../src/main/assistant-toggle.cjs');
test('first press starts immediately, release preserves recording and second press stops',()=>{
 const events=[],g=createToggleGesture(v=>events.push(v));
 g.down();assert.deepEqual(events,['start']);g.up();assert.equal(g.active,true);
 g.down();assert.deepEqual(events,['start','stop']);g.up();assert.equal(g.active,false);
});
test('holding or repeated keydowns cannot restart or stop recording',()=>{
 const events=[],g=createToggleGesture(v=>events.push(v));
 g.down();for(let i=0;i<100;i++)g.down();assert.deepEqual(events,['start']);
 g.up();g.down();g.down();assert.deepEqual(events,['start','stop']);
});
test('completion while held retains the physical key latch until release',()=>{
 const events=[],g=createToggleGesture(v=>events.push(v));
 g.down();g.finish();g.down();assert.deepEqual(events,['start']);
 g.up();g.down();assert.deepEqual(events,['start','start']);
});
test('UI-started capture is stopped by the next hotkey and cancel clears both latches',()=>{
 const events=[],g=createToggleGesture(v=>events.push(v));
 g.started();g.down();assert.deepEqual(events,['stop']);g.cancel();g.down();assert.deepEqual(events,['stop','start']);
});
