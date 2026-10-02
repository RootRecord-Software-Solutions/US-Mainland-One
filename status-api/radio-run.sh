#!/bin/bash
# Run the active radio release. Exit 75 means the station reached a quiet
# boundary and asked to switch to deploy-pending. Any other status is a
# failure for systemd to restart. This script does not schedule audio.
set -u

REAL="$(readlink -f "$0")"
LIB="$(dirname "$REAL")/runtime-path.sh"
if [[ -f "$LIB" ]]; then
  # shellcheck source=runtime-path.sh
  . "$LIB"
  ROOT="$(runtime_root "$0")" || exit 1
else
  ROOT="${RADIO_ROOT:-$(cd "$(dirname "$0")" && pwd)}"
fi
export RADIO_ROOT="$ROOT"
ACTIVE="$ROOT/active"
PENDING="${RADIO_DEPLOY_PENDING:-$ROOT/deploy-pending}"
export RADIO_DIR="${RADIO_DIR:-$ROOT/audio}"
export RADIO_REPORTS_DIR="${RADIO_REPORTS_DIR:-$RADIO_DIR/reports}"
export RADIO_HEARTBEAT="${RADIO_HEARTBEAT:-$ROOT/state/heartbeat}"
export RADIO_DEPLOY_PENDING="$PENDING"
export RADIO_PLAY_LOG="${RADIO_PLAY_LOG:-$ROOT/plays.log}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8092}"
mkdir -p "$ROOT/state" "$RADIO_DIR" "$RADIO_REPORTS_DIR"

cd "$ROOT" || exit 1

ensure() {
  local bin="$1" pkg="$2"
  command -v "$bin" >/dev/null 2>&1 && return 0
  echo "event=dependency_missing bin=$bin pkg=$pkg"
  if command -v apt-get >/dev/null 2>&1; then
    sudo -n apt-get update -qq || true
    sudo -n apt-get install -y "$pkg" || true
  fi
  command -v "$bin" >/dev/null 2>&1
}

ensure node nodejs || { echo "event=dependency_failed bin=node"; exit 1; }
ensure ffmpeg ffmpeg || { echo "event=dependency_failed bin=ffmpeg"; exit 1; }
if [[ -n "${RADIO_NODE:-}" && -x "${RADIO_NODE}" ]]; then
  NODE="$RADIO_NODE"
else
  NODE="$(command -v node)"
fi

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
  if [[ "$code" -eq 127 ]]; then
    ensure ffmpeg ffmpeg && continue
    echo "event=dependency_failed bin=ffmpeg"
    exit 127
  fi
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
