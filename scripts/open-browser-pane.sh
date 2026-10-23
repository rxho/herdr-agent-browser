#!/usr/bin/env bash
set -euo pipefail
# Herdr's stdout records the opened pane ID. Ovis can focus it automatically.
exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
  --plugin rxho.agent-browser \
  --entrypoint browser \
  --placement split \
  --direction right \
  --focus
