#!/usr/bin/env bash
# remote-activate.sh REL TS [FAIL_HEALTH]: runs ON AWS (sent by deploy-aws-fallback.sh --apply). Desk-canonical.
# lock -> verify manifest -> dated backup -> layout + missing flags -> install changed system files
# -> atomic app symlink swap (app.prev kept) -> apply plan must be "in sync" -> timers -> one tick -> health
# -> on any failure: rollback (previous release + system files restored from the backup).
set -euo pipefail
REL="$1"; TS="$2"; FAIL_HEALTH="${3:-0}"
R=/home/ubuntu/rootrecord/fallback; NEW="$R/releases/$REL.new"; B="/home/ubuntu/rootrecord/bin.bak-fallback-deploy-$TS"
UNITS="rr-fallback-runner.service rr-fallback-runner.timer rr-fallback-apply.service rr-fallback-apply.path rr-fallback-apply.timer"
log(){ echo "$(TZ=Pacific/Honolulu date '+%F %T HST') $*" | tee -a "$R/logs/deploy.log"; }
mkdir -p "$R/logs" "$R/releases"
exec 9>/home/ubuntu/rootrecord/.fallback-deploy.lock
flock -n 9 || { echo "another deploy is running"; exit 4; }
( cd "$NEW" && sha256sum -c --quiet MANIFEST.sha256 ) || { log "REL $REL manifest verify FAILED"; rm -rf "$NEW"; exit 5; }
log "REL $REL manifest OK"

# ---- backup (before any change)
mkdir -p "$B/system"
[ -L "$R/app" ] && readlink "$R/app" > "$B/app.target" || true
[ -L "$R/app.prev" ] && readlink "$R/app.prev" > "$B/app.prev.target" || true
[ -d "$R/flags" ] && cp -a "$R/flags" "$B/flags" || true
[ -f "$R/budget.json" ] && cp -p "$R/budget.json" "$B/" || true
crontab -l > "$B/crontab" 2>/dev/null || true
declare -A DST=(
  [rr-fallback-runner.service]=/etc/systemd/system/rr-fallback-runner.service
  [rr-fallback-runner.timer]=/etc/systemd/system/rr-fallback-runner.timer
  [rr-fallback-apply.service]=/etc/systemd/system/rr-fallback-apply.service
  [rr-fallback-apply.path]=/etc/systemd/system/rr-fallback-apply.path
  [rr-fallback-apply.timer]=/etc/systemd/system/rr-fallback-apply.timer
  [journald-60-rootrecord-caps.conf]=/etc/systemd/journald.conf.d/60-rootrecord-caps.conf
  [logrotate-rootrecord-fallback]=/etc/logrotate.d/rootrecord-fallback
  [rr-fallback-apply]=/usr/local/sbin/rr-fallback-apply
)
for k in "${!DST[@]}"; do d="${DST[$k]}"; if [ -e "$d" ]; then sudo cp -p "$d" "$B/system/$k"; else echo "$k" >> "$B/system/ABSENT"; fi; done
for u in $UNITS; do echo "$u $(systemctl is-enabled $u 2>&1) $(systemctl is-active $u 2>&1)"; done > "$B/unit-states.txt"
sudo chown -R ubuntu:ubuntu "$B"
log "REL $REL backup $B"

PREV="$(readlink "$R/app" 2>/dev/null || true)"; PREVREL="$(basename "$(dirname "$PREV")" 2>/dev/null)"; JCHANGED=0
rollback(){
  log "REL $REL ROLLBACK: $*"
  if [ -n "$PREV" ]; then ln -sfn "$PREV" "$R/app.tmp" && mv -T "$R/app.tmp" "$R/app"
    if [ -f "$B/app.prev.target" ]; then ln -sfn "$(cat "$B/app.prev.target")" "$R/app.prev.tmp" && mv -T "$R/app.prev.tmp" "$R/app.prev"; else rm -f "$R/app.prev"; fi
  else sudo systemctl disable --now rr-fallback-runner.timer rr-fallback-apply.path rr-fallback-apply.timer 2>/dev/null || true; rm -f "$R/app"; fi
  for k in "${!DST[@]}"; do d="${DST[$k]}"
    m=0644; [ "$k" = rr-fallback-apply ] && m=0755
    if [ -f "$B/system/$k" ]; then sudo install -o root -g root -m $m "$B/system/$k" "$d"; elif grep -qx "$k" "$B/system/ABSENT" 2>/dev/null; then sudo rm -f "$d"; fi; done
  sudo systemctl daemon-reload
  [ "$JCHANGED" = 1 ] && sudo systemctl restart systemd-journald || true
  [ -d "$R/releases/$REL" ] && mv -T "$R/releases/$REL" "$R/releases/$REL.failed-$TS" || true
  sudo systemctl start rr-fallback-runner.service 2>/dev/null || true   # refresh status.json from the restored release
  log "REL $REL rolled back to ${PREV:-<none: fallback units disabled>}"
  exit 7
}

