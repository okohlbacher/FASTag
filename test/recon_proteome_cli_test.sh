#!/usr/bin/env bash
# Feedback 422372a2: -recon_proteome, a shipped proteome as the database of
# -recon_out (the mass-shift survey without a FASTA of one's own). On the
# vendored E. coli run with its FASTA gzip-compressed as the shipped ecoli
# proteome: -recon_out, -delta_out and -massgap_out equal those of
# -recon_fasta on the plain FASTA; -recon_fasta wins over it (warned); it is
# ignored without -recon_out (warned); a missing shipped proteome and an
# unknown name are refused; without any database -recon_out names it.
# Exits 77 (ctest SKIP) when the binary cannot start or gzip is missing.
set -u
BIN="$1"
IN="$2"     # test/fixtures/Ecoli_MS2_small.mzML
DB="$3"     # test/fixtures/Ecoli_MS2_small.fasta
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
command -v gzip > /dev/null 2>&1 || { echo "SKIP: no gzip" >&2; exit 77; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-recon-prot.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
same() { cmp -s "$1" "$2" || { diff "$1" "$2" | head -8 >&2; fail "$3"; }; }
run() { "$BIN" "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
mkdir -p "$TMP/alk"
gzip -c "$DB" > "$TMP/alk/ecoli.fasta.gz"
export FASTAG_ALKYLATION_DIR="$TMP/alk"
COMMON=(-in "$IN" -threads 2 -extension 3)
OUTS() { echo -out "$TMP/$1.tsv" -recon_out "$TMP/$1.recon.tsv" -delta_out "$TMP/$1.delta.tsv" -massgap_out "$TMP/$1.massgap.tsv"; }
run "${COMMON[@]}" $(OUTS f) -recon_fasta "$DB"
run "${COMMON[@]}" $(OUTS p) -recon_proteome ecoli
[ "$(wc -l < "$TMP/p.recon.tsv")" -gt 1 ] || fail "-recon_proteome placed nothing"
for k in tsv recon.tsv delta.tsv massgap.tsv; do
  same "$TMP/f.$k" "$TMP/p.$k" "-recon_proteome ecoli and -recon_fasta on the same FASTA differ in $k"
done
# -recon_fasta wins, with a warning
run "${COMMON[@]}" $(OUTS w) -recon_fasta "$DB" -recon_proteome human
grep -q -- "-recon_proteome is ignored: the tags place on -recon_fasta" "$TMP/log" || fail "no warning when -recon_fasta is given too"
same "$TMP/f.recon.tsv" "$TMP/w.recon.tsv" "-recon_proteome changed a -recon_fasta run"
# without -recon_out it does nothing
run "${COMMON[@]}" -out "$TMP/n.tsv" -recon_proteome ecoli
grep -q -- "-recon_proteome is ignored: it is only read with -recon_out" "$TMP/log" || fail "no warning without -recon_out"
same "$TMP/f.tsv" "$TMP/n.tsv" "-recon_proteome without -recon_out changed the tags"
# a shipped proteome that is not there
"$BIN" "${COMMON[@]}" $(OUTS m) -recon_proteome human > "$TMP/log" 2>&1
rc=$?
[ "$rc" = 6 ] || { cat "$TMP/log" >&2; fail "missing human proteome: exit $rc, not 6"; }
grep -q -- "-recon_proteome: no shipped human proteome found" "$TMP/log" || fail "no message for the missing human proteome"
grep -q -- "Give -recon_fasta <fasta>" "$TMP/log" || fail "no advice for the missing human proteome"
# an unknown name
"$BIN" "${COMMON[@]}" $(OUTS z) -recon_proteome zebrafish > "$TMP/log" 2>&1 && fail "-recon_proteome zebrafish was accepted"
# no database at all: the refusal names -recon_proteome
unset FASTAG_ALKYLATION_DIR
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -recon_out "$TMP/x.recon.tsv" > "$TMP/log" 2>&1 && fail "-recon_out without a database was accepted"
grep -q -- "or -recon_proteome for a shipped proteome" "$TMP/log" || fail "the refusal does not name -recon_proteome"
echo "recon_proteome_cli_test: ok"
