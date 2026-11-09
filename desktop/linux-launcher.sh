#!/usr/bin/env bash
set -u

usage() {
  cat >&2 <<'EOF'
Usage: linux-launcher.sh /path/to/Metis-AI-Remote-Client-x86_64.AppImage [app arguments...]

This launcher performs a read-only host preflight. It does not install packages.
EOF
}

appimage="${METIS_APPIMAGE:-}"
if [[ -n "${1:-}" && "${1:-}" != --* ]]; then
  appimage="$1"
  shift
fi
if [[ -z "$appimage" ]]; then
  usage
  exit 64
fi
if [[ ! -f "$appimage" || ! -x "$appimage" ]]; then
  printf 'AppImage is not an executable file: %s\n' "$appimage" >&2
  exit 66
fi
if ! command -v realpath >/dev/null 2>&1; then
  printf 'Cannot inspect the AppImage runtime: realpath is missing. Install it with: sudo apt-get update && sudo apt-get install -y coreutils\n' >&2
  exit 3
fi
appimage="$(realpath -e -- "$appimage")"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  cat >&2 <<'EOF'
Metis AI Remote Client cannot start on a headless Linux host.
This AppImage is a desktop Electron client and needs an interactive X11 or
Wayland session. It is not a headless service or CLI.

Use the server's legacy headless remote-client installer instead, or run this
AppImage on a Linux desktop. The headless installer is maintained by the
paired Metis server, not by this desktop-client repository.
EOF
  exit 2
fi

if [[ "$(id -u)" -eq 0 ]]; then
  cat >&2 <<'EOF'
Metis AI Remote Client refuses to run as root.
Run it as the signed-in desktop user. Do not bypass Electron's sandbox with the no-sandbox flag for a portable
installation.
EOF
  exit 2
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/metis-appimage-preflight.XXXXXX")"
cleanup() { rm -rf -- "$tmpdir"; }
trap cleanup EXIT HUP INT TERM

if ! (cd "$tmpdir" && "$appimage" --appimage-extract >/dev/null 2>extract.err); then
  printf 'Could not inspect the AppImage runtime.\n' >&2
  sed -n '1,20p' "$tmpdir/extract.err" >&2
  exit 3
fi

# The packaging hook replaces the original entrypoint with a shell wrapper.
# Inspect the renamed ELF, while retaining support for older AppImages.
binary="$(find "$tmpdir/squashfs-root" -maxdepth 1 -type f -perm -0100 -name 'metis-ai-remote-client*.real' -print -quit)"
if [[ -z "$binary" ]]; then
  binary="$(find "$tmpdir/squashfs-root" -maxdepth 1 -type f -perm -0100 -name 'metis-ai-remote-client*' -print -quit)"
fi
if [[ -z "$binary" ]]; then
  printf 'Could not find the packaged Electron executable in the AppImage.\n' >&2
  exit 3
fi

if ! command -v ldd >/dev/null 2>&1; then
  printf 'Cannot inspect the packaged Electron executable: ldd is missing.\n' >&2
  printf '%s\n' 'On Ubuntu install it with: sudo apt-get update && sudo apt-get install -y libc-bin' >&2
  exit 3
fi
missing="$(ldd "$binary" 2>&1 | awk '/not found$/ { print $1 }')"
if [[ -n "$missing" ]]; then
  cat >&2 <<EOF
The host is missing runtime libraries required by the Electron AppImage:
$missing

Install the distribution packages that provide these libraries on the
desktop host, then run this launcher again. No packages were installed by
this check.
EOF
  exit 3
fi

"$appimage" "$@"
