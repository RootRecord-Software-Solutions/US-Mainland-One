#!/usr/bin/env bash
# Wipe leftover Mainland sysmon scratch. Never archive. Truncate logs only.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAR="${RR_SYSMON_VAR:-$REPO/var/sysmon}"
MAX_AGE_HANDOFF="${RR_SYSMON_HANDOFF_MAX_AGE_SEC:-3600}"
MAX_AGE_OUTBOX="${RR_SYSMON_OUTBOX_MAX_AGE_SEC:-900}"
now=$(date +%s)
purge_old() {
  local dir="$1" age="$2"
  [[ -d "$dir" ]] || return 0
  find "$dir" -type f -printf '%T@ %p\n' 2>/dev/null | while read -r ts path; do
    ts=${ts%.*}
    if (( now - ts > age )); then
      rm -f "$path" || true
      echo "sysmon-purge: removed $path"
    fi
  done
}
purge_old "$VAR/handoff" "$MAX_AGE_HANDOFF"
purge_old "$VAR/telegram-outbox" "$MAX_AGE_OUTBOX"
# keep only overwrite state files; delete rotated names
if [[ -d "$VAR/state" ]]; then
  find "$VAR/state" -type f \( -name '*.tmp' -o -name '*~' -o -name '*.log.*' -o -name '*.old' \) -delete 2>/dev/null || true
  for log in "$VAR/state"/*.log; do
    [[ -f "$log" ]] && : > "$log"
  done
fi
mkdir -p "$VAR/state"
echo "{\"purged_at\":$(date -u +%s),\"iso\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$VAR/state/purge-last.json"
echo "sysmon-purge: done"
