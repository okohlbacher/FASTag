#!/usr/bin/env bash
# Run the tauri-driver specs (app.test.mjs) on Linux. Usage:
#
#   dbus-run-session -- xvfb-run -a bash e2e-tauri/run.sh stub|real
#
# stub: the app runs gui/testing/stub-fastag/FASTag (every PR).
# real: the app runs the CLI in its own resources/fastag (before a tag: the
#       portable linux-x64 CLI staged by ci.yml, or an installed .deb).
#
# FASTAG_APP names the app (default: the debug build in src-tauri/target);
# E2E_ONLY, if set, runs only the specs whose name matches it (a regex);
# tauri-driver and WebKitWebDriver must be on PATH. The app's settings and
# history go to a throwaway XDG folder, so a run starts like a fresh install.
set -euo pipefail
MODE=${1:?usage: run.sh stub|real}
GUI=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$GUI/.." && pwd)
export FASTAG_APP=${FASTAG_APP:-$GUI/src-tauri/target/debug/fastag}
export E2E_CLI=$MODE
export E2E_OUT=${E2E_OUT:-$GUI/e2e-tauri/results}
XDG=$(mktemp -d)
export XDG_DATA_HOME=$XDG/data XDG_CONFIG_HOME=$XDG/config XDG_CACHE_HOME=$XDG/cache
# Software rendering: the runners have no GPU, and WebKitGTK's compositing
# mode fails without one on some images.
export LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1
case "$MODE" in
  stub) export FASTAG_BIN=$GUI/testing/stub-fastag/FASTag ;;
  real)
    unset FASTAG_BIN
    export E2E_MZML=${E2E_MZML:-$REPO/test/fixtures/Ecoli_MS2_small.mzML}
    export E2E_VERSION=${E2E_VERSION:-$(sed -n 's/^project(FASTag VERSION \([0-9.]*\).*/\1/p' "$REPO/CMakeLists.txt")}
    ;;
  *) echo "run.sh: mode must be stub or real, not $MODE" >&2; exit 2 ;;
esac
[ -x "$FASTAG_APP" ] || { echo "run.sh: no app at $FASTAG_APP" >&2; exit 2; }
command -v tauri-driver >/dev/null || { echo "run.sh: tauri-driver is not on PATH" >&2; exit 2; }
command -v WebKitWebDriver >/dev/null || { echo "run.sh: WebKitWebDriver is not on PATH (apt: webkit2gtk-driver)" >&2; exit 2; }

node --test "$GUI/e2e-tauri/wd.test.mjs"

mkdir -p "$E2E_OUT"
tauri-driver --port 4444 > "$E2E_OUT/tauri-driver-$MODE.log" 2>&1 &
DRIVER=$!
trap 'kill $DRIVER 2>/dev/null || true; pkill -f -- "$FASTAG_APP" 2>/dev/null || true; rm -rf "$XDG"' EXIT
for _ in $(seq 1 100); do
  curl -fsS http://127.0.0.1:4444/status >/dev/null 2>&1 && break
  kill -0 $DRIVER 2>/dev/null || { cat "$E2E_OUT/tauri-driver-$MODE.log"; exit 1; }
  sleep 0.2
done
cd "$GUI"
node --test --test-concurrency=1 --test-reporter=spec ${E2E_ONLY:+"--test-name-pattern=$E2E_ONLY"} e2e-tauri/app.test.mjs
