#!/bin/bash
# Start the station from this folder. Audio, engine, and logs stay here.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/rootrecord-radio"
API="$HERE/status-api"

mkdir -p "$ROOT/releases/local" "$ROOT/state" "$ROOT/audio/music" "$ROOT/audio/reports" "$ROOT/audio/chimes"
ln -sfn "$API/stream.js" "$ROOT/releases/local/stream.js"
ln -sfn "$API/radio.js" "$ROOT/releases/local/radio.js"
ln -sfn "releases/local" "$ROOT/active"
ln -sfn "$API/radio-run.sh" "$ROOT/radio-run.sh"
ln -sfn "$API/radio-station-watch.sh" "$ROOT/radio-station-watch.sh"
ln -sfn "$API/radio-plays-purge.sh" "$ROOT/radio-plays-purge.sh"
ln -sfn "$API/radio-watch.sh" "$ROOT/radio-watch.sh"

export RADIO_ROOT="$ROOT"
export RADIO_DIR="$ROOT/audio"
export RADIO_REPORTS_DIR="$ROOT/audio/reports"
export RADIO_HEARTBEAT="$ROOT/state/heartbeat"
export RADIO_DEPLOY_PENDING="$ROOT/deploy-pending"
export RADIO_PLAY_LOG="$ROOT/plays.log"
export RADIO_WATCH_STATE="$ROOT/watch.json"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8092}"

exec "$ROOT/radio-run.sh"
