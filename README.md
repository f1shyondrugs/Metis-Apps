# Metis Apps

| Directory | Application |
| --- | --- |
| [desktop/](desktop/) | One Metis app for Windows, macOS and Linux: chats, notebooks, device connection, notifications and native desktop control |
| [android/](android/) | Existing native Android app; unchanged by the desktop integration |

Desktop builds and updates are published from this repository. Download the installer for your operating system from GitHub Releases.

The main window opens your Metis server. **Metis → Device settings** opens local pairing, command history, permissions, startup and update settings. Closing either window keeps the device connection running in its own background process. Use **Quit** in the application or tray menu to exit.

The former Windows prototype moved from `windows/` to `desktop/`. The remote-client desktop implementation was imported from `f1shyondrugs/metis-remote-client` at `115fb45`. Existing device identities, permissions and local preferences remain compatible. Chat sign-in and permission to control the device remain separate.

See [desktop build, testing and migration details](desktop/README.md). Android keeps its independent build. A floating desktop assistant is a later module and is not included in this release.
