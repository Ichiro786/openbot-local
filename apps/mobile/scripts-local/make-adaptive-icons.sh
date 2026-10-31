#!/usr/bin/env bash
# OpenBot Local: build Android adaptive-icon layers from the splash "eyes" glyph.
#   assets/icons/adaptive-monochrome.png  white glyph on transparent (Android 13+ themed / Monet icon)
#   assets/icons/adaptive-foreground.png  dark glyph on transparent (used with backgroundColor in app.json)
# Canvas 1024x1024; glyph scaled to ~43% (bounding box fits the 66/108 safe-zone circle) so it sits inside the 66/108 adaptive-icon safe zone.
# Needs ImageMagick (`magick` v7 or `convert` v6). Run from apps/mobile.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=assets/splash/eyes.png
OUT=assets/icons
IM=$(command -v magick || command -v convert)
SIZE=1024
GLYPH=440

# Alpha mask = darkness of the glyph (flatten on white first so a transparent background stays empty).
"$IM" "$SRC" -background white -alpha remove -alpha off -colorspace Gray -negate \
  -trim +repage -resize "${GLYPH}x${GLYPH}" \
  -gravity center -background black -extent "${SIZE}x${SIZE}" /tmp/obl-mask.png

"$IM" -size "${SIZE}x${SIZE}" xc:white /tmp/obl-mask.png -alpha off -compose CopyOpacity -composite \
  "PNG32:$OUT/adaptive-monochrome.png"
"$IM" -size "${SIZE}x${SIZE}" xc:'#0B0710' /tmp/obl-mask.png -alpha off -compose CopyOpacity -composite \
  "PNG32:$OUT/adaptive-foreground.png"

rm -f /tmp/obl-mask.png
echo "wrote $OUT/adaptive-monochrome.png and $OUT/adaptive-foreground.png"
