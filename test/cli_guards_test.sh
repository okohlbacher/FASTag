#!/usr/bin/env bash
# Guards on the command line and the output paths, against the real binary:
# inputs that used to run with the wrong result and exit 0, or destroy a file.
#   - an unknown modification name is refused (it ran without the shift)
#   - an output naming the input, or two outputs naming one file, is refused
#     (-out_spectra = -in truncated the raw file before re-reading it)
#   - an output naming another consumed input (-digest_models, -fasta,
#     -recon_fasta) is refused, by name, symlink or hard link; input unchanged
#   - an output naming another consumed input (-fasta, -recon_fasta) is
#     refused, also through a symlink or a hard link, the database unchanged
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
#   - -complement_tolerance or -complement_tol_factor 0 or NaN is refused (1.12 E2)
#   - #5: -fasta_out naming -recon_fasta/-fasta (also by symlink) or
#     -shortlist_out naming -shortlist_background is refused, the database
#     unchanged; -stream -fasta_out, -shortlist_out without a database, an
#     unknown -search_engine, a template with sage and a template without an
#     enzyme table are refused; a database nothing places on gives an empty
#     shortlist and the background only, with a WARN; a conflicting duplicate
#     identifier is refused; a chymotryptic run writes no FASTA/configuration
#     and exits non-zero unless -shortlist_force
#   - #11B: -stream -census_ids*, census outputs naming -census_ids (by name,
#     symlink, hard link; the file unchanged) and a missing or unreadable
#     -census_ids are refused before -out is written
#   - outputs on inputs no option names are refused: the shipped digest
#     tables (-digest_out, -shortlist_out, -massgap_out on them), -fasta on
#     the q_db temporary <out>.qtmp, -out on the -census_ids join's
#     <census_out>.part.part
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
# An output naming a consumed input other than -in, by the same name, through
# a symlink and through a hard link: refused, and the input unchanged. The
# outputs are .tsv and the databases .fasta by option format, so the same-name
# case uses -digest_models (.tsv) and the database is reached through a .fasta
# link to a .tsv file.
echo "not a model table" > "$TMP/models.tsv"
models_before=$(cksum < "$TMP/models.tsv")
"$BIN" -in "$IN" -out "$TMP/models.tsv" -digest_models "$TMP/models.tsv" "${ARGS[@]}" \
  >"$TMP/dm.log" 2>&1 && fail "-out equal to -digest_models ran (exit 0)"
grep -q "is the -digest_models file" "$TMP/dm.log" || fail "no message naming -digest_models as the clobbered input"
[ "$(cksum < "$TMP/models.tsv")" = "$models_before" ] || fail "the -digest_models file was modified"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    cp "$DB" "$TMP/db.tsv"
    db_before=$(cksum < "$TMP/db.tsv")
    ln -s "$TMP/db.tsv" "$TMP/dblink.fasta"
    "$BIN" -in "$IN" -out "$TMP/f1.tsv" -fasta "$TMP/dblink.fasta" -recon_out "$TMP/db.tsv" -tag_length 4 "${ARGS[@]}" \
      >"$TMP/f1.log" 2>&1 && fail "-recon_out aliasing -fasta through a symlink ran (exit 0)"
    grep -q "is the -fasta file" "$TMP/f1.log" || fail "no message naming -fasta as the clobbered input"
    "$BIN" -in "$IN" -out "$TMP/db.tsv" -recon_fasta "$TMP/dblink.fasta" -recon_out "$TMP/f2.tsv" -tag_length 4 "${ARGS[@]}" \
      >"$TMP/f2.log" 2>&1 && fail "-out aliasing -recon_fasta through a symlink ran (exit 0)"
    grep -q "is the -recon_fasta file" "$TMP/f2.log" || fail "no message naming -recon_fasta as the clobbered input"
    ln "$TMP/db.tsv" "$TMP/dbhard.fasta"
    "$BIN" -in "$IN" -out "$TMP/f3.tsv" -fasta "$TMP/dbhard.fasta" -recon_out "$TMP/f3r.tsv" -delta_out "$TMP/db.tsv" \
      -tag_length 4 "${ARGS[@]}" >"$TMP/f3.log" 2>&1 && fail "-delta_out aliasing -fasta through a hard link ran (exit 0)"
    grep -q "is the -fasta file" "$TMP/f3.log" || fail "no message for the hard-linked -fasta"
    [ "$(cksum < "$TMP/db.tsv")" = "$db_before" ] || fail "the database was modified" ;;
