#!/usr/bin/env bash
# 1.13 species redesign DEV diagnostic (undocumented, env-gated, no option):
# FASTAG_SPECIES_DUMP=<file> [FASTAG_SPECIES_DUMP_DECOYS=<n>] [FASTAG_SPECIES_DECOYDB=<taxdb>]
# writes a per-tag dump for the calibration analysis in tools/species-b113/.
#
#   * with the variables set, the tags and the species report (legacy and
#     -species_call decoy) are byte-identical to the variables unset;
#   * the dump has the header, taxon lines, one T line per evaluated tag with
#     n decoy replicates, and overlap lines;
#   * a decoy index of another k, an invalid decoy count, a missing decoy
#     index and an unwritable dump path each fail the run (no silent empty arm).
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"; BUILDTAXDB="$2"; IN="$3"; DB="$4"; TAXDIR="$5"
if ! "$BIN" --help >/dev/null 2>&1; then echo "SKIP: binary cannot initialize" >&2; exit 77; fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-species-dump-test.XXXXXX") || exit 1
[ "${FASTAG_TEST_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
gen() {  # seed nprot len (Park-Miller, as species_call_test.sh)
  awk -v seed="$1" -v np="$2" -v len="$3" 'BEGIN {
    a = "ACDEFGHIKLMNPQRSTVWY"; x = seed
    for (p = 1; p <= np; ++p) {
      s = ""
      for (i = 0; i < len; ++i) { x = (x * 16807) % 2147483647; s = s substr(a, int(x / 2147483647 * 20) + 1, 1) }
      print ">syn" seed "_" p; print s
    } }'
}
mkdir -p "$TMP/prot" "$TMP/dec"
{ awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB"
  gen 11 300 300; } > "$TMP/prot/562.fasta"
gen 13 1000 300 > "$TMP/prot/1280.fasta"
gen 21 300 300 > "$TMP/dec/562.fasta"
gen 23 1000 300 > "$TMP/dec/1280.fasta"
"$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/b1.log" 2>&1 || { cat "$TMP/b1.log" >&2; fail buildtaxdb; }
"$BUILDTAXDB" "$TMP/dec" "$TMP/dec7.taxdb" 7 > "$TMP/b2.log" 2>&1 || { cat "$TMP/b2.log" >&2; fail buildtaxdb; }
"$BUILDTAXDB" "$TMP/dec" "$TMP/dec6.taxdb" 6 > "$TMP/b3.log" 2>&1 || { cat "$TMP/b3.log" >&2; fail buildtaxdb; }
export FASTAG_TAXONOMY_DIR="$TAXDIR"
COMMON=(-in "$IN" -tag_length 7 -extension 1 -fragment_tolerance 600 -fragment_tolerance_unit ppm
        -max_evalue 0 -max_tags 200 -threads 2
        -species -taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
run() { local n=$1; shift; "$BIN" -out "$TMP/$n.tsv" "${COMMON[@]}" "$@" < /dev/null > "$TMP/$n.log" 2>&1; }
unset FASTAG_SPECIES_DUMP FASTAG_SPECIES_DUMP_DECOYS FASTAG_SPECIES_DECOYDB

run off || { cat "$TMP/off.log" >&2; fail "run without the dump"; }
[ "$(wc -l < "$TMP/off.species.tsv")" -ge 2 ] || fail "no genus reported (test is vacuous)"
FASTAG_SPECIES_DUMP="$TMP/d.tsv" FASTAG_SPECIES_DUMP_DECOYS=4 FASTAG_SPECIES_DECOYDB="$TMP/dec7.taxdb" run on \
  || { cat "$TMP/on.log" >&2; fail "run with the dump"; }
cmp -s "$TMP/off.species.tsv" "$TMP/on.species.tsv" || fail "the dump changed the species report"
cmp -s "$TMP/off.tsv" "$TMP/on.tsv" || fail "the dump changed the tags"
head -1 "$TMP/d.tsv" | grep -q $'^#k\t7\tkmer_decoys\t4\tdecoydb\t1$' || fail "dump header: $(head -1 "$TMP/d.tsv")"
[ "$(grep -c $'^#taxon\t' "$TMP/d.tsv")" -ge 2 ] || fail "dump: fewer than 2 taxon lines"
nt=$(grep -c '^T' "$TMP/d.tsv"); [ "$nt" -ge 50 ] || fail "dump: only $nt tag lines"
bad=$(awk -F'\t' '/^T/ && (NF != 7 || split($6, r, "|") != 4)' "$TMP/d.tsv" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "dump: $bad tag lines without 7 fields and 4 decoy replicates"
hits=$(awk -F'\t' '/^T/ && $5 != "-"' "$TMP/d.tsv" | wc -l | tr -d ' ')
[ "$hits" -ge 1 ] || fail "dump: no tag maps to a target taxon"
[ "$(grep -c $'^#overlap\t' "$TMP/d.tsv")" -ge 2 ] || fail "dump: no overlap matrix"
withdec=$(awk -F'\t' '/^T/ && length($4) == 7 && $6 !~ /^X(\|X)*$/' "$TMP/d.tsv" | wc -l | tr -d ' ')
[ "$withdec" -ge 50 ] || fail "dump: only $withdec 7-residue tags carry decoy replicates"
longdec=$(awk -F'\t' '/^T/ && length($4) != 7 && $6 !~ /^X(\|X)*$/' "$TMP/d.tsv" | wc -l | tr -d ' ')
[ "$longdec" = 0 ] || fail "dump: $longdec tags longer than k carry decoys"

run calloff -species_call decoy -species_call_min_units 10 || { cat "$TMP/calloff.log" >&2; fail "-species_call decoy"; }
FASTAG_SPECIES_DUMP="$TMP/d2.tsv" run callon -species_call decoy -species_call_min_units 10 \
  || { cat "$TMP/callon.log" >&2; fail "-species_call decoy with the dump"; }
cmp -s "$TMP/calloff.species.tsv" "$TMP/callon.species.tsv" || fail "the dump changed the -species_call decoy report"

FASTAG_SPECIES_DUMP="$TMP/d3.tsv" FASTAG_SPECIES_DECOYDB="$TMP/dec6.taxdb" run k6 && fail "a k=6 decoy index against a k=7 index ran"
grep -q "differs from the target index k" "$TMP/k6.log" || fail "no k-mismatch message"
FASTAG_SPECIES_DUMP="$TMP/d4.tsv" FASTAG_SPECIES_DUMP_DECOYS=abc run badn && fail "FASTAG_SPECIES_DUMP_DECOYS=abc ran"
FASTAG_SPECIES_DUMP="$TMP/d5.tsv" FASTAG_SPECIES_DECOYDB="$TMP/missing.taxdb" run nodb && fail "a missing decoy index ran"
FASTAG_SPECIES_DUMP="$TMP/no/such/dir/d.tsv" run nodir && fail "an unwritable dump path ran"
echo "species_dump_test: OK ($nt tag lines, $hits target hits)"
