#!/usr/bin/env bash
# FASTag 1.14 held-out test "aspn": the frozen runs for one run id on node data (PREREG-aspn.md).
#   run.sh <manifest.tsv> <run id>
# Arms: auto (-shortlist_protease auto), autofull (auto + -shortlist_specificity full; Asp-N runs only),
# tryp (default trypsin shortlist, -shortlist_force). Sage: full-database reference search with the true protease and
# the auto export, interleaved three times each (full, auto, full, auto, full, auto); autofull and tryp exports once.
set -u
H=${ASPN_HELDOUT:-/scratch/kohlbach/acc114/aspn/heldout}
F=$H/frozen/aspn                             # copy of acceptance/1.14/aspn at the freeze commit
BIN=/scratch/kohlbach/acc114/aspn/build/FASTag   # built from a git archive of 0ddff9b (v1.13.4), build.sh
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=/dev/shm/kohlbach-tmp OPENMS_TMPDIR=/dev/shm/kohlbach-tmp OPENBLAS_NUM_THREADS=1; mkdir -p $TMPDIR
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS
export FASTAG_DIGEST_DIR=/scratch/kohlbach/acc114/aspn/src/data/digest
T=12
export RAYON_NUM_THREADS=$T
COMMON=(-extension 3 -recon_missed_cleavages 2 -fixed_modifications 'Carbamidomethyl (C)'
        -variable_modifications 'Oxidation (M)' -search_isotope_errors 1 -threads $T)
id=$2
line=$(awk -F'\t' -v r="$id" '$1 == r && $10 ~ /^in_test/' "$1")
[ -n "$line" ] || { echo "run $id is not in the test"; exit 2; }
group=$(cut -f2 <<<"$line"); truth=$(cut -f3 <<<"$line"); DB=$H/db/$(cut -f5 <<<"$line").fasta; mzml=$H/$(cut -f8 <<<"$line")
O=$H/out/$id
[ -e $O ] && { echo "REFUSED: $O exists (run once)"; exit 3; }
mkdir -p $O
echo "== $id $group $truth $(date -u +%FT%TZ)"
arm() {  # arm NAME EXTRA...
  local a=$1; shift; local d=$O/$a; mkdir -p $d
  ( cd $d && /usr/bin/time -v "$BIN" -in $mzml -recon_fasta $DB "${COMMON[@]}" \
      -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json "$@" > run.log 2> time.log; echo $? > rc )
  [ -s $d/sage.json ] && $PY $F/scripts/sagecfg.py $d/sage.json $d/sage.run.json --fasta $d/red.fasta --mzml $mzml
}
sage() {  # sage DIR REP : one Sage search of DIR/sage.run.json into DIR/sage.REP
  local d=$1 r=$2
  [ -s $d/sage.run.json ] || return 0
  ( cd $d && /usr/bin/time -v $SAGE sage.run.json -o sage.$r > sage.$r.log 2> sage.$r.time.log; echo $? > sage.$r.rc )
}
arm auto -shortlist_protease auto
[ "$group" = aspn ] && arm autofull -shortlist_protease auto -shortlist_specificity full
arm tryp -shortlist_force
# full-database reference search with the true protease (metadata), FASTag's other search settings, full specificity
mkdir -p $O/full
src=$O/auto/sage.json; [ -s $src ] || src=$O/tryp/sage.json
$PY $F/scripts/sagecfg.py $src $O/full/sage.run.json --fasta $DB --enzyme $truth --mzml $mzml
for r in 1 2 3; do sage $O/full $r; sage $O/auto $r; done
[ "$group" = aspn ] && sage $O/autofull 1
sage $O/tryp 1
echo "== $id done $(date -u +%FT%TZ)"
touch $O/RUN_DONE
