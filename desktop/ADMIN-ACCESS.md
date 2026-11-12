# Windows administrator access

Windows elevation and the pairing grant are independent. An existing normal Metis process cannot gain a new token when a second shortcut is launched with Run as administrator.

Open **Remote Client Device Settings → Restart as administrator** and confirm Windows UAC. Cancelling keeps the normal app and saved pairing unchanged. After approval, the fixed Metis executable waits for the old process to exit, without killing it or forwarding a command, server URL or pairing code. Normal reopens never request UAC.

An elevated app with a saved **User access** pairing keeps that credential but pauses the device connection. Create an **Administrator access** pairing code in Metis → Settings → Devices and enter it locally. No grant is upgraded automatically; choosing User access again requires quitting from the tray and starting normally.

Device Settings shows both the main Windows process and the device-host token. The utility process independently verifies its actual token before connecting; a mismatch fails closed. The local restart IPC is restricted to the exact local main frame. The existing fixed show-window signal, background-close behavior, autostart choices and global UAC settings stay unchanged.

Tests: admin-restart.test.cjs, device-elevation.test.cjs, reopen.test.cjs, file-drop.test.cjs, and unified.cjs (including actual Windows main/device token agreement and foreign-frame rejection). Consent cancellation is simulated in unit tests; a real user's secure-desktop confirmation is never automated.
