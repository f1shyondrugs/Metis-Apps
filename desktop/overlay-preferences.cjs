const fs = require("node:fs");
const path = require("node:path");
const shortcut = require("./cancel-shortcut.cjs");

// Local presentation preferences survive disconnecting or re-pairing a device.
function createOverlayPreferences(file) {
  let state = { hideOverlayFromCapture: true, cancelShortcut: "Escape" };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof saved?.hideOverlayFromCapture === "boolean") state.hideOverlayFromCapture = saved.hideOverlayFromCapture;
    try { state.cancelShortcut = shortcut.normalize(saved?.cancelShortcut); } catch { /* Migrate old or invalid settings to Escape. */ }
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
    set(value) {
      if (typeof value !== "boolean") throw new TypeError("Capture visibility must be a boolean");
      save({hideOverlayFromCapture:value});
      return value;
    },
    setCancelShortcut(value) {
      const next = shortcut.normalize(value);
      save({cancelShortcut:next});
      return next;
    },
  };
}
module.exports = { createOverlayPreferences };
