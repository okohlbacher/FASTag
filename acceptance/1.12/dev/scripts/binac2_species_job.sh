#!/bin/bash
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=48G
#SBATCH --time=04:00:00
#SBATCH --job-name=fastag112-species
# #1/#10 DEV regeneration on BinAC2: one array task per DEV run of <plan dir>/inputs.tsv (species_dev_plan.py).
# Runs species_dev.py's argv for each planned arm inside the Ubuntu 24.04 image (glibc 2.39, as on data), with the RC
# bundle, OpenMS and the env libraries bound at their data paths and cwd /scratch/kohlbach/fastag112-dev, then writes
# command.txt, run.log, time.json and removes tags.tsv as species_dev.run_one does (species.tsv removed on rc != 0).
# Usage: sbatch --array=1-N binac2_species_job.sh <workspace> <plan dir> [runs dir relative to fastag112-dev, default species/runs]
set -u
W=$1; PLAN=$2; RUNS=${3:-species/runs}
IMG=/pfs/10/project/bw26g016/qgate/ubuntu2404.sif
ROW=$(awk -v n=$((SLURM_ARRAY_TASK_ID + 1)) 'NR==n' "$PLAN/inputs.tsv")
RID=$(cut -f1 <<<"$ROW")
[ -n "$RID" ] || { echo "no row $SLURM_ARRAY_TASK_ID"; exit 2; }
DEV=$W/root/scratch/kohlbach/fastag112-dev
SIZE=$(cut -f3 <<<"$ROW"); NAME=$(cut -f4 <<<"$ROW")
[ "$(stat -c %s "$DEV/species/in/$NAME" 2>/dev/null)" = "$SIZE" ] || { echo "input $NAME missing or incomplete"; exit 3; }
mkdir -p "$DEV/$RUNS/$RID"
cp "$PLAN/$RID/meta.json" "$DEV/$RUNS/$RID/meta.json"
LOG=$DEV/$RUNS/driver-binac2-$RID.log
echo "$(date '+%F %T') start $RID on $(hostname) job ${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID}" >> "$LOG"
apptainer exec --cleanenv --no-mount /scratch \
  -B "$DEV:/scratch/kohlbach/fastag112-dev" \
  -B "$W/root/scratch/kohlbach/fastag-heldout-1.12:/scratch/kohlbach/fastag-heldout-1.12" \
  -B "$W/root/ceph/ibmi/abi/oliver:/ceph/ibmi/abi/oliver" \
  -B "$PLAN:/plan" \
  --env FASTAG_TAXONOMY_DIR=/scratch/kohlbach/fastag112-dev/tax \
  --env OPENMS_TMPDIR=/dev/shm/kohlbach-tmp-$SLURM_JOB_ID --env TMPDIR=/dev/shm/kohlbach-tmp-$SLURM_JOB_ID \
  --env RID="$RID" --env RUNS="$RUNS" --env HOSTN="$(hostname)" \
  "$IMG" bash -c '
    mkdir -p "$TMPDIR"; cd /scratch/kohlbach/fastag112-dev || exit 3
    while IFS=$'"'"'\t'"'"' read -r arm cmd; do
      d=$RUNS/$RID/$arm; mkdir -p "$d"
      eval "set -- $cmd"; printf "%s\n" "$*" > "$d/command.txt"
      t0=$(date +%s.%N); "$@" < /dev/null > "$d/run.log" 2>&1; rc=$?; t1=$(date +%s.%N)
      l1=$(cut -d" " -f1 /proc/loadavg)
      awk -v a="$t0" -v b="$t1" -v rc="$rc" -v l="$l1" -v h="$HOSTN" \
        "BEGIN{printf \"{\\\"wall_s\\\": %.3f, \\\"returncode\\\": %d, \\\"load1\\\": %s, \\\"host\\\": \\\"binac2:%s\\\"}\\n\", b-a, rc, l, h}" > "$d/time.json"
      rm -f "$d/tags.tsv"; [ "$rc" -eq 0 ] || rm -f "$d/species.tsv"
      echo "$(date +%T) $RID $arm rc $rc $(awk -v a="$t0" -v b="$t1" "BEGIN{printf \"%.1f\", b-a}") s" >> $RUNS/driver-binac2-$RID.log
    done < /plan/$RID/arms.tsv
    rm -rf "$TMPDIR"'
echo "$(date '+%F %T') DONE $RID" >> "$LOG"
