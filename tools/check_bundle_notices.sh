#!/usr/bin/env bash
# Check the notices and the example data of a desktop-app bundle.
#
#   check_bundle_notices.sh <resources/fastag dir of the bundle> [appimage]
#
# The folder must hold LICENSE; THIRD-PARTY-NOTICES.txt (the command-line
# closure) with licence texts, not only names; GUI-THIRD-PARTY-NOTICES.txt
# (tools/gui_third_party_notices.py) of a plausible size, naming the app's own
# stack (Tauri, React, IBM Plex) and carrying licence texts; with "appimage",
# its section on the system libraries the AppImage bundles; the vendor
# readers' state (below); and examples/Ecoli_MS2_small.mzML with the sha256 examples/README.md gives.
# Writes a line to the job summary when there is one. Exits 1 on the first
# failure.
set -euo pipefail
R=$1 kind=${2:-}
fail() { echo "::error::$R: $*"; exit 1; }
size() { wc -c < "$1" | tr -d ' '; }
[ -s "$R/LICENSE" ] || fail "no LICENSE"
cli="$R/THIRD-PARTY-NOTICES.txt" gui="$R/GUI-THIRD-PARTY-NOTICES.txt"
[ -s "$cli" ] || fail "no THIRD-PARTY-NOTICES.txt"
[ "$(size "$cli")" -gt 100000 ] || fail "THIRD-PARTY-NOTICES.txt is only $(size "$cli") bytes"
! grep -q "licence text not found" "$cli" || fail "THIRD-PARTY-NOTICES.txt lists a licence without its text"
[ -s "$gui" ] || fail "no GUI-THIRD-PARTY-NOTICES.txt"
[ "$(size "$gui")" -gt 200000 ] || fail "GUI-THIRD-PARTY-NOTICES.txt is only $(size "$gui") bytes"
for want in '^tauri ' '^wry ' '^react ' 'IBM Plex' '^\[T1\] used by' 'Permission is hereby granted' 'Apache License'; do
  grep -qE "$want" "$gui" || fail "GUI-THIRD-PARTY-NOTICES.txt has no line matching '$want'"
done
if [ "$kind" = appimage ]; then
  grep -q "^System libraries bundled in the AppImage" "$gui" || fail "the AppImage's GUI-THIRD-PARTY-NOTICES.txt has no section on its bundled libraries"
fi
# The vendor readers (1.15.2): every bundle but the AppImage carries the
# Thermo reader with its licence, notices and .NET runtime
# (tools/vendor_bundle.py check); the AppImage carries none of it and says so.
if [ "$kind" = appimage ]; then
  grep -q "does not include Thermo's RawFileReader" "$cli" || fail "the AppImage's THIRD-PARTY-NOTICES.txt does not say it has no Thermo reader"
  ! grep -q "Thermo RawFileReader -- licence terms" "$cli" || fail "the AppImage's THIRD-PARTY-NOTICES.txt states Thermo terms"
else
  python3 "$(dirname "$0")/vendor_bundle.py" check --root "$R" --exe-dir "$R/bin" --share "$R/share/OpenMS" \
    || fail "the Thermo reader, its licence or its notices are incomplete"
fi
ex="$R/examples/Ecoli_MS2_small.mzML"
[ -s "$ex" ] || fail "no examples/Ecoli_MS2_small.mzML"
want=30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e
got=$( (command -v sha256sum >/dev/null && sha256sum "$ex" || shasum -a 256 "$ex") | cut -d' ' -f1)
[ "$got" = "$want" ] || fail "examples/Ecoli_MS2_small.mzML has sha256 $got, not $want"
msg="notices in $R: THIRD-PARTY-NOTICES.txt $(size "$cli") bytes, GUI-THIRD-PARTY-NOTICES.txt $(size "$gui") bytes ($(grep -c '^\[T[0-9]*\] used by' "$gui") licence texts)${kind:+, $kind section}; example data present"
echo "$msg"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $msg" >> "$GITHUB_STEP_SUMMARY"
exit 0
