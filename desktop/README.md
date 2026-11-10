# Metis Desktop

A single Electron app for Windows, macOS Apple Silicon and Linux x64. The app combines the Metis website and the existing device connection.

## Use

The main window opens Metis. **Metis → Change server** selects your server; **Metis → Device settings** (Ctrl/Cmd+Shift+D) opens local device pairing, command history and settings. The tray offers both windows. Closing windows hides them while the connection remains available. **Quit** exits the app and disconnects the device.

Signing into the website does not pair your computer. Pair separately in **Device settings** with the code from Metis Settings → Devices. Pairing does not sign into the website. Device permissions remain managed by the server and the operating system. Microphone approval is remembered per server on this device and shared by the main web window and assistant, including after an app restart. Camera access is a separate approval; operating-system permissions still apply.

## Desktop Assistant

Hold **Ctrl+Shift+Space** to record. Release before three seconds to finish, or keep holding for three seconds to lock; press the shortcut again or use Stop to finish a locked recording. Escape closes the assistant and cancels recording. The tray also offers **Open Desktop Assistant**. Global key listening requires Accessibility on macOS and X11 on Linux; the tray remains available when the hotkey is unavailable.

With voice configured, the overlay stays passive: it does not activate or intercept mouse/keyboard input from your game. **Ctrl+Shift+Enter** enters text mode; press it again to return to the prior app. Without voice, the text field is focused automatically. **Ctrl+Shift+M** opens the same saved chat. Change Talk, Focus text, Open chat, local device settings and Dismiss/stop in **Settings → Remote Client → Keyboard shortcuts**. These preferences are local to this device and survive restarts.

The assistant keeps a white wave-and-dot perimeter while open, including when it is not recording. Microphone volume strengthens the waves smoothly within the narrow outer band; reduced-motion settings keep the outline still.

The compact **Ask Metis** field remains available without voice. Submitted user messages and replies appear at the top right and are the actual saved chat messages; the Open button opens that chat in Metis. It uses the signed-in account's **Voice & dictionary** configuration: batch Whisper inserts its completed transcript, and realtime transcription additionally shows live words. Review the text and press Enter or Send. Each send attaches fresh screenshots of **all connected monitors** (up to the existing ten-attachment limit), their names/bounds/scales and the paired device ID. Screen recording failures keep the draft and prevent a partial screen submission. Dismissing the window does not cancel an already submitted server job; **Open in Metis** provides the full chat controls.

Inside the desktop app, **Settings → Remote Client** shows the local connection, app version, assistant shortcut and **Open Remote Client Device Settings**. The extra category is hidden in normal browsers. Website sign-in and device pairing remain separate; pair this computer and sign in to use the assistant. The server must include the desktop-assistant page.

## Layout

- `main.cjs`: app lifecycle, local device settings, tray, startup and updates.
- `src/main/`: sandboxed web window and its narrowly scoped local preload.
- `src/device/`: existing protocol client and a separate Electron utility process; private IPC coordinates overlay capture and native notifications with the main process.
- `src/native/`: Windows/macOS/Linux desktop implementation and macOS library source.
- `ui/`: server selection, loading and connection error views.
- `tests/` and repository `tests/`: Electron integration and device regression suites.

`prepare-client.cjs` stages protocol/native sources in the packaged app root and compiles the macOS native library. Generated files are ignored. The remote web view has no Node integration. Its narrow preload exposes `metisApp.openDeviceSettings()`, read-only `deviceState()` and `openAssistant()` for the local settings category. The assistant has its own preload and IPC sender/path guards, sharing the web session without exposing credentials or arbitrary device commands. The main process accepts this action only from the current web view's main frame on the configured server origin. Device commands, pairing credentials and the full device IPC remain exclusive to the exact bundled local main frame.

The desktop application icon uses the M outline in `../assets/metis-mark.svg`. Run `npm run generate:icons` to produce its PNG and Windows ICO. CI regenerates these icons before packaging. The local device window, server-selection view and tray retain the original hands branding from `assets/brand.png`.

## Build and test

For a visible Windows focus regression, bundle the server’s `tests/desktop-assistant-native.browser.tsx` with its CSS/fonts, set `METIS_ASSISTANT_UI` to that asset directory, and run `electron tests/assistant-passive-windows.cjs`. It observes the real foreground HWND, checks native NoActivate/click-through flags, sends test keys only into its own window, and sends screenshot bytes only to loopback. Set `METIS_OVERLAY_PREVIEW_ONLY=1` for a frame-only preview without key injection; it also checks the narrow wave contour.


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
