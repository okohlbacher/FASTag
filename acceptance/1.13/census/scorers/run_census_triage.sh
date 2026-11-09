#!/bin/bash
# FASTag 1.13 item 7 (#11 census triage evaluation): one run, all arms.
#   run_census_triage.sh <mzML> <outdir> [threads]
# Arms (frozen in PREREG-census-triage.md):
#   closed  SageAdapter (OpenMS 70cebcd144) + Sage 0.14.7 on the target+decoy DB (DecoyDatabase reverse, DECOY_),
#           IDScoreSwitcher: spectrum_q -> score type q-value (lower better). The -census_ids input.
#   fastag  FASTag at defaults + -census -census_ids closed.idXML (-census_ids_fdr 0.01, -census_triage_evalue 0.01).
#   semi    Sage 0.14.7, the closed search's settings, semi-enzymatic, + protein N-term acetyl and N-term pyro-Glu (Q).
#   open    Sage 0.14.7, the closed search's settings, precursor window [-500, +150] Da, isotope errors 0.
# Environment: CENSUS_ROOT (default /scratch/kohlbach/b113/census): opt/FASTag, db/UP000005640_9606_td.fasta.
set -u
export LC_ALL=C LANG=C
IN=$1; OUT=$2; T=${3:-8}
R=${CENSUS_ROOT:-/scratch/kohlbach/b113/census}
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
SAGE=/ceph/ibmi/abi/oliver/jpr-bench/envs/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
DB=$R/db/UP000005640_9606_td.fasta
export OPENMS_DATA_PATH=$P/share/OpenMS TMPDIR=/dev/shm/kohlbach-tmp OPENMS_TMPDIR=/dev/shm/kohlbach-tmp RAYON_NUM_THREADS=$T
mkdir -p "$TMPDIR" "$OUT"/closed "$OUT"/fastag "$OUT"/semi "$OUT"/open
step() { echo "STEP $1 $(date -Is)"; }

step closed
if [ ! -s "$OUT/closed/closed.idXML" ]; then
  ( cd "$OUT/closed" && $P/bin/SageAdapter -in "$IN" -out closed_raw.idXML -database "$DB" -sage_executable "$SAGE" \
      -decoy_prefix DECOY_ -precursor_tol_left -10 -precursor_tol_right 10 -precursor_tol_unit ppm \
      -fragment_tol_left -20 -fragment_tol_right 20 -fragment_tol_unit ppm \
      -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -threads "$T" > sage.log 2>&1 \
    && $P/bin/IDScoreSwitcher -in closed_raw.idXML -out closed.idXML -new_score spectrum_q -new_score_type q-value \
      -new_score_orientation lower_better > switch.log 2>&1 ) || { echo "FAIL closed"; exit 1; }
fi

step fastag
if [ ! -s "$OUT/fastag/tags.census.tsv" ]; then
  "$R/opt/FASTag" -in "$IN" -out "$OUT/fastag/tags.tsv" -census -census_ids "$OUT/closed/closed.idXML" \
    -census_ids_fdr 0.01 -census_triage_evalue 0.01 -threads "$T" > "$OUT/fastag/run.log" 2>&1 || { echo "FAIL fastag"; exit 1; }
fi

# Sage JSON: the closed search's settings as SageAdapter wrote them (results.json), with the arm's changes.
mkjson() {  # arm
  python3 - "$OUT/closed/results.json" "$1" "$IN" "$OUT/$1" <<'EOF'
import json, sys
src, arm, mz, out = sys.argv[1:]
c = json.load(open(src))
for k in ("output_paths", "version"):
    c.pop(k, None)
c["mzml_paths"] = [mz]
db = c["database"]
if arm == "semi":
    db["enzyme"]["semi_enzymatic"] = True
    vm = db["variable_mods"]
    vm["[" ] = [42.010565]        # protein N-term acetyl
    vm["^Q"] = [-17.026549]       # peptide N-term pyro-Glu from Q
elif arm == "open":
    c["precursor_tol"] = {"da": [-500.0, 150.0]}
    c["isotope_errors"] = [0, 0]
else:
    sys.exit("unknown arm " + arm)
json.dump(c, open(f"{out}/sage.json", "w"), indent=2)
EOF
}
for arm in semi open; do
  step $arm
  if [ ! -s "$OUT/$arm/results.sage.tsv" ]; then
    mkjson $arm || { echo "FAIL json $arm"; exit 1; }
    "$SAGE" -o "$OUT/$arm" "$OUT/$arm/sage.json" > "$OUT/$arm/sage.log" 2>&1 || { echo "FAIL $arm"; exit 1; }
  fi
done
sha256sum "$IN" "$OUT"/closed/closed.idXML "$OUT"/fastag/tags.census.tsv "$OUT"/fastag/tags.census_summary.tsv \
  "$OUT"/semi/results.sage.tsv "$OUT"/open/results.sage.tsv > "$OUT/outputs.sha256"
step done
echo RUN_DONE
