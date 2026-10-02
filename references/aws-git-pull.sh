#!/bin/bash
# Fast-forward the mainland checkout. Stage a radio release when the engine
# bytes change. This script must not restart the station. Restart the status
# API when server.js or radio.js changed. The live globe under
# /home/ubuntu/network-globe is a separate copy and is not updated here.
set -u

REPO="/home/ubuntu/US-Mainland-Server"
API_DIR="$REPO/status-api"
RADIO_ROOT="/home/ubuntu/rootrecord-radio"
RELEASES="$RADIO_ROOT/releases"

cd "$REPO" || exit 1

tracked_dirty() {
  git status --porcelain | awk '$1 != "??" { print }'
}

dirty="$(tracked_dirty)"
if [[ -n "$dirty" ]]; then
  echo "aws-git-pull: dirty checkout, skip"
  printf '%s\n' "$dirty"
  exit 1
fi

fingerprint() {
  sha256sum "$API_DIR/server.js" "$API_DIR/radio.js" 2>/dev/null | sha256sum | awk '{print $1}'
}

before="$(fingerprint)"

git pull --ff-only
rc=$?
if [[ "$rc" -ne 0 ]]; then
  echo "aws-git-pull: pull failed"
  exit "$rc"
fi

after="$(fingerprint)"

watch_src="$API_DIR/radio-watch.sh"
watch_dst="$RADIO_ROOT/radio-watch.sh"
if [[ -f "$watch_src" ]]; then
  mkdir -p "$(dirname "$watch_dst")"
  if ! cmp -s "$watch_src" "$watch_dst"; then
    cp "$watch_src" "$watch_dst"
    chmod 755 "$watch_dst"
    echo "aws-git-pull: installed radio-watch.sh"
  fi
fi

run_src="$API_DIR/radio-run.sh"
run_dst="$RADIO_ROOT/radio-run.sh"
if [[ -f "$run_src" ]]; then
  mkdir -p "$(dirname "$run_dst")"
  if ! cmp -s "$run_src" "$run_dst"; then
    cp "$run_src" "$run_dst"
    chmod 755 "$run_dst"
    echo "aws-git-pull: installed radio-run.sh"
  fi
fi

stream_src="$API_DIR/stream.js"
radio_src="$API_DIR/radio.js"
if [[ -f "$stream_src" && -f "$radio_src" ]]; then
  sha="$(git rev-parse HEAD)"
  ref=""
  if [[ -f "$RELEASES/staged" ]]; then
    ref="$(tr -d '[:space:]' < "$RELEASES/staged")"
  fi
  same=0
  if [[ -n "$ref" && -f "$RELEASES/$ref/stream.js" && -f "$RELEASES/$ref/radio.js" ]]; then
    if cmp -s "$stream_src" "$RELEASES/$ref/stream.js" && cmp -s "$radio_src" "$RELEASES/$ref/radio.js"; then
      same=1
    fi
  fi
  if [[ "$same" -eq 0 ]]; then
    dest="$RELEASES/$sha"
    mkdir -p "$dest"
    cp "$stream_src" "$dest/stream.js"
    cp "$radio_src" "$dest/radio.js"
    if ! /usr/bin/node --check "$dest/stream.js"; then
      echo "aws-git-pull: stream.js failed node --check"
      rm -rf "$dest"
      exit 1
    fi
    if ! /usr/bin/node --check "$dest/radio.js"; then
      echo "aws-git-pull: radio.js failed node --check"
      rm -rf "$dest"
      exit 1
    fi
    if [[ -n "$ref" && "$ref" != "$sha" ]]; then
      printf '%s\n' "$ref" > "$RELEASES/previous"
    fi
    printf '%s\n' "$sha" > "$RELEASES/staged"
    printf '%s\n' "$sha" > "$RADIO_ROOT/deploy-pending"
    echo "aws-git-pull: deploy pending $sha"
    active_target=""
    if [[ -L "$RADIO_ROOT/active" || -d "$RADIO_ROOT/active" ]]; then
      active_target="$(readlink -f "$RADIO_ROOT/active" || true)"
    fi
    keep_prev=""
    [[ -f "$RELEASES/previous" ]] && keep_prev="$(tr -d '[:space:]' < "$RELEASES/previous")"
    shopt -s nullglob
    for dir in "$RELEASES"/*/; do
      base="$(basename "$dir")"
      [[ "$base" == "$sha" || "$base" == "$keep_prev" ]] && continue
      if [[ -n "$active_target" && "$(readlink -f "$dir")" == "$active_target" ]]; then
        continue
      fi
      rm -rf "$dir"
      echo "aws-git-pull: removed release $base"
    done
    shopt -u nullglob
  fi
fi

music_src="$API_DIR/install-music.sh"
if [[ -f "$music_src" ]]; then
  chmod 755 "$music_src"
  RADIO_ROOT="$RADIO_ROOT" "$music_src"
  echo "aws-git-pull: install-music"
fi

src_chimes="$REPO/rootrecord-radio/audio/chimes"
dest_chimes="$RADIO_ROOT/audio/chimes"
if [[ -d "$src_chimes" ]]; then
  mkdir -p "$dest_chimes"
  cp -a "$src_chimes/." "$dest_chimes/"
  echo "aws-git-pull: copied chimes"
fi

if [[ -n "$after" && "$before" != "$after" ]]; then
  sudo -n systemctl restart rr-status-api.service
  echo "aws-git-pull: restarted status api"
fi

exit 0
