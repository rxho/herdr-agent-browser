#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${HAB_PORT:-7931}"
STATE="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr-agent-browser}"
mkdir -p "$STATE"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1;then echo "Already running at :$PORT";exit 0;fi
if [ ! -f "$ROOT/public/viewer.js" ];then (cd "$ROOT" && npm install --no-audit --no-fund && npm run build);fi
(cd "$ROOT"; nohup node src/server.js >>"$STATE/server.log" 2>&1 </dev/null & echo $! >"$STATE/server.pid")
for n in {1..30};do if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1;then echo "http://127.0.0.1:$PORT/";exit 0;fi;sleep 0.2;done
echo "Start failed: $STATE/server.log" >&2;exit 1
