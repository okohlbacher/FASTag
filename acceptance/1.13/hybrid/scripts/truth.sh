#!/bin/bash
# Hybrid arm: activation table and Sage truth of one mzML. No FASTag run.
#   truth.sh <mzML> <work dir> <truth-config json>
# Sage 0.14.7 on the mzML as staged, fragment ions b, y, c and z, with the enzyme, modifications and FASTA of the
# truth-config; then scorers/hybtruth.py (hybrid Orbitrap MS2 only, 1 % FDR). Writes <work dir>/qualification.tsv.
set -uo pipefail
MZ=$1; W=$2; CFG=$3; H=$(cd "$(dirname "$0")/.." && pwd)
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
export RAYON_NUM_THREADS=${SAGE_THREADS:-12}
mkdir -p "$W/truth"; cd "$W"
[ -s scans.tsv ] || $PY -I $H/scripts/hybrid_scans.py "$MZ" > scans.tsv
if ! grep -q '^SAGE_RC=0' truth/sage.log 2>/dev/null; then
  $PY -I - "$CFG" "$MZ" truth/sage.json <<"PYEOF"
import json, sys
c = json.load(open(sys.argv[1]))
enz = {"missed_cleavages": 2, "min_len": 7, "max_len": 50, "cleave_at": c["cleave_at"]}
if c.get("restrict"):
    enz["restrict"] = c["restrict"]
cfg = {"database": {"bucket_size": 32768, "enzyme": enz, "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
       "peptide_min_mass": 500.0, "peptide_max_mass": 6000.0, "ion_kinds": c.get("ion_kinds", ["b", "y", "c", "z"]),
       "min_ion_index": 2, "static_mods": c["static_mods"], "variable_mods": c["variable_mods"],
       "max_variable_mods": 2, "decoy_tag": "rev_", "generate_decoys": True, "fasta": c["fasta"]},
       "precursor_tol": {"ppm": [-10.0, 10.0]}, "fragment_tol": {"ppm": [-20.0, 20.0]},
       "precursor_charge": [2, 6], "isotope_errors": [-1, 3], "deisotope": True, "chimera": False,
       "wide_window": False, "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1,
       "mzml_paths": [sys.argv[2]]}
json.dump(cfg, open(sys.argv[3], "w"), indent=2)
PYEOF
  ( cd truth && $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
fi
{ awk -F'\t' 'NR>1{n++; k[$3" "$4]++} END{printf "ms2\t%d\n", n; for (x in k) printf "ms2 %s\t%d\n", x, k[x]}' scans.tsv | sort
  $PY -I $H/scorers/hybtruth.py truth/results.sage.tsv scans.tsv
  printf 'sage_rc\t%s\n' "$(grep -o 'SAGE_RC=.*' truth/sage.log | cut -d= -f2)"
  printf 'sage_sha256\t%s\nscans_sha256\t%s\n' "$(sha256sum truth/results.sage.tsv | cut -c1-64)" "$(sha256sum scans.tsv | cut -c1-64)"
} > qualification.tsv 2> qualification.err
echo TRUTH_DONE > truth.done
