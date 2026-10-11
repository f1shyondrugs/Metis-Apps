# Metis AI for Windows

An Electron prototype that renders the existing Metis website in its own native window. No duplicate chat UI or local backend.

## Install

Run `Metis-AI-Setup-0.1.1-x64.exe` from [GitHub Releases](https://github.com/f1shyondrugs/Metis-Apps/releases). Choose the install location in the wizard. Windows gets a **Metis AI** Installed Apps entry, uninstaller, Start menu shortcut and desktop shortcut. App ID: `ai.metis.desktop`, independent of `ai.metis.remoteclient`.

The prototype is unsigned; Windows can show an unknown-publisher warning. It targets Windows 10/11 x64. Automatic desktop updates are not implemented yet; install a newer setup over the existing version. Website changes appear immediately when the page reloads.

## Use

The app opens https://ai.f1shy312.com. Sign in normally. Cookies and browser storage persist in the Electron user-data directory. **Metis → Change server** accepts a custom HTTPS server; localhost HTTP is allowed for development. Offline/server failures show retry and change-server actions.

The remote page runs sandboxed without Node.js, a preload script or a native API bridge. External web links open in the default browser. Microphone/camera and notification access require a native permission prompt. Downloads and uploads use Chromium's normal file handling. Authentication that requires a cross-origin popup/callback is not implemented in this prototype.

## Build

Use Node.js 22 and npm on Windows:

```powershell
cd windows
npm ci
npm run check
npm test
npm run test:e2e
npm start
npm run build:win
```

Output: `dist/Metis-AI-Setup-0.1.1-x64.exe`. Electron and the app are bundled; installed users do not need Node.js.

GitHub Actions builds Windows on a native Windows runner, silently installs the setup in an isolated test directory, verifies Windows registration and both shortcuts, launches the installed app and checks uninstall cleanup before uploading the installer. Tags named `desktop-v0.1.1` publish a desktop prerelease independently of Android.

## Verification

Unit tests cover server validation and navigation boundaries. The Electron smoke test uses an isolated temporary profile and a local HTTP fixture to exercise remote rendering, renderer isolation, resizing, server selection, session persistence and offline recovery. Screenshots go to `test-results/`.

On Linux, the smoke test can run with `xvfb-run -a npm run test:e2e`. A root-only CI environment may need Electron's `--no-sandbox` flag; the installed application does not disable its sandbox.

Android source, dependencies and builds are in `../android/` and are not used by this application.
