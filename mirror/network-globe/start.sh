#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p data
export PORT="${PORT:-8090}"
if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E node server.js
else
  exec node server.js
fi
