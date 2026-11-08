#!/usr/bin/env bash
# Diagnostic arm added after the #17 DEV grid (descriptive, not part of the freeze rule): the closed baseline with
# -search_isotope_errors 2, the isotope range the #17 candidates export on PXD003531 (rule 0). It separates the
# isotope-error part of the candidates' PSM gain from the exported modifications and offsets. Same DB, entrapment,
# FASTag options and engines as run_dev17.sh. Usage: diag17_iso.sh <workdir of run_dev17.sh> <threads>
set -euo pipefail
W=$1; TH=$2
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801
FT=$RC/opt/FASTag
export FASTAG_DIGEST_DIR=$RC/data/digest
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
COMET=/ceph/ibmi/abi/oliver/opt/comet-2026.03.0/comet.linux.exe
HS=/scratch/kohlbach/gate-in/db/Homo_sapiens.fasta
TPL=/scratch/kohlbach/fastag112-engines/cometp/comet.params.new
cd "$W/d17"; DB=$PWD/hs_e.fasta; A=base_iso2; mkdir -p $A
BASE=(-in run.mzML -recon_fasta "$HS" -tag_length 4 -extension 6 -variable_modifications 'Oxidation (M)' -threads "$TH" -search_isotope_errors 2)
"$FT" "${BASE[@]}" -out $A/tags.tsv -search_config_out $A/cfg_sage.json > $A/fastag_sage.log 2>&1
"$FT" "${BASE[@]}" -out $A/tags_c.tsv -search_engine comet -search_config_template "$TPL" -search_config_out $A/cfg_comet.params > $A/fastag_comet.log 2>&1
python3 -I - $A/cfg_sage.json "$DB" "$PWD/run.mzML" $A/sage.json <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); c["database"]["fasta"] = sys.argv[2]; c["mzml_paths"] = [sys.argv[3]]
json.dump(c, open(sys.argv[4], "w"), indent=1)
PY
RAYON_NUM_THREADS=$TH "$SAGE" $A/sage.json -o $A/sage_out > $A/sage.log 2>&1
sed -e "s|^database_name = .*|database_name = $DB|" -e "s/^num_threads = .*/num_threads = $TH/" \
    -e "s/^output_txtfile = .*/output_txtfile = 1/" -e "s/^output_pepxmlfile = .*/output_pepxmlfile = 0/" $A/cfg_comet.params > $A/comet.params
( cd $A && "$COMET" -Pcomet.params -Ncomet ../run.mzML > comet.log 2>&1 )
printf 'PXD003531\t%s\tsage\tclosed + search_isotope_errors 2 (diagnostic)\t%s\t%s\tbase\n' $A "$PWD/$A/sage_out/results.sage.tsv" "$HS" >> searches.tsv
printf 'PXD003531\t%s\tcomet\tclosed + search_isotope_errors 2 (diagnostic)\t%s\t%s\tbase\n' $A "$PWD/$A/comet.txt" "$HS" >> searches.tsv
echo "DIAG17_DONE $(date -Is)"
