#!/usr/bin/env bash
# -qc_out (FASTag 1.16, item 2) against the real binary:
#   (a) the tag TSV is identical with and without -qc_out; no QC file without it
#   (b) the synthetic run run_qc_test writes: every fact `run_qc_test --expect`
#       names (counts per MS level and analyser, analyser source, charges,
#       stated MS2 resolution, reporter assessability and compatible kits,
#       redundancy) and the MS1 resolution measured within 3% of R = 50000
#   (c) the same QC file with -threads 1 and -threads 4 (synthetic, fixture)
#   (d) tag yield is the census's: MS2 rows with best_evalue <= 0.01 over the
#       census rows, on the vendored fixture
#   (e) the fixture's MS level counts equal its "ms level" cvParams
#   (f) MGF input: written; every MS2 counted, analyser class unknown
#   (g) five fields per line; the run rows first, then section qc
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
HELPER="$2"   # run_qc_test
IN="$3"       # Ecoli_MS2_small.mzML
MGF="$4"      # Ecoli_MS2_small.mgf

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-qc-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { local log="$1"; shift; "$BIN" "$@" >"$log" 2>&1 || { cat "$log" >&2; fail "run failed: $*"; }; }
# \r stripped: on Windows the QC file and the Python-written expectations end lines in CRLF.
qcv() { awk -F'\t' -v k="$2" '{ sub(/\r$/, "") } $1 == "qc" && $2 == k { print $3; f = 1 } END { if (!f) print "MISSING" }' "$1"; }
LOOSE=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da)
TIGHT=(-fragment_tolerance 0.02 -fragment_tolerance_unit Da)

# ---- (a) identity ---------------------------------------------------------------
mkdir -p "$TMP/off" "$TMP/on"
run "$TMP/off/log" -in "$IN" -out "$TMP/off/tags.tsv" "${LOOSE[@]}" -threads 2
run "$TMP/on/log" -in "$IN" -out "$TMP/on/tags.tsv" "${LOOSE[@]}" -threads 2 -qc_out "$TMP/on/qc.tsv"
cmp -s "$TMP/off/tags.tsv" "$TMP/on/tags.tsv" || fail "(a) the tag TSV differs with -qc_out"
[ "$(ls "$TMP/off")" = "log
tags.tsv" ] || fail "(a) a run without -qc_out wrote $(ls "$TMP/off" | tr '\n' ' ')"
[ -s "$TMP/on/qc.tsv" ] || fail "(a) no QC file"

# ---- (g) format -------------------------------------------------------------------
awk -F'\t' 'NF != 5 { bad = 1 } END { exit bad }' "$TMP/on/qc.tsv" || fail "(g) a line without five fields"
first=$(awk -F'\t' 'NR == 2 { print $1 }' "$TMP/on/qc.tsv")
[ "$first" = "run" ] || fail "(g) the first section is '$first', not run"
[ "$(qcv "$TMP/on/qc.tsv" qc_version)" = "1" ] || fail "(g) qc_version"

# ---- (e) fixture counts against its own cvParams ----------------------------------
ms1=$(grep -c 'name="ms level" value="1"' "$IN")
ms2=$(grep -c 'name="ms level" value="2"' "$IN")
[ "$(qcv "$TMP/on/qc.tsv" count_ms1)" = "$ms1" ] || fail "(e) count_ms1 $(qcv "$TMP/on/qc.tsv" count_ms1) != $ms1"
[ "$(qcv "$TMP/on/qc.tsv" count_ms2)" = "$ms2" ] || fail "(e) count_ms2 $(qcv "$TMP/on/qc.tsv" count_ms2) != $ms2"

# ---- (d) tag yield is the census's ------------------------------------------------
run "$TMP/on/clog" -in "$IN" -out "$TMP/on/c.tsv" "${LOOSE[@]}" -threads 2 -census -qc_out "$TMP/on/qc2.tsv"
cmp -s "$TMP/on/qc.tsv" "$TMP/on/qc2.tsv" || fail "(d) -census changes the QC file"
read -r cen_n cen_t < <(awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; ++i) if ($i == "best_evalue") c = i; next }
  { ++n; if ($c != "" && $c + 0 <= 0.01) ++t } END { print n, t + 0 }' "$TMP/on/c.census.tsv")
