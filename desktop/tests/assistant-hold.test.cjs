const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHoldGesture}=require('../src/main/assistant-hold.cjs');
function setup(){const events=[];let fire;const gesture=createHoldGesture(value=>events.push(value),{schedule:fn=>{fire=fn;return 1;},clear:()=>{fire=null;}});return {gesture,events,lock:()=>fire?.()};}
test('release stops a short hold and repeated keydown does not restart',()=>{const {gesture,events}=setup();gesture.down();gesture.down();gesture.up();assert.deepEqual(events,['start','stop']);});
test('three-second hold locks, release preserves capture, next press stops',()=>{const {gesture,events,lock}=setup();gesture.down();lock();gesture.up();assert.equal(gesture.locked,true);gesture.down();gesture.up();assert.deepEqual(events,['start','lock','stop']);});
test('completion keeps the held-key latch until physical release',()=>{const {gesture,events}=setup();gesture.down();gesture.finish();gesture.down();gesture.up();assert.deepEqual(events,['start']);gesture.down();assert.deepEqual(events,['start','start']);});
test('cancel removes a pending lock and permits a fresh capture',()=>{const {gesture,events,lock}=setup();gesture.down();gesture.cancel();lock();gesture.up();gesture.down();assert.deepEqual(events,['start','start']);assert.equal(gesture.locked,false);});
