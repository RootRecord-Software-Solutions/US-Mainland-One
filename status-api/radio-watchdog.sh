#!/bin/bash
# One station. Start it when a release is ready. Leave a healthy one alone.
# A second copy is stopped. A heartbeat older than 30 seconds is a hung mixer.
set -u

exec 9>/tmp/rr-radio-watchdog.lock
flock -n 9 || exit 0

ROOT="${RADIO_ROOT:-/home/ubuntu/rootrecord-radio}"
UNIT="${RADIO_UNIT:-rr-radio-station.service}"
mkdir -p "$ROOT/state" "$ROOT/releases"

if [[ ! -f "$ROOT/active/stream.js" || ! -f "$ROOT/active/radio.js" ]]; then
  sha=""
  if [[ -f "$ROOT/releases/staged" ]]; then
    sha="$(tr -d '[:space:]' < "$ROOT/releases/staged")"
  fi
  if [[ -n "$sha" && -f "$ROOT/releases/$sha/stream.js" && -f "$ROOT/releases/$sha/radio.js" ]]; then
    ln -sfn "$ROOT/releases/$sha" "$ROOT/active"
    rm -f "$ROOT/deploy-pending"
    echo "event=watch_activate sha=$sha"
  fi
fi

if [[ ! -x "$ROOT/radio-run.sh" || ! -f "$ROOT/active/stream.js" ]]; then
  echo "event=watch_wait reason=no_station"
  exit 0
fi

runners=()
nodes=()
for proc in /proc/[0-9]*; do
  pid="${proc##*/}"
  [[ -r "$proc/cmdline" ]] || continue
  cmd="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
  [[ "$cmd" == *"$ROOT/radio-run.sh"* ]] && runners+=("$pid")
  [[ "$cmd" == *"/stream.js"* && "$cmd" == *"$ROOT/"* ]] && nodes+=("$pid")
done

if [[ ${#runners[@]} -gt 1 ]]; then
  keep="${runners[0]}"
  for pid in "${runners[@]:1}"; do
    kill "$pid" 2>/dev/null || true
    echo "event=watch_single_instance killed=$pid keep=$keep"
  done
  runners=("$keep")
fi

heartbeat="$ROOT/state/heartbeat"
age=-1
if [[ -f "$heartbeat" ]]; then
  age="$(( $(date +%s) - $(stat -c %Y "$heartbeat") ))"
fi

ctl() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

service_up=0
if systemctl cat "$UNIT" >/dev/null 2>&1; then
  systemctl is-active --quiet "$UNIT" && service_up=1
  if [[ "$service_up" -eq 0 && ( ${#runners[@]} -gt 0 || ${#nodes[@]} -gt 0 ) ]]; then
    for pid in "${runners[@]}" "${nodes[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
    runners=()
    nodes=()
    echo "event=watch_single_instance reason=outside_service"
  fi
  if [[ "$service_up" -eq 0 ]]; then
    ctl systemctl start "$UNIT"
    echo "event=watch_start unit=$UNIT"
  elif [[ "$age" -gt 30 ]]; then
    ctl systemctl restart "$UNIT"
    echo "event=watch_restart reason=heartbeat age=$age"
  else
    echo "event=watch_ok unit=$UNIT age=$age"
  fi
  exit 0
fi

if [[ ${#runners[@]} -eq 0 && ${#nodes[@]} -eq 0 ]]; then
  setsid "$ROOT/radio-run.sh" >> "$ROOT/state/station.log" 2>&1 < /dev/null &
  echo $! > "$ROOT/state/station.pid"
  echo "event=watch_start pid=$!"
elif [[ "$age" -gt 30 ]]; then
  for pid in "${runners[@]}" "${nodes[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  setsid "$ROOT/radio-run.sh" >> "$ROOT/state/station.log" 2>&1 < /dev/null &
  echo $! > "$ROOT/state/station.pid"
  echo "event=watch_restart reason=heartbeat age=$age pid=$!"
else
  echo "event=watch_ok runners=${#runners[@]} nodes=${#nodes[@]} age=$age"
fi
