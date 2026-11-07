#!/usr/bin/env bash
# -census (FASTag 1.12 #11 phase A) against the real binary:
#   (a) the tag TSV, and with -fasta/-recon_fasta -recon_out the recon table,
#       are identical with and without -census; no census file without it
#   (b) one census row per MS2 spectrum of the input; the n_reported column
#       sums to the tag TSV rows
#   (c) the spectra with status tagged or placed are the spectra of the tag TSV
#   (d) the placed spectra are a non-empty set equal to the spectra of
#       recon.tsv, and at least one reported spectrum is not placed
#   (e) ms2_processed = the log's "N MS2 spectra" = the statuses other than
#       empty and no_precursor
#   (f) the summary has five fields per line, starts with the run rows, has
#       every status, and ms2_total is empty iff subsampled = 1
#   (g) the MGF twin of the fixture gives the same census but for the index
#       and spectrum columns
#   (h) subsampling on census_edge.mzML (it has an MS1): the rows are exactly
#       the sampled MS2 spectra, computed independently (census_test
#       --sampled-ms2: FASTag's sampleByCount over OpenMS's MS levels)
#   (i) diatracer_like.mzML (precursor only as the isolation target) runs and
#       gets no acquisition-related status
#   -out_spectra lists -census only when it is set (the 1.11 parameter list
#   of the compatibility shim holds at defaults)
# and the expected status of every census_edge spectrum.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
HELPER="$2"   # census_test
IN="$3"       # Ecoli_MS2_small.mzML
MGF="$4"      # Ecoli_MS2_small.mgf
DB="$5"       # Ecoli_MS2_small.fasta
FIX="$6"      # test/fixtures

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-census-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
STATUSES="empty no_precursor no_signal bad_precursor too_few_peaks no_tags filtered placed tagged"
run() { local log="$1"; shift; "$BIN" "$@" >"$log" 2>&1 || { cat "$log" >&2; fail "run failed: $*"; }; }
ms2_in() { grep -c 'name="ms level" value="2"' "$1"; }
rows() { tail -n +2 "$1" | wc -l | tr -d ' '; }
col() { awk -F'\t' -v c="$2" 'NR > 1 { print $c }' "$1"; }   # census column c, data rows
log_ms2() { grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$1" | awk '{ print $1 }'; }
summary() { awk -F'\t' -v k="$2" '$1 == "census" && $2 == k { print $3; f = 1 } END { if (!f) print "MISSING" }' "$1"; }

# ---- (a) identity, default paths, no file without -census --------------------
mkdir -p "$TMP/off" "$TMP/on"
run "$TMP/off/log" -in "$IN" -out "$TMP/off/tags.tsv" ${ARGS[@]+"${ARGS[@]}"}
run "$TMP/on/log" -in "$IN" -out "$TMP/on/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
cmp -s "$TMP/off/tags.tsv" "$TMP/on/tags.tsv" || fail "(a) the tag TSV differs with -census"
[ "$(ls "$TMP/off")" = "log
tags.tsv" ] || fail "(a) a run without -census wrote $(ls "$TMP/off" | tr '\n' ' ')"
C="$TMP/on/tags.census.tsv"; S="$TMP/on/tags.census_summary.tsv"
[ -s "$C" ] && [ -s "$S" ] || fail "(a) -census did not write tags.census.tsv and tags.census_summary.tsv"
ls "$TMP/on" | grep -q '\.part$' && fail "(a) a .part file was left behind"

for mode in fasta recon_fasta; do
  d="$TMP/r_$mode"; mkdir -p "$d/off" "$d/on"
  for w in off on; do
    extra=(); [ $w = on ] && extra=(-census -census_out "$d/$w/census.tsv" -census_summary_out "$d/$w/summary.tsv")
    run "$d/$w/log" -in "$IN" -out "$d/$w/tags.tsv" -"$mode" "$DB" -recon_out "$d/$w/recon.tsv" -tag_length 4 \
      ${ARGS[@]+"${ARGS[@]}"} ${extra[@]+"${extra[@]}"}
  done
  cmp -s "$d/off/tags.tsv" "$d/on/tags.tsv" || fail "(a) -$mode: the tag TSV differs with -census"
  cmp -s "$d/off/recon.tsv" "$d/on/recon.tsv" || fail "(a) -$mode: recon.tsv differs with -census"
  [ "$(rows "$d/on/recon.tsv")" -gt 0 ] || fail "(a) -$mode: no placements; (d) would prove nothing"
done

# ---- (b) rows, (c) tagged set, (e) n_ms2, (f) summary -------------------------
check_run() {  # census summary tags log mzML_for_count subsampled
  local c="$1" s="$2" t="$3" l="$4" src="$5" sub="$6"
  [ "$(head -1 "$c" | awk -F'\t' '{ print NF }')" = 20 ] || fail "$c: header has not 20 fields"
  awk -F'\t' 'NF != 20 { exit 1 }' "$c" || fail "$c: a row has not 20 fields"
  if [ -n "$src" ]; then
    [ "$(rows "$c")" = "$(ms2_in "$src")" ] || fail "(b) $c: $(rows "$c") rows for $(ms2_in "$src") MS2 spectra"
  fi
  local rep; rep=$(col "$c" 14 | awk '{ s += $1 } END { print s + 0 }')
  [ "$rep" = "$(rows "$t")" ] || fail "(b) $c: n_reported sums to $rep, the tag TSV has $(rows "$t") rows"
  cmp -s <(awk -F'\t' 'NR > 1 && ($12 == "tagged" || $12 == "placed") { print $2 }' "$c" | sort -u) \
         <(tail -n +2 "$t" | cut -f1 | sort -u) || fail "(c) $c: tagged/placed spectra are not the tag TSV's"
  for st in $(col "$c" 12 | sort -u); do
    case " $STATUSES " in *" $st "*) ;; *) fail "$c: unknown status '$st'";; esac
  done
  local proc; proc=$(col "$c" 12 | grep -vcE '^(empty|no_precursor)$')
  [ "$proc" = "$(log_ms2 "$l")" ] || fail "(e) $c: $proc processed rows, the log says $(log_ms2 "$l") MS2 spectra"
  [ "$(summary "$s" ms2_processed)" = "$proc" ] || fail "(e) $s: ms2_processed $(summary "$s" ms2_processed), rows $proc"
  [ "$(summary "$s" ms2_seen)" = "$(rows "$c")" ] || fail "(f) $s: ms2_seen is not the row count"
  awk -F'\t' 'NF != 5 { exit 1 }' "$s" || fail "(f) $s: a line has not five fields"
  [ "$(head -1 "$s")" = "$(printf 'section\tkey\tvalue\tn\tdescription')" ] || fail "(f) $s: header"
  [ "$(sed -n 2p "$s" | cut -f1,2)" = "$(printf 'run\tversion')" ] || fail "(f) $s: does not start with the run rows"
  [ "$(summary "$s" census_version)" = 1 ] || fail "(f) $s: census_version"
  local sum=0
  for st in $STATUSES; do
    local n; n=$(summary "$s" "count_$st")
    [ "$n" != MISSING ] && [ "$(summary "$s" "share_$st")" != MISSING ] || fail "(f) $s: status $st missing"
    [ "$n" = "$(col "$c" 12 | grep -cx "$st")" ] || fail "(f) $s: count_$st $n does not match the rows"
    sum=$((sum + n))
  done
  [ "$sum" = "$(rows "$c")" ] || fail "(f) $s: the status counts sum to $sum"
  [ "$(summary "$s" subsampled)" = "$sub" ] || fail "(f) $s: subsampled $(summary "$s" subsampled), expected $sub"
  local total; total=$(summary "$s" ms2_total)
  if [ "$sub" = 1 ]; then [ -z "$total" ] || fail "(f) $s: ms2_total '$total' while subsampled"
  else [ "$total" = "$(rows "$c")" ] || fail "(f) $s: ms2_total '$total' without subsampling"; fi
}
check_run "$C" "$S" "$TMP/on/tags.tsv" "$TMP/on/log" "$IN" 0
[ "$(col "$C" 12 | grep -cx tagged)" -gt 0 ] || fail "no tagged spectrum in the fixture; the checks prove nothing"
for mode in fasta recon_fasta; do
  d="$TMP/r_$mode/on"
  check_run "$d/census.tsv" "$d/summary.tsv" "$d/tags.tsv" "$d/log" "$IN" 0
