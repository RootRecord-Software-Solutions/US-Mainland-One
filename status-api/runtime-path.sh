#!/bin/bash
# The runtime is the directory that holds audio/. Scripts may live beside it
# or inside it. RADIO_ROOT overrides both.

runtime_root() {
  local invoked="$1"
  local here
  if [[ -n "${RADIO_ROOT:-}" ]]; then
    cd "$RADIO_ROOT" && pwd
    return
  fi
  invoked="$(cd "$(dirname "$invoked")" && pwd)"
  if [[ -d "$invoked/audio" ]]; then
    printf '%s\n' "$invoked"
    return
  fi
  here="$(cd "$(dirname "$(readlink -f "$1")")" && pwd)"
  if [[ -d "$here/../rootrecord-radio/audio" ]]; then
    cd "$here/../rootrecord-radio" && pwd
    return
  fi
  if [[ -d "$here/audio" ]]; then
    printf '%s\n' "$here"
    return
  fi
  echo "event=runtime_missing" >&2
  return 1
}
