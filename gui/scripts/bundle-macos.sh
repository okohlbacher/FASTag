#!/usr/bin/env bash
# Assemble the self-contained macOS resource tree the Tauri app bundles:
#
#   resources/fastag/
#     bin/FASTag              the CLI, install names rewritten to @executable_path/../lib
#     lib/*.dylib             its full dylib closure, with exactly ONE libomp
#     share/OpenMS/           OpenMS data (OPENMS_DATA_PATH)
#     share/FASTag/taxonomy/  the k-mer index + NCBI dumps (FASTAG_TAXONOMY_DIR)
#     share/FASTag/digest/    the -digest_out models, -massgap_out modifications
#     share/FASTag/alkylation/ the -alkylation_proteome proteomes (UniProt, CC BY 4.0)
#
# Bundling libomp exactly once is what avoids `OMP: Error #15 (libomp already
# initialized)` without KMP_DUPLICATE_LIB_OK. Tauri's resource bundler skips
# symlinked dirs, so everything here must be real files.
#
# Inputs (env, with local-dev defaults):
#   FASTAG_BIN     the built CLI                     [build-rel/FASTag]
#   OPENMS_LIB     dylibbundler search path (OpenMS) [openms-build/lib]
#   DEPS_LIB       dylibbundler search path (deps)   [fastag-mm/envs/omsbuild/lib]
#   OPENMS_SHARE   OpenMS data dir                   [openms-src/share/OpenMS]
#   TAXONOMY_DIR   share/FASTag/taxonomy             [the first that holds tax_k7.taxdb of
#                  share/FASTag/taxonomy (an unpacked FASTag-<version>-taxonomy-k7.tar.gz), the
#                  CLI's own share-FASTag-taxonomy (a build tree with the index staged) and the
#                  folder tools/fetch_taxonomy_index.py fetched it into (when its completion
#                  marker says the fetch is complete: --check); else data/taxonomy]
#   DIGEST_DIR     share/FASTag/digest               [data/digest]
#   ALKYLATION_DIR share/FASTag/alkylation           [data/alkylation]
#   OUT            output resource root              [gui/src-tauri/resources/fastag]
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
FASTAG_BIN="${FASTAG_BIN:-$repo/build-rel/FASTag}"
OPENMS_LIB="${OPENMS_LIB:-$repo/../openms-build/lib}"
DEPS_LIB="${DEPS_LIB:-$repo/../fastag-mm/envs/omsbuild/lib}"
OPENMS_SHARE="${OPENMS_SHARE:-$repo/../openms-src/share/OpenMS}"
_tax="$repo/data/taxonomy"
_fetched="$(python3 "$repo/tools/fetch_taxonomy_index.py" --print-dir 2>/dev/null || true)"
# The fetched folder only as a complete fetch of the pinned manifest (its
# completion marker; an interrupted or failed fetch is not bundled).
if [ -n "$_fetched" ] && ! python3 "$repo/tools/fetch_taxonomy_index.py" --check "$_fetched" 2>/dev/null; then _fetched=""; fi
for _c in "$repo/share/FASTag/taxonomy" "$(dirname "$FASTAG_BIN")/share-FASTag-taxonomy" "$_fetched"; do
  if [ -n "$_c" ] && [ -s "$_c/tax_k7.taxdb" ]; then _tax="$_c"; break; fi
done
TAXONOMY_DIR="${TAXONOMY_DIR:-$_tax}"
DIGEST_DIR="${DIGEST_DIR:-$repo/data/digest}"
ALKYLATION_DIR="${ALKYLATION_DIR:-$repo/data/alkylation}"
OUT="${OUT:-$repo/gui/src-tauri/resources/fastag}"

command -v dylibbundler >/dev/null || { echo "need dylibbundler (brew install dylibbundler)"; exit 1; }
[ -x "$FASTAG_BIN" ] || { echo "no CLI at $FASTAG_BIN"; exit 1; }

echo ">> staging binary + dylib closure"
rm -rf "$OUT"; mkdir -p "$OUT/bin" "$OUT/lib" "$OUT/share/FASTag"
cp "$FASTAG_BIN" "$OUT/bin/FASTag"

# -od overwrite, -b bundle, -p install-name prefix, -s extra search paths for @rpath deps.
dylibbundler -od -b \
  -x "$OUT/bin/FASTag" \
  -d "$OUT/lib" \
  -p '@executable_path/../lib/' \
  -s "$OPENMS_LIB" \
  -s "$DEPS_LIB" \
  </dev/null

# dylibbundler rewrites each pre-existing LC_RPATH to its -p prefix individually,
# so a Mach-O that had several rpaths ends up with duplicate '@executable_path/../lib/'
# entries — and a duplicate LC_RPATH is FATAL on arm64 (dyld refuses to launch).
# Collapse duplicates on every Mach-O, then ad-hoc re-sign (install_name_tool
# invalidates the signature; real Developer ID signing downstream overwrites it).
dedup_rpath() {
  local f="$1" dup
  for dup in $(otool -l "$f" | awk '/LC_RPATH/{g=1;next} g&&/path /{print $2; g=0}' | sort | uniq -d); do
    while [ "$(otool -l "$f" | awk '/LC_RPATH/{g=1;next} g&&/path /{print $2; g=0}' | grep -cx "$dup")" -gt 1 ]; do
      install_name_tool -delete_rpath "$dup" "$f"
    done
  done
  codesign --force --sign - "$f" 2>/dev/null || true
}
echo ">> dedup LC_RPATH on $(ls "$OUT"/lib/*.dylib | wc -l | tr -d ' ') libs + the binary"
dedup_rpath "$OUT/bin/FASTag"
for so in "$OUT"/lib/*.dylib; do [ -L "$so" ] && continue; dedup_rpath "$so"; done

echo ">> copying OpenMS data, taxonomy and digest data"
cp -RL "$OPENMS_SHARE" "$OUT/share/OpenMS"
cp -RL "$TAXONOMY_DIR" "$OUT/share/FASTag/taxonomy"
# The fetch's completion marker and staging marker are this machine's, not the app's.
rm -f "$OUT/share/FASTag/taxonomy/.fastag-fetched" "$OUT/share/FASTag/taxonomy/.fastag-staged"
cp -RL "$DIGEST_DIR" "$OUT/share/FASTag/digest"
cp -RL "$ALKYLATION_DIR" "$OUT/share/FASTag/alkylation"
# An index folder (the release asset) has the index and its dumps only: the
# rest of data/taxonomy (species_call.tsv) goes beside it, as in a release;
# species_call.tsv is always this tree's (a fetched folder's copy may be older).
for f in "$repo"/data/taxonomy/*; do
  n=$(basename "$f")
  if [ -f "$f" ] && { [ ! -e "$OUT/share/FASTag/taxonomy/$n" ] || [ "$n" = species_call.tsv ]; }; then
    cp "$f" "$OUT/share/FASTag/taxonomy/"
  fi
done
# Every data file the CLI reads (tools/shipped_data.py), or no bundle.
python3 "$repo/tools/shipped_data.py" check --layout gui "$OUT"
[ -s "$OUT/share/FASTag/taxonomy/tax_k7.taxdb" ] \
  || echo "!! no tax_k7.taxdb in $TAXONOMY_DIR: -species will not run in this app (set TAXONOMY_DIR)"

libomp=$(ls "$OUT"/lib | grep -c '^libomp\.dylib$' || true)
echo ">> done: $(du -sh "$OUT" | cut -f1) at $OUT (libomp copies: $libomp — must be 1)"
[ "$libomp" = "1" ] || { echo "!! expected exactly one libomp"; exit 1; }