# ---- layout, release, flags (only missing ones), budget (only if missing)
mkdir -p "$R"/{flags,state,logs,spool,data/current,releases}
mv -T "$NEW" "$R/releases/$REL"
while read -r id val _; do
  [[ "$id" =~ ^[a-z0-9_]{2,40}$ && "$val" =~ ^[01]$ ]] || continue
  if [ ! -e "$R/flags/$id" ]; then printf '%s\n' "$val" > "$R/flags/.$id.tmp"; mv -f "$R/flags/.$id.tmp" "$R/flags/$id"; log "flag created $id=$val"; fi
done < "$R/releases/$REL/profile/trimmed-micro.flags"
[ -f "$R/budget.json" ] || cp "$R/releases/$REL/profile/budget.json" "$R/budget.json"

# ---- system files (only when changed)
S="$R/releases/$REL"
src(){ case "$1" in rr-fallback-apply) echo "$S/app/$1";; *) echo "$S/system/$1";; esac; }
sudo mkdir -p /etc/systemd/journald.conf.d
for k in "${!DST[@]}"; do d="${DST[$k]}"; s="$(src "$k")"; m=0644; [ "$k" = rr-fallback-apply ] && m=0755
  if ! sudo cmp -s "$s" "$d" 2>/dev/null; then sudo install -o root -g root -m $m "$s" "$d"; log "installed $d"; [ "$k" = journald-60-rootrecord-caps.conf ] && JCHANGED=1; fi; done
sudo systemctl daemon-reload || rollback "daemon-reload failed"
[ "$JCHANGED" = 1 ] && { sudo systemctl restart systemd-journald || rollback "journald restart failed"; }
sudo logrotate -d /etc/logrotate.d/rootrecord-fallback >/dev/null 2>&1 || rollback "logrotate config invalid"

# ---- atomic swap
ln -sfn "releases/$REL/app" "$R/app.tmp" && mv -T "$R/app.tmp" "$R/app"   # app -> releases/<REL>/app
[ -n "$PREV" ] && ln -sfn "$PREV" "$R/app.prev.tmp" && mv -T "$R/app.prev.tmp" "$R/app.prev"
log "REL $REL active (prev ${PREV:-none})"

# ---- the deploy never changes service states: the flag plan must already be in sync
PLAN="$(sudo /usr/local/sbin/rr-fallback-apply --dry-run 2>&1)" || rollback "apply dry-run error: $PLAN"
echo "$PLAN" | grep -q "in sync" || rollback "flags not in sync with services: $PLAN"
sudo systemctl enable --now rr-fallback-runner.timer rr-fallback-apply.path rr-fallback-apply.timer >/dev/null 2>&1 || rollback "enable units failed"
sudo systemctl start rr-fallback-runner.service || rollback "tick failed"

# ---- health
H=ok
[ "$(systemctl show -p Result --value rr-fallback-runner.service)" = success ] || H="tick result not success"
python3 - "$R/data/current/status.json" "$REL" <<'PY' || H="status.json stale/invalid or wrong release"
import json,sys,time
s=json.load(open(sys.argv[1])); assert time.time()-s["ts"]<90 and s["release"]==sys.argv[2], s.get("release")
PY
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8090/health)" = 200 ] || H="globe /health not 200"
systemctl is-active --quiet cloudflared-network-globe || H="tunnel inactive"
[ "$FAIL_HEALTH" = 1 ] && H="forced health failure (rollback test)"
[ "$H" = ok ] || rollback "health: $H"
for d in $(ls -1d "$R"/releases/*/ 2>/dev/null | grep -v -e "/$REL/" -e "/${PREVREL:-none}/" | head -n -3); do rm -rf "$d"; log "pruned $d"; done
log "REL $REL HEALTH OK"
