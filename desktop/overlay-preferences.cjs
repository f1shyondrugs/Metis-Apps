const fs = require("node:fs");
const path = require("node:path");
const shortcut = require("./cancel-shortcut.cjs");
const assistantShortcuts = require("./assistant-shortcuts.cjs");

// Local presentation preferences survive disconnecting or re-pairing a device.
function createOverlayPreferences(file) {
  let state = { hideOverlayFromCapture: true, cancelShortcut: "Escape", assistantShortcuts: assistantShortcuts.normalize() };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof saved?.hideOverlayFromCapture === "boolean") state.hideOverlayFromCapture = saved.hideOverlayFromCapture;
    try { state.cancelShortcut = shortcut.normalize(saved?.cancelShortcut); } catch { /* Migrate old or invalid settings to Escape. */ }
    try { state.assistantShortcuts = assistantShortcuts.normalize(saved?.assistantShortcuts, state.cancelShortcut); } catch { state.assistantShortcuts=assistantShortcuts.normalize({},state.cancelShortcut); }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  function save(patch) {
    const next = {...state, ...patch};
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
    state = next;
  }
  return {
    get: () => state.hideOverlayFromCapture,
    getCancelShortcut: () => state.cancelShortcut,
    getAssistantShortcuts: () => ({...state.assistantShortcuts}),
    setAssistantShortcuts(value) {
      const next=assistantShortcuts.normalize(value,state.cancelShortcut);
      save({assistantShortcuts:next,cancelShortcut:next.cancel});
      return {...next};
    },
    set(value) {
      if (typeof value !== "boolean") throw new TypeError("Capture visibility must be a boolean");
      save({hideOverlayFromCapture:value});
      return value;
    },
    setCancelShortcut(value) {
      const next = shortcut.normalize(value);
      const bindings=assistantShortcuts.normalize({...state.assistantShortcuts,cancel:next});
      save({cancelShortcut:next,assistantShortcuts:bindings});
      return next;
    },
  };
}
module.exports = { createOverlayPreferences };
