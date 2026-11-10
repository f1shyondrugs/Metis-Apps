const shortcut = require('./cancel-shortcut.cjs');
const defaults = Object.freeze({
  assistant: 'Control+Shift+Space',
  focusInput: 'Control+Shift+Enter',
  openChat: 'Control+Shift+M',
  deviceSettings: 'Control+Shift+D',
  cancel: 'Escape',
});
function normalize(input = {}, cancel = defaults.cancel) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose valid desktop shortcuts.');
  const result = {};
  for (const key of Object.keys(defaults)) result[key] = shortcut.normalize(input[key] ?? (key === 'cancel' ? cancel : defaults[key]));
  if (new Set(Object.values(result)).size !== Object.keys(result).length) throw new Error('Each desktop shortcut must be different.');
  return result;
}
function matches(binding, event, keys) {
  const parts = binding.split('+'), key = parts.pop();
  const names = {Up:'ArrowUp',Down:'ArrowDown',Left:'ArrowLeft',Right:'ArrowRight'};
  return event.keycode === keys[names[key] || key] &&
    Boolean(event.ctrlKey) === parts.includes('Control') &&
    Boolean(event.altKey) === parts.includes('Alt') &&
    Boolean(event.shiftKey) === parts.includes('Shift') &&
    Boolean(event.metaKey) === parts.includes('Super');
}
function releases(binding, event, keys) {
  const parts = binding.split('+'), key = parts.pop();
  const names = {Up:'ArrowUp',Down:'ArrowDown',Left:'ArrowLeft',Right:'ArrowRight'};
  if (event.keycode === keys[names[key] || key]) return true;
  return parts.includes('Control') && [keys.Ctrl,keys.CtrlRight].includes(event.keycode) && !event.ctrlKey ||
    parts.includes('Shift') && [keys.Shift,keys.ShiftRight].includes(event.keycode) && !event.shiftKey ||
    parts.includes('Alt') && [keys.Alt,keys.AltRight].includes(event.keycode) && !event.altKey ||
    parts.includes('Super') && [keys.Meta,keys.MetaRight].includes(event.keycode) && !event.metaKey;
}
module.exports = { defaults, normalize, matches, releases };