done

# ---- (d) placed = the spectra of recon.tsv; some reported spectrum unplaced ---
d="$TMP/r_recon_fasta/on"
awk -F'\t' 'NR > 1 && $12 == "placed" { print $2 }' "$d/census.tsv" | sort -u > "$TMP/placed"
tail -n +2 "$d/recon.tsv" | cut -f1 | sort -u > "$TMP/recon_ids"
[ -s "$TMP/placed" ] || fail "(d) no placed spectrum"
cmp -s "$TMP/placed" "$TMP/recon_ids" || fail "(d) the placed spectra are not the spectra of recon.tsv"
[ "$(col "$d/census.tsv" 12 | grep -cx tagged)" -gt 0 ] || fail "(d) every reported spectrum was placed; the precedence is untested"
# Without -recon_out there is no placed status.
col "$C" 12 | grep -qx placed && fail "(d) placed without -recon_out"

# ---- (g) the MGF twin -----------------------------------------------------------
mkdir -p "$TMP/mgf"
run "$TMP/mgf/log" -in "$MGF" -out "$TMP/mgf/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
cmp -s <(cut -f3- "$C") <(cut -f3- "$TMP/mgf/tags.census.tsv") || fail "(g) the MGF census differs from the mzML's"
[ "$(rows "$TMP/mgf/tags.census.tsv")" = 139 ] || fail "(g) the MGF census has $(rows "$TMP/mgf/tags.census.tsv") rows"

