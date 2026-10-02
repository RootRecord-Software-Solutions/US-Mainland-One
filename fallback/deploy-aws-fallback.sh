#!/usr/bin/env bash
# ==============================================================================
# deploy-aws-fallback.sh: ONE-WAY desk -> AWS deploy of the fallback runtime
#   ./deploy-aws-fallback.sh               dry-run (default): preflight + manifest + diff, changes nothing
#   ./deploy-aws-fallback.sh --apply       deploy: backup, verify, atomic swap, health, auto-rollback
#   ./deploy-aws-fallback.sh --apply --test-rollback   same, but force a failed health check (rollback test)
# INFO (future agents): must read
# - The desk is canonical; AWS never commits or pulls. Nothing under ~/.env or any secret is copied.
# - Flags are STATE (Root Monitor owns them): the deploy only creates missing flags from profile/.
# - The deploy never starts/stops globe or legacy services: rr-fallback-apply --dry-run must be "in sync".
# - Remote backup: ~/rootrecord/bin.bak-fallback-deploy-<HST ts>/; desk log 2 - RootRecord-Database/Logs/Network/aws-fallback-deploy.log
# ==============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALIAS="${RR_AWS_ALIAS:-rr-aws-ip}"
MODE=dry-run; FAIL=0
for a in "$@"; do case "$a" in --apply) MODE=apply;; --dry-run) MODE=dry-run;; --test-rollback) FAIL=1;;
  *) echo "usage: $0 [--dry-run|--apply] [--test-rollback]"; exit 2;; esac; done
R=/home/ubuntu/rootrecord/fallback
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS")
TS="$(TZ=Pacific/Honolulu date +%Y%m%d-%H%M%S)"
DLOG="/home/rootrecord/RootRecord-Ecosystem/2 - RootRecord-Database/Logs/Network/aws-fallback-deploy.log"; mkdir -p "$(dirname "$DLOG")"
say(){ echo "$(TZ=Pacific/Honolulu date '+%F %T HST') [$MODE] $*" | tee -a "$DLOG"; }

# ---- stage + manifest
ST="$(mktemp -d /tmp/rr-fallback-stage.XXXXXX)"; trap 'rm -rf "$ST"' EXIT
cp -a "$HERE/app" "$HERE/system" "$HERE/profile" "$HERE/deploy" "$ST/"
find "$ST" -name __pycache__ -prune -exec rm -rf {} +
( cd "$ST" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256 )
REL="$TS-$(sha256sum "$ST/MANIFEST.sha256" | cut -c1-8)"
echo "$REL" > "$ST/VERSION"; ( cd "$ST" && sha256sum ./VERSION >> MANIFEST.sha256 )
say "release $REL ($(wc -l < "$ST/MANIFEST.sha256") files) -> $ALIAS"

# ---- preflight
PRE="$("${SSH[@]}" "awk '/MemAvailable/{print int(\$2/1024)}' /proc/meminfo; df -Pm / | awk 'NR==2{print \$4}'; readlink $R/app 2>/dev/null || echo none")" \
  || { say "preflight: $ALIAS unreachable"; exit 3; }
read -r AV DF CUR <<<"$(echo $PRE)"
say "preflight: MemAvailable ${AV} MB, disk free ${DF} MB, current app -> ${CUR}"
(( DF >= 1600 )) || { say "preflight FAILED: disk free ${DF} MB < 1600"; exit 3; }

# ---- diff
if [ "$CUR" != none ]; then
  say "diff vs current release (rsync -n --checksum):"
  rsync -n -rc --delete -i -e "ssh -o BatchMode=yes" --exclude VERSION --exclude MANIFEST.sha256 "$ST/" "$ALIAS:$R/$(dirname "$CUR")/" | sed 's/^/    /' | tee -a "$DLOG" || true
else
  say "first install: no current release"
fi
"${SSH[@]}" "for p in /etc/systemd/system/rr-fallback-runner.service /etc/systemd/system/rr-fallback-runner.timer /etc/systemd/system/rr-fallback-apply.service /etc/systemd/system/rr-fallback-apply.path /etc/systemd/system/rr-fallback-apply.timer /etc/systemd/journald.conf.d/60-rootrecord-caps.conf /etc/logrotate.d/rootrecord-fallback /usr/local/sbin/rr-fallback-apply; do [ -e \$p ] && sha256sum \$p || echo \"ABSENT \$p\"; done" > "$ST/.remote-sys" || true
while read -r h p; do b="$(basename "$p")"; case "$b" in 60-rootrecord-caps.conf) l="$ST/system/journald-60-rootrecord-caps.conf";; rootrecord-fallback) l="$ST/system/logrotate-rootrecord-fallback";; rr-fallback-apply) l="$ST/app/rr-fallback-apply";; *) l="$ST/system/$b";; esac
  if [ "$h" = ABSENT ]; then say "  system: would INSTALL $p"; elif [ "$(sha256sum "$l" | cut -d' ' -f1)" != "$h" ]; then say "  system: would UPDATE $p"; else say "  system: unchanged $p"; fi
done < "$ST/.remote-sys"; rm -f "$ST/.remote-sys"
MISSING="$(awk '/^[a-z0-9_]+ [01]/{print $1"="$2}' "$HERE/profile/trimmed-micro.flags" | "${SSH[@]}" "while IFS== read -r i v; do [ -e $R/flags/\$i ] || echo \"\$i=\$v\"; done" | tr '\n' ' ')"
say "flags that would be created (existing flags are never overwritten): ${MISSING:-none}"

if [ "$MODE" = dry-run ]; then say "DRY-RUN complete: nothing changed on $ALIAS"; exit 0; fi

# ---- apply
say "apply: rsync -> $R/releases/$REL.new"
"${SSH[@]}" "mkdir -p $R/releases $R/logs"
rsync -rc -e "ssh -o BatchMode=yes" "$ST/" "$ALIAS:$R/releases/$REL.new/"
set +e
"${SSH[@]}" "bash $R/releases/$REL.new/deploy/remote-activate.sh '$REL' '$TS' '$FAIL'" 2>&1 | tee -a "$DLOG"
RC=${PIPESTATUS[0]}; set -e
case $RC in 0) say "DEPLOYED $REL (health OK)";; 7) say "ROLLED BACK $REL (health/activation failed) rc=7";; *) say "FAILED $REL rc=$RC";; esac
exit $RC
