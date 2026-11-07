#!/usr/bin/env bash
# Thread-count determinism on the mzML path, for the tag TSV AND every
# secondary output: the vendored fixture at -threads 1, 3 and 8 must write
# byte-identical files. (fastag_test 5 repeats one spectrum in one thread;
# mzpeak_roundtrip compares thread counts on mzPeak input only.)
# With a 5th argument (test/fixtures/profile_ms2_small.mzML), also
# -pick_profile auto (1.12 #9) on profile MS2, where the tagging loop (one
# picker per thread), the tolerance probe (its own picker, before the loop)
# and the -out_spectra re-read (a serial picker) each centroid: every TSV and
# the exported spectra, with -out_spectra (OnDisc reader) and without it (fast
# reader), byte-identical at 1, 3 and 8 threads.
# With a 6th argument (ion_series_test), also -ion_series auto (1.12 #15
# phase B) on a synthetic ETD run.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"
DATA="$4"   # data/digest
PROF="${5:-}"  # test/fixtures/profile_ms2_small.mzML (optional)
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-threads-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

OUTS=(tags recon delta digest label massgap glyco)
for t in 1 3 8; do
  d="$TMP/t$t"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" \
    -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -fasta "$DB" -recon_out "$d/recon.tsv" -delta_out "$d/delta.tsv" \
    -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" \
    -glyco -glyco_out "$d/glyco.tsv" -recon_id_out "$d/ids.idXML" \
    >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-threads $t run failed"; }
done
for f in ${OUTS[@]+"${OUTS[@]}"}; do
  [ "$(wc -l < "$TMP/t1/$f.tsv")" -gt 1 ] || fail "$f.tsv has no rows at -threads 1; the check would prove nothing"
  for t in 3 8; do
    cmp -s "$TMP/t1/$f.tsv" "$TMP/t$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t"
  done
done
# idXML carries a creation date; compare it without that line.
for t in 3 8; do
  cmp -s <(grep -v 'date=' "$TMP/t1/ids.idXML") <(grep -v 'date=' "$TMP/t$t/ids.idXML") \
    || fail "ids.idXML differs between -threads 1 and $t"
done
# 1.12 E2: -complement_rule both (with the fragment-tied window and mid-p)
# is deterministic too.
for t in 1 3 8; do
  "$BIN" -in "$IN" -out "$TMP/t$t/compl.tsv" -threads "$t" -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -complement_rule both -complement_tol_factor 0.2 -complement_tolerance_unit fragment -complement_midp \
    >"$TMP/t$t/compl.log" 2>&1 || { cat "$TMP/t$t/compl.log" >&2; fail "-complement_rule both at -threads $t failed"; }
done
[ "$(wc -l < "$TMP/t1/compl.tsv")" -gt 1 ] || fail "compl.tsv has no rows at -threads 1"
for t in 3 8; do
  cmp -s "$TMP/t1/compl.tsv" "$TMP/t$t/compl.tsv" || fail "-complement_rule both differs between -threads 1 and $t"
done
# -census (1.12 #11): the census table and summary, with -recon_out so that
# placed spectra occur, and with -tag_lengths 3 5 so that the best tag is not
# always row 1; the tags equal the run without -census at every count.
for t in 1 3 8; do
  d="$TMP/c$t"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" -tag_lengths 3 5 \
    -fragment_tolerance 0.3 -fragment_tolerance_unit Da -recon_fasta "$DB" -recon_out "$d/recon.tsv" \
    -census -census_out "$d/census.tsv" -census_summary_out "$d/census_summary.tsv" \
    >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-census -threads $t run failed"; }
  "$BIN" -in "$IN" -out "$d/plain.tsv" -threads "$t" -tag_lengths 3 5 \
    -fragment_tolerance 0.3 -fragment_tolerance_unit Da >"$d/plog" 2>&1 || fail "-threads $t plain run failed"
  cmp -s "$d/tags.tsv" "$d/plain.tsv" || fail "the tags differ with -census at -threads $t"
