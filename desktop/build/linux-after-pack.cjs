const fs = require("node:fs");
const path = require("node:path");

const wrapper = ({ executableName }) => `#!/usr/bin/env bash
set -u

appdir="\${APPDIR:-$(CDPATH= cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)}"
real="$appdir/${executableName}.real"

if [[ -z "\${DISPLAY:-}" && -z "\${WAYLAND_DISPLAY:-}" ]]; then
  cat >&2 <<'EOF'
Metis AI Remote Client cannot start on a headless Linux host.
This AppImage is a desktop Electron client and needs an interactive X11 or Wayland session.
It is not a headless service or CLI, so the Electron ELF was not started.

For a headless Ubuntu remote client, use the server-provided installer command from
Metis Remote Devices (it downloads /install/remote-client.sh):
  bash -c 'installer="$(mktemp)" && curl -fsSL https://YOUR-METIS-HOST/install/remote-client.sh -o "$installer" && bash "$installer" --server https://YOUR-METIS-HOST --enrollment-token YOUR_ENROLLMENT_TOKEN --permission-mode user; result=$?; rm -f -- "$installer"; exit "$result"'
EOF
  exit 2
fi

if [[ "$(id -u)" -eq 0 ]]; then
  printf '%s\\n' 'Metis AI Remote Client refuses to run as root. Run it as the signed-in desktop user.' >&2
  exit 2
fi

if [[ ! -x "$real" ]]; then
  printf 'Packaged Electron executable is missing: %s\\n' "$real" >&2
  exit 3
fi
if ! command -v ldd >/dev/null 2>&1; then
  printf '%s\\n' 'Cannot check Electron runtime libraries: ldd is missing.' >&2
  printf '%s\\n' 'On Ubuntu install it with: sudo apt-get update && sudo apt-get install -y libc-bin' >&2
  exit 3
fi

missing="$(ldd "$real" 2>&1 | awk '/not found$/ { print $1 }')"
if [[ -n "$missing" ]]; then
  packages=()
  unmapped=()
  while IFS= read -r library; do
    case "$library" in
      libatk-1.0.so.*) packages+=(libatk1.0-0) ;;
      libatk-bridge-2.0.so.*) packages+=(libatk-bridge2.0-0) ;;
      libcups.so.*) packages+=(libcups2) ;;
      libdrm.so.*) packages+=(libdrm2) ;;
      libgbm.so.*) packages+=(libgbm1) ;;
      libgtk-3.so.*) packages+=(libgtk-3-0) ;;
      libnss3.so.*) packages+=(libnss3) ;;
      libasound.so.*) packages+=(libasound2) ;;
      libX11-xcb.so.*) packages+=(libx11-xcb1) ;;
      libXcomposite.so.*) packages+=(libxcomposite1) ;;
      libXdamage.so.*) packages+=(libxdamage1) ;;
      libXfixes.so.*) packages+=(libxfixes3) ;;
      libXrandr.so.*) packages+=(libxrandr2) ;;
      libXshmfence.so.*) packages+=(libxshmfence1) ;;
      libpango-1.0.so.*|libpangocairo-1.0.so.*) packages+=(libpango-1.0-0 libpangocairo-1.0-0) ;;
      libcairo.so.*) packages+=(libcairo2) ;;
      libatspi.so.*) packages+=(libatspi2.0-0) ;;
      *) unmapped+=("$library") ;;
    esac
  done <<< "$missing"
  resolved=()
  for package in "\${packages[@]}"; do
    candidate=""
    if command -v apt-cache >/dev/null 2>&1; then
      candidate="$(apt-cache policy "$package" 2>/dev/null | awk '/Candidate:/ {print $2; exit}')"
      if [[ -z "$candidate" || "$candidate" == '(none)' ]]; then
        candidate="$(apt-cache policy "\${package}t64" 2>/dev/null | awk '/Candidate:/ {print $2; exit}')"
        if [[ -n "$candidate" && "$candidate" != '(none)' ]]; then package="\${package}t64"; fi
      fi
    fi
    if [[ -n "$candidate" && "$candidate" != '(none)' ]]; then resolved+=("$package");
    else unmapped+=("$package"); fi
  done
  packages=("\${resolved[@]}")
  printf '%s\\n' 'The host is missing runtime libraries required by the Electron AppImage:' >&2
  printf '  %s\\n' "$missing" >&2
  if [[ \${#packages[@]} -gt 0 ]]; then
    printf 'Available Debian/Ubuntu package candidates:\\n  sudo apt-get update && sudo apt-get install -y %s\\n' "$(printf '%s ' "\${packages[@]}" | xargs -n1 | sort -u | xargs)" >&2
  fi
  if [[ \${#unmapped[@]} -gt 0 ]]; then
    printf 'No available package mapping for: %s\\n' "\${unmapped[*]}" >&2
    printf '%s\\n' 'Use your distribution package manager to resolve the remaining libraries.' >&2
  fi
  printf '%s\\n' 'No packages were installed and the Electron ELF was not started.' >&2
  exit 3
fi

exec "$real" "$@"
`;

async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;
  const executableName = context.packager.executableName;
  const executable = path.join(context.appOutDir, executableName);
  const realExecutable = `${executable}.real`;
  fs.renameSync(executable, realExecutable);
  fs.writeFileSync(executable, wrapper({ executableName }), { mode: 0o755 });
};

module.exports = afterPack;
