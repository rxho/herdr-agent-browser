#!/usr/bin/env bash
set -euo pipefail
STATE="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
if [ -f "$STATE/server.pid" ];then pid="$(cat "$STATE/server.pid")";if ps -p "$pid" -o command=|grep -q 'node src/server.js';then kill "$pid";fi;rm -f "$STATE/server.pid";fi
