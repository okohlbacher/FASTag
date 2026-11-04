#!/usr/bin/env bash
# Guards on the command line and the output paths, against the real binary:
# inputs that used to run with the wrong result and exit 0, or destroy a file.
#   - an unknown modification name is refused (it ran without the shift)
#   - an output naming the input, or two outputs naming one file, is refused
#     (-out_spectra = -in truncated the raw file before re-reading it)
#   - a NaN / inf precursor in a -stream header is a bad header (it tagged
#     with nterm_mass 0, a false N-terminal claim)
#   - an entrapment database inside the target's key space is refused even
#     when it produced no event (every q_db came out 0)
#   - a native ID with a tab or newline stays one TSV field
#   - -max_peaks above the 1024 table ceiling is refused
#   - an empty -out_spectra result removes an earlier run's file there
#   - -out through a symlink writes the link's target and keeps the link;
#     -out /dev/stdout redirected to a file writes that file
#   - an unknown -species_rank is refused before the run, old table untouched,
#     and hides neither the one-set rule nor the -stream refusals
#   - -out is written in place: an existing -out keeps its mode, every hard
#     link sees the table, and a writable -out in a read-only directory works
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-cli-guards.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)

# Unknown modification.
"$BIN" -in "$IN" -out "$TMP/m.tsv" -fixed_modifications "Carbamidomethy (C)" "${ARGS[@]}" \
  >"$TMP/m.log" 2>&1 && fail "an unknown modification name ran (exit 0)"
grep -q "Unknown modification" "$TMP/m.log" || fail "no message naming the unknown modification"

# -out_spectra = -in, by the same name and through a symlink.
cp "$IN" "$TMP/run.mzML"
ln -s "$TMP/run.mzML" "$TMP/link.mzML"
sum_before=$(cksum < "$TMP/run.mzML")
"$BIN" -in "$TMP/run.mzML" -out "$TMP/o.tsv" -out_spectra "$TMP/run.mzML" "${ARGS[@]}" \
  >"$TMP/o.log" 2>&1 && fail "-out_spectra equal to -in ran (exit 0)"
# Git Bash on Windows makes ln -s a copy, which is no alias: test only a real symlink.
if [ -L "$TMP/link.mzML" ]; then
  "$BIN" -in "$TMP/link.mzML" -out "$TMP/o.tsv" -out_spectra "$TMP/run.mzML" "${ARGS[@]}" \
    >"$TMP/o2.log" 2>&1 && fail "-out_spectra aliasing -in through a symlink ran (exit 0)"
fi
[ "$(cksum < "$TMP/run.mzML")" = "$sum_before" ] || fail "the input file was modified"
# Two outputs, one file.
"$BIN" -in "$IN" -out "$TMP/same.tsv" -fasta "$DB" -recon_out "$TMP/same.tsv" -tag_length 4 "${ARGS[@]}" \
  >"$TMP/s.log" 2>&1 && fail "-recon_out equal to -out ran (exit 0)"
grep -q "name the same file" "$TMP/s.log" || fail "no message naming the colliding outputs"
# /dev/null twice is fine (not a regular file).
# Not on Windows: OpenMS's output check cannot create NUL there ("could not be created").
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) "$BIN" -in "$IN" -out /dev/null -fasta "$DB" -recon_out /dev/null -tag_length 4 "${ARGS[@]}" >"$TMP/n.log" 2>&1 \
       || { cat "$TMP/n.log"; fail "-out and -recon_out both /dev/null was refused"; } ;;
esac

# NaN / inf precursor in -stream.
OUT=$(printf 'spectrum a nan 2\n300.1 10\n400.2 20\n\nspectrum b inf 2\n300.1 10\n\nspectrum c 500.25 2\n300.1 10\n400.2 20\n413.317 15\n' \
      | "$BIN" -stream -fragment_tolerance 0.3 -fragment_tolerance_unit Da 2>/dev/null)