esac
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

# -complement_tolerance (1.12 E2): 0 and NaN are refused, as for
# -fragment_tolerance; a positive value in either unit runs.
for o in complement_tolerance complement_tol_factor; do
  for v in 0 nan; do
    "$BIN" -in "$IN" -out "$TMP/$o$v.tsv" -$o $v "${ARGS[@]}" >"$TMP/$o$v.log" 2>&1
    rc=$?
    [ $rc = 6 ] || { cat "$TMP/$o$v.log"; fail "-$o $v: exit $rc, want 6 (ILLEGAL_PARAMETERS)"; }
    grep -q "$o" "$TMP/$o$v.log" || fail "-$o $v: no message naming it"
  done
done
"$BIN" -in "$IN" -out "$TMP/ctok.tsv" -complement_tolerance 0.05 "${ARGS[@]}" >"$TMP/ctok.log" 2>&1 \
  || { cat "$TMP/ctok.log"; fail "-complement_tolerance 0.05 was refused"; }
"$BIN" -in "$IN" -out "$TMP/ctf.tsv" -complement_tol_factor 0.5 -complement_tolerance_unit fragment "${ARGS[@]}" \
  >"$TMP/ctf.log" 2>&1 || { cat "$TMP/ctf.log"; fail "-complement_tolerance_unit fragment was refused"; }
"$BIN" -in "$IN" -out "$TMP/ctu.tsv" -complement_tolerance_unit fragment "${ARGS[@]}" \
  >"$TMP/ctu.log" 2>&1 || { cat "$TMP/ctu.log"; fail "-complement_tolerance_unit fragment alone was refused"; }
"$BIN" -in "$IN" -out "$TMP/cru.tsv" -complement_rule nonsense "${ARGS[@]}" >"$TMP/cru.log" 2>&1 \
  && fail "-complement_rule nonsense ran (exit 0)"
# -census (1.12 #11): refused with -stream; its outputs may not name -out, each
# other, another output's default path or a consumed input (by name, symlink
# or hard link), and the input is unchanged afterwards.
"$BIN" -stream -census "${ARGS[@]}" </dev/null >"$TMP/cs.log" 2>&1 && fail "-stream -census ran (exit 0)"
grep -q "stream cannot be combined with -census" "$TMP/cs.log" || fail "no -stream refusal naming -census"
"$BIN" -stream -census_out "$TMP/cs.tsv" "${ARGS[@]}" </dev/null >"$TMP/cs2.log" 2>&1 && fail "-stream -census_out ran (exit 0)"
"$BIN" -in "$IN" -out "$TMP/c1.tsv" -census -census_out "$TMP/c1.tsv" "${ARGS[@]}" >"$TMP/c1.log" 2>&1 \
  && fail "-census_out equal to -out ran (exit 0)"
grep -q "name the same file" "$TMP/c1.log" || fail "no message for -census_out equal to -out"
"$BIN" -in "$IN" -out "$TMP/c2.tsv" -census -census_out "$TMP/c2c.tsv" -census_summary_out "$TMP/c2c.tsv" "${ARGS[@]}" \
  >"$TMP/c2.log" 2>&1 && fail "-census_summary_out equal to -census_out ran (exit 0)"
grep -q "name the same file" "$TMP/c2.log" || fail "no message for -census_summary_out equal to -census_out"
"$BIN" -in "$IN" -out "$TMP/c3.tsv" -census -glyco -glyco_out "$TMP/c3.census.tsv" "${ARGS[@]}" \
  >"$TMP/c3.log" 2>&1 && fail "-glyco_out on the default census path ran (exit 0)"
