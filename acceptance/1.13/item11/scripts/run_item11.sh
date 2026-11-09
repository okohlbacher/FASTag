#!/bin/bash
# Item 11 (1.13, a/x ions) held-out run on node data (PREREG-item11.md). Refuses any binary but the frozen one and
# any input whose sha256 differs from manifests/item11-heldout.tsv; runs the two frozen arms (CFG-11-base,
# CFG-11-cand), the MSFragger 4.4.1 truth searches with the frozen parameter files, and the scorer once.
# Usage: run_item11.sh <acceptance/1.13 dir> <work dir (data:/scratch/kohlbach/b113/ax/heldout)>
set -u
ACC=$(cd "$1" && pwd); W=$2
BIN=/scratch/kohlbach/b113/ax/frozen/FASTag; BIN_SHA=d3ec817573e114446f601943378939b59f91aadf256cbd68fdf675fb62e84701
J=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar; JAVA=/ceph/ibmi/abi/oliver/opt/jdk-21.0.12.1/bin/java
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
# feat/b113-ax at 99ec699 (git archive), for bench/fastag-bench score.py with the a/x offset
FEAT=/scratch/kohlbach/b113/ax/feat-99ec699; export ITEM11_BENCH_SRC=$FEAT/bench/fastag-bench/src
MAN=$ACC/manifests/item11-heldout.tsv; IN=$W/PXD018176; OUT=$W/results
[ -e "$OUT" ] && { echo "refusing: $OUT exists (scored once)"; exit 2; }
[ "$(sha256sum $BIN | cut -c1-64)" = $BIN_SHA ] || { echo "refusing: binary sha256"; exit 2; }
[ "$(sha256sum $J | cut -c1-64)" = "$(awk '$2=="MSFragger-4.4.1.jar"{print $1}' $ACC/item11/SHA256SUMS)" ] || { echo "refusing: MSFragger jar"; exit 2; }
for p in msfragger_by.params msfragger_abxy.params msfragger_ax.params ecoli.td.fasta; do
  [ "$(sha256sum $W/params/$p | cut -c1-64)" = "$(awk -v f=$p '$2==f{print $1}' $ACC/item11/SHA256SUMS)" ] || { echo "refusing: $p"; exit 2; }
done
chk() { [ "$(sha256sum "$1" | cut -c1-64)" = "$(awk -v f="$2" '$2==f{print $1}' $ACC/item11/SHA256SUMS)" ] || { echo "refusing: $2"; exit 2; }; }
chk $ITEM11_BENCH_SRC/fastag_bench/score.py bench/fastag-bench/src/fastag_bench/score.py
chk $ITEM11_BENCH_SRC/fastag_bench/parsers.py bench/fastag-bench/src/fastag_bench/parsers.py
chk $ACC/scorers/score_item11.py scorers/score_item11.py
chk $ACC/../1.12/scorers/acclib.py acceptance/1.12/scorers/acclib.py
chk $ACC/item11/scripts/mgf_titles.py item11/scripts/mgf_titles.py
chk $MAN manifests/item11-heldout.tsv
tail -n +2 $MAN | while IFS=$'\t' read -r pxd file pride_sha1 sha256 bytes role pair laser split; do
  [ "$(sha256sum $IN/$file | cut -c1-64)" = $sha256 ] || { echo "refusing: $file sha256"; exit 2; }
done || exit 2
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=$W/tmp OPENMS_TMPDIR=$W/tmp; mkdir -p $TMPDIR
fastag() { local cfg=$1 f=$2; shift 2; local d=$W/runs/$cfg/${f%.mgf}; mkdir -p $d
  ( cd $d && $BIN -in $IN/$f -out tags.tsv -threads 4 -fragment_tolerance 15 "$@" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log ) }
frag() { local s=$1 f=$2; local D=$W/truth/${f%.mgf}/$s; mkdir -p $D
  python3 -I $ACC/item11/scripts/mgf_titles.py $IN/$f $D/$f
  ( cd $D && cp $W/params/msfragger_$s.params search.params && $JAVA -Xmx24G -jar $J search.params $f > fragger.log 2>&1
    echo "FRAGGER_RC=$?" >> fragger.log; rm -f $f ) }
export -f fastag frag; export W BIN IN ACC J JAVA
tail -n +2 $MAN | awk -F'\t' '$6=="uvpd"{print "fastag by "$2; print "fastag ax "$2" -ion_series ax"}' | xargs -P 4 -L 1 bash -c '"$@"' _
tail -n +2 $MAN | awk -F'\t' '$6=="hcd"{print "frag by "$2} $6=="uvpd"{print "frag abxy "$2; print "frag ax "$2}' | xargs -P 2 -L 1 bash -c '"$@"' _
mkdir -p $OUT
tail -n +2 $MAN | awk -F'\t' 'BEGIN{print "stem\tlaser_ms"} $6=="uvpd"{sub(/\.mgf$/,"",$2); print $2"\t"$8}' > $OUT/runs_list.tsv
$PY $ACC/scorers/score_item11.py $OUT/runs_list.tsv $IN $W/runs $W/truth $OUT/score --base by --cand ax --split heldout > $OUT/score.out 2>&1
echo "SCORER_RC=$?" >> $OUT/score.out
