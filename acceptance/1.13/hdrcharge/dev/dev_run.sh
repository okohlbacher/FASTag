#!/bin/bash
# hdrcharge DEV (backlog #14): Sage charge truth on the charge-stripped DEV copies, a perturbed copy, and
# -check_header_charge warn at several margins. DEV runs only: PXD003531 (QE, HCD) and PXD001819 (LTQ, CID).
# Truth search: the held-out truth style (C+57 fixed, M+16 variable, max 2), the DEV run tolerances.
set -uo pipefail
D=/scratch/kohlbach/b113/hdrcharge/dev
cd $D; source /scratch/kohlbach/b113/hdrcharge/env.sh
export OPENBLAS_NUM_THREADS=1 RAYON_NUM_THREADS=16
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
B=$D/bin/FASTag
JB=/ceph/ibmi/abi/oliver/jpr-bench
declare -A IN=( [PXD003531]=$JB/data/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
                [PXD001819]=$JB/data/PXD001819/UPS1_25000amol_R1.mzML )
declare -A FASTA=( [PXD003531]=$JB/data/PXD054073/UP000005640_9606.fasta [PXD001819]=$JB/data/PXD001819/yeast_ups.fasta )
declare -A TOL=( [PXD003531]="10 ppm 20 true" [PXD001819]="5 da 0.8 false" )
declare -A OPT=( [PXD003531]="" [PXD001819]="-fragment_tolerance 0.5 -fragment_tolerance_unit Da" )
for p in PXD003531 PXD001819; do
  w=$D/$p; mkdir -p $w/truth; cd $w
  [ -s input.nocharge.mzML ] || $PY $D/scripts/strip_charge.py ${IN[$p]} input.nocharge.mzML > strip.txt
  [ -s pert.mzML ] || $PY $D/scripts/perturb_charge.py ${IN[$p]} pert.mzML > pert.txt
  if ! grep -q SAGE_RC=0 truth/sage.log 2>/dev/null; then
    $PY - ${FASTA[$p]} $w/input.nocharge.mzML truth/sage.json ${TOL[$p]} <<"PYEOF"
import json, sys
fasta, mz, out, ptol, funit, ftol, deiso = sys.argv[1:8]
cfg = {"database": {"bucket_size": 32768, "enzyme": {"missed_cleavages": 2, "min_len": 7, "max_len": 50,
       "cleave_at": "KR", "restrict": "P"}, "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
       "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0, "ion_kinds": ["b", "y"], "min_ion_index": 2,
       "static_mods": {"C": 57.021464}, "variable_mods": {"M": [15.994915]}, "max_variable_mods": 2,
       "decoy_tag": "rev_", "generate_decoys": True, "fasta": fasta},
       "precursor_tol": {"ppm": [-float(ptol), float(ptol)]}, "fragment_tol": {funit: [-float(ftol), float(ftol)]},
       "precursor_charge": [1, 4], "isotope_errors": [-1, 3], "deisotope": deiso == "true", "chimera": False,
       "wide_window": False, "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1,
       "mzml_paths": [mz]}
json.dump(cfg, open(out, "w"), indent=2)
PYEOF
    ( cd truth && $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
  fi
  for in in orig pert; do
    src=${IN[$p]}; [ $in = pert ] && src=$w/pert.mzML
    for m in 1 2 3 4 6; do
      d=$w/$in/m$m; mkdir -p $d
      [ -f $d/log ] && grep -q FASTAG_RC=0 $d/log && continue
      ( cd $d && $B -in $src -out tags.tsv -threads 16 ${OPT[$p]} -check_header_charge warn -check_header_margin $m \
          -check_header_out hc.tsv > log 2>&1; echo FASTAG_RC=$? >> log; rm -f tags.tsv )
    done
  done
done
echo DEV_DONE > $D/dev.done
