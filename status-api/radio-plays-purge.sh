#!/bin/bash
# Empty the radio play log. One file. No copy, no rotation, no dated archive.
set -u

LOG="${RADIO_PLAY_LOG:-/home/ubuntu/rootrecord-radio/plays.log}"
dir="$(dirname "$LOG")"
mkdir -p "$dir"

find "$dir" -maxdepth 1 -type f \( \
  -name 'plays.log.*' -o \
  -name 'plays.log-*' -o \
  -name 'plays.log.gz' -o \
  -name 'plays.log.old' \
\) -delete

: > "$LOG"
