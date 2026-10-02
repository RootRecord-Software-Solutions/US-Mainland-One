#!/usr/bin/env bash
# ==============================================================================
# maintain-hawaii-feed.sh — bounded AWS Network Globe Hawaii feed
# ------------------------------------------------------------------------------
# Usage:
#   maintain-hawaii-feed.sh [MAX_BYTES] [TARGET_BYTES]
#
# The Hawaii collector closes its SSH writer before calling this script.
# Therefore this script can safely rewrite the SAME inode instead of renaming
# the live file away from an open append descriptor.
#
# The reader's byte offset is reset to zero after trimming because the feed
# contents are intentionally replaced with a newer bounded window.
# ==============================================================================
set -euo pipefail

FEED="/home/ubuntu/network-globe/network-globe/data/hawaii.ndjson"
OFFSET="/home/ubuntu/network-globe/network-globe/data/hawaii-offset.json"
MAX_BYTES="${1:-67108864}"
TARGET_BYTES="${2:-50331648}"
LOCK="/tmp/rootrecord-hawaii-feed-maintenance.lock"

if ! [[ "$MAX_BYTES" =~ ^[0-9]+$ && "$TARGET_BYTES" =~ ^[0-9]+$ ]]; then
  echo "invalid byte limits" >&2
  exit 2
fi

if (( TARGET_BYTES >= MAX_BYTES )); then
  echo "TARGET_BYTES must be smaller than MAX_BYTES" >&2
  exit 2
fi

exec 9>"$LOCK"
flock -n 9 || {
  echo "maintenance already running"
  exit 0
}

if [ ! -f "$FEED" ]; then
  echo "feed missing -- nothing to trim"
  exit 0
fi

SIZE=$(stat -c '%s' "$FEED")

if (( SIZE <= MAX_BYTES )); then
  echo "feed $SIZE bytes <= $MAX_BYTES -- no trim"
  exit 0
fi

TMP="${FEED}.trim.$$"
trap 'rm -f "$TMP"' EXIT

# Keep a byte window, then discard the first partial NDJSON record so the
# retained file starts on a complete line.
tail -c "$TARGET_BYTES" "$FEED" | sed '1d' > "$TMP"

# Preserve the feed inode/path for the live globe reader.
cat "$TMP" > "$FEED"
rm -f "$TMP"

# Reset only the byte cursor; preserve any other metadata the consumer keeps.
python3 - "$OFFSET" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    data = {}

if not isinstance(data, dict):
    data = {}

if "offset" in data:
    data["offset"] = 0
elif "byte_offset" in data:
    data["byte_offset"] = 0
else:
    data["offset"] = 0

directory = os.path.dirname(path)
fd, tmp = tempfile.mkstemp(prefix=".hawaii-offset.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
finally:
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
PY

NEW_SIZE=$(stat -c '%s' "$FEED")
echo "trimmed $SIZE -> $NEW_SIZE bytes; offset reset"
