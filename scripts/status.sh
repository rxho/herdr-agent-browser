#!/usr/bin/env bash
set -euo pipefail

port="${HAB_PORT:-7931}"
bind="${HAB_BIND:-127.0.0.1}"
if [[ "$bind" == "::1" ]]; then
  bind="[::1]"
fi

base_path="${HAB_BASE_PATH:-/}"
base_path="${base_path%/}"
curl --fail --silent --show-error "http://$bind:$port${base_path}/api/health"
printf '\n'
