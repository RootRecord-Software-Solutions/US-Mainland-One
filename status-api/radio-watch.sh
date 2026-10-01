#!/bin/bash
# Keep one status API and one Caddy. Warm the radio catalog.
# A healthy listener is left running. A missing process is started.
# More than one match is collapsed to the systemd unit.
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
api_up=0
caddy_up=0
listening '127.0.0.1:8091' && api_up=1
listening ':443 ' && caddy_up=1

api_action="warm"
caddy_action="warm"

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

python3 - "$STATE" "$api_action" "$api_count" "$caddy_action" "$caddy_count" "$catalog" << 'PY'
import json, sys
from datetime import datetime, timezone
path, api_action, api_count, caddy_action, caddy_count, catalog = sys.argv[1:]
payload = {
    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "status_api": api_action,
    "status_api_count": int(api_count or 0),
    "caddy": caddy_action,
    "caddy_count": int(caddy_count or 0),
    "catalog": int(catalog or 0),
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
    handle.write("\n")
print(json.dumps(payload))
PY