[ "$(qcv "$TMP/on/qc.tsv" ms2_tagged_e001)" = "$cen_t" ] || fail "(d) ms2_tagged_e001 $(qcv "$TMP/on/qc.tsv" ms2_tagged_e001) != census $cen_t"
[ "$cen_t" -gt 0 ] || fail "(d) the fixture has no tag at E <= 0.01"
[ "$cen_n" = "$ms2" ] || fail "(d) census rows $cen_n != MS2 $ms2"

# ---- (c) threads (fixture) ---------------------------------------------------------
run "$TMP/on/t1" -in "$IN" -out "$TMP/on/t1.tsv" "${LOOSE[@]}" -threads 1 -qc_out "$TMP/on/qc_t1.tsv"
run "$TMP/on/t4" -in "$IN" -out "$TMP/on/t4.tsv" "${LOOSE[@]}" -threads 4 -qc_out "$TMP/on/qc_t4.tsv"
cmp -s "$TMP/on/qc_t1.tsv" "$TMP/on/qc_t4.tsv" || fail "(c) fixture: QC differs between 1 and 4 threads"
cmp -s "$TMP/on/qc.tsv" "$TMP/on/qc_t1.tsv" || fail "(c) fixture: QC differs between 2 and 1 threads"

# ---- (b) the synthetic run ----------------------------------------------------------
SYN="$TMP/synthetic.mzML"
"$HELPER" --write-mzml "$SYN" || fail "(b) cannot write the synthetic run"
run "$TMP/s1" -in "$SYN" -out "$TMP/s1.tsv" "${TIGHT[@]}" -threads 1 -qc_out "$TMP/sqc1.tsv"
run "$TMP/s4" -in "$SYN" -out "$TMP/s4.tsv" "${TIGHT[@]}" -threads 4 -qc_out "$TMP/sqc4.tsv"
cmp -s "$TMP/sqc1.tsv" "$TMP/sqc4.tsv" || fail "(c) synthetic: QC differs between 1 and 4 threads"
Q="$TMP/sqc1.tsv"
in_clusters=
while read -r key want; do
  want=${want%$'\r'}
  case "$key" in
    resolution_FTMS_ms1)
      got=$(qcv "$Q" resolution_FTMS_ms1)
      awk -v g="$got" -v w="$want" 'BEGIN { exit !(g + 0 > 0 && (g - w) / w < 0.03 && (w - g) / w < 0.03) }' \
        || fail "(b) resolution_FTMS_ms1 $got, not within 3% of $want"
      [ "$(qcv "$Q" resolution_source_FTMS_ms1)" = "measured" ] || fail "(b) MS1 resolution not measured";;
    redundancy_in_clusters) in_clusters=$want;;
    *) got=$(qcv "$Q" "$key"); [ "$got" = "$want" ] || fail "(b) $key = $got, expected $want";;
  esac
done < <("$HELPER" --expect)
red_n=$(qcv "$Q" redundancy_ms2)
want_share=$(awk -v a="$in_clusters" -v b="$red_n" 'BEGIN { printf "%.4f", a / b }')
[ "$(qcv "$Q" redundancy_share)" = "$want_share" ] || fail "(b) redundancy_share $(qcv "$Q" redundancy_share) != $want_share"
[ "$(qcv "$Q" reporter_tmt10plex)" = "present" ] || fail "(b) TMT10 not present"
[ "$(qcv "$Q" reporter_tmt6plex)" = "absent" ] || fail "(b) TMT6 not absent"
[ "$(qcv "$Q" reporter_itraq4plex)" = "absent" ] || fail "(b) iTRAQ4 not absent"
[ "$(qcv "$Q" resolution_measured_FTMS_ms2)" = "n/a" ] || fail "(b) centroided MS2 resolution is not n/a"

# ---- (f) MGF ------------------------------------------------------------------------
run "$TMP/m" -in "$MGF" -out "$TMP/m.tsv" "${LOOSE[@]}" -threads 2 -qc_out "$TMP/mqc.tsv"
n_mgf=$(grep -c '^BEGIN IONS' "$MGF")
[ "$(qcv "$TMP/mqc.tsv" count_ms2)" = "$n_mgf" ] || fail "(f) MGF count_ms2 $(qcv "$TMP/mqc.tsv" count_ms2) != $n_mgf"
[ "$(qcv "$TMP/mqc.tsv" count_ms2_unknown)" = "$n_mgf" ] || fail "(f) MGF MS2 not of unknown analyser"

echo "run_qc_cli_test: all checks passed"
