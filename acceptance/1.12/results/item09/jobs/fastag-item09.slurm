#!/bin/bash
# item09-H1 held-out FASTag runs (PREREG-item09.md + amendment 1): one task per run x arm x cell (18).
#SBATCH --partition=compute
#SBATCH --job-name=i09fastag
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=96gb
#SBATCH --time=06:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/ho/item09/logs/%x-%A_%a.out
set -uo pipefail
FT=/pfs/10/project/bw26g016/fastag-1.12
W=$FT/ho/item09
. $FT/bin/fastag-env.sh
IFS=$'\t' read -r N CFG IN_REL SHA REL CELL OPTS < <(awk -F'\t' -v i="$SLURM_ARRAY_TASK_ID" '$1==i' $W/tasks.tsv)
[ -n "${CFG:-}" ] || { echo "no task $SLURM_ARRAY_TASK_ID"; exit 2; }
THREADS=$((SLURM_CPUS_PER_TASK/2))   # hyperthreading: 32 logical = 16 physical
OUT=$W/runs/$CFG/item09-H1/$REL/$CELL
[ -e "$OUT/run.log" ] && { echo "REFUSE: $OUT exists (scored once)"; exit 3; }
mkdir -p "$OUT"
echo "$(sha256sum $FT/rc-a117801/opt/FASTag.bin)" | grep -q '^c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3 ' || { echo BIN_MISMATCH; exit 4; }
cp "$FT/heldout/$IN_REL" "$TMPDIR/"
IN=$TMPDIR/$(basename "$IN_REL")
GOT=$(sha256sum < "$IN" | cut -d' ' -f1)
[ "$GOT" = "$SHA" ] || { echo "INPUT_MISMATCH $GOT != $SHA"; exit 5; }
cd "$TMPDIR"
echo "$GOT  $IN_REL" > input.sha256
echo "host=$(hostname) job=${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID} cfg=$CFG cell=$CELL threads=$THREADS opts=$OPTS" > task.txt
/usr/bin/time -v -o time.txt FASTag -in "$IN" -out tags.tsv -threads $THREADS $OPTS > run.log 2>&1
echo "FASTAG_RC=$?" >> run.log
rm -f "$IN"
cp -pr "$TMPDIR"/. "$OUT"/
tail -1 run.log
