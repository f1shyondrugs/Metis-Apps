// Key lifecycle only; never records or forwards arbitrary keys.
function createHoldGesture(emit, { delay = 3000, schedule = setTimeout, clear = clearTimeout, now = Date.now } = {}) {
  let down = false, locked = false, stopping = false, timer, startedAt = 0;
  return {
    down() {
      if (down) return;
      down = true;
      if (locked) { locked = false; stopping = true; emit('stop'); return; }
      startedAt=now();
      timer = schedule(() => { if (down && !stopping) { locked = true; emit('lock'); } }, delay);
      emit('start');
    },
    up() {
      if (!down) return;
      down = false; clear(timer);
      // Window creation can delay timer delivery; wall-clock hold duration wins.
      if(!locked && !stopping && now()-startedAt>=delay){locked=true;emit('lock');}
      if (!locked && !stopping) emit('stop');
      stopping = false;
    },
    finish() { locked=false; clear(timer); if(down)stopping=true; },
    cancel() { down = false; locked = false; stopping = false; clear(timer); },
    get locked() { return locked; },
  };
}
module.exports = { createHoldGesture };
