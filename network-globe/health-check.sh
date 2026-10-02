#!/usr/bin/env bash
set -euo pipefail

SERVICE="network-globe-hawaii.service"

if ! systemctl --user is-active --quiet "$SERVICE"; then
  echo "Hawaii collector: DOWN"
  exit 1
fi

if ! journalctl --user -u "$SERVICE" --since "2 minutes ago" --no-pager | grep -q "SSH stream ready → AWS"; then
  echo "Hawaii collector: RUNNING, SSH stream not recently confirmed"
  exit 2
fi

echo "Hawaii collector: OK"
echo "SSH stream: OK"
