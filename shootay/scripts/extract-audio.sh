#!/usr/bin/env bash
# Extracts the audio from the four supplied soundtrack recordings and writes browser-ready OGG files
# plus the manifest the in-game music player reads.
#
#   1. Copy 255.mp4, 257.mp4, 221.mp4 and 201.mp4 into  assets/music-src/
#   2. npm run audio:extract
#
# The audio is only transcoded (Vorbis ~160 kbps, original sample rate and channels): no effects,
# trimming, normalisation or substitution. A missing source file is an error — nothing is generated
# in its place. Only distribute these recordings if you hold the rights or the artists' permission.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/music-src; OUT=assets/music
TRACKS=(255 257 221 201)
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (apt install ffmpeg / brew install ffmpeg)"; exit 1; }
missing=0
for t in "${TRACKS[@]}"; do [ -f "$SRC/$t.mp4" ] || { echo "MISSING: $SRC/$t.mp4"; missing=1; }; done
[ "$missing" = 0 ] || { echo "Add the missing recordings to $SRC and run again. Nothing was written."; exit 1; }
mkdir -p "$OUT"
entries=()
for t in "${TRACKS[@]}"; do
  ffmpeg -hide_banner -loglevel error -y -i "$SRC/$t.mp4" -vn -map_metadata -1 -c:a libvorbis -q:a 5 "$OUT/$t.ogg"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$t.ogg")
  # the title comes from the file's own metadata when present, otherwise the supplied file name
  title=$(ffprobe -v error -show_entries format_tags=title -of csv=p=0 "$SRC/$t.mp4" | head -n1 | tr -d '"\\')
  [ -n "$title" ] || title="Track $t"
  entries+=("    { \"title\": \"$title\", \"file\": \"$t.ogg\", \"source\": \"$t.mp4\", \"duration\": $dur }")
  echo "extracted $t.mp4 -> $OUT/$t.ogg (${dur}s)"
done
{ echo '{'; echo '  "tracks": ['; ( IFS=$',\n'; printf '%s' "$(printf '%s,\n' "${entries[@]}" | sed '$ s/,$//')" ); echo; echo '  ]'; echo '}'; } > "$OUT/manifest.json"
echo "wrote $OUT/manifest.json"
