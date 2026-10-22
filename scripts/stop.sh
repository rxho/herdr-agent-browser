#!/usr/bin/env bash
set -euo pipefail

state_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
pid_file="$state_dir/server.pid"

if [[ ! -f "$pid_file" ]]; then
  echo "No running browser viewer recorded."
  exit 0
fi

pid="$(cat "$pid_file")"
if [[ "$pid" =~ ^[0-9]+$ ]] && ps -p "$pid" -o command= 2>/dev/null | grep -q "node src/server.js"; then
  kill "$pid"
  echo "Stopped browser viewer (PID $pid)."
else
  echo "Recorded browser viewer process is not running."
fi

rm -f "$pid_file"
