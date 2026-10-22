#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
port="${HAB_PORT:-7931}"
bind="${HAB_BIND:-127.0.0.1}"
address="$bind"
if [[ "$bind" == "::1" ]]; then
  address="[::1]"
fi
url="http://$address:$port"

mkdir -p "$state_dir"

healthy() {
  curl --fail --silent --show-error --connect-timeout 1 --max-time 2 "$url/api/health" 2>/dev/null |
    grep -q '"service":"herdr-agent-browser"'
}

if healthy; then
  echo "Browser viewer already running: $url/"
  exit 0
fi

if [[ ! -f "$root/public/sdk.js" ]]; then
  (cd "$root" && npm ci --no-audit --no-fund && npm run build)
fi

(
  cd "$root"
  nohup node src/server.js >>"$state_dir/server.log" 2>&1 </dev/null &
  echo "$!" >"$state_dir/server.pid"
)

for attempt in {1..30}; do
  if healthy; then
    echo "Browser viewer: $url/"
    exit 0
  fi
  sleep 0.2
done

echo "Browser viewer did not start; inspect $state_dir/server.log" >&2
exit 1
