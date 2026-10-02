#!/bin/bash
# Empty the radio play log. One file. No copy, no rotation, no dated archive.
set -u

REAL="$(readlink -f "$0")"
# shellcheck source=runtime-path.sh
. "$(dirname "$REAL")/runtime-path.sh"
ROOT="$(runtime_root "$0")" || exit 1
LOG="${RADIO_PLAY_LOG:-$ROOT/plays.log}"
dir="$(dirname "$LOG")"
mkdir -p "$dir"

find "$dir" -maxdepth 1 -type f \( \
  -name 'plays.log.*' -o \
  -name 'plays.log-*' -o \
  -name 'plays.log.gz' -o \
  -name 'plays.log.old' \
\) -delete

: > "$LOG"