grep -q "name the same file" "$TMP/c3.log" || fail "no message for -glyco_out on the default census path"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    cp "$DB" "$TMP/cdb.tsv"
    cdb_before=$(cksum < "$TMP/cdb.tsv")
    ln -s "$TMP/cdb.tsv" "$TMP/cdblink.fasta"
    ln "$TMP/cdb.tsv" "$TMP/cdbhard.fasta"
    "$BIN" -in "$IN" -out "$TMP/c4.tsv" -fasta "$TMP/cdblink.fasta" -census -census_out "$TMP/cdb.tsv" -tag_length 4 "${ARGS[@]}" \
      >"$TMP/c4.log" 2>&1 && fail "-census_out aliasing -fasta through a symlink ran (exit 0)"
    grep -q "is the -fasta file" "$TMP/c4.log" || fail "no message naming -fasta for -census_out"
    "$BIN" -in "$IN" -out "$TMP/c5.tsv" -fasta "$TMP/cdbhard.fasta" -census -census_summary_out "$TMP/cdb.tsv" -tag_length 4 "${ARGS[@]}" \
      >"$TMP/c5.log" 2>&1 && fail "-census_summary_out aliasing -fasta through a hard link ran (exit 0)"
    grep -q "is the -fasta file" "$TMP/c5.log" || fail "no message naming -fasta for -census_summary_out"
    [ "$(cksum < "$TMP/cdb.tsv")" = "$cdb_before" ] || fail "the -fasta file was modified by a census run"
    cp "$IN" "$TMP/crun.mzML"
    crun_before=$(cksum < "$TMP/crun.mzML")
    ln -s "$TMP/crun.mzML" "$TMP/crun.tsv"
    "$BIN" -in "$TMP/crun.mzML" -out "$TMP/c6.tsv" -census -census_out "$TMP/crun.tsv" "${ARGS[@]}" \
      >"$TMP/c6.log" 2>&1 && fail "-census_out aliasing -in through a symlink ran (exit 0)"
    grep -q "is the input file" "$TMP/c6.log" || fail "no message naming the input for -census_out"
    [ "$(cksum < "$TMP/crun.mzML")" = "$crun_before" ] || fail "the input was modified by a census run" ;;
esac
# -census_out / -census_summary_out without -census: warned and ignored.
"$BIN" -in "$IN" -out "$TMP/c7.tsv" -census_summary_out "$TMP/c7s.tsv" "${ARGS[@]}" >"$TMP/c7.log" 2>&1 \
  || fail "-census_summary_out without -census failed"
grep -q -- "-census_summary_out is only read for -census" "$TMP/c7.log" || fail "no warning for -census_summary_out alone"
[ ! -e "$TMP/c7s.tsv" ] || fail "-census_summary_out without -census wrote a file"
# -census_ids (1.12 #11 phase B): refused with -stream; no census output may
# name it (by name, symlink or hard link; the file unchanged); a missing file
# is an input error. Collisions are refused before the file is read, so a
# placeholder file suffices here (census_ids_cli_test covers the join).
printf 'placeholder, never read\n' > "$TMP/ids.idXML"
"$BIN" -stream -census_ids "$TMP/ids.idXML" "${ARGS[@]}" </dev/null >"$TMP/ci0.log" 2>&1 && fail "-stream -census_ids ran (exit 0)"
grep -q "stream cannot be combined with -census_ids" "$TMP/ci0.log" || fail "no -stream refusal naming -census_ids"
"$BIN" -stream -census_ids_fdr 0.05 "${ARGS[@]}" </dev/null >"$TMP/ci0b.log" 2>&1 && fail "-stream -census_ids_fdr ran (exit 0)"
"$BIN" -stream -census_triage_evalue 0.05 "${ARGS[@]}" </dev/null >"$TMP/ci0c.log" 2>&1 && fail "-stream -census_triage_evalue ran (exit 0)"
ids_before=$(cksum < "$TMP/ids.idXML")
"$BIN" -in "$IN" -out "$TMP/ci1.tsv" -census -census_ids "$TMP/ids.idXML" -census_out "$TMP/ids.idXML" "${ARGS[@]}" \
  >"$TMP/ci1.log" 2>&1 && fail "-census_out equal to -census_ids ran (exit 0)"
