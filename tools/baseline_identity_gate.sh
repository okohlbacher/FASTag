#!/usr/bin/env bash
# The baseline-identity harness in the gate job on node data: the candidate
# against the 1.11.0 release binary (78390cd) on the gate's public PXD inputs,
# next to gate.sh (which compares with the refs-1.10.0 digests).
#
#   baseline_identity_gate.sh <candidate FASTag> <outdir>
#
#   PXD014764  -extension 3 -fasta Homo_sapiens.fasta: every case (tags, recon,
#              delta, digest, label, massgap, glyco, mzid, idXML, mzTab,
#              -proforma/-res_conf, -out_spectra mzML, --help, CTD)
#   PXD003531  defaults: tags, -proforma/-res_conf, -out_spectra mzML;
#              -extension 2 with the gate's tax_k7 index: species
#
# Environment: FASTAG_BASELINE_BIN (default the 1.11.0 install on /ceph),
# GATE_IN (default /scratch/kohlbach/gate-in, staged by gate.sh --stage),
# BASELINE_THREADS (default "32", as gate.sh), FASTAG_DIGEST_DIR (default the
# candidate source tree's data/digest), FASTAG_PYTHON.
# Exit 0 when every comparison is equal.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CAND=${1:?candidate binary}
OUT=${2:?outdir}
BASE=${FASTAG_BASELINE_BIN:-/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag}
GATE_IN=${GATE_IN:-/scratch/kohlbach/gate-in}
T=${BASELINE_THREADS:-32}
DIGEST=${FASTAG_DIGEST_DIR:-$HERE/../data/digest}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-1}
mkdir -p "$OPENMS_TMPDIR" "$OUT" || exit 2
R1=$GATE_IN/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
R2=$GATE_IN/PXD014764/20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008.mzML
for f in "$R1" "$R2" "$GATE_IN/db/Homo_sapiens.fasta" "$GATE_IN/tax/tax_k7.taxdb"; do
  [ -f "$f" ] || { echo "baseline_identity_gate: missing $f (gate.sh --stage)" >&2; exit 2; }
done
H="$HERE/baseline_identity.sh"
rc=0
bash "$H" --label PXD014764 --in "$R2" --fasta "$GATE_IN/db/Homo_sapiens.fasta" --digest-dir "$DIGEST" \
  --common "-extension 3" --threads "$T" "$CAND" "$BASE" "$OUT/PXD014764" || rc=1
bash "$H" --label PXD003531 --in "$R1" --digest-dir "$DIGEST" --cases "plain format spectra_mzml species" \
  --taxdb "$GATE_IN/tax/tax_k7.taxdb" --nodes "$GATE_IN/tax/nodes.dmp" --names "$GATE_IN/tax/names.dmp" \
  --species-args "-extension 2" --threads "$T" "$CAND" "$BASE" "$OUT/PXD003531" || rc=1
cat "$OUT"/PXD*/report.tsv | awk 'NR == 1 || $1 != "label"' > "$OUT/report.tsv"
if [ $rc = 0 ]; then echo "BASELINE IDENTITY PASS ($(awk -F'\t' '$5 == "SAME"' "$OUT/report.tsv" | wc -l) comparisons)"
else echo "BASELINE IDENTITY FAIL"; awk -F'\t' 'NR > 1 && $5 != "SAME" && $5 !~ /^INFO/' "$OUT/report.tsv"; fi
exit $rc
