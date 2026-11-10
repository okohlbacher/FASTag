#!/bin/bash
# all score tables of REASSESS.md (DEV only)
cd /scratch/kohlbach/b113/species/ana4
P=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
B=/scratch/kohlbach/b113/species
for A in FTMS ""; do
echo "######## analyzer: ${A:-all}"
SCORE_ANALYZER=$A $P score.py "v1.12=$B/devrep/species/runs/{run}/g_0.01_0_10_off/species.tsv" \
  "decoy=$B/dev13/{run}/real/decoy/species.tsv" "explain=$B/dev13/{run}/real/explain/species.tsv" \
  "explain10=$B/dev13/{run}/real/explain10/species.tsv" \
  "decoy_alldecoy=$B/dev13/{run}/alldecoy/decoy/species.tsv" "explain_alldecoy=$B/dev13/{run}/alldecoy/explain/species.tsv" \
  "explain10_alldecoy=$B/dev13/{run}/alldecoy/explain10/species.tsv"
done
echo "######## decoy mode vs the 1.12 reports (byte identity)"
n=0; d=0
for r in $B/dev13/*/; do r=$(basename $r); f=$B/devrep/species/runs/$r/g_0.01_0_10_off/species.tsv; [ -f $f ] || continue; n=$((n+1)); cmp -s $f $B/dev13/$r/real/decoy/species.tsv || { d=$((d+1)); echo "differs: $r"; }; done
echo "compared $n, different $d"