# By the same name the .tsv-only output check refuses it first (the ids
# file is an idXML); through a .tsv alias (below) the guard has to.
grep -q -E "is the -census_ids file|Invalid output file extension" "$TMP/ci1.log" || fail "no refusal message for -census_out = -census_ids"
"$BIN" -in "$IN" -out "$TMP/ci2.tsv" -census -census_ids "$TMP/ids.idXML" -census_summary_out "$TMP/ids.idXML" "${ARGS[@]}" \
  >"$TMP/ci2.log" 2>&1 && fail "-census_summary_out equal to -census_ids ran (exit 0)"
grep -q -E "is the -census_ids file|Invalid output file extension" "$TMP/ci2.log" || fail "no refusal message for -census_summary_out = -census_ids"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    ln -s "$TMP/ids.idXML" "$TMP/idslink.tsv"
    ln "$TMP/ids.idXML" "$TMP/idshard.tsv"
    "$BIN" -in "$IN" -out "$TMP/ci3.tsv" -census -census_ids "$TMP/ids.idXML" -census_out "$TMP/idslink.tsv" "${ARGS[@]}" \
      >"$TMP/ci3.log" 2>&1 && fail "-census_out aliasing -census_ids through a symlink ran (exit 0)"
    grep -q "is the -census_ids file" "$TMP/ci3.log" || fail "no message naming -census_ids (symlink)"
    "$BIN" -in "$IN" -out "$TMP/ci4.tsv" -census -census_ids "$TMP/ids.idXML" -census_out "$TMP/idshard.tsv" "${ARGS[@]}" \
      >"$TMP/ci4.log" 2>&1 && fail "-census_out aliasing -census_ids through a hard link ran (exit 0)"
    grep -q "is the -census_ids file" "$TMP/ci4.log" || fail "no message naming -census_ids (hard link)" ;;
esac
[ "$(cksum < "$TMP/ids.idXML")" = "$ids_before" ] || fail "the -census_ids file was modified by a census run"
[ ! -e "$TMP/ci1.tsv" ] && [ ! -e "$TMP/ci3.tsv" ] || fail "a refused -census_ids collision wrote -out"
"$BIN" -in "$IN" -out "$TMP/ci5.tsv" -census -census_ids "$TMP/missing.idXML" "${ARGS[@]}" >"$TMP/ci5.log" 2>&1 \
  && fail "-census_ids on a missing file ran (exit 0)"
[ ! -e "$TMP/ci5.tsv" ] || fail "-census_ids on a missing file wrote -out"
"$BIN" -in "$IN" -out "$TMP/ci6.tsv" -census -census_ids "$TMP/ids.idXML" "${ARGS[@]}" >"$TMP/ci6.log" 2>&1 \
  && fail "-census_ids on an unreadable idXML ran (exit 0)"
grep -q "census_ids" "$TMP/ci6.log" || fail "no message naming -census_ids for an unreadable file"
# #5 shortlist, reduced FASTA and engine configuration. The protease check
# reads the shipped models.
export FASTAG_DIGEST_DIR="${FASTAG_DIGEST_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/data/digest}"
SLA=(-in "$IN" -tag_length 4 -extension 1 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -threads 2)
cp "$DB" "$TMP/sl_db.fasta"
db_sum=$(cksum < "$TMP/sl_db.fasta")
"$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -recon_fasta "$TMP/sl_db.fasta" -fasta_out "$TMP/sl_db.fasta" >"$TMP/sl1.log" 2>&1 \
  && fail "-fasta_out equal to -recon_fasta ran (exit 0)"
