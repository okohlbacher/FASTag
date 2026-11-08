#!/usr/bin/env bash
# FASTag 1.12 DEV freeze of #5 (PLAN-handoff #5: "tune only on dev runs"), node data, DEV runs only:
#   PXD003531 20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML (human, QE) and
#   PXD017035 d12_12_hTT_I.mzML (SIHUMIx, QE HF). No held-out file is read.
# Large database: ref50.fasta (human + 49 UniProt reference proteomes, 589010 entries) + cRAP (116); background
# of every reduced arm: cRAP (both runs: no host proteome in the sample design of the DEV runs; human is a
# database organism of ref50 for PXD003531, scenario (a)).
# Arms per run and engine (Sage 0.14.7, Comet 2026.03.0; engine settings identical across arms, taken from the
# FASTag-written configuration): F = full database; R_<e>_<m> = FASTag -fasta_out with -shortlist_max_evalue e
# and -shortlist_min_spectra m, grid e in {0.01, 0.1, 1}, m in {1, 2, 3}. Every arm gets a shuffled entrapment
# copy of its own target database at r = 1 (entrap.py, post-reduction entrapment C1); the engines add decoys.
# FASTag options fixed for all arms (FREEZE-05.md): -tag_length 4 -extension 6 -variable_modifications
# 'Oxidation (M)' (fixed Carbamidomethyl (C) default), shortlist parsimony none, top 0, not gapped; engine
# config defaults (precursor 10 ppm, fragment 20 ppm, isotope errors 0, 1 missed cleavage).
# Usage: run_dev05.sh <run_id> <mzML> <workdir> <threads>
set -euo pipefail
RUN=$1; MZML=$2; W=$3; TH=$4
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801
FT=$RC/opt/FASTag
export FASTAG_DIGEST_DIR=$RC/data/digest
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
COMET=/ceph/ibmi/abi/oliver/opt/comet-2026.03.0/comet.linux.exe
REF50=/ceph/ibmi/abi/oliver/jpr-bench/species/ref50.fasta
CRAP=/ceph/ibmi/abi/oliver/prose-auto-20261029/search/db/crap.fasta
TPL=/scratch/kohlbach/fastag112-engines/cometp/comet.params.new
S=$(dirname "$0")
mkdir -p "$W/$RUN"; cd "$W/$RUN"
ln -sf "$MZML" run.mzML
BASE=(-in run.mzML -recon_fasta "$REF50" -tag_length 4 -extension 6 -variable_modifications 'Oxidation (M)'
      -shortlist_background "$CRAP" -threads "$TH")

sage_run() {  # <arm> <config> <db_with_entrapment>
  python3 -I - "$2" "$3" "$PWD/run.mzML" "$1/sage.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); c["database"]["fasta"] = sys.argv[2]; c["mzml_paths"] = [sys.argv[3]]
json.dump(c, open(sys.argv[4], "w"), indent=1)
PY
  RAYON_NUM_THREADS=$TH "$SAGE" "$1/sage.json" -o "$1/sage_out" > "$1/sage.log" 2>&1
}
comet_run() {  # <arm> <config> <db_with_entrapment>
  sed -e "s|^database_name = .*|database_name = $3|" -e "s/^num_threads = .*/num_threads = $TH/" \
      -e "s/^output_txtfile = .*/output_txtfile = 1/" -e "s/^output_pepxmlfile = .*/output_pepxmlfile = 0/" \
      "$2" > "$1/comet.params"
  ( cd "$1" && "$COMET" -Pcomet.params -Ncomet ../run.mzML > comet.log 2>&1 )
}

: > searches.tsv
for e in 0.01 0.1 1; do for m in 1 2 3; do
  A=R_${e}_${m}; mkdir -p $A
  "$FT" "${BASE[@]}" -shortlist_max_evalue $e -shortlist_min_spectra $m -out $A/tags.tsv -shortlist_out $A/sl.tsv \
    -fasta_out $A/red.fasta -search_config_out $A/cfg_sage.json > $A/fastag_sage.log 2>&1
  "$FT" "${BASE[@]}" -shortlist_max_evalue $e -shortlist_min_spectra $m -out $A/tags_c.tsv \
    -fasta_out $A/red_c.fasta -search_engine comet -search_config_template "$TPL" -search_config_out $A/cfg_comet.params \
    > $A/fastag_comet.log 2>&1
  cmp -s $A/red.fasta $A/red_c.fasta || { echo "reduced FASTA differs between the two FASTag runs: $A" >&2; exit 3; }
  python3 -I "$S/entrap.py" $A/red_e.fasta $A/red.fasta > $A/entrap.log
  sage_run $A $A/cfg_sage.json "$PWD/$A/red_e.fasta"
  comet_run $A $A/cfg_comet.params "$PWD/$A/red_e.fasta"
  printf '%s\t%s\tsage\tmax_evalue %s min_spectra %s\t%s\t%s\tF\n' "$RUN" $A $e $m "$PWD/$A/sage_out/results.sage.tsv" "$PWD/$A/red.fasta" >> searches.tsv
  printf '%s\t%s\tcomet\tmax_evalue %s min_spectra %s\t%s\t%s\tF\n' "$RUN" $A $e $m "$PWD/$A/comet.txt" "$PWD/$A/red.fasta" >> searches.tsv
done; done
echo "REDUCED_DONE $RUN $(date -Is)"
# Arm F: the full database with the same engine settings (configurations of R_0.1_2, database replaced).
mkdir -p F
[ -s F/full.fasta ] || cat "$REF50" "$CRAP" > F/full.fasta
python3 -I "$S/entrap.py" F/full_e.fasta F/full.fasta > F/entrap.log
sage_run F R_0.1_2/cfg_sage.json "$PWD/F/full_e.fasta"
comet_run F R_0.1_2/cfg_comet.params "$PWD/F/full_e.fasta"
printf '%s\tF\tsage\tfull ref50+cRAP\t%s\t%s\t-\n' "$RUN" "$PWD/F/sage_out/results.sage.tsv" "$PWD/F/full.fasta" >> searches.tsv
printf '%s\tF\tcomet\tfull ref50+cRAP\t%s\t%s\t-\n' "$RUN" "$PWD/F/comet.txt" "$PWD/F/full.fasta" >> searches.tsv
echo "DEV05_DONE $RUN $(date -Is)"
