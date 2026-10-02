#!/bin/bash
# Run the active radio release. Exit 75 means the station reached a quiet
# boundary and asked to switch to deploy-pending. Any other status is a
# failure for systemd to restart. This script does not schedule audio.
set -u

ROOT="${RADIO_ROOT:-/home/ubuntu/rootrecord-radio}"
ACTIVE="$ROOT/active"
PENDING="${RADIO_DEPLOY_PENDING:-$ROOT/deploy-pending}"
NODE="${RADIO_NODE:-/usr/bin/node}"

cd "$ROOT" || exit 1

while true; do
  if [[ ! -f "$ACTIVE/stream.js" ]]; then
    echo "event=station_exit reason=no_active_release code=1"
    exit 1
  fi
  release="$(basename "$(readlink -f "$ACTIVE")")"
  RADIO_RELEASE="$release" \
  RADIO_LIB="$ACTIVE/radio.js" \
  RADIO_DEPLOY_PENDING="$PENDING" \
  "$NODE" "$ACTIVE/stream.js"
  code=$?
  if [[ "$code" -eq 75 ]]; then
    if [[ -f "$PENDING" ]]; then
      sha="$(tr -d '[:space:]' < "$PENDING")"
      dest="$ROOT/releases/$sha"
      if [[ -f "$dest/stream.js" && -f "$dest/radio.js" ]]; then
        ln -sfn "$dest" "$ACTIVE"
        rm -f "$PENDING"
        echo "event=deploy_activated sha=$sha"
        continue
      fi
    fi
    echo "event=station_exit reason=deploy_missing code=75"
    exit 75
  fi
  echo "event=station_exit reason=process code=$code"
  exit "$code"
done
