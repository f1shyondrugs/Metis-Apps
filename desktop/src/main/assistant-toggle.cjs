// The physical key latch is independent from the recording lifecycle.
function createToggleGesture(emit) {
  let down = false, active = false;
  return {
    down() {
      if (down) return;
      down = true;
      active = !active;
      emit(active ? 'start' : 'stop');
    },
    up() { down = false; },
    started() { active = true; },
    finish() { active = false; },
    cancel() { active = false; down = false; },
    get active() { return active; }
  };
}
module.exports = { createToggleGesture };
