#!/usr/bin/env bash
# FASTag 1.12 DEV freeze of #17 (PLAN-handoff #17: "settings frozen on dev"), node data, DEV run PXD003531 only
# (20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML, human QE). No held-out file is read.
# Database: the gate's Homo_sapiens.fasta (20416 entries) for FASTag placement and the engine; every search adds a
# shuffled entrapment copy at r = 1 (entrap.py); the engines add decoys. FASTag options as #5 (FREEZE-05.md):
# -tag_length 4 -extension 6 -variable_modifications 'Oxidation (M)', fixed Carbamidomethyl (C) default, engine
# config defaults (precursor 10 ppm, fragment 20 ppm, 1 missed cleavage, isotope errors as exported).
# Arms: base = -search_config_out without -search_shifts (closed search: Carbamidomethyl C fixed, Oxidation M
# variable); cand_<v>_<o> = + -search_shifts both (Comet) / variable (Sage) with -shift_max_variable v and
# -shift_max_offsets o; grid (3,10) = RC defaults, (1,10), (3,3) [Comet], (3,-) and (1,-) [Sage].
# A5-01 negative-offset check (Comet only): base config with mass_offsets '0.0 -17.026549' (NEG) and the mirror
# '0.0 17.026549' (POS); negoff.py counts 1 % FDR PSMs whose exp - calc mass is the offset.
# Usage: run_dev17.sh <workdir> <threads>
set -euo pipefail
W=$1; TH=$2
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801
FT=$RC/opt/FASTag
export FASTAG_DIGEST_DIR=$RC/data/digest
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
COMET=/ceph/ibmi/abi/oliver/opt/comet-2026.03.0/comet.linux.exe
HS=/scratch/kohlbach/gate-in/db/Homo_sapiens.fasta
MZML=/scratch/kohlbach/gate-in/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
TPL=/scratch/kohlbach/fastag112-engines/cometp/comet.params.new
S=$(dirname "$0")
RUN=PXD003531
mkdir -p "$W/d17"; cd "$W/d17"
ln -sf "$MZML" run.mzML
[ -s hs_e.fasta ] || python3 -I "$S/entrap.py" hs_e.fasta "$HS" > entrap.log
DB=$PWD/hs_e.fasta
BASE=(-in run.mzML -recon_fasta "$HS" -tag_length 4 -extension 6 -variable_modifications 'Oxidation (M)' -threads "$TH")

sage_run() {
  python3 -I - "$2" "$DB" "$PWD/run.mzML" "$1/sage.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); c["database"]["fasta"] = sys.argv[2]; c["mzml_paths"] = [sys.argv[3]]
json.dump(c, open(sys.argv[4], "w"), indent=1)
PY
  RAYON_NUM_THREADS=$TH "$SAGE" "$1/sage.json" -o "$1/sage_out" > "$1/sage.log" 2>&1
}
comet_run() {
  sed -e "s|^database_name = .*|database_name = $DB|" -e "s/^num_threads = .*/num_threads = $TH/" \
      -e "s/^output_txtfile = .*/output_txtfile = 1/" -e "s/^output_pepxmlfile = .*/output_pepxmlfile = 0/" \
      "$2" > "$1/comet.params"
  ( cd "$1" && "$COMET" -Pcomet.params -Ncomet ../run.mzML > comet.log 2>&1 )
}
row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$RUN" "$1" "$2" "$3" "$4" "$HS" "$5" >> searches.tsv; }
: > searches.tsv

mkdir -p base
"$FT" "${BASE[@]}" -out base/tags.tsv -search_config_out base/cfg_sage.json > base/fastag_sage.log 2>&1
"$FT" "${BASE[@]}" -out base/tags_c.tsv -search_engine comet -search_config_template "$TPL" \
  -search_config_out base/cfg_comet.params > base/fastag_comet.log 2>&1
sage_run base base/cfg_sage.json; comet_run base base/cfg_comet.params
row base sage "closed" "$PWD/base/sage_out/results.sage.tsv" -
row base comet "closed" "$PWD/base/comet.txt" -

for vo in 3_10 1_10 3_3; do
  v=${vo%_*}; o=${vo#*_}; A=cand_$vo; mkdir -p $A
  "$FT" "${BASE[@]}" -out $A/tags_c.tsv -search_engine comet -search_config_template "$TPL" -search_shifts both \
    -shift_max_variable $v -shift_max_offsets $o -search_shifts_out $A/shifts_comet.tsv \
    -search_config_out $A/cfg_comet.params > $A/fastag_comet.log 2>&1
  comet_run $A $A/cfg_comet.params
  row $A comet "search_shifts both shift_max_variable $v shift_max_offsets $o" "$PWD/$A/comet.txt" base
  if [ "$o" = 10 ]; then
    "$FT" "${BASE[@]}" -out $A/tags.tsv -search_shifts variable -shift_max_variable $v \
      -search_shifts_out $A/shifts_sage.tsv -search_config_out $A/cfg_sage.json > $A/fastag_sage.log 2>&1
    sage_run $A $A/cfg_sage.json
    row $A sage "search_shifts variable shift_max_variable $v" "$PWD/$A/sage_out/results.sage.tsv" base
  fi
done

for sg in NEG POS; do
  A=off_$sg; mkdir -p $A
  [ $sg = NEG ] && OFF="0.0 -17.026549" || OFF="0.0 17.026549"
  sed -e "s/^mass_offsets = .*/mass_offsets = $OFF/" base/cfg_comet.params > $A/cfg_comet.params
  comet_run $A $A/cfg_comet.params
  row $A comet "base + mass_offsets $OFF" "$PWD/$A/comet.txt" base
done
echo "DEV17_DONE $(date -Is)"
