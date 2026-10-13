#!/usr/bin/env bash
# Static verification for DeckyCRT. Run before packaging a release.
#
# Covers what can be checked without the device:
#   - backend parses (python syntax)
#   - frontend typechecks (tsc — this is a gate, not decoration)
#   - frontend builds, and the bundle is byte-reproducible
#   - the shipped bundle actually contains the code that was just written
#
# Device-side checks (needs the BC-250) are documented in README.md under
# "Verifying a change" — they cover what static analysis cannot: whether
# Gamescope accepts each shader, and whether the panel's data contract holds
# against the real preset list.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== python syntax =="
python3 -m py_compile main.py && echo "   main.py OK"

echo "== launch-option unit tests =="
node scripts/test-launch-options.ts

echo "== backend harness (stubbed decky, throwaway home) =="
python3 scripts/test-backend.py | sed 's/^/   /'

echo "== typescript (gate) =="
pnpm exec tsc --noEmit
echo "   tsc clean"

echo "== build =="
pnpm run build >/dev/null
FIRST=$(sha256sum dist/index.js | cut -d' ' -f1)
echo "   dist/index.js $FIRST"

echo "== bundle contents =="
for sym in toastError sliderValue paramIsUsable installWrapper removeWrapper foreign-gamescope RegisterForAppDetails check_wrapper_crashes wrapped_running_apps 0.4.0-crashguard; do
  grep -q "$sym" dist/index.js || { echo "   MISSING $sym in bundle" >&2; exit 1; }
  echo "   $sym present"
done

echo "== rebuild reproducibility =="
cp dist/index.js /tmp/deckycrt-dist-check.js
pnpm run build >/dev/null
if cmp -s dist/index.js /tmp/deckycrt-dist-check.js; then
  echo "   reproducible (same bytes on a second build)"
else
  echo "   WARNING: second build differs — do not trust the committed bundle" >&2
fi
rm -f /tmp/deckycrt-dist-check.js

echo "OK"
