#!/bin/bash
# Runtime check of the compltol binary on BinAC2 before any held-out run: gate.sh (9 cases) vs refs-1.12.0 with the
# options off, as the 1.12 gate-identity job (out_spectra_mzml records the input path, so it differs on BinAC2 only
# in that path and the index offsets: BINAC2-RUNTIME.md; it is compared after masking the path).
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=64
#SBATCH --mem=64gb
#SBATCH --time=01:00:00
#SBATCH --job-name=ctgate
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.13/compltol/logs/gate-%j.out
set -u
FT=/pfs/10/project/bw26g016/fastag-1.12; W=/pfs/10/project/bw26g016/fastag-1.13/compltol
G=$FT/gate; REFS=$FT/src-a117801/tools/gate-1.12/refs-1.12.0
OUT=$W/gate-$SLURM_JOB_ID; mkdir -p $OUT
export GATE_THREADS=32 OPENMS_TMPDIR=$TMPDIR/omstmp
echo "b7a1701c7cbe85d6ba7c9ecc270046a86e514e2eed45e4cd2eab78814d3ffac9  $W/opt/FASTag.bin" | sha256sum -c - || exit 3
GATE_REFS=$REFS GATE_IN=$G/gate-in-110 GATE_PYTHON=$G/pyvenv/bin/python bash $G/gate.sh $W/bin/FASTag $OUT/gate; echo "GATE_RC=$?"
echo JOB_DONE
