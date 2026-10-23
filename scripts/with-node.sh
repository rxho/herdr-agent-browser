#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
saved="$root/build/runtime-node.path"

validate() {
  local candidate="$1"
  [[ -n "$candidate" && -x "$candidate" && ! -d "$candidate" ]] || return 1
  local version major
  version="$("$candidate" --version 2>/dev/null)" || return 1
  [[ "$version" =~ ^v([0-9]+)\. ]] || return 1
  major="${BASH_REMATCH[1]}"
  (( major >= 20 ))
}

fail() {
  {
    echo "herdr-agent-browser: Node.js >= 20 was not found in the Herdr process environment."
    printf 'PATH=%s\n' "${PATH:-<unset>}"
    printf 'HOME=%s\n' "${HOME:-<unset>}"
    printf 'HAB_NODE_BINARY=%s\n' "${HAB_NODE_BINARY:-<unset>}"
    printf 'recorded_node=%s\n' "${saved_path:-<none>}"
    echo "Set HAB_NODE_BINARY to your Node executable or install Node in a standard location."
    echo "Common Linuxbrew location: /home/linuxbrew/.linuxbrew/bin/node"
  } >&2
  exit 127
}

saved_path=""
if [[ -r "$saved" ]]; then
  IFS= read -r saved_path < "$saved" || true
fi

# An explicit executable path is authoritative; never silently ignore a typo.
if [[ -n "${HAB_NODE_BINARY:-}" ]]; then
  if validate "$HAB_NODE_BINARY"; then exec "$HAB_NODE_BINARY" "$@"; fi
  echo "Invalid HAB_NODE_BINARY: $HAB_NODE_BINARY (requires executable Node.js >= 20)" >&2
  fail
fi

candidates=("$saved_path" "$(command -v node || true)")
for dir in \
  /home/linuxbrew/.linuxbrew/bin \
  /opt/homebrew/bin \
  /usr/local/bin \
  /usr/bin \
  "${HOME:-}/.local/bin" \
  "${HOME:-}/.linuxbrew/bin" \
  "${HOME:-}/.volta/bin" \
  "${HOME:-}/.asdf/shims" \
  "${HOME:-}/.local/share/mise/shims"; do
  candidates+=("$dir/node")
done
shopt -s nullglob
for file in "${HOME:-}/.nvm/versions/node/"v*/bin/node "${HOME:-}/.local/share/fnm/node-versions/"v*/installation/bin/node; do
  candidates+=("$file")
done
for file in "${candidates[@]}"; do
  if validate "$file"; then exec "$file" "$@"; fi
done
fail
