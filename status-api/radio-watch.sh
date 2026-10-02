#!/bin/bash
# Older name for the station watch. Stays inside this runtime.
set -u
REAL="$(readlink -f "$0")"
exec "$(dirname "$REAL")/radio-station-watch.sh" "$@"
