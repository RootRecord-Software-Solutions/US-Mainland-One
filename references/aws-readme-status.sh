#!/bin/bash
# Rewrite the AWS status block in README.md and push that file to GitHub.
# One commit of README.md. No backup copy of the file.
set -u

REPO="/home/ubuntu/US-Mainland-Server"
REMOTE="git@github.com:RootRecord-Software-Solutions/US-Mainland-One.git"
KEY="/home/ubuntu/.ssh/mainland-status-ed25519"
PLAY_LOG="/home/ubuntu/rootrecord-radio/plays.log"

cd "$REPO" || exit 1
[[ -f "$KEY" ]] || { echo "missing deploy key $KEY" >&2; exit 1; }

if ! git pull --ff-only; then
  echo "pull failed; README not pushed" >&2
  exit 1
fi

unit_state() {
  local unit="$1"
  local active enabled
  active="$(systemctl is-active "$unit" 2>/dev/null || true)"
  enabled="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  [[ -n "$active" ]] || active="unknown"
  [[ -n "$enabled" ]] || enabled="unknown"
  printf '%s (%s)' "$active" "$enabled"
}

checked="$(TZ=Pacific/Honolulu date '+%Y-%m-%d %H:%M HST')"
sha="$(git rev-parse --short HEAD)"
subject="$(git log -1 --format='%s' | tr '|' '/')"
counts="$(git rev-list --left-right --count origin/main...HEAD 2>/dev/null | tr '\t' ' ' || true)"
[[ -n "$counts" ]] || counts="? ?"
behind="${counts%% *}"
ahead="${counts##* }"
if [[ "$behind" == "0" && "$ahead" == "0" ]]; then
  sync_state="even with GitHub"
elif [[ "$behind" == "0" ]]; then
  sync_state="ahead of GitHub by ${ahead}"
elif [[ "$ahead" == "0" ]]; then
  sync_state="behind GitHub by ${behind}"
else
  sync_state="diverged (behind ${behind}, ahead ${ahead})"
fi

dirty_names="$(git status --porcelain | sed -E 's/^.. //' | paste -sd ', ' -)"
if [[ -z "$dirty_names" ]]; then
  worktree="clean"
else
  worktree="local edits: ${dirty_names}"
fi

last_pull="$(sudo -n journalctl -u aws-git-pull.service -n 30 --no-pager -o short-iso 2>/dev/null | awk '/aws-git-pull.sh/ { line=$0 } END { print line }')"
if [[ -z "$last_pull" ]]; then
  last_pull="no journal line"
else
  last_pull="$(printf '%s' "$last_pull" | sed -E 's/ ip-[^ ]+ aws-git-pull.sh\[[0-9]+\]: / — /' | tr '|' '/')"
fi

disk="$(df -h / | awk 'NR==2 { printf "%s free of %s (%s used)", $4, $2, $5 }')"
uptime_text="$(uptime -p 2>/dev/null || uptime)"

plays=0
if [[ -f "$PLAY_LOG" ]]; then
  plays="$(grep -c . "$PLAY_LOG" 2>/dev/null || true)"
  [[ -n "$plays" ]] || plays=0
fi

block="$(cat <<EOF
<!-- aws-status:start -->
## Live status

The AWS host fills this block in and pushes it to GitHub. A desk publish keeps the block already on GitHub.

| | |
| --- | --- |
| Checked | ${checked} |
| Commit | \`${sha}\` ${subject} |
| Checkout | ${sync_state}; ${worktree} |
| Last pull | ${last_pull} |
| Disk | ${disk} |
| Uptime | ${uptime_text} |
| rr-status-api | $(unit_state rr-status-api.service) |
| network-globe-web | $(unit_state network-globe-web.service) |
| network-globe-feed | $(unit_state network-globe-feed-server.service) |
| network-globe-history | $(unit_state network-globe-connection-history.service) |
| cloudflared | $(unit_state cloudflared-network-globe.service) |
| aws-git-pull.timer | $(unit_state aws-git-pull.timer) |
| rr-pacific-fetch.timer | $(unit_state rr-pacific-fetch.timer) |
| rr-radio-plays-purge.timer | $(unit_state rr-radio-plays-purge.timer) |
| rr-radio-watch.timer | $(unit_state rr-radio-watch.timer) |
| rr-radio-stream | $(unit_state rr-radio-stream.service) |
| Play log | ${plays} line(s) since the hourly wipe |
<!-- aws-status:end -->
EOF
)"

python3 - "$REPO/README.md" "$block" << 'PY'
import pathlib, re, sys
path, block = sys.argv[1], sys.argv[2]
file = pathlib.Path(path)
text = file.read_text()
pat = re.compile(r"<!-- aws-status:start -->.*?<!-- aws-status:end -->", re.S)
if not pat.search(text):
    raise SystemExit("README has no aws-status markers")
file.write_text(pat.sub(lambda _m: block, text, count=1))
PY

if git diff --quiet -- README.md; then
  echo "README status unchanged"
  exit 0
fi

export GIT_AUTHOR_NAME="US-MAINLAND-ONE"
export GIT_AUTHOR_EMAIL="alexanderstorey94@gmail.com"
export GIT_COMMITTER_NAME="US-MAINLAND-ONE"
export GIT_COMMITTER_EMAIL="alexanderstorey94@gmail.com"

git add -- README.md
git commit -m "status: AWS live README $(date -u '+%Y-%m-%dT%H:%MZ')"
GIT_SSH_COMMAND="ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes" \
  git push "$REMOTE" HEAD:main
echo "README status pushed"
