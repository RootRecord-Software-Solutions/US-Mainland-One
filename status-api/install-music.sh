#!/bin/bash
# aws-git-pull should call this script after a fast-forward.
# Copy the music bed and library.json from this checkout into the runtime
# audio directory. Extra files already there stay. audio/reports is not touched.
set -u

REAL="$(readlink -f "$0")"
REPO="$(cd "$(dirname "$REAL")/.." && pwd)"
SRC_MUSIC="$REPO/rootrecord-radio/audio/music"
SRC_LIBRARY="$REPO/rootrecord-radio/audio/library.json"
RUNTIME="${RADIO_ROOT:-/home/ubuntu/rootrecord-radio}"
DEST_AUDIO="$RUNTIME/audio"
DEST_MUSIC="$DEST_AUDIO/music"

if [[ ! -d "$SRC_MUSIC" ]]; then
  echo "install-music: missing $SRC_MUSIC" >&2
  exit 1
fi
if [[ ! -f "$SRC_LIBRARY" ]]; then
  echo "install-music: missing $SRC_LIBRARY" >&2
  exit 1
fi

mkdir -p "$DEST_MUSIC"

src_real="$(readlink -f "$SRC_MUSIC")"
dest_real="$(readlink -f "$DEST_MUSIC")"
if [[ "$src_real" == "$dest_real" ]]; then
  echo "install-music: music already in the runtime directory"
  exit 0
fi

cp -a "$SRC_MUSIC/." "$DEST_MUSIC/"
cp -a "$SRC_LIBRARY" "$DEST_AUDIO/library.json"
echo "install-music: copied music and library.json"
