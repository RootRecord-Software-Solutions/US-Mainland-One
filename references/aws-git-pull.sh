#!/bin/bash
# Fast-forward the mainland checkout. Restart the status API only when its
# source file changed. The live globe under /home/ubuntu/network-globe is a
# separate copy and is not updated here.
set -u

REPO="/home/ubuntu/US-Mainland-Server"
API="$REPO/status-api/server.js"

cd "$REPO" || exit 1

before=""
if [[ -f "$API" ]]; then
  before="$(sha256sum "$API" | awk '{print $1}')"
fi

git pull --ff-only
rc=$?

after=""
if [[ -f "$API" ]]; then
  after="$(sha256sum "$API" | awk '{print $1}')"
fi

if [[ "$rc" -eq 0 && -n "$after" && "$before" != "$after" ]]; then
  sudo -n systemctl restart rr-status-api.service
fi

exit "$rc"
