#!/usr/bin/env bash
set -euo pipefail
exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
  --plugin rxho.agent-browser --entrypoint setup \
  --placement split --direction right --focus