grep -q -- "-fasta_out (.*) is the -recon_fasta file" "$TMP/sl1.log" || fail "no message naming -fasta_out and -recon_fasta"
if [ -L "$TMP/link.mzML" ]; then
  ln -s "$TMP/sl_db.fasta" "$TMP/sl_link.fasta"
  "$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -fasta "$TMP/sl_db.fasta" -fasta_out "$TMP/sl_link.fasta" >"$TMP/sl1b.log" 2>&1 \
    && fail "-fasta_out aliasing -fasta through a symlink ran (exit 0)"
  grep -q -- "is the -fasta file" "$TMP/sl1b.log" || fail "no message naming -fasta_out and -fasta"
fi
# (the formats differ, so only a symlink can make the two one file)
if [ -L "$TMP/link.mzML" ]; then
  ln -s "$TMP/sl_db.fasta" "$TMP/sl_db_link.tsv"
  "$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -recon_fasta "$DB" -fasta_out "$TMP/bgx.fasta" -shortlist_background "$TMP/sl_db.fasta" \
    -shortlist_out "$TMP/sl_db_link.tsv" >"$TMP/sl1c.log" 2>&1 && fail "-shortlist_out aliasing -shortlist_background ran (exit 0)"
  grep -q -- "is the -shortlist_background file" "$TMP/sl1c.log" || fail "no message naming -shortlist_out and -shortlist_background"
fi
[ "$(cksum < "$TMP/sl_db.fasta")" = "$db_sum" ] || fail "a refused -fasta_out/-shortlist_out touched the database"
"$BIN" -stream -fasta_out "$TMP/x.fasta" -threads 2 </dev/null >"$TMP/sl2.log" 2>&1 && fail "-stream -fasta_out ran (exit 0)"
grep -q "stream cannot be combined with -fasta_out" "$TMP/sl2.log" || fail "no -stream refusal for -fasta_out"
"$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -shortlist_out "$TMP/x.tsv" >"$TMP/sl3.log" 2>&1 && fail "-shortlist_out without a database ran (exit 0)"
grep -q "shortlist_out needs a database" "$TMP/sl3.log" || fail "no message that -shortlist_out needs a database"
for e in msfragger foo; do
  "$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -recon_fasta "$DB" -search_config_out "$TMP/x.cfg" -search_engine $e \
    >"$TMP/sl4.log" 2>&1 && fail "-search_engine $e ran (exit 0)"
done
[ ! -e "$TMP/x.cfg" ] || fail "a refused -search_engine wrote a configuration"
printf '# comet_version x\n[COMET_ENZYME_INFO]\n1.  Trypsin  1  KR  P\n' > "$TMP/t.params"
"$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -recon_fasta "$DB" -search_config_out "$TMP/x.cfg" -search_config_template "$TMP/t.params" \
  >"$TMP/sl5.log" 2>&1 && fail "-search_config_template with sage ran (exit 0)"
grep -q "needs -search_engine comet" "$TMP/sl5.log" || fail "no message that the template needs comet"
printf 'database_name = x\n' > "$TMP/bad.params"
"$BIN" "${SLA[@]}" -out "$TMP/sl.tsv" -recon_fasta "$DB" -search_config_out "$TMP/x.cfg" -search_engine comet \
  -search_config_template "$TMP/bad.params" >"$TMP/sl5b.log" 2>&1 && fail "a template without an enzyme table ran (exit 0)"