# ---- census_edge: every status where it belongs --------------------------------
E="$FIX/census_edge.mzML"
mkdir -p "$TMP/edge"
run "$TMP/edge/log" -in "$E" -out "$TMP/edge/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
EC="$TMP/edge/tags.census.tsv"
check_run "$EC" "$TMP/edge/tags.census_summary.tsv" "$TMP/edge/tags.tsv" "$TMP/edge/log" "$E" 0
got=$(awk -F'\t' 'NR > 1 { print $1 ":" $12 }' "$EC" | tr '\n' ' ')
for want in 1:empty 2:no_precursor 3:bad_precursor 4:too_few_peaks 5:no_signal 6:no_signal; do
  case " $got" in *" $want "*) ;; *) fail "census_edge: expected $want, got $got";; esac
done
awk -F'\t' 'NR > 1 && $1 == 0 { exit 1 }' "$EC" || fail "census_edge: the MS1 has a census row"
for i in 7 8 9 10 11; do
  case " $got" in *" $i:tagged "*|*" $i:no_tags "*) ;; *) fail "census_edge: index $i is not tagged/no_tags ($got)";; esac
done
[ "$(awk -F'\t' '$1 == 9 { print $5 ":" $6 }' "$EC")" = "0:2" ] || fail "census_edge: the charge-less MS2 is not charge_given 0, charge_used 2"
[ "$(summary "$TMP/edge/tags.census_summary.tsv" input_spectra)" = 12 ] || fail "census_edge: input_spectra"
[ "$(summary "$TMP/edge/tags.census_summary.tsv" no_charge)" = 1 ] || fail "census_edge: no_charge"

# ---- (h) subsampling ------------------------------------------------------------
for seed in 1 7; do
  d="$TMP/sub$seed"; mkdir -p "$d"
  run "$d/log" -in "$E" -out "$d/tags.tsv" -census -subsample_spectra 6 -subsample_seed $seed ${ARGS[@]+"${ARGS[@]}"}
  grep -q "Subsampling: tagging 6 of 12 input spectra" "$d/log" || fail "(h) seed $seed: no subsampling line"
  "$HELPER" --sampled-ms2 "$E" 6 $seed > "$d/want" || fail "(h) the census_test helper failed"
  [ -s "$d/want" ] || fail "(h) seed $seed selects no MS2; pick another seed"
  cmp -s "$d/want" <(col "$d/tags.census.tsv" 1) || fail "(h) seed $seed: rows $(col "$d/tags.census.tsv" 1 | tr '\n' ' ') are not the sampled MS2 $(tr '\n' ' ' < "$d/want")"
  check_run "$d/tags.census.tsv" "$d/tags.census_summary.tsv" "$d/tags.tsv" "$d/log" "" 1
  [ "$(summary "$d/tags.census_summary.tsv" input_spectra)" = 12 ] || fail "(h) input_spectra"
done
cmp -s "$TMP/sub1/want" "$TMP/sub7/want" && fail "(h) both seeds select the same spectra; the check is weak"

# ---- (i) diatracer_like ---------------------------------------------------------
mkdir -p "$TMP/dia"
run "$TMP/dia/log" -in "$FIX/diatracer_like.mzML" -out "$TMP/dia/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
check_run "$TMP/dia/tags.census.tsv" "$TMP/dia/tags.census_summary.tsv" "$TMP/dia/tags.tsv" "$TMP/dia/log" \
  "$FIX/diatracer_like.mzML" 0
[ "$(col "$TMP/dia/tags.census.tsv" 12 | grep -cx tagged)" -gt 0 ] || fail "(i) diatracer_like gave no tagged spectrum"

# ---- -out_spectra provenance: the unset flag is not listed (the 1.11 list of
# the compatibility shim), the set flag is, with its value ----------------------
mkdir -p "$TMP/os"
run "$TMP/os/log0" -in "$IN" -out "$TMP/os/t0.tsv" -out_spectra "$TMP/os/s0.mzML" ${ARGS[@]+"${ARGS[@]}"}
grep -q 'name="parameter: census' "$TMP/os/s0.mzML" && fail "-out_spectra lists a census option at its default"
run "$TMP/os/log1" -in "$IN" -out "$TMP/os/t1.tsv" -out_spectra "$TMP/os/s1.mzML" -census ${ARGS[@]+"${ARGS[@]}"}
grep -q 'name="parameter: census" type="xsd:string" value="true"' "$TMP/os/s1.mzML" \
  || fail "-out_spectra does not list -census when it is set"
grep -q 'name="parameter: census_out"' "$TMP/os/s1.mzML" && fail "-out_spectra lists the unset -census_out"
cmp -s "$TMP/os/t0.tsv" "$TMP/os/t1.tsv" || fail "-census changed the tags of an -out_spectra run"

# ---- -census_out / -census_summary_out are only read with -census ----------------
mkdir -p "$TMP/orph"
run "$TMP/orph/log" -in "$IN" -out "$TMP/orph/tags.tsv" -census_out "$TMP/orph/c.tsv" ${ARGS[@]+"${ARGS[@]}"}
grep -q -- "-census_out is only read for -census" "$TMP/orph/log" || fail "no warning for -census_out without -census"
[ ! -e "$TMP/orph/c.tsv" ] || fail "-census_out without -census wrote a file"
cmp -s "$TMP/off/tags.tsv" "$TMP/orph/tags.tsv" || fail "-census_out without -census changed the tags"

echo "census_cli_test: all checks passed"
