#!/usr/bin/env bash
set -euo pipefail
state_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
pid_file="$state_dir/chrome.pid"

if [[ ! -f "$pid_file" ]]; then
  echo "No plugin-managed Chrome process recorded."
  exit 0
fi

pid="$(cat "$pid_file")"
if [[ "$pid" =~ ^[0-9]+$ ]] && ps -p "$pid" -o command= 2>/dev/null | grep -Eq '(Google Chrome|chromium).*remote-debugging-port'; then
  kill "$pid"
  echo "Stopped plugin-managed Chrome (PID $pid)."
else
  echo "Recorded Chrome process no longer matches; leaving unrelated processes alone."
fi
rm -f "$pid_file"
