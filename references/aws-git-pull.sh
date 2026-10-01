#!/bin/bash
# Fast-forward the mainland checkout. Restart the status API when server.js
# or radio.js changed. The live globe under /home/ubuntu/network-globe is a
# separate copy and is not updated here.
set -u

REPO="/home/ubuntu/US-Mainland-Server"
API_DIR="$REPO/status-api"

cd "$REPO" || exit 1

fingerprint() {
  sha256sum "$API_DIR/server.js" "$API_DIR/radio.js" 2>/dev/null | sha256sum | awk '{print $1}'
}

before="$(fingerprint)"

git pull --ff-only
rc=$?

after="$(fingerprint)"

watch_src="$API_DIR/radio-watch.sh"
watch_dst="/home/ubuntu/rootrecord-radio/radio-watch.sh"
if [[ -f "$watch_src" ]]; then
  mkdir -p "$(dirname "$watch_dst")"
  if ! cmp -s "$watch_src" "$watch_dst"; then
    cp "$watch_src" "$watch_dst"
    chmod 755 "$watch_dst"
  fi
fi

stream_src="$API_DIR/stream.js"
stream_dst="/home/ubuntu/rootrecord-radio/stream.js"
if [[ -f "$stream_src" ]]; then
  if ! cmp -s "$stream_src" "$stream_dst"; then
    cp "$stream_src" "$stream_dst"
    sudo -n systemctl restart rr-radio-stream.service
  fi
fi

if [[ "$rc" -eq 0 && -n "$after" && "$before" != "$after" ]]; then
  sudo -n systemctl restart rr-status-api.service
fi

exit "$rc"
