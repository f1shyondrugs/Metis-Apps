# Metis Apps

Installable Metis AI applications, separated by platform:

| Directory | Application |
| --- | --- |
| [android/](android/) | Existing native Android client, imported unchanged from the Android-App branch |
| [windows/](windows/) | Electron desktop prototype rendering the Metis website, with a Windows installer |

Each directory owns its dependencies, build configuration, tests and documentation. There is no shared root build or dependency installation. Android and Windows releases are independent.

## Windows

Download the installer from [desktop releases](https://github.com/f1shyondrugs/Metis-Apps/releases). The app starts at https://ai.f1shy312.com; use **Metis → Serveradresse ändern** to connect to your own server.

The installer registers **Metis AI** in Windows Installed Apps and creates Start menu and desktop shortcuts. Its app ID is separate from Metis AI Remote Client. This application renders the website; remote device control continues to use the separate Remote Client.

See [Windows build and test instructions](windows/README.md).

## Android

The existing Android source is in [android/](android/). See [Android build instructions](android/README.md). The [Android-App branch](https://github.com/f1shyondrugs/Metis-Apps/tree/Android-App) is retained.

## iPhone

A native iOS client is planned and is not included yet.
