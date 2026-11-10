// Key lifecycle only; never records or forwards arbitrary keys.
function createHoldGesture(emit, { delay = 3000, schedule = setTimeout, clear = clearTimeout } = {}) {
  let down = false, locked = false, stopping = false, timer;
  return {
    down() {
      if (down) return;
      down = true;
      if (locked) { locked = false; stopping = true; emit('stop'); return; }
      emit('start');
      timer = schedule(() => { if (down) { locked = true; emit('lock'); } }, delay);
    },
    up() {
      if (!down) return;
      down = false; clear(timer);
      if (!locked && !stopping) emit('stop');
      stopping = false;
    },
    cancel() { down = false; locked = false; stopping = false; clear(timer); },
    get locked() { return locked; },
  };
}
module.exports = { createHoldGesture };
