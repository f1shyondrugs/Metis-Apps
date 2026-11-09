const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function linuxAutostartPath() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "metis-ai-remote-client.desktop");
}
function getDesktopAutostart(app) {
  if (process.platform === "darwin") return app.getLoginItemSettings().openAtLogin;
  if (process.platform === "linux") return fs.existsSync(linuxAutostartPath());
  return false;
}
function setDesktopAutostart(app, enabled) {
  if (process.platform === "darwin") app.setLoginItemSettings({ openAtLogin: enabled });
  else if (process.platform === "linux") {
    const file = linuxAutostartPath();
    if (!enabled) fs.rmSync(file, { force: true });
    else {
      const executable = process.env.APPIMAGE || process.execPath;
      if (!app.isPackaged || !path.isAbsolute(executable) || /[\r\n]/.test(executable))
        throw new Error("Start at login requires an installed desktop app.");
      // Desktop Entry Exec quoting, including literal field-code percent signs.
      const quoted = '"' + executable.replace(/[%\\"$`]/g, c => c === "%" ? "%%" : "\\" + c) + '"';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "[Desktop Entry]\nType=Application\nName=Metis AI Remote Client\nExec=" + quoted +
        "\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", { mode: 0o600 });
    }
  }
  return getDesktopAutostart(app);
}
function credentialStorageAvailable(safeStorage) {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}
module.exports = { getDesktopAutostart, setDesktopAutostart, credentialStorageAvailable };
