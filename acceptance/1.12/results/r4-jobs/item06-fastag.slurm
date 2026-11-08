#!/bin/bash
# 8 tasks per run: (CFG-06-base, CFG-06-cand) x (S_L3, S_L4, S_L5, G_L3); high-resolution runs only (no -it05 twin)
#SBATCH --partition=compute
#SBATCH --job-name=r4-i06fastag
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128gb
#SBATCH --time=12:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
echo "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3  $FT/rc-a117801/opt/FASTag.bin" | sha256sum -c --quiet - || exit 3
i=$((SLURM_ARRAY_TASK_ID-1)); E=${I6[$((i/8))]}; k=$((i%8)); MAN=${E%%	*}
R=$(row6 "$E"); REL=$(cut -f10 <<<"$R"); SHA=$(cut -f11 <<<"$R"); STRAT=$(cut -f3 <<<"$R"); AN=$(cut -f15 <<<"$R"); RD=${REL%.*}
[ "${AN%;}" = ion_trap ] && { echo "ION_TRAP_RUN_REFUSED $REL"; exit 3; }
ARMS=(CFG-06-base CFG-06-cand); CELLS=(S_L3 S_L4 S_L5 G_L3)
CFG=${ARMS[$((k/4))]}; CELL=${CELLS[$((k%4))]}; L=${CELL#*_L}
OPTS=""; [ $CFG = CFG-06-cand ] && OPTS="-unknown_charge infer"
if [ ${CELL%%_*} = S ]; then SRC=$FT/truth/$MAN/$RD/input.nocharge.mzML; else SRC=$FT/heldout/$REL; fi
OUT=$FT/runs/$CFG/$MAN/$RD/$CELL
if [ -f $OUT/run.log ]; then echo "EXISTS $OUT (not re-run)"; exit 4; fi
mkdir -p $OUT; W=$TMPDIR/r4i06-$SLURM_ARRAY_TASK_ID; mkdir -p $W; cp $SRC $W/; IN=$W/$(basename $SRC); cd $W
echo "$(sha256sum < $IN | cut -d' ' -f1)  $SRC" > input.sha256
if [ ${CELL%%_*} = G ]; then grep -q "^$SHA " input.sha256 || { echo "INPUT_SHA_MISMATCH" ; exit 3; }; fi
THREADS=$((SLURM_CPUS_PER_TASK/2))
echo "FASTag -in $IN -out tags.tsv -threads $THREADS $OPTS -tag_length $L" > cmd.txt
echo "host=$(hostname) job=${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID} set=$STRAT" >> cmd.txt
FASTag -in $IN -out tags.tsv -threads $THREADS $OPTS -tag_length $L > run.log 2>&1
echo "FASTAG_RC=$?" >> run.log
rm -f $IN; cp -pr $W/. $OUT/; rm -rf $W
echo "$CFG $CELL $RD $(tail -1 $OUT/run.log)"
