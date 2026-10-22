#!/usr/bin/env bash
set -euo pipefail
umask 077

port="${HAB_CDP_PORT:-19331}"
state_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
profile_dir="${HAB_CHROME_PROFILE:-$HOME/.local/share/herdr-agent-browser/chrome-profile}"
viewer_port="${HAB_PORT:-7931}"

mkdir -p "$state_dir" "$profile_dir"

if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q 'webSocketDebuggerUrl'; then
  echo "Existing Chrome CDP session on port $port; leaving it running."
  exit 0
fi

if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
  echo "Port $port is occupied but is not a Chrome browser CDP endpoint." >&2
  exit 1
fi

if [[ -n "${HAB_CHROME_BINARY:-}" ]]; then
  chrome="$HAB_CHROME_BINARY"
elif [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  chrome="$(command -v google-chrome)"
elif command -v chromium >/dev/null 2>&1; then
  chrome="$(command -v chromium)"
else
  echo "Chrome or Chromium not found. Set HAB_CHROME_BINARY." >&2
  exit 1
fi

(
  cd "$state_dir"
  nohup "$chrome" \
    --no-first-run \
    --no-default-browser-check \
    --remote-debugging-address=127.0.0.1 \
    "--remote-debugging-port=$port" \
    "--user-data-dir=$profile_dir" \
    "http://127.0.0.1:$viewer_port/demo" >"$state_dir/chrome.log" 2>&1 </dev/null &
  echo "$!" >"$state_dir/chrome.pid"
)

for attempt in {1..50}; do
  if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q 'webSocketDebuggerUrl'; then
    echo "Isolated Chrome ready on CDP port $port"
    echo "Profile: $profile_dir"
    exit 0
  fi
  sleep 0.2
done

echo "Chrome did not expose CDP; inspect $state_dir/chrome.log" >&2
exit 1
