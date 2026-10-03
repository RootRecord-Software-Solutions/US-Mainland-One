#!/bin/bash
# Pacific / desk runner for ML1 RadioRss → RR_DATABASE_ROOT/Media/RadioRss/
# Same rule as ML2 run-local-bank: canonical code lives in THIS tree only.
# Usage: run-radio-rss.sh poll|health|check|handoff|news-hour [...]
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DB_DEFAULT="/home/rootrecord/RootRecord-Ecosystem/2 - RootRecord-Database"
export RR_DATABASE_ROOT="${RR_DATABASE_ROOT:-$DB_DEFAULT}"
export RR_RADIO_RSS_CONFIG="${RR_RADIO_RSS_CONFIG:-$REPO/vendor/RadioRss/config}"
# When ML1 host is not transmitting, radio_push auto/local banks into desk audio.
export RR_RADIO_LOCAL_ROOT="${RR_RADIO_LOCAL_ROOT:-$REPO/rootrecord-radio}"

VENDOR="$REPO/vendor/RadioRss"
if [[ ! -f "$VENDOR/scripts/rss_radio.py" ]]; then
  echo "run-radio-rss: missing $VENDOR/scripts/rss_radio.py" >&2
  exit 1
fi

if [[ -n "${ML1_PYTHON:-}" && -x "${ML1_PYTHON}" ]]; then
  PY="$ML1_PYTHON"
elif [[ -x "$REPO/.venv/bin/python" ]]; then
  PY="$REPO/.venv/bin/python"
else
  PY=python3
fi

cd "$VENDOR"
echo "run-radio-rss: repo=$REPO db=$RR_DATABASE_ROOT cmd=${*:-poll}"
exec "$PY" scripts/rss_radio.py "$@"
