#!/usr/bin/env bash
# The packed taxonomy index (tax_k7.ftz, what the installers ship) against the
# real binaries, on a toy k=5 index built from the fixture FASTA (k=7 finds
# nothing in its few proteins):
#   - buildtaxdb --pack round-trips (it decodes and compares itself), packs
#     the same bytes twice, --unpack restores the .taxdb byte for byte, and
#     --verify accepts the right sha256 and refuses a wrong one;
#   - FASTag -species -species_call decoy -census writes the same bytes with
#     the .ftz as with the .taxdb: found in FASTAG_TAXONOMY_DIR (the bundled
#     lookup) and given as -taxdb;
#   - a truncated .ftz is refused (INPUT_FILE_CORRUPT, "Failed to load -taxdb"),
#     as a truncated .taxdb is.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
BUILDTAXDB="$2"
MZML="$3"     # test/fixtures/Ecoli_MS2_small.mzML
DB="$4"       # test/fixtures/Ecoli_MS2_small.fasta
TAXDIR="$5"   # data/taxonomy

fail() { echo "packed_taxdb_cli_test: FAIL: $*" >&2; exit 1; }
"$BIN" --help > /dev/null 2>&1 || { echo "packed_taxdb_cli_test: $BIN does not start; skipped"; exit 77; }
sha() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Two toy taxa: E. coli (the fixture's proteins) and human (the same
# proteins reversed, so it has k-mers of its own).
mkdir -p "$TMP/prot"
cp "$DB" "$TMP/prot/562.fasta"
awk '/^>/ { print; next } { s = ""; for (i = length($0); i > 0; --i) s = s substr($0, i, 1); print s }' "$DB" > "$TMP/prot/9606.fasta"
"$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 5 > "$TMP/build.log" 2>&1 || { cat "$TMP/build.log" >&2; fail "buildtaxdb"; }

# ---- buildtaxdb --pack / --unpack / --verify --------------------------------
"$BUILDTAXDB" --pack "$TMP/toy.taxdb" "$TMP/toy.ftz" > "$TMP/pack.log" 2>&1 || { cat "$TMP/pack.log" >&2; fail "--pack"; }
grep -q "round trip ok" "$TMP/pack.log" || { cat "$TMP/pack.log" >&2; fail "--pack did not confirm the round trip"; }
"$BUILDTAXDB" --pack "$TMP/toy.taxdb" "$TMP/toy2.ftz" > /dev/null 2>&1 || fail "second --pack"
cmp -s "$TMP/toy.ftz" "$TMP/toy2.ftz" || fail "two packs of the same index differ"
"$BUILDTAXDB" --pack "$TMP/toy.ftz" "$TMP/toy3.ftz" > /dev/null 2>&1 || fail "--pack of a .ftz"
cmp -s "$TMP/toy.ftz" "$TMP/toy3.ftz" || fail "re-packing a .ftz changes it"
"$BUILDTAXDB" --unpack "$TMP/toy.ftz" "$TMP/back.taxdb" > "$TMP/unpack.log" 2>&1 || { cat "$TMP/unpack.log" >&2; fail "--unpack"; }
cmp -s "$TMP/toy.taxdb" "$TMP/back.taxdb" || fail "--unpack does not restore the .taxdb byte for byte"
want=$(sha "$TMP/toy.taxdb")
got=$("$BUILDTAXDB" --verify "$TMP/toy.ftz" "$want" 2> "$TMP/verify.log") || { cat "$TMP/verify.log" >&2; fail "--verify refused the right sha256"; }
[ "$got" = "$want" ] || fail "--verify printed $got, the .taxdb has $want"
"$BUILDTAXDB" --verify "$TMP/toy.ftz" 0000000000000000000000000000000000000000000000000000000000000000 > /dev/null 2>&1 \
  && fail "--verify accepted a wrong sha256"
[ "$("$BUILDTAXDB" --verify "$TMP/toy.taxdb" 2> /dev/null)" = "$want" ] || fail "--verify of the .taxdb"
[ "$(wc -c < "$TMP/toy.ftz")" -lt "$(wc -c < "$TMP/toy.taxdb")" ] || fail "the .ftz is not smaller than the .taxdb"
echo "packed_taxdb_cli_test: --pack, --unpack and --verify round-trip ($(wc -c < "$TMP/toy.taxdb") -> $(wc -c < "$TMP/toy.ftz") bytes)"

# ---- FASTag: same reports from either form ----------------------------------
for v in raw ftz; do
  mkdir -p "$TMP/tax-$v"
  cp "$TAXDIR/nodes.dmp" "$TAXDIR/names.dmp" "$TAXDIR/species_call.tsv" "$TMP/tax-$v/"
done
cp "$TMP/toy.taxdb" "$TMP/tax-raw/tax_k7.taxdb"
cp "$TMP/toy.ftz" "$TMP/tax-ftz/tax_k7.ftz"
RUN=(-in "$MZML" -species -species_call decoy -census -tag_length 5
     -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
outs="tsv species.tsv census.tsv census_summary.tsv"
for v in raw ftz; do
  FASTAG_TAXONOMY_DIR="$TMP/tax-$v" "$BIN" "${RUN[@]}" -out "$TMP/$v.tsv" > "$TMP/$v.log" 2>&1 \
    || { cat "$TMP/$v.log" >&2; fail "-species with the bundled $v index"; }
done
[ "$(wc -l < "$TMP/raw.species.tsv")" -ge 2 ] || fail "the species report is empty (construct vacuous)"
for o in $outs; do
  cmp -s "$TMP/raw.$o" "$TMP/ftz.$o" || fail "$o differs between tax_k7.taxdb and tax_k7.ftz"
done
"$BIN" "${RUN[@]}" -out "$TMP/x.tsv" -taxdb "$TMP/toy.ftz" \
  -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp" > "$TMP/x.log" 2>&1 \
  || { cat "$TMP/x.log" >&2; fail "-species with -taxdb <.ftz>"; }
cmp -s "$TMP/raw.species.tsv" "$TMP/x.species.tsv" || fail "the species report differs with -taxdb <.ftz>"
echo "packed_taxdb_cli_test: tags, species, census and census summary identical from the .taxdb and the .ftz"

# ---- a damaged .ftz is refused -----------------------------------------------
n=$(wc -c < "$TMP/toy.ftz")
head -c $((n - 7)) "$TMP/toy.ftz" > "$TMP/tax-ftz/tax_k7.ftz"
FASTAG_TAXONOMY_DIR="$TMP/tax-ftz" "$BIN" "${RUN[@]}" -out "$TMP/bad.tsv" > "$TMP/bad.log" 2>&1
rc=$?
[ "$rc" = 3 ] || { cat "$TMP/bad.log" >&2; fail "a truncated .ftz gave exit $rc, expected 3 (INPUT_FILE_CORRUPT)"; }
grep -q "Failed to load -taxdb" "$TMP/bad.log" || { cat "$TMP/bad.log" >&2; fail "no load error for a truncated .ftz"; }
echo "packed_taxdb_cli_test: a truncated .ftz is refused"
echo "packed_taxdb_cli_test: all checks passed"
