# Metis Desktop

A single Electron app for Windows, macOS Apple Silicon and Linux x64. The app combines the Metis website and the existing device connection.

## Use

The main window opens Metis. **Metis → Change server** selects your server; **Metis → Device settings** (Ctrl/Cmd+Shift+D) opens local device pairing, command history and settings. **Metis → Recent Servers** lists up to ten addresses whose Metis version endpoint and workspace load were verified, with the active server selected. Invalid addresses and failed workspace loads do not enter history. Click one to switch immediately; the same list is available by right-clicking the Windows taskbar icon or the macOS Dock icon. Taskbar and Dock server entries open an additional independent window on that server; the current chat stays untouched. **Metis → New Window** (Ctrl/Cmd+N), **New Window** in the tray/taskbar menu, or launching the app again also opens another window. Each window has its own server, navigation and draft; sign-in remains shared per server. Server choices persist locally across app restarts, and switching does not change device pairing or permissions. Use **Change server** to add another address. The tray offers the app windows and local device settings. Closing an extra app window closes only that window. Closing the last app window hides it while all paired server connections stay available. **Quit** exits the app and disconnects them.

Launching a running app again from its shortcut, the taskbar context-menu app entry, Shift-click or middle-click opens another app window without starting another device connection or requesting UAC again. A normal left-click on a running taskbar icon keeps Windows' standard activation/thumbnail behavior; use New Window or a new launch for an additional window. A fixed, profile-scoped signal only asks the existing process to focus an already visible workspace or restore a hidden one when none is visible. It cannot carry commands or URLs. The elevated primary never writes or interprets that signal file. Starting the app from a fully stopped state may still require the Windows administrator confirmation for an admin-paired device. User-mode devices never elevate.

**Device settings → Servers** shows all paired servers and verified recent Metis addresses. Select a card to show activity for that server, or pairing instructions if it is not paired. Selecting a card does not change any connection. Adding a new origin preserves existing connections; re-pairing replaces only the selected origin’s local registration.

When an update is ready, **Install downloaded update** or Quit hands off to the installer after the device processes exit. The frameless update window explains what is happening and a Windows installer-owned notice stays visible while the app files are replaced. Metis reopens automatically after a successful install. An all-users installation can still require Windows UAC.

Signing into the website does not pair your computer. Pair separately in **Device settings** with the code from Metis Settings → Devices. Pairing does not sign into the website. Each server origin (including its port) has its own saved pairing and background connection. Use **Add server** to connect another server or enter a new code for an existing one. To remove a local pairing, select that server, open **Settings**, and choose **Disconnect**. Other pairings stay connected; manage the server-side device registration separately in Metis. Device permissions remain managed by the paired server and the operating system. On Windows, saved Administrator pairings request UAC in sequence on cold start; cancelling leaves the unapproved pairings paused for manual approval. Standard user pairings reconnect without elevation. Background jobs from different servers can run concurrently, but Computer Use and annotations share the same physical desktop. Microphone approval is remembered per server on this device and shared by the main web window and assistant, including after an app restart. Camera access is a separate approval; operating-system permissions still apply.

For browser-side errors in the desktop app, use **View → Developer Tools** (Ctrl/Cmd+Shift+I) and select **Console**. The shortcut also works in the frameless setup or connection-error window. This inspects only the current window; it does not upload logs or enable remote debugging.

## Desktop Assistant

Press **Ctrl+Shift+Space** once to start recording and again to stop. Releasing or holding the key does not stop or restart the recording. Escape closes the assistant and cancels recording. The tray also offers **Open Desktop Assistant**. Global key listening requires Accessibility on macOS and X11 on Linux; the tray remains available when the hotkey is unavailable.

With voice configured, the overlay stays passive: it does not activate or intercept mouse/keyboard input from your game. **Ctrl+Shift+Enter** enters text mode; press it again to return to the prior app. Without voice, the text field is focused automatically. **Ctrl+Shift+M** opens the same saved chat. Change Talk, Focus text, Open chat, local device settings and Dismiss/stop in **Profile → App settings → Assistant** on updated Metis servers. These preferences are local to this device and survive restarts.

The assistant keeps a white wave-and-dot perimeter while open, including when it is not recording. Microphone volume strengthens the waves smoothly within the narrow outer band. Left-clicks anywhere on the active monitor send a short, bounded wave through that monitor's dots, like the onboarding. The existing global input hook observes the click without intercepting it; the perimeter remains click-through and does not take focus. Click positions are used locally for the animation only, not stored or sent to a server. Reduced-motion settings keep the outline still.