[ "$(printf '%s\n' "$OUT" | grep -c '^#error ')" -eq 2 ] || { printf '%s\n' "$OUT" >&2; fail "nan/inf precursor headers were not refused"; }
printf '%s\n' "$OUT" | grep -q '^#end c ' || fail "a valid block after the bad ones lost its sentinel"

# Entrapment database identical to the target.
"$BIN" -in "$IN" -out "$TMP/e.tsv" -fasta "$DB" -entrapment_fasta "$DB" -tag_length 4 "${ARGS[@]}" \
  >"$TMP/e.log" 2>&1 && fail "an entrapment database equal to the target ran (exit 0)"
grep -q "entire key" "$TMP/e.log" || fail "no message about the shared key space"

# A native ID with a tab: same byte length (keeps the index valid), id and idRef alike.
sed 's/scan=11472"/s\&#9;11472"/g' "$IN" > "$TMP/tab.mzML"
grep -q 's&#9;11472' "$TMP/tab.mzML" || fail "fixture edit did not apply"
"$BIN" -in "$TMP/tab.mzML" -out "$TMP/tab.tsv" "${ARGS[@]}" >"$TMP/tab.log" 2>&1 \
  || fail "the run with a tab in a native ID failed ($(tail -1 "$TMP/tab.log"))"
grep -q 's 11472' "$TMP/tab.tsv" || fail "the tab-carrying native ID wrote no row"
BAD=$(awk -F'\t' 'NF != 12' "$TMP/tab.tsv" | head -1)
[ -z "$BAD" ] || fail "a row with a stray field: $BAD"

# -out_spectra with nothing to write removes an earlier run's file there.
echo stale > "$TMP/stale.mzML"
"$BIN" -in "$IN" -out "$TMP/z.tsv" -out_spectra "$TMP/stale.mzML" -max_evalue 1e-300 "${ARGS[@]}" \
  >"$TMP/z.log" 2>&1 && fail "an empty -out_spectra result exited 0"
[ ! -e "$TMP/stale.mzML" ] || fail "an earlier run's -out_spectra file was left in place"

# -max_peaks above the table ceiling.
"$BIN" -in "$IN" -out "$TMP/p.tsv" -max_peaks 5000 "${ARGS[@]}" >/dev/null 2>&1 \
  && fail "-max_peaks 5000 ran (exit 0)"

# -out: an existing file is overwritten; a symlink stays a link and its
# target gets the table; /dev/stdout redirected to a file is written directly.
"$BIN" -in "$IN" -out "$TMP/r.tsv" "${ARGS[@]}" >/dev/null 2>&1 || fail "the reference run failed"
echo old > "$TMP/x.tsv"
"$BIN" -in "$IN" -out "$TMP/x.tsv" "${ARGS[@]}" >/dev/null 2>&1 || fail "replacing an existing -out failed"
cmp -s "$TMP/r.tsv" "$TMP/x.tsv" || fail "an existing -out was not replaced by the table"
echo old > "$TMP/target.tsv"
ln -s "$TMP/target.tsv" "$TMP/l.tsv"
if [ -L "$TMP/l.tsv" ]; then
  "$BIN" -in "$IN" -out "$TMP/l.tsv" "${ARGS[@]}" >/dev/null 2>&1 || fail "-out through a symlink failed"
  [ -L "$TMP/l.tsv" ] || fail "-out replaced the symlink instead of writing its target"
  cmp -s "$TMP/r.tsv" "$TMP/target.tsv" || fail "the symlink's target did not get the table"
fi
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) "$BIN" -in "$IN" -out /dev/stdout "${ARGS[@]}" >"$TMP/so.tsv" 2>/dev/null \
       || fail "-out /dev/stdout redirected to a file failed"
     grep -q '^spectrum	tag' "$TMP/so.tsv" || fail "-out /dev/stdout wrote no table header" ;;
esac

