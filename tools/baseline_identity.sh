#!/usr/bin/env bash
# Baseline-identity harness: every legacy output of a candidate FASTag binary
# against the same run of a baseline binary (the 1.11.0 release, 78390cd, on
# node data), after masking only run-specific values (dates, versions, the
# random mzIdentML ids; see tools/baseline_canon.py). Not compared here: the
# -out_spectra mzPeak export (gate.sh's member digests cover it) and buildtaxdb
# (compared by test/baseline_identity_test.sh and tools/baseline_identity_gate.sh).
#
#   baseline_identity.sh [options] <candidate> <baseline> <workdir>
#
#   --in FILE            spectra (required)
#   --fasta FILE         database for the recon cases (all_mzid, idxml, mztab);
#                        without it those cases are skipped
#   --taxdb F --nodes F --names F
#                        taxonomy for the species case; without them it is skipped
#   --common "ARGS"      options for every tag case (word-split; no spaces in values)
#   --species-args "ARGS" options for the species case instead of --common
#                        (default "-tag_length 7")
#   --threads "N ..."    thread counts; every case runs at each (default "1 8")
#   --cases "C ..."      subset of: plain all_mzid idxml mztab format spectra_mzml species
#                        interface (default: all that the inputs allow)
#   --digest-dir DIR     FASTAG_DIGEST_DIR for both binaries (-digest_out, -massgap_out)
#   --label NAME         prefix for the report lines (default: input file name)
#
# Per case and thread count both binaries run in their own directory with the
# same relative output names. Compared:
#   - exit code and the "N MS2 spectra, M tags" summary line (what gate.sh digests);
#   - the set of files written;
#   - every file, canonicalised, with cmp (the first differing lines are shown);
#     one change is accepted and reported as PREFIX: -label_out (label.tsv)
#     may end in the label_call rows FASTag 1.12 appends (#3a), when the
#     baseline's file is a byte prefix of the candidate's and every added
#     line is a label_call row;
#   - interface: `--help` and the -write_ctd CTD, raw bytes (versions masked when
#     the two binaries report different versions).
# The rest of the log is reported as INFO when it differs, never a failure.
# A case whose baseline tag TSV has no rows FAILS: the comparison would prove nothing.
#
# Exit 0 when every comparison is equal, 1 otherwise, 2 on usage errors.
# Writes <workdir>/report.tsv (case, threads, item, status).
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CANON="$HERE/baseline_canon.py"
PY=${FASTAG_PYTHON:-}
if [ -z "$PY" ]; then for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY=$c; break; }; done; fi
[ -n "$PY" ] || { echo "baseline_identity: no python3 for $CANON" >&2; exit 2; }

IN="" FASTA="" TAXDB="" NODES="" NAMES="" COMMON="" SPECIES_ARGS="-tag_length 7" THREADS="1 8" CASES="" DIGEST_DIR="" LABEL=""
while [ $# -gt 0 ]; do
  case $1 in
    --in) IN=$2; shift 2 ;;
    --fasta) FASTA=$2; shift 2 ;;
    --taxdb) TAXDB=$2; shift 2 ;;
    --nodes) NODES=$2; shift 2 ;;
    --names) NAMES=$2; shift 2 ;;
    --common) COMMON=$2; shift 2 ;;
    --species-args) SPECIES_ARGS=$2; shift 2 ;;
    --threads) THREADS=$2; shift 2 ;;
    --cases) CASES=$2; shift 2 ;;
    --digest-dir) DIGEST_DIR=$2; shift 2 ;;
    --label) LABEL=$2; shift 2 ;;
    -h|--help) sed -n 2,36p "$0"; exit 0 ;;
    --*) echo "baseline_identity: unknown option $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
