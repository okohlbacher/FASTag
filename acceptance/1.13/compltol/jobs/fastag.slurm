#!/bin/bash
# compltol held-out FASTag runs (PREREG-compltol.md): one array task per line of tasks.tsv
# (arm_dir, fastag_input, cell, sha256, options). Layout and settings as the #2 job (acc112-item02/fastag.slurm).
#SBATCH --partition=compute
#SBATCH --job-name=ctfastag
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=96gb
#SBATCH --time=06:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.13/compltol/logs/%x-%A_%a.out
set -uo pipefail
FT=/pfs/10/project/bw26g016/fastag-1.12; W=/pfs/10/project/bw26g016/fastag-1.13/compltol; MAN=compltol-H1
echo "b7a1701c7cbe85d6ba7c9ecc270046a86e514e2eed45e4cd2eab78814d3ffac9  $W/opt/FASTag.bin" | sha256sum -c - || exit 3
LINE=$(sed -n "${SLURM_ARRAY_TASK_ID}p" $W/tasks.tsv)
[ -n "$LINE" ] || { echo "no task $SLURM_ARRAY_TASK_ID"; exit 2; }
IFS=$'\t' read -r ARM REL CELL EXPSHA OPTS <<< "$LINE"
THREADS=$((SLURM_CPUS_PER_TASK/2))          # hyperthreading: 32 logical = 16 physical
OUT=$W/runs/$ARM/$MAN/$(dirname "$REL")/$(basename "$REL" | sed 's/\.[^.]*$//')/$CELL
mkdir -p "$OUT"
cp "$FT/heldout/$REL" "$TMPDIR/"
IN=$TMPDIR/$(basename "$REL")
GOT=$(sha256sum < "$IN" | cut -d' ' -f1)
[ "$GOT" = "$EXPSHA" ] || { echo "INPUT_SHA_MISMATCH $REL $GOT"; exit 4; }
mkdir -p "$TMPDIR/o"; cd "$TMPDIR/o"
echo "$GOT  $REL" > input.sha256
echo "host $(hostname) task $SLURM_ARRAY_TASK_ID arm $ARM cell $CELL opts: $OPTS"
$W/bin/FASTag -in "$IN" -out tags.tsv -threads $THREADS $OPTS > run.log 2>&1
echo "FASTAG_RC=$?" >> run.log
cp -pr "$TMPDIR/o"/. "$OUT"/
tail -1 run.log
