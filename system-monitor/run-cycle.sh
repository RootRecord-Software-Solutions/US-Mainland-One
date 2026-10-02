#!/usr/bin/env bash
# Collect → SSH stream to Pacific; on failure → Telegram datapack; always try purge leftovers.
# Staged only — not installed on live hosts by this scaffold.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
export PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}"
PY="${RR_SYSMON_PYTHON:-python3}"
SOURCE="${RR_SYSMON_SOURCE_NODE:-us-mainland-one}"
export RR_SYSMON_SOURCE_NODE="$SOURCE"

"$PY" "$REPO/system-monitor/collect.py"
set +e
"$PY" "$REPO/system-monitor/stream_send.py"
rc=$?
set -e
if [[ $rc -eq 0 ]]; then
  echo "sysmon-cycle: primary SSH path ok"
elif [[ $rc -eq 2 ]]; then
  echo "sysmon-cycle: stream disabled — trying Telegram datapack fallback"
  "$PY" "$REPO/system-monitor/telegram_datapack.py" --source-node "$SOURCE"
else
  echo "sysmon-cycle: SSH unreachable/fail rc=$rc — Telegram datapack fallback"
  "$PY" "$REPO/system-monitor/telegram_datapack.py" --source-node "$SOURCE"
fi
"$REPO/system-monitor/purge.sh" || true
