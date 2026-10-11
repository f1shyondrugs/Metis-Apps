# Metis for Android

Native Android client for a self-hosted Metis server. Android views call the existing authenticated APIs directly; the app contains no WebView and runs no separate backend. Enter the server URL on first launch, then sign in with your Metis account.

The mobile layout uses Metis' Geist and GFS Didot fonts, dark surfaces, Lucide icons, a swipeable sidebar, project filters and composer. Version 1.4.0 adds:

- Horizontal gestures to open/close the sidebar and switch from a chat to its workspace, with animated drawer transitions.
- Native OpenAI Realtime transcription over WebRTC using a short-lived credential from `/api/voice/realtime`. Live transcript stays in the draft until the user stops; cancel discards it. Other configured voice providers keep using `/api/voice/transcribe` or Android speech recognition.
- Shared browser controls for URL/search, back/forward/reload, per-chat history, click/scroll and typing into the focused page. Actions use `/api/browser`; the current page is rendered from the server screenshot after each action.
- Global memory list/create/edit/delete and skill list/toggle screens backed by `/api/memories` and `/api/skills`.
- Native interactive graph blocks: functions, sliders, points, lines, circles and labels; drag/pinch navigation and reset. Graph and chart JSON fences render inside messages and workspace previews. Charts support bar, line, area, pie, donut and scatter with tap inspection.
- Expanded tool details with selectable input, output, errors and copy actions; before/after file views use stored tool snapshots or `/api/chats/:id/tool-diff`. Chat logs can be loaded, filtered and inspected.

Existing features include chat creation/history/streaming/cancellation, model and agent-mode selection, title/message search, pin/archive/rename/delete/move, projects, shared notes, automation overview, workspace editing with version checks, questions, approval decisions, context/quota display and sharing. Context uses a marked estimate when server telemetry is unavailable. This is still not complete web parity: live streamed browser frames/tabs, remote-client and account/admin management, advanced graph/chart editing, and full automation editing are outstanding.

## Build

Use JDK 17, Android SDK Platform 35 and Gradle 8.9:

```sh
cd android
ANDROID_HOME=/path/to/android-sdk gradle assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Open this directory in Android Studio to build there. Debug signing is for direct testing; distribution needs a release key.

Source asset bundles in `assets/*.b64` are decoded by Gradle into generated resources. Keep the text bundles in source control; do not commit caches or APKs.

## Verification

```sh
ANDROID_HOME=/path/to/android-sdk gradle connectedDebugAndroidTest
```

Ten offline fixture tests exercise graph parameters/fallback, all chart types, settings PATCH preservation and Realtime-model validation, microphone upload formatting, transcript event handling, WebRTC engine initialization, swipe navigation, browser controls, memory/skill rendering, and tool input/output/diff views. One optional live API test reads preferences/models/providers/logs/memories/skills, confirms chat logs, and sends an empty preferences PATCH that preserves the current settings. Run it with `-e liveServer true` on an emulator signed into a test account containing the earlier `Native-Parity-OK` chat.

Verified on Pixel 7 / Android 15: 11 instrumentation tests passed. Realtime WebRTC native engine and transcript events were exercised, but a real OpenAI session/voice exchange was not. Approval/sharing/workspace mutations and provider credential changes were not exercised against live account data. The universal debug APK is larger because it includes WebRTC native libraries for device ABIs. Test screenshots are evidence artifacts, not bundled in the APK.

## Licenses

Geist and GFS Didot: SIL Open Font License, notices in `assets/fonts`. Lucide: ISC, `assets/lucide-LICENSE.txt`. Expression evaluation uses exp4j 0.4.8 (Apache-2.0). Markdown uses Markwon 4.6.2 (Apache-2.0).