The compact **Ask Metis** field remains available without voice. Submitted user messages and replies appear at the top right and are the actual saved chat messages; the Open button opens that chat in Metis. It uses the signed-in account's **Voice & dictionary** configuration: batch Whisper inserts its completed transcript, and realtime transcription additionally shows live words. Review the text and press Enter or Send. Each send attaches fresh screenshots of **all connected monitors** (up to the existing ten-attachment limit), their names/bounds/scales and the paired device ID. Screen recording failures keep the draft and prevent a partial screen submission. Dismissing the window does not cancel an already submitted server job; **Open in Metis** provides the full chat controls.

Open the bottom-left **profile menu → App settings** to edit this device’s startup, overlay stream visibility and assistant shortcuts, see the connection/version, and check app updates. A dot on your profile and App settings appears only when the native updater reports an available update, including a download that needs retrying. On updated Metis servers, these app-only controls open in a standalone modal with **General**, **Assistant**, and **Connection** sections, separate from regular Metis Settings. Normal browsers do not expose them. Pairing and device history remain available through **Open Remote Client Device Settings**. One saved **Show overlays in streams and recordings** preference applies immediately to the assistant window, voice perimeter and computer-use overlays and survives restarts. It removes capture protection; share the entire display in Discord/OBS because single-window capture cannot include separate overlay windows. Website sign-in and device pairing remain separate; pair this computer and sign in to use the assistant. The server must include the desktop-assistant page.

On Windows, an admin-paired app delegates external file drops to a sandboxed local drop helper at the interactive user’s normal integrity. The existing admin Remote Client keeps running unchanged. The parent verifies the helper’s OS user/session and normal token; the helper never loads credentials or remote commands. Only bytes from the normal-user File API (up to 10 files / 64 MB total), names and a drop point cross an ephemeral named pipe. No privileged path-read API, UAC change, scheduled task, window-message filter or OLE revocation is used. The normal Chromium target remains intact for in-app dragging. The helper appears only over the app’s content during an external mouse drag, shows without activating, and exits with its parent. Files enter the canonical web drop owner under the pointer; larger uploads keep the ordinary Attach files picker.

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

On Windows, an interactive device terminal uses the system pseudoconsole so the configured shell handles editing and Up/Down command history. This does not change pairing permissions or non-interactive commands.

On Linux, a new device terminal uses Bash when the desktop session does not supply `SHELL` and Bash is installed. The terminal then supports Up/Down history. An explicitly configured shell and non-interactive command execution are unchanged.

Linux Electron integration tests need a graphical session, e.g. `xvfb-run -a npm run test:e2e` on CI. Packaged Linux launch preflight refuses root/headless startup and reports missing libraries. Linux Computer Use needs X11, xdotool, wmctrl and ImageMagick.

The Electron suites use temporary data directories and local HTTP/WebSocket fixtures. They exercise server/session persistence, isolation, offline recovery, preserved pairing, separate device process and commands during renderer reload/window closure. They never borrow production credentials. `METIS_DESKTOP_TEST_DATA` selects an isolated local app-data directory for manual testing.

## Releases and compatibility

Tags `v<desktop/package.json version>` build Windows x64 NSIS, macOS ARM64 DMG/ZIP and Linux x64 AppImage. The release is published as Latest only after every platform succeeds. All subsequent update checks use `f1shyondrugs/Metis-Apps`, without pairing headers or tokens.

Keep the existing `ai.metis.remoteclient` installer/bundle identity, internal Electron app name and `MetisAI/RemoteClient` app-data directory. This preserves encrypted credentials, device IDs, local preferences and upgrade registration. The visible product name is Metis. The Windows executable, autostart task and artifact filenames retain their previous technical names for compatibility:
`Metis-AI-Remote-Client-Setup.exe`, `Metis-AI-Remote-Client-arm64.dmg`, `Metis-AI-Remote-Client-arm64.zip`, `Metis-AI-Remote-Client-x86_64.AppImage`.

A final transition release in the old remote-client repository can mirror these exact binaries and updater metadata; it must only be published after the canonical Metis-Apps release succeeds. Old clients first discover that bridge at their old feed, then the installed unified app uses Metis-Apps. The old repository must not be archived until that transition has been verified. No live client or headless installation is stopped by the migration.

The former web-only Windows prototype had a separate installer ID and browser profile. It is not silently uninstalled; website sign-in may be required again. Existing remote-client installs retain pairing. macOS may request OS permissions again after the visible bundle changes to Metis.app. Unsigned builds remain unsigned; verify the source before removing a quarantine flag.