grep -q "no \[COMET_ENZYME_INFO\]" "$TMP/sl5b.log" || fail "no message about the template's missing enzyme table"
[ ! -s "$TMP/sl5b.log" ] || ! grep -q "MS2 spectra," "$TMP/sl5b.log" || fail "a bad template was refused only after tagging"
# A database nothing places on: empty shortlist, the background only, a WARN, exit 0.
printf '>W1\nWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWK\n>W2\nWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWR\n' > "$TMP/w.fasta"
printf '>BG1 background\nMKWVTFISLLLLFSSAYSR\n' > "$TMP/wbg.fasta"
"$BIN" "${SLA[@]}" -out "$TMP/w.tsv" -recon_fasta "$TMP/w.fasta" -shortlist_out "$TMP/w.sl.tsv" -fasta_out "$TMP/w.red.fasta" \
  -shortlist_background "$TMP/wbg.fasta" >"$TMP/w.log" 2>&1 || { cat "$TMP/w.log" >&2; fail "a W-only database did not exit 0"; }
grep -q "no protein has 2 qualifying spectra; -fasta_out holds the background only" "$TMP/w.log" || fail "no WARN for an empty shortlist"
[ "$(grep -c '^>' "$TMP/w.red.fasta")" = 1 ] && grep -q '^>BG1 background' "$TMP/w.red.fasta" || fail "-fasta_out is not the background only"
[ "$(grep -vc '^#' "$TMP/w.sl.tsv")" = 2 ] || fail "the empty shortlist is not header plus the background row"
# Conflicting duplicate identifiers.
printf '>D1\nPEPTIDEKAAAAR\n>D1\nPEPTIDEKCCCCR\n' > "$TMP/dup.fasta"
"$BIN" "${SLA[@]}" -out "$TMP/dup.tsv" -recon_fasta "$TMP/dup.fasta" -shortlist_out "$TMP/dup.sl.tsv" >"$TMP/dup.log" 2>&1
rc=$?
[ $rc = 0 ] && fail "a conflicting duplicate identifier ran (exit 0)"
grep -q "'D1' names two different sequences" "$TMP/dup.log" || fail "no message naming the duplicate identifier"
# A non-tryptic run without -digest_out: protease ERROR, no FASTA/configuration, non-zero exit; -shortlist_force writes.
CHY="$(dirname "$IN")/chymo_insilico.mgf"
if [ -f "$CHY" ]; then
  CHA=(-in "$CHY" -recon_fasta "$DB" -out "$TMP/ch.tsv" -shortlist_out "$TMP/ch.sl.tsv" -fasta_out "$TMP/ch.fasta"
       -search_config_out "$TMP/ch.cfg" -threads 2)
  "$BIN" "${CHA[@]}" >"$TMP/ch.log" 2>&1 && fail "a chymotryptic run wrote the hand-off outputs (exit 0)"
  grep -q "ERROR.*Chymotrypsin fits the tag ends best\|Chymotrypsin fits the tag ends best.*Not writing" "$TMP/ch.log" \
    || fail "no protease ERROR for a chymotryptic run"
  [ ! -e "$TMP/ch.fasta" ] && [ ! -e "$TMP/ch.cfg" ] || fail "a refused run wrote -fasta_out or -search_config_out"
  "$BIN" "${CHA[@]}" -shortlist_force >"$TMP/chf.log" 2>&1 || fail "-shortlist_force did not exit 0"
  [ -e "$TMP/ch.fasta" ] && [ -s "$TMP/ch.cfg" ] && grep -q "shortlist_force writes" "$TMP/chf.log" \
    || fail "-shortlist_force did not write with a WARN"
else
  fail "fixture $CHY missing"
fi

