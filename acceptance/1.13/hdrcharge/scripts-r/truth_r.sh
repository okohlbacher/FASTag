#!/bin/bash
# hdrcharge second held-out round: the Sage truth of one staged run, before the freeze. No FASTag run.
#   truth_r.sh <mzML> <work dir of the run>
# Charge-stripped copy (scripts/strip_charge.py), perturbed copy (scripts/perturb_charge.py; made here so that its
# sha256 is frozen, read by FASTag only after the freeze), Sage 0.14.7 on the stripped copy: `truth` (one PSM per
# spectrum) and `chimera` (chimera mode, two PSMs). Writes <work dir>/qualification.tsv: truth spectra = target,
# rank 1, spectrum_q <= 0.001 PSMs; the header charges are not read here.
set -uo pipefail
MZ=$1; W=$2; H=$(cd "$(dirname "$0")/.." && pwd)
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
FASTA=/ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta
export RAYON_NUM_THREADS=${SAGE_THREADS:-12}
mkdir -p "$W"; cd "$W"
[ -s input.nocharge.mzML ] || $PY -I $H/scripts/strip_charge.py "$MZ" input.nocharge.mzML > strip.txt
[ -s pert.mzML ] || $PY -I $H/scripts/perturb_charge.py "$MZ" pert.mzML > pert.txt
for mode in truth chimera; do mkdir -p $mode
  grep -q '^SAGE_RC=0' $mode/sage.log 2>/dev/null && continue
  $PY -I - $FASTA "$W/input.nocharge.mzML" $mode/sage.json $mode <<"PYEOF"
import json, sys
fasta, mz, out, mode = sys.argv[1:5]
cfg = {"database": {"bucket_size": 32768, "enzyme": {"missed_cleavages": 2, "min_len": 7, "max_len": 50,
       "cleave_at": "KR", "restrict": "P"}, "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
       "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0, "ion_kinds": ["b", "y"], "min_ion_index": 2,
       "static_mods": {"C": 57.021464}, "variable_mods": {"M": [15.994915]}, "max_variable_mods": 2,
       "decoy_tag": "rev_", "generate_decoys": True, "fasta": fasta},
       "precursor_tol": {"ppm": [-10.0, 10.0]}, "fragment_tol": {"ppm": [-20.0, 20.0]},
       "precursor_charge": [1, 4], "isotope_errors": [-1, 3], "deisotope": True, "chimera": mode == "chimera",
       "wide_window": False, "predict_rt": True, "min_peaks": 15, "max_peaks": 150,
       "report_psms": 2 if mode == "chimera" else 1, "mzml_paths": [mz]}
json.dump(cfg, open(out, "w"), indent=2)
PYEOF
  ( cd $mode && $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
done
n=$(awk -F'\t' 'NR==1{for(i=1;i<=NF;i++) c[$i]=i; next} $c["label"]==1 && $c["rank"]==1 && $c["spectrum_q"]<=0.001{k++} END{print k+0}' truth/results.sage.tsv 2>/dev/null)
printf 'truth_spectra\tsage_rc_truth\tsage_rc_chimera\ttruth_sage_sha256\tchimera_sage_sha256\tnocharge_sha256\tpert_sha256\tpert_tsv_sha256\n' > qualification.tsv
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${n:-0}" "$(grep -o 'SAGE_RC=.*' truth/sage.log | cut -d= -f2)" "$(grep -o 'SAGE_RC=.*' chimera/sage.log | cut -d= -f2)" \
  "$(sha256sum truth/results.sage.tsv | cut -c1-64)" "$(sha256sum chimera/results.sage.tsv | cut -c1-64)" \
  "$(sha256sum input.nocharge.mzML | cut -c1-64)" "$(sha256sum pert.mzML | cut -c1-64)" "$(sha256sum pert.mzML.perturbed.tsv | cut -c1-64)" >> qualification.tsv
echo TRUTH_DONE > truth.done