done
# The phase-A status column is found by its header name, as the other census
# readers do (CensusIds::layoutOf), not by its position (12 in Census::header).
n_placed=$(awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; ++i) if ($i == "status") c = i; next }
                        c && $c == "placed" { n++ } END { if (!c) print "nocol"; else print n + 0 }' "$TMP/c1/census.tsv")
[ "$n_placed" != nocol ] || fail "census.tsv has no status column"
[ "$n_placed" -gt 0 ] || fail "no placed census row; the check is weak"
for f in census census_summary recon; do
  for t in 3 8; do
    cmp -s "$TMP/c1/$f.tsv" "$TMP/c$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t"
  done
done
# -census_ids (1.12 #11B): the joined table and the census_ids section at
# 1, 3 and 8 threads; the idXML is FASTag's own -recon_id_out of the 1-thread
# run with a q-value added to every hit (score type q-value), so that
# identified and triage both take several values.
if [ -s "$TMP/c1/recon.tsv" ]; then
  "$BIN" -in "$IN" -out "$TMP/c1/ri.tsv" -threads 1 -tag_lengths 3 5 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -recon_fasta "$DB" -recon_out "$TMP/c1/ri_recon.tsv" \
    -recon_id_out "$TMP/c1/ri.idXML" >"$TMP/c1/rilog" 2>&1 || fail "-recon_id_out run failed"
  # Every other identification becomes a q = 0.001 target, the rest q = 0.5.
  awk 'BEGIN { n = 0 }
       /<PeptideIdentification / { n++; sub(/score_type="[^"]*"/, "score_type=\"q-value\""); sub(/higher_score_better="[^"]*"/, "higher_score_better=\"false\"") }
       /<PeptideHit / { sub(/score="[^"]*"/, "score=\"" (n % 2 ? "0.001" : "0.5") "\"") }
       { print }' "$TMP/c1/ri.idXML" > "$TMP/ids.idXML"
  grep -q 'score_type="q-value"' "$TMP/ids.idXML" || fail "could not prepare the -census_ids file"
  for t in 1 3 8; do
    d="$TMP/i$t"; mkdir -p "$d"
    "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" -tag_lengths 3 5 -fragment_tolerance 0.3 \
      -fragment_tolerance_unit Da -census -census_ids "$TMP/ids.idXML" -census_triage_evalue 1 \
      -census_out "$d/census.tsv" -census_summary_out "$d/census_summary.tsv" >"$d/log" 2>&1 \
      || { cat "$d/log" >&2; fail "-census_ids -threads $t run failed"; }
  done
  # identified is found by name (a later census column moves it)
  idc=$(head -1 "$TMP/i1/census.tsv" | tr '\t' '\n' | grep -nx identified | cut -d: -f1)
  [ -n "$idc" ] || fail "-census_ids: no identified column"
  for v in 0 1; do
    [ "$(awk -F'\t' -v v=$v -v c="$idc" 'NR > 1 && $c == v' "$TMP/i1/census.tsv" | wc -l)" -gt 0 ] || fail "-census_ids: no row identified $v; the check is weak"
  done
  for f in census census_summary; do
    for t in 3 8; do
      cmp -s "$TMP/i1/$f.tsv" "$TMP/i$t/$f.tsv" || fail "-census_ids: $f.tsv differs between -threads 1 and $t"
    done
  done
fi
msg="${#OUTS[@]} TSVs, the idXML, the census tables"
# 1.12 #15 phase B: -ion_series auto on a synthetic ETD run (6th argument,
# ion_series_test --write-mzml: c/z-dot ladders of 40 fixture peptides,
# activation ETD): every spectrum is read as c/z-dot through the tagger,
# recon, digest, label, mass gap and census.
GEN="${6:-}"
if [ -n "$GEN" ]; then
"$GEN" --write-mzml "$DB" "$TMP/etd.mzML" cz > /dev/null || fail "writing the synthetic ETD run"
ZOUTS=(tags recon digest label massgap census)
for t in 1 3 8; do
  d="$TMP/z$t"; mkdir -p "$d"
  "$BIN" -in "$TMP/etd.mzML" -out "$d/tags.tsv" -threads "$t" -ion_series auto \
    -tag_length 4 -extension 1 -fragment_tolerance 0.02 -fragment_tolerance_unit Da -recon_fasta "$DB" -recon_out "$d/recon.tsv" \
    -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" \
    -census -census_out "$d/census.tsv" >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-ion_series auto -threads $t run failed"; }