[ $# -eq 3 ] || { sed -n 2,36p "$0" >&2; exit 2; }
CAND=$1 BASE=$2 WORK=$3
[ -n "$IN" ] && [ -f "$IN" ] || { echo "baseline_identity: --in file missing" >&2; exit 2; }
for b in "$CAND" "$BASE"; do [ -x "$b" ] || { echo "baseline_identity: not executable: $b" >&2; exit 2; }; done
# Every run starts in its own directory: make the paths absolute.
abspath() { [ -z "$1" ] && return; case $1 in /*) echo "$1" ;; *) echo "$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")" ;; esac; }
CAND=$(abspath "$CAND") BASE=$(abspath "$BASE") IN=$(abspath "$IN") FASTA=$(abspath "$FASTA")
TAXDB=$(abspath "$TAXDB") NODES=$(abspath "$NODES") NAMES=$(abspath "$NAMES") DIGEST_DIR=$(abspath "$DIGEST_DIR")
[ -n "$LABEL" ] || LABEL=$(basename "$IN")
[ -z "$DIGEST_DIR" ] || export FASTAG_DIGEST_DIR="$DIGEST_DIR"
unset FASTAG_FULL_PRECISION
export OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$WORK" || exit 2
WORK=$(CDPATH= cd -- "$WORK" && pwd)

if [ -z "$CASES" ]; then
  CASES="plain format spectra_mzml interface"
  [ -n "$FASTA" ] && CASES="all_mzid idxml mztab $CASES"
  [ -n "$TAXDB" ] && CASES="$CASES species"
fi

# "Version: 1.11.0 (OpenMS 3.7.0-pre-HEAD-2026-11-02)" -> 1.11.0 / 3.7.0-pre-HEAD-2026-11-02
version_of() { "$1" --help 2>&1 | tr -d '\r' | sed -n 's/^Version: \([^ ]*\).*/\1/p' | head -1; }
openms_of() { "$1" --help 2>&1 | tr -d '\r' | sed -n 's/^Version: [^ ]* (OpenMS \([^)]*\)).*/\1/p' | head -1; }
CV=$(version_of "$CAND") BV=$(version_of "$BASE")
CO=$(openms_of "$CAND") BO=$(openms_of "$BASE")
[ -n "$CV" ] && [ -n "$BV" ] || { echo "baseline_identity: cannot read the version from --help" >&2; exit 2; }

REPORT="$WORK/report.tsv"
[ -f "$REPORT" ] || printf 'label\tcase\tthreads\titem\tstatus\n' > "$REPORT"
nfail=0 nsame=0
rec() { printf '%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$1" "$2" "$3" "$4" >> "$REPORT"
        case $4 in SAME) nsame=$((nsame + 1)) ;; INFO*|PREFIX*) ;; *) nfail=$((nfail + 1)); echo "  FAIL $1 t$2 $3: $4" ;; esac; }
# label_prefix BASE CAND: BASE is a byte prefix of CAND and every further line
# of CAND is a label_call row (FASTag 1.12 #3a); prints the number of them.
label_prefix() {
  local nb; nb=$(wc -c < "$1" | tr -d ' ')
  cmp -s -n "$nb" "$1" "$2" || return 1
  tail -c +"$((nb + 1))" "$2" | awk -F'\t' '$1 != "label_call" { bad = 1 } END { if (bad || NR == 0) exit 1; print NR }'
}
showdiff() { diff "$1" "$2" | head -8 | cut -c1-200 | sed 's/^/      /'; }

# args for case $1 into CASE_ARGS
case_args() {
  local c=$1
  read -r -a C <<< "$COMMON"
  read -r -a S <<< "$SPECIES_ARGS"
  CASE_ARGS=()
  case $c in
    all_mzid) CASE_ARGS=("${C[@]}" -fasta "$FASTA" -out tags.tsv -recon_out recon.tsv -delta_out delta.tsv
                         -digest_out digest.tsv -label_out label.tsv -massgap_out massgap.tsv
                         -glyco -glyco_out glyco.tsv -recon_id_out ids.mzid) ;;
    idxml)    CASE_ARGS=("${C[@]}" -fasta "$FASTA" -out tags.tsv -recon_out recon.tsv -recon_id_out ids.idXML) ;;
    mztab)    CASE_ARGS=("${C[@]}" -fasta "$FASTA" -out tags.tsv -recon_out recon.tsv -recon_id_out ids.mzTab) ;;
    plain)    CASE_ARGS=("${C[@]}" -out tags.tsv) ;;
    format)   CASE_ARGS=("${C[@]}" -proforma -res_conf -out tags.tsv) ;;
    spectra_mzml) CASE_ARGS=("${C[@]}" -out tags.tsv -out_spectra spectra.mzML) ;;
    species)  CASE_ARGS=("${S[@]}" -species -taxdb "$TAXDB" -taxonomy_nodes "$NODES" -taxonomy_names "$NAMES"
                         -out tags.tsv -species_out species.tsv) ;;
    *) return 1 ;;
  esac
}

