#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${HAB_CDP_PORT:-19331}"
state_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
profile_dir="${HAB_CHROME_PROFILE:-$HOME/.local/share/herdr-agent-browser/chrome-profile}"
viewer_port="${HAB_PORT:-7931}"
headless="${HAB_HEADLESS:-auto}"

mkdir -p "$state_dir" "$profile_dir"

if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q 'webSocketDebuggerUrl'; then
  echo "An existing Chrome CDP session is listening on port $port. Leaving it running."
  exit 0
fi
if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
  echo "Port $port is occupied but does not provide a Chrome browser CDP endpoint." >&2
  exit 1
fi

case "$headless" in
  auto)
    if [[ "$(uname -s)" == Linux && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
      headless=true
    else
      headless=false
    fi
    ;;
  true|false) ;;
  *) echo "Invalid HAB_HEADLESS=$headless (expected auto, true, or false)." >&2; exit 1 ;;
esac

if [[ "$headless" == false && "$(uname -s)" == Linux &&
      -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "Headful Chrome requires DISPLAY or WAYLAND_DISPLAY. Set HAB_HEADLESS=auto or true." >&2
  exit 1
fi

if ! chrome="$(cd "$root" && bash scripts/with-node.sh scripts/browser-path.mjs)"; then
  echo "Install a managed browser with the Herdr action 'Install isolated browser'." >&2
  exit 1
fi

args=(
  --no-first-run
  --no-default-browser-check
  --remote-debugging-address=127.0.0.1
  "--remote-debugging-port=$port"
  "--user-data-dir=$profile_dir"
)
if [[ "$headless" == true ]]; then args+=(--headless=new); fi
base_path="${HAB_BASE_PATH:-/}"
base_path="${base_path%/}"
args+=("http://127.0.0.1:$viewer_port${base_path}/demo")

(
  cd "$state_dir"
  nohup "$chrome" "${args[@]}" >"$state_dir/chrome.log" 2>&1 </dev/null &
  echo "$!" >"$state_dir/chrome.pid"
)

for attempt in {1..50}; do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q 'webSocketDebuggerUrl'; then
    echo "Isolated Chrome CDP listening on 127.0.0.1:$port (headless=$headless)"
    echo "Executable: $chrome"
    echo "Profile: $profile_dir"
    exit 0
  fi
  sleep 0.2
done

echo "Chrome failed to expose CDP. Inspect $state_dir/chrome.log" >&2
if [[ "$(uname -s)" == Linux ]]; then
  if grep -q "No usable sandbox" "$state_dir/chrome.log" 2>/dev/null; then
    echo "Chrome sandbox blocked: on Ubuntu 23.10+ AppArmor can restrict user namespaces for downloaded Chrome for Testing." >&2
    echo "Use a system Chrome with a distro AppArmor profile (HAB_CHROME_BINARY=/usr/bin/google-chrome)," >&2
    echo "or ask your administrator to configure a restricted AppArmor profile permitting userns for this browser." >&2
    echo "Do not disable Chrome's sandbox or the system-wide AppArmor protection as a default workaround." >&2
  else
    echo "Check shared libraries (ldd), user namespaces, sandbox permissions, and disk space." >&2
  fi
fi
exit 1
