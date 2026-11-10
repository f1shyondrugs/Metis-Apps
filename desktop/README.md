# Metis Desktop

A single Electron app for Windows, macOS Apple Silicon and Linux x64. The app combines the Metis website and the existing device connection.

## Use

The main window opens Metis. **Metis → Change server** selects your server; **Metis → Device settings** (Ctrl/Cmd+Shift+D) opens local device pairing, command history and settings. The tray offers both windows. Closing windows hides them while the connection remains available. **Quit** exits the app and disconnects the device.

Signing into the website does not pair your computer. Pair separately in **Device settings** with the code from Metis Settings → Devices. Pairing does not sign into the website. Device permissions remain managed by the server and the operating system.

## Layout

- `main.cjs`: app lifecycle, local device settings, tray, startup and updates.
- `src/main/`: sandboxed web window and its narrowly scoped local preload.
- `src/device/`: existing protocol client and a separate Electron utility process; private IPC coordinates overlay capture and native notifications with the main process.
- `src/native/`: Windows/macOS/Linux desktop implementation and macOS library source.
- `ui/`: server selection, loading and connection error views.
- `tests/` and repository `tests/`: Electron integration and device regression suites.

`prepare-client.cjs` stages protocol/native sources in the packaged app root and compiles the macOS native library. Generated files are ignored. The remote web view has no Node integration. Its narrow preload exposes only `metisApp.openDeviceSettings()` so Settings → Devices can open the local device window. The main process accepts this action only from the current web view's main frame on the configured server origin. Device commands, pairing credentials and the full device IPC remain exclusive to the exact bundled local main frame.

The canonical brand outline is `../assets/metis-mark.svg`. Run `npm run generate:icons` to produce the application PNG, Windows ICO and macOS template tray image from that M. CI regenerates icons before packaging.

## Build and test

Use Node.js 22 or newer:

```sh
cd desktop
npm ci
npm run check
npm test
npm run test:e2e
npm run build:win -- --publish never
# Or on the relevant build host:
npm run build:mac -- --publish never
npm run build:linux -- --publish never
```

Linux Electron integration tests need a graphical session, e.g. `xvfb-run -a npm run test:e2e` on CI. Packaged Linux launch preflight refuses root/headless startup and reports missing libraries. Linux Computer Use needs X11, xdotool, wmctrl and ImageMagick.

The Electron suites use temporary data directories and local HTTP/WebSocket fixtures. They exercise server/session persistence, isolation, offline recovery, preserved pairing, separate device process and commands during renderer reload/window closure. They never borrow production credentials. `METIS_DESKTOP_TEST_DATA` selects an isolated local app-data directory for manual testing.

## Releases and compatibility

Tags `v<desktop/package.json version>` build Windows x64 NSIS, macOS ARM64 DMG/ZIP and Linux x64 AppImage. The release is published as Latest only after every platform succeeds. All subsequent update checks use `f1shyondrugs/Metis-Apps`, without pairing headers or tokens.

Keep the existing `ai.metis.remoteclient` installer/bundle identity, internal Electron app name and `MetisAI/RemoteClient` app-data directory. This preserves encrypted credentials, device IDs, local preferences and upgrade registration. The visible product name is Metis. The Windows executable, autostart task and artifact filenames retain their previous technical names for compatibility:
`Metis-AI-Remote-Client-Setup.exe`, `Metis-AI-Remote-Client-arm64.dmg`, `Metis-AI-Remote-Client-arm64.zip`, `Metis-AI-Remote-Client-x86_64.AppImage`.

A final transition release in the old remote-client repository can mirror these exact binaries and updater metadata; it must only be published after the canonical Metis-Apps release succeeds. Old clients first discover that bridge at their old feed, then the installed unified app uses Metis-Apps. The old repository must not be archived until that transition has been verified. No live client or headless installation is stopped by the migration.

The former web-only Windows prototype had a separate installer ID and browser profile. It is not silently uninstalled; website sign-in may be required again. Existing remote-client installs retain pairing. macOS may request OS permissions again after the visible bundle changes to Metis.app. Unsigned builds remain unsigned; verify the source before removing a quarantine flag.
