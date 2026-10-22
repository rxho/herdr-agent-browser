#!/usr/bin/env bash
set -euo pipefail

port="${HAB_PORT:-7931}"
bind="${HAB_BIND:-127.0.0.1}"
if [[ "$bind" == "::1" ]]; then
  bind="[::1]"
fi

curl --fail --silent --show-error "http://$bind:$port/api/health"
printf '\n'
