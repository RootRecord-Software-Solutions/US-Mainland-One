#!/bin/bash
# Pull the Pacific current snapshots over the loopback reverse tunnel.
# A failed pull keeps the last good file. An oversized download is discarded.
set -u
DEST=/home/ubuntu/rebroadcast
KEY=/home/ubuntu/.ssh/pacific_fetch_ed25519
KNOWN=/home/ubuntu/.ssh/pacific_fetch_known_hosts
mkdir -p "$DEST"

pull() {
  local name="$1"
  local max="$2"
  local dest="$DEST/$name"
  local tmp bytes
  tmp=$(mktemp "$DEST/.$name.XXXXXX")
  if ! ssh -p 17022 -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN" \
    rootrecord@127.0.0.1 "$name" > "$tmp"; then
    rm -f "$tmp"
    echo "fetch-pacific: keep last $name"
    return 0
  fi
  bytes=$(wc -c < "$tmp")
  if [[ "$bytes" -eq 0 || "$bytes" -gt "$max" ]]; then
    rm -f "$tmp"
    echo "fetch-pacific: reject $name ${bytes} bytes"
    return 0
  fi
  mv -f "$tmp" "$dest"
  echo "fetch-pacific: $name ${bytes} bytes"
}

pull hawaii-current.ndjson 1048576
pull status-current.json 262144
find "$DEST" -type f \
  ! -name 'hawaii-current.ndjson' \
  ! -name 'status-current.json' \
  ! -name 'aws-current.ndjson' \
  ! -name 'aws-current.ndjson.tmp' \
  ! -name 'fetch-pacific.sh' \
  -delete
