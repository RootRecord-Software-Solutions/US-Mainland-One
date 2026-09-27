#!/usr/bin/env bash
# ==============================================================================
# # INFO — MUST HAVE
# ------------------------------------------------------------------------------
# Pull AWS host sysmon snapshot into Database/NETWORK/metrics/aws/
# One owner path. Manual / on-demand — NO systemd timer (avoids Bruce pack-slot race).
# HOW TO RUN: bash aws-sysmon-pull.sh
# HOW TO ADD: keep DEST labeled; never embed secrets; do not dual-write ENERGY/watts.
# ==============================================================================
set -euo pipefail
DEST="${RR_AWS_SYSMON_DEST:-/home/rootrecord/Database/NETWORK/metrics/aws}"
HOST="${RR_AWS_SSH_HOST:-rr-aws}"
STAMP=$(date '+%Y%m%d-%H%M%S')
OUT="$DEST/aws-sysmon-${STAMP}.txt"
mkdir -p "$DEST"
{
  echo "# aws-sysmon $STAMP HST via $HOST"
  echo "## df"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" 'df -h'
  echo "## free"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" 'free -h'
  echo "## uptime"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" 'uptime; hostname; date'
  echo "## load / mem quick"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" 'cat /proc/loadavg; echo ---; head -5 /proc/meminfo'
  echo "## rr-packer env (names only)"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" 'systemctl show rr-packer -p Environment --no-pager | tr " " "\n" | sed -E "s/=.*/=***/" | head -40'
} > "$OUT"
echo "aws-sysmon-pull: wrote $OUT"