summary() { tr -d '\r' < "$1" | grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' || echo MISSING; }
# The log without the lines that legitimately differ between runs.
loglines() { tr -d '\r' < "$1" | grep -v -E '^FASTag took |^-threads 0: using ' \
               | sed -E -e "s#$WORK/[^/ ]*/[^/ ]*/##g" -e 's/\([0-9.]+ s\)/(@TIME@ s)/g'; }

run_interface() {
  local d="$WORK/interface" ok=1
  rm -rf "$d"; mkdir -p "$d/c" "$d/b"
  "$CAND" --help > "$d/c/help.txt" 2>&1; local rc_c=$?
  "$BASE" --help > "$d/b/help.txt" 2>&1; local rc_b=$?
  [ $rc_c = $rc_b ] || rec interface - help.exit "DIFF (exit $rc_c vs $rc_b)"
  "$CAND" -write_ctd "$d/c" > "$d/c/ctd.log" 2>&1 || rec interface - ctd "ERROR (candidate -write_ctd exit $?)"
  "$BASE" -write_ctd "$d/b" > "$d/b/ctd.log" 2>&1 || rec interface - ctd "ERROR (baseline -write_ctd exit $?)"
  for f in help.txt FASTag.ctd; do
    [ -f "$d/c/$f" ] && [ -f "$d/b/$f" ] || { rec interface - "$f" MISSING; continue; }
    if cmp -s "$d/c/$f" "$d/b/$f"; then rec interface - "$f" SAME
    elif [ "$CV" != "$BV" ] || [ "$CO" != "$BO" ]; then
      "$PY" "$CANON" "$d/c/$f" "$CV" "$CO" > "$d/c/$f.canon"; "$PY" "$CANON" "$d/b/$f" "$BV" "$BO" > "$d/b/$f.canon"
      if cmp -s "$d/c/$f.canon" "$d/b/$f.canon"; then rec interface - "$f" SAME
      else rec interface - "$f" DIFF; showdiff "$d/b/$f.canon" "$d/c/$f.canon"; fi
    else rec interface - "$f" DIFF; showdiff "$d/b/$f" "$d/c/$f"; fi
  done
}

run_case() { # case threads
  local c=$1 t=$2 d="$WORK/$1/t$2" side rc_c rc_b f
  case_args "$c" || { rec "$c" "$t" case "ERROR (unknown case)"; return; }
  rm -rf "$d"; mkdir -p "$d/c" "$d/b"
  for side in c b; do
    local bin=$CAND; [ $side = b ] && bin=$BASE
    ( cd "$d/$side" && "$bin" -in "$IN" "${CASE_ARGS[@]}" -threads "$t" > run.log 2>&1 ); echo $? > "$d/$side.rc"
  done
  rc_c=$(cat "$d/c.rc") rc_b=$(cat "$d/b.rc")
  if [ "$rc_c" = "$rc_b" ]; then rec "$c" "$t" exit SAME; else rec "$c" "$t" exit "DIFF ($rc_c vs baseline $rc_b)"; fi
  [ "$rc_b" = 0 ] || rec "$c" "$t" baseline_run "ERROR (exit $rc_b; see $d/b/run.log)"
  if [ "$(summary "$d/c/run.log")" = "$(summary "$d/b/run.log")" ]; then rec "$c" "$t" summary SAME
  else rec "$c" "$t" summary "DIFF ('$(summary "$d/c/run.log")' vs '$(summary "$d/b/run.log")')"; fi
  if ! diff -q <(loglines "$d/c/run.log") <(loglines "$d/b/run.log") > /dev/null; then
    rec "$c" "$t" log "INFO (log lines differ)"
  fi
  local files_c files_b
  files_c=$(cd "$d/c" && ls | grep -v -x -e run.log -e '.*\.canon' | sort | tr '\n' ' ')
  files_b=$(cd "$d/b" && ls | grep -v -x -e run.log -e '.*\.canon' | sort | tr '\n' ' ')
  if [ "$files_c" = "$files_b" ]; then rec "$c" "$t" files SAME
  else rec "$c" "$t" files "DIFF (candidate: $files_c; baseline: $files_b)"; fi
  if [ "$rc_b" = 0 ] && [ "$(wc -l < "$d/b/tags.tsv" 2>/dev/null || echo 0)" -le 1 ]; then
    rec "$c" "$t" tags.tsv "EMPTY (the baseline wrote no tag rows; the comparison would prove nothing)"
  fi
  for f in $files_b; do
    [ -f "$d/c/$f" ] || continue
    "$PY" "$CANON" "$d/c/$f" "$CV" "$CO" > "$d/c/$f.canon" || { rec "$c" "$t" "$f" "ERROR (canon failed on candidate)"; continue; }
    "$PY" "$CANON" "$d/b/$f" "$BV" "$BO" > "$d/b/$f.canon" || { rec "$c" "$t" "$f" "ERROR (canon failed on baseline)"; continue; }
    if cmp -s "$d/c/$f.canon" "$d/b/$f.canon"; then rec "$c" "$t" "$f" SAME
    elif [ "$f" = label.tsv ] && n=$(label_prefix "$d/b/$f.canon" "$d/c/$f.canon"); then
      rec "$c" "$t" "$f" "PREFIX (the baseline's rows, then $n label_call rows)"
    else rec "$c" "$t" "$f" DIFF; showdiff "$d/b/$f.canon" "$d/c/$f.canon"; fi
  done
}

echo "baseline_identity: $LABEL; candidate $CV ($CAND), baseline $BV ($BASE); cases: $CASES; threads: $THREADS"
for c in $CASES; do
  if [ "$c" = interface ]; then run_interface; continue; fi
  for t in $THREADS; do run_case "$c" "$t"; done
done
npre=$(awk -F'\t' -v l="$LABEL" '$1 == l && $5 ~ /^PREFIX/' "$REPORT" | wc -l | tr -d ' ')
echo "baseline_identity: $LABEL: $nsame equal, $npre label_call prefix, $nfail different (report $REPORT)"
[ $nfail = 0 ]
