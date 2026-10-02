#!/bin/bash
# Keep one station, one status API, and one Caddy.
# A healthy station is left running. A missing unit is started.
# A heartbeat older than 30 seconds is a hung mixer. A new report,
# a new file, or a deployment is not a failure.
set -u

exec 9>/tmp/rr-radio-watch.lock
flock -n 9 || exit 0

STATE="${RADIO_WATCH_STATE:-/home/ubuntu/rootrecord-radio/watch.json}"
mkdir -p "$(dirname "$STATE")"

count_cmd() {
  local want="$1" n=0 args
  while IFS= read -r args; do
    [[ "$args" == "$want" ]] && n=$((n + 1))
  done < <(ps -ww -eo args=)
  printf '%s' "$n"
}

listening() {
  ss -ltn 2>/dev/null | grep -q "$1"
}

api_count="$(count_cmd '/usr/bin/node /home/ubuntu/US-Mainland-Server/status-api/server.js')"
caddy_count="$(count_cmd '/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile')"
stream_count="$(count_cmd '/bin/bash /home/ubuntu/rootrecord-radio/radio-run.sh')"
if [[ "$stream_count" -eq 0 ]]; then
  stream_count="$(count_cmd '/usr/bin/node /home/ubuntu/rootrecord-radio/stream.js')"
fi
api_up=0
caddy_up=0
stream_up=0
listening '127.0.0.1:8091' && api_up=1
listening ':443 ' && caddy_up=1
systemctl is-active --quiet rr-radio-stream.service && stream_up=1

api_action="warm"
caddy_action="warm"
stream_action="warm"
heartbeat="${RADIO_HEARTBEAT:-/home/ubuntu/rootrecord-radio/state/heartbeat}"
heartbeat_age=-1
if [[ -f "$heartbeat" ]]; then
  now_s="$(date +%s)"
  hb_s="$(stat -c %Y "$heartbeat" 2>/dev/null || echo 0)"
  heartbeat_age="$((now_s - hb_s))"
fi

if [[ "$stream_up" -eq 0 ]]; then
  sudo -n systemctl start rr-radio-stream.service
  stream_action="started"
  echo "event=watch_restart reason=inactive"
elif [[ "$heartbeat_age" -gt 30 ]]; then
  sudo -n systemctl restart rr-radio-stream.service
  stream_action="heartbeat"
  echo "event=watch_restart reason=heartbeat age=$heartbeat_age"
fi

if [[ "$api_count" -gt 1 ]]; then
  sudo -n systemctl restart rr-status-api.service
  api_action="collapsed"
elif [[ "$api_up" -eq 0 ]]; then
  sudo -n systemctl start rr-status-api.service
  api_action="started"
fi

if [[ "$caddy_count" -gt 1 ]]; then
  sudo -n systemctl restart caddy.service
  caddy_action="collapsed"
elif [[ "$caddy_up" -eq 0 ]]; then
  sudo -n systemctl start caddy.service
  caddy_action="started"
fi

catalog="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8091/radio/catalog.json || true)"
[[ "$catalog" == "200" ]] || catalog="0"

api_count="$(count_cmd '/usr/bin/node /home/ubuntu/US-Mainland-Server/status-api/server.js')"
caddy_count="$(count_cmd '/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile')"
stream_count="$(count_cmd '/usr/bin/node /home/ubuntu/rootrecord-radio/stream.js')"

python3 - "$STATE" "$api_action" "$api_count" "$caddy_action" "$caddy_count" "$catalog" "$stream_action" "$stream_count" << 'PY'
import json, sys
from datetime import datetime, timezone
path, api_action, api_count, caddy_action, caddy_count, catalog, stream_action, stream_count = sys.argv[1:]
payload = {
    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "status_api": api_action,
    "status_api_count": int(api_count or 0),
    "caddy": caddy_action,
    "caddy_count": int(caddy_count or 0),
    "catalog": int(catalog or 0),
    "station": stream_action,
    "station_count": int(stream_count or 0),
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
    handle.write("\n")
print(json.dumps(payload))
PY
