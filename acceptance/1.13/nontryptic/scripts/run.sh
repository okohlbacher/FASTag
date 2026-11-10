#!/usr/bin/env bash
# FASTag 1.13 item 20 held-out: the frozen runs for one run id on node data (same calls as the DEV check, dev/run.sh).
#   run.sh <manifest.tsv> <run id>
set -u
H=${NT_HELDOUT:-/scratch/kohlbach/b113/nontryptic/heldout}
F=$H/frozen/nontryptic                       # copy of acceptance/1.13/nontryptic at the freeze commit
DB=$H/db/Homo_sapiens.fasta
BIN=$H/build/FASTag
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=/dev/shm/kohlbach-tmp OPENMS_TMPDIR=/dev/shm/kohlbach-tmp OPENBLAS_NUM_THREADS=1; mkdir -p $TMPDIR
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS
export FASTAG_DIGEST_DIR=$H/src/data/digest
T=8
export RAYON_NUM_THREADS=$T
COMMON=(-extension 3 -recon_missed_cleavages 2 -fixed_modifications 'Carbamidomethyl (C)'
        -variable_modifications 'Oxidation (M)' -search_isotope_errors 1 -threads $T)
id=$2
line=$(awk -F'\t' -v r="$id" '$1 == r && $11 ~ /^in_test/' "$1")
[ -n "$line" ] || { echo "run $id is not in the test"; exit 2; }
truth=$(cut -f2 <<<"$line"); mzml=$H/$(cut -f8 <<<"$line")
O=$H/out/$id
[ -e $O ] && { echo "REFUSED: $O exists (run once)"; exit 3; }
mkdir -p $O
echo "== $id $truth $(date -u +%FT%TZ)"
arm() {  # arm NAME EXTRA...
  local a=$1; shift; local d=$O/$a; mkdir -p $d
  ( cd $d && /usr/bin/time -v "$BIN" -in $mzml -recon_fasta $DB "${COMMON[@]}" \
      -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json "$@" > run.log 2> time.log; echo $? > rc )
  if [ -s $d/sage.json ]; then
    $PY $F/scripts/sagecfg.py $d/sage.json $d/sage.run.json --fasta $d/red.fasta --mzml $mzml
    ( cd $d && /usr/bin/time -v $SAGE sage.run.json -o sage > sage.log 2> sage.time.log; echo $? > sage.rc )
  fi
}
arm default
arm forced -shortlist_force
arm auto -shortlist_protease auto
# full-database reference search with the true protease (metadata), FASTag's other search settings
mkdir -p $O/full
src=$O/auto/sage.json; [ -s $src ] || src=$O/forced/sage.json
$PY $F/scripts/sagecfg.py $src $O/full/sage.run.json --fasta $DB --enzyme $truth --mzml $mzml
( cd $O/full && /usr/bin/time -v $SAGE sage.run.json -o . > sage.log 2> sage.time.log; echo $? > sage.rc )
echo "== $id done $(date -u +%FT%TZ)"
touch $O/RUN_DONE