done
[ "$(awk -F'\t' 'NR > 1 { print $NF }' "$TMP/z1/tags.tsv" | sort -u)" = cz ] || fail "-ion_series auto: the ETD copy was not read as c/z"
for f in ${ZOUTS[@]+"${ZOUTS[@]}"}; do
  [ "$(wc -l < "$TMP/z1/$f.tsv")" -gt 1 ] || fail "-ion_series auto: $f.tsv has no rows"
  for t in 3 8; do
    cmp -s "$TMP/z1/$f.tsv" "$TMP/z$t/$f.tsv" || fail "-ion_series auto: $f.tsv differs between -threads 1 and $t"
  done
done
msg="$msg; -ion_series auto: ${#ZOUTS[@]} TSVs on a synthetic ETD run"
fi

if [ -n "$PROF" ]; then
  # On the profile fixture's 10 spectra the tags (at -min_filter_length 3),
  # digest, label and massgap reports have rows; recon and delta are header
  # only (no tag reaches the fixture database's proteins) and are compared
  # as written.
  POUTS=(tags digest label massgap)
  for t in 1 3 8; do
    for r in ondisc fast; do
      d="$TMP/p$r$t"; mkdir -p "$d"
      extra=(); [ $r = ondisc ] && extra=(-out_spectra "$d/spectra.mzML")
      "$BIN" -in "$PROF" -out "$d/tags.tsv" -threads "$t" -pick_profile auto -min_filter_length 3 \
        -fasta "$DB" -recon_out "$d/recon.tsv" -delta_out "$d/delta.tsv" \
        -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" ${extra[@]+"${extra[@]}"} \
        >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-pick_profile auto ($r) -threads $t run failed"; }
      grep -q 'mzML: centroided 10 profile spectra on read' "$d/log" \
        || { cat "$d/log" >&2; fail "-pick_profile auto ($r) -threads $t: the 10 profile spectra were not centroided"; }
    done
  done
  for r in ondisc fast; do
    for f in ${POUTS[@]+"${POUTS[@]}"} recon delta; do
      case " ${POUTS[*]} " in *" $f "*)
        [ "$(wc -l < "$TMP/p${r}1/$f.tsv")" -gt 1 ] || fail "auto ($r): $f.tsv has no rows at -threads 1; the check would prove nothing" ;;
      esac
      for t in 3 8; do
        cmp -s "$TMP/p${r}1/$f.tsv" "$TMP/p$r$t/$f.tsv" || fail "auto ($r): $f.tsv differs between -threads 1 and $t"
      done
    done
  done
  cmp -s "$TMP/pondisc1/tags.tsv" "$TMP/pfast1/tags.tsv" || fail "auto: tags differ between the OnDisc and the fast reader"
  # The exported spectra (the processing info lists -threads, so compare the
  # spectrumList): centroided, and the same at every thread count.
  spl() { tr -d '\r' < "$1" | sed -n '/<spectrumList /,/<\/spectrumList>/p'; }
  n=$(spl "$TMP/pondisc1/spectra.mzML" | grep -c '<spectrum ')
  [ "$n" -gt 0 ] || fail "auto -out_spectra exported no spectra at -threads 1"
  [ "$(spl "$TMP/pondisc1/spectra.mzML" | grep -c 'MS:1000127')" -ge "$n" ] || fail "auto -out_spectra: not every exported spectrum is centroid"
  for t in 3 8; do
    cmp -s <(spl "$TMP/pondisc1/spectra.mzML") <(spl "$TMP/pondisc$t/spectra.mzML") \
      || fail "auto -out_spectra: exported spectra differ between -threads 1 and $t"
  done
  msg="$msg; -pick_profile auto: ${#POUTS[@]} TSVs (+ recon, delta headers) on two readers and $n exported spectra"
fi
echo "threads_test: all checks passed ($msg identical at 1, 3 and 8 threads)"