# -species_rank no node has: refused before tagging, the old table untouched.
printf '1\t|\t1\t|\tno rank\t|\n2\t|\t1\t|\tgenus\t|\n' > "$TMP/nodes.dmp"
printf '1\t|\troot\t|\t\t|\tscientific name\t|\n' > "$TMP/names.dmp"
echo notanindex > "$TMP/none.taxdb"
echo old > "$TMP/sp.tsv"
"$BIN" -in "$IN" -out "$TMP/sp.tsv" -species -species_rank superkingdom -taxdb "$TMP/none.taxdb" \
  -taxonomy_nodes "$TMP/nodes.dmp" -taxonomy_names "$TMP/names.dmp" -tag_length 7 "${ARGS[@]}" \
  >"$TMP/sp.log" 2>&1 && fail "-species_rank superkingdom ran (exit 0)"
grep -q "no node of the taxonomy has that rank" "$TMP/sp.log" || fail "no message naming the missing rank"
[ "$(cat "$TMP/sp.tsv")" = old ] || fail "a refused -species_rank touched the old table"
# ... but not ahead of the one-set rule or the -stream refusal.
"$BIN" -in "$IN" -out "$TMP/sp.tsv" -species -species_rank superkingdom -taxdb "$TMP/none.taxdb" \
  -taxonomy_nodes "$TMP/nodes.dmp" -tag_length 7 "${ARGS[@]}" >"$TMP/sp2.log" 2>&1 \
  && fail "-species with an incomplete taxonomy set ran (exit 0)"
grep -q "are one set" "$TMP/sp2.log" || fail "a bad -species_rank hid the one-set error"
"$BIN" -stream -species -species_rank superkingdom -taxdb "$TMP/none.taxdb" -taxonomy_nodes "$TMP/nodes.dmp" \
  -taxonomy_names "$TMP/names.dmp" -tag_length 7 "${ARGS[@]}" </dev/null >"$TMP/sp3.log" 2>&1 \
  && fail "-stream -species ran (exit 0)"
grep -q "stream cannot be combined" "$TMP/sp3.log" || fail "a bad -species_rank hid the -stream refusal"

# -out is written in place, so it keeps what the old file had (not on Windows:
# no POSIX modes, hard links or read-only directories there in Git Bash).
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
    for m in 600 664; do
      echo old > "$TMP/m$m.tsv"; chmod $m "$TMP/m$m.tsv"
      "$BIN" -in "$IN" -out "$TMP/m$m.tsv" "${ARGS[@]}" >/dev/null 2>&1 || fail "overwriting a $m -out failed"
      [ "$(mode_of "$TMP/m$m.tsv")" = $m ] || fail "an overwritten -out lost mode $m (now $(mode_of "$TMP/m$m.tsv"))"
      cmp -s "$TMP/r.tsv" "$TMP/m$m.tsv" || fail "the $m -out did not get the table"
    done
    echo old > "$TMP/hl1.tsv"; ln "$TMP/hl1.tsv" "$TMP/hl2.tsv"
    "$BIN" -in "$IN" -out "$TMP/hl1.tsv" "${ARGS[@]}" >/dev/null 2>&1 || fail "a hard-linked -out failed"
    cmp -s "$TMP/r.tsv" "$TMP/hl2.tsv" || fail "the other hard link of -out kept the old content"
    if [ "$(id -u)" != 0 ]; then
      mkdir "$TMP/ro"; echo old > "$TMP/ro/t.tsv"; chmod 555 "$TMP/ro"
      "$BIN" -in "$IN" -out "$TMP/ro/t.tsv" "${ARGS[@]}" >"$TMP/ro.log" 2>&1
      rc=$?; chmod 755 "$TMP/ro"
      [ $rc = 0 ] || { cat "$TMP/ro.log"; fail "a writable -out in a read-only directory failed (rc $rc)"; }
      cmp -s "$TMP/r.tsv" "$TMP/ro/t.tsv" || fail "the -out in a read-only directory did not get the table"
    fi ;;
esac

echo "cli_guards_test: all checks passed"
