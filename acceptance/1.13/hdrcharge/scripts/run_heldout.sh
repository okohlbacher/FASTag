#!/bin/bash
# hdrcharge (backlog #14) held-out run on node data (PREREG-item14.md): the frozen binary only, every input checked
# against the manifest sha256, Sage 0.14.7 charge_truth on the charge-stripped copy, FASTag under CFG-14-warn on the
# input as given and on its perturbed copy (perturb_charge.py), then the scorer and the verdict, once.
# Usage: run_heldout.sh <acceptance/1.13 dir> <work dir>
set -uo pipefail
A=$(cd "$1" && pwd); W=$2
M=$A/manifests/item14-hdrcharge.tsv
S=$A/hdrcharge/scripts
STAGED=/scratch/kohlbach/fastag-heldout-1.12
PANEL=/ceph/ibmi/abi/oliver/prose-auto-20261029/panel
FROZEN=/scratch/kohlbach/b113/hdrcharge/frozen/FASTag
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
source /scratch/kohlbach/b113/hdrcharge/env.sh
export TMPDIR=/scratch/kohlbach/b113/hdrcharge/tmp OPENMS_TMPDIR=/scratch/kohlbach/b113/hdrcharge/tmp; mkdir -p $TMPDIR
export OPENBLAS_NUM_THREADS=1 RAYON_NUM_THREADS=16
row=$(awk -F'\t' '$1 == "CFG-14-warn"' $A/frozen-configs.tsv | tail -1)
want_bin=$(cut -f4 <<< "$row"); opts=$(cut -f6 <<< "$row"); status=$(cut -f9 <<< "$row")
[ "$status" = frozen ] || { echo "CFG-14-warn is not frozen ($status)"; exit 2; }
[ "$(sha256sum $FROZEN | cut -c1-64)" = "$want_bin" ] || { echo "frozen binary sha256 mismatch"; exit 2; }
(cd $A/hdrcharge && sha256sum -c --quiet SHA256SUMS) || { echo "script sha256 mismatch"; exit 2; }
[ -e $W/score ] && { echo "$W/score exists: scored once already"; exit 3; }
mkdir -p $W
rc_ok=yes
specs_a=(); specs_p=()
while IFS=$'\t' read -r item split stratum pxd run instr org fasta smods vmods input sha src sel; do
  [ "$item" = "#14" ] || continue
  d=$W/$pxd; mkdir -p $d/truth $d/asgiven $d/perturbed
  f=$STAGED/$input
  [ "$(sha256sum $f | cut -c1-64)" = "$sha" ] || { echo "$pxd: input sha256 mismatch"; exit 4; }
  [ -s $d/input.nocharge.mzML ] || $PY -I $S/strip_charge.py $f $d/input.nocharge.mzML > $d/strip.txt
  [ -s $d/pert.mzML ] || $PY -I $S/perturb_charge.py $f $d/pert.mzML > $d/pert.txt
  $PY -I - "$PANEL/$fasta" "$smods" "$vmods" $d/input.nocharge.mzML $d/truth/sage.json <<"PYEOF"
import json, sys
fasta, smods, vmods, mz, out = sys.argv[1:6]
cfg = {"database": {"bucket_size": 32768, "enzyme": {"missed_cleavages": 2, "min_len": 7, "max_len": 50,
       "cleave_at": "KR", "restrict": "P"}, "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
       "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0, "ion_kinds": ["b", "y"], "min_ion_index": 2,
       "static_mods": json.loads(smods), "variable_mods": json.loads(vmods), "max_variable_mods": 2,
       "decoy_tag": "rev_", "generate_decoys": True, "fasta": fasta},
       "precursor_tol": {"ppm": [-10.0, 10.0]}, "fragment_tol": {"ppm": [-20.0, 20.0]},
       "precursor_charge": [1, 4], "isotope_errors": [-1, 3], "deisotope": True, "chimera": False,
       "wide_window": False, "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1,
       "mzml_paths": [mz]}
json.dump(cfg, open(out, "w"), indent=2)
PYEOF
  if ! grep -q '^SAGE_RC=0' $d/truth/sage.log 2>/dev/null; then
    ( cd $d/truth && $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
  fi
  grep -q '^SAGE_RC=0' $d/truth/sage.log || rc_ok=no
  for arm in asgiven perturbed; do
    in=$f; [ $arm = perturbed ] && in=$d/pert.mzML
    if ! grep -q '^FASTAG_RC=0' $d/$arm/log 2>/dev/null; then
      # shellcheck disable=SC2086
      ( cd $d/$arm && $FROZEN -in $in -out tags.tsv $opts > log 2>&1; echo FASTAG_RC=$? >> log; rm -f tags.tsv )
    fi
    grep -q '^FASTAG_RC=0' $d/$arm/log || rc_ok=no
  done
  specs_a+=("$pxd:$stratum=$d/asgiven/hc.tsv,$d/truth/results.sage.tsv")
  specs_p+=("$pxd:$stratum=$d/perturbed/hc.tsv,$d/truth/results.sage.tsv,$d/pert.mzML.perturbed.tsv")
done < <(grep -v '^# ' $M | tail -n +2)
mkdir -p $W/score
sha256sum $S/score_hdrcharge.py $S/verdict_hdrcharge.py > $W/score/scorer.sha256
$PY -I $S/score_hdrcharge.py $W/score/asgiven.tsv "${specs_a[@]}" > $W/score/asgiven.log 2>&1; echo SCORE_RC=$? >> $W/score/asgiven.log
$PY -I $S/score_hdrcharge.py $W/score/perturbed.tsv "${specs_p[@]}" > $W/score/perturbed.log 2>&1; echo SCORE_RC=$? >> $W/score/perturbed.log
$PY -I $S/verdict_hdrcharge.py $W/score/asgiven.tsv $W/score/perturbed.tsv --rc-ok $rc_ok > $W/score/verdict.json 2>&1
echo HELDOUT_DONE > $W/heldout.done
