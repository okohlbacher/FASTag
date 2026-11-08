#!/bin/bash
# 8 tasks per run: (base, cand) x (S_L3, S_L4, S_L5, G_L3); ion_trap set -> the -it05 twins
#SBATCH --partition=compute
#SBATCH --job-name=i06-fastag
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=64gb
#SBATCH --time=06:00:00
#SBATCH --output=logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/jobs/item06/common.sh
i=$((SLURM_ARRAY_TASK_ID-1)); r=$((i/8+1)); k=$((i%8))
R=$(row $r); REL=$(cut -f10 <<<"$R"); STRAT=$(cut -f3 <<<"$R"); AN=$(cut -f15 <<<"$R"); RD=${REL%.*}
SET=$STRAT; [ "${AN%;}" = ion_trap ] && SET=ion_trap
ARMS=(CFG-06-base CFG-06-cand); CELLS=(S_L3 S_L4 S_L5 G_L3)
CFG=${ARMS[$((k/4))]}; CELL=${CELLS[$((k%4))]}; L=${CELL#*_L}
OPTS=""; [ $CFG = CFG-06-cand ] && OPTS="-unknown_charge infer"
if [ $SET = ion_trap ]; then CFG=$CFG-it05; OPTS="$OPTS -fragment_tolerance 0.5 -fragment_tolerance_unit Da"; fi
if [ ${CELL%%_*} = S ]; then SRC=$FT/truth/$MAN/$RD/input.nocharge.mzML; else SRC=$FT/heldout/$REL; fi
OUT=$FT/runs/$CFG/$MAN/$RD/$CELL
if [ -f $OUT/run.log ]; then echo "EXISTS $OUT (not re-run)"; exit 4; fi
mkdir -p $OUT; W=$TMPDIR/i06-$SLURM_ARRAY_TASK_ID; mkdir -p $W; cp $SRC $W/; IN=$W/$(basename $SRC); cd $W
echo "$(sha256sum < $IN | cut -d' ' -f1)  $SRC" > input.sha256
THREADS=$((SLURM_CPUS_PER_TASK/2))
echo "FASTag -in $IN -out tags.tsv -threads $THREADS $OPTS -tag_length $L" > cmd.txt
echo "host=$(hostname) job=${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID} set=$SET" >> cmd.txt
FASTag -in $IN -out tags.tsv -threads $THREADS $OPTS -tag_length $L > run.log 2>&1
echo "FASTAG_RC=$?" >> run.log
rm -f $IN; cp -pr $W/. $OUT/; rm -rf $W
echo "$CFG $CELL $RD $(tail -1 $OUT/run.log)"
