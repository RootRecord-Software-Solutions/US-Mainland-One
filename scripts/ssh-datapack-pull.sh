#!/usr/bin/env bash
# ==============================================================================
# # INFO — MUST HAVE
# ------------------------------------------------------------------------------
# Desk SSH-first datapack pull (OmniBook → rr-aws). One pull path.
# Lands zips in Database/NETWORK/datapacks/
# Does NOT wipe AWS (packer owns wipe after confirmed send).
# Ping Bruce if enabling beside any OmniBook→AWS push timer.
# HOW TO RUN: bash ssh-datapack-pull.sh
# HOW TO ADD: copy this script; keep dest/ssh host labeled; no secrets in file.
# ==============================================================================
set -euo pipefail
DEST="${RR_DATAPACK_DEST:-/home/rootrecord/Database/NETWORK/datapacks}"
HOST="${RR_AWS_SSH_HOST:-rr-aws}"
REMOTE_OUT="${RR_AWS_OUT:-/home/ubuntu/rootrecord/out}"
mkdir -p "$DEST"
# Copy any rootrecord-*.zip present; skip if none
mapfile -t FILES < <(ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" "ls -1 ${REMOTE_OUT}/rootrecord-*.zip 2>/dev/null" || true)
if [[ ${#FILES[@]} -eq 0 || -z "${FILES[0]:-}" ]]; then
  echo "ssh-datapack-pull: no remote zips"
  exit 0
fi
for f in "${FILES[@]}"; do
  base=$(basename "$f")
  if [[ -f "$DEST/$base" ]]; then
    echo "skip existing $base"
    continue
  fi
  scp -o BatchMode=yes -o ConnectTimeout=60 "${HOST}:${REMOTE_OUT}/${base}" "$DEST/$base"
  echo "pulled $base → $DEST"
done
