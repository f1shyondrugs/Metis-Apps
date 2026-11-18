const path = require("node:path");
const { pathToFileURL } = require("node:url");

function createUpdateWindow(BrowserWindow) {
  const file = path.join(__dirname, "../../ui/updating.html");
  const url = pathToFileURL(file).href;
  let win, loaded;
  return {
    get active() { return Boolean(win && !win.isDestroyed()); },
    show(phase = "installing") {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        if (win.isVisible()) win.focus();
        return loaded;
      }
      const current = win = new BrowserWindow({
        title: "Updating Metis", width: 510, height: 348, frame: false, center: true,
        resizable: false, minimizable: true, maximizable: false, fullscreenable: false,
        show: false, backgroundColor: "#000000", autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      current.removeMenu();
      current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      current.webContents.on("will-navigate", event => event.preventDefault());
      current.on("closed", () => { if (win === current) win = undefined; });
      loaded = current.loadURL(url + (phase === "opening" ? "?phase=opening" : "")).then(() => {
        if (!current.isDestroyed()) current.show();
      }).catch(() => { if (!current.isDestroyed()) current.destroy(); });
      return loaded;
    },
    close() { if (win && !win.isDestroyed()) win.destroy(); },
  };
}

module.exports = { createUpdateWindow };