# Inputs no option names are guarded too (OutputGuard.h): the shipped
# digest tables resolved from FASTAG_DIGEST_DIR, the q_db temporary
# <out>.qtmp and the -census_ids join's <census_out>.part.part. A copy of
# the digest directory, so the shipped data is never at risk.
mkdir -p "$TMP/dig"
cp "$FASTAG_DIGEST_DIR"/* "$TMP/dig/"
dm_before=$(cksum < "$TMP/dig/digest_models.tsv")
FASTAG_DIGEST_DIR="$TMP/dig" "$BIN" -in "$IN" -out "$TMP/g1.tsv" -digest_out "$TMP/dig/digest_models.tsv" "${ARGS[@]}" \
  >"$TMP/g1.log" 2>&1 && fail "-digest_out on the shipped digest_models.tsv ran (exit 0)"
grep -q "is the -digest_models (shipped) file" "$TMP/g1.log" || { cat "$TMP/g1.log"; fail "no message naming the shipped digest_models.tsv for -digest_out"; }
FASTAG_DIGEST_DIR="$TMP/dig" "$BIN" "${SLA[@]}" -out "$TMP/g2.tsv" -recon_fasta "$DB" -shortlist_out "$TMP/dig/digest_models.tsv" \
  >"$TMP/g2.log" 2>&1 && fail "-shortlist_out on the shipped digest_models.tsv ran (exit 0)"
grep -q "is the -digest_models (shipped) file" "$TMP/g2.log" || { cat "$TMP/g2.log"; fail "no message naming the shipped digest_models.tsv for -shortlist_out"; }
FASTAG_DIGEST_DIR="$TMP/dig" "$BIN" -in "$IN" -out "$TMP/g3.tsv" -massgap_out "$TMP/dig/massgap_mods.tsv" "${ARGS[@]}" \
  >"$TMP/g3.log" 2>&1 && fail "-massgap_out on the shipped massgap_mods.tsv ran (exit 0)"
grep -q "is the -massgap_mods (shipped) file" "$TMP/g3.log" || { cat "$TMP/g3.log"; fail "no message naming the shipped massgap_mods.tsv"; }
[ "$(cksum < "$TMP/dig/digest_models.tsv")" = "$dm_before" ] || fail "the shipped digest_models.tsv was modified"
[ ! -e "$TMP/g1.tsv" ] && [ ! -e "$TMP/g2.tsv" ] && [ ! -e "$TMP/g3.tsv" ] || fail "a refused shipped-table collision wrote -out"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    # q_db: -fasta is (a link to) <out>.qtmp.
    cp "$DB" "$TMP/q.tsv.qtmp"
    ln -s "$TMP/q.tsv.qtmp" "$TMP/qlink.fasta"
    q_before=$(cksum < "$TMP/q.tsv.qtmp")
    printf '>ENT1\nMWWHHGWWYHHWWPHHWWHFHWWHNHWWHHKWWHHWMWHHWWHYHWWHHWWQHHWWHHR\n' > "$TMP/qent.fasta"
    "$BIN" -in "$IN" -out "$TMP/q.tsv" -fasta "$TMP/qlink.fasta" -entrapment_fasta "$TMP/qent.fasta" -tag_length 4 "${ARGS[@]}" \
      >"$TMP/q.log" 2>&1 && fail "-fasta on the q_db temporary file ran (exit 0)"
    grep -q "is the -fasta file" "$TMP/q.log" || { cat "$TMP/q.log"; fail "no message naming -fasta for the q_db temporary file"; }
    [ "$(cksum < "$TMP/q.tsv.qtmp")" = "$q_before" ] || fail "the -fasta file behind <out>.qtmp was modified"
    # -census_ids join: -out is (behind a link) <census_out>.part.part.
    printf 'an earlier table\n' > "$TMP/cj_out.tsv"
    cj_before=$(cksum < "$TMP/cj_out.tsv")
    ln -s "$TMP/cj_out.tsv" "$TMP/cj.tsv.part.part"
    "$BIN" -in "$IN" -out "$TMP/cj_out.tsv" -census -census_ids "$TMP/ids.idXML" -census_out "$TMP/cj.tsv" "${ARGS[@]}" \
      >"$TMP/cj.log" 2>&1 && fail "-out on the -census_ids join's temporary file ran (exit 0)"
    grep -q "collide through a temporary file" "$TMP/cj.log" || { cat "$TMP/cj.log"; fail "no message for the -census_ids join's temporary file"; }
    [ "$(cksum < "$TMP/cj_out.tsv")" = "$cj_before" ] && [ ! -e "$TMP/cj.tsv" ] || fail "a refused join collision wrote an output" ;;
esac

echo "cli_guards_test: all checks passed"
