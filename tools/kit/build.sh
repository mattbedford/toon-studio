#!/usr/bin/env bash
# Rebuild the kit for one character from incoming/<char>: ./tools/kit/build.sh boy
# Steps 01 to 05 are per character. Step 06 is run for both characters together so they can share a canvas;
# it needs data/kit/<char>/landmarks.json for each (hand-measured, see 06_normalise.py).
set -euo pipefail
CHAR="${1:?usage: build.sh <character>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."

python3 -I "$HERE/01_inventory.py" "$CHAR"
python3 -I "$HERE/02_convert.py" "$CHAR"
python3 -I "$HERE/03_remove_bg.py" "$CHAR"
python3 -I "$HERE/04_crop.py" "$CHAR"
python3 -I "$HERE/05_colour_match.py" "$CHAR"

CHARS=()
for c in boy girl; do
  [ -f "data/kit/$c/landmarks.json" ] && CHARS+=("$c")
done
python3 -I "$HERE/06_normalise.py" "${CHARS[@]}"

python3 -I "$HERE/07_faces_slice.py" "$CHAR"
python3 -I "$HERE/07_faces_assemble.py" "$CHAR"

python3 -I "$HERE/08_character_json.py" "$CHAR"
python3 -I "$HERE/09_report.py" "$CHAR"
# The shipped fixture is only the boy, at half size; the full kits stay in data/characters/.
[ "$CHAR" = boy ] && python3 -I "$HERE/10_fixture.py" boy 0.5
