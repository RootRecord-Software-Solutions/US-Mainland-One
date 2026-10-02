#!/bin/bash
# Keep the one radio station up. A healthy station is left running.
# A heartbeat older than 30 seconds is a hung mixer.
set -u

if ! command -v python3 >/dev/null 2>&1; then
  echo "event=dependency_missing bin=python3 pkg=python3"
  if command -v apt-get >/dev/null 2>&1; then
    sudo -n apt-get update -qq || true
    sudo -n apt-get install -y python3 || true
  fi
  command -v python3 >/dev/null 2>&1 || { echo "event=dependency_failed bin=python3"; exit 1; }
fi

exec 9>/tmp/rr-radio-watch.lock
flock -n 9 || exit 0

REAL="$(readlink -f "$0")"
# shellcheck source=runtime-path.sh
. "$(dirname "$REAL")/runtime-path.sh"
ROOT="$(runtime_root "$0")" || exit 1
HERE="$(cd "$ROOT/.." && pwd)"
STATE="${RADIO_WATCH_STATE:-$ROOT/watch.json}"
mkdir -p "$(dirname "$STATE")" "$ROOT/state"

stream_up=0
if systemctl cat rr-radio-stream.service >/dev/null 2>&1; then
  systemctl is-active --quiet rr-radio-stream.service && stream_up=1
  start_station() { sudo -n systemctl start rr-radio-stream.service; }
  restart_station() { sudo -n systemctl restart rr-radio-stream.service; }
else
  pidfile="$ROOT/state/station.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(tr -d '[:space:]' < "$pidfile")" 2>/dev/null; then
    stream_up=1
  fi
  start_station() {
    nohup "$HERE/station.sh" >> "$ROOT/state/station.log" 2>&1 &
    echo $! > "$pidfile"
  }
  restart_station() {
    if [[ -f "$pidfile" ]]; then
      old="$(tr -d '[:space:]' < "$pidfile")"
      kill "$old" 2>/dev/null || true
    fi
    start_station
  }
fi

stream_action="warm"
heartbeat="${RADIO_HEARTBEAT:-$ROOT/state/heartbeat}"
heartbeat_age=-1
if [[ -f "$heartbeat" ]]; then
  now_s="$(date +%s)"
  hb_s="$(stat -c %Y "$heartbeat" 2>/dev/null || echo 0)"
  heartbeat_age="$((now_s - hb_s))"
fi

if [[ "$stream_up" -eq 0 ]]; then
  start_station
  stream_action="started"
  echo "event=watch_restart reason=inactive"
elif [[ "$heartbeat_age" -gt 30 ]]; then
  restart_station
  stream_action="heartbeat"
  echo "event=watch_restart reason=heartbeat age=$heartbeat_age"
fi

python3 - "$STATE" "$stream_action" << 'PY'
import json, sys
from datetime import datetime, timezone
path, stream_action = sys.argv[1:]
payload = {
    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "station": stream_action,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
    handle.write("\n")
print(json.dumps(payload))
PY
