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
#   buildtaxdb Homo_sapiens.fasta as taxon 9606, k 7: the candidate's and the
#              baseline's .taxdb, raw bytes
#
# Environment: FASTAG_BASELINE_BIN (default the 1.11.0 install on /ceph),
# FASTAG_CANDIDATE_BUILDTAXDB (default buildtaxdb next to the candidate),
# FASTAG_BASELINE_BUILDTAXDB (default /ceph/ibmi/abi/oliver/opt/fastag-1.11.0-tools/
# buildtaxdb, built from 78390cd: the 1.11.0 install ships none); a missing one
# FAILS unless BASELINE_SKIP_BUILDTAXDB=1,
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
# buildtaxdb (on fastag_core like FASTag): .taxdb bytes of both builds.
CBT=${FASTAG_CANDIDATE_BUILDTAXDB:-$(dirname -- "$CAND")/buildtaxdb}
BBT=${FASTAG_BASELINE_BUILDTAXDB:-/ceph/ibmi/abi/oliver/opt/fastag-1.11.0-tools/buildtaxdb}
BT="$OUT/buildtaxdb"
rm -rf "$BT"; mkdir -p "$BT/prot"
printf 'label\tcase\tthreads\titem\tstatus\n' > "$BT/report.tsv"
btrec() { printf 'buildtaxdb\tk7\t-\t%s\t%s\n' "$1" "$2" >> "$BT/report.tsv"; [ "$2" = SAME ] || { rc=1; echo "  FAIL buildtaxdb $1: $2"; }; }
if [ "${BASELINE_SKIP_BUILDTAXDB:-0}" = 1 ]; then
  echo "baseline_identity_gate: buildtaxdb skipped (BASELINE_SKIP_BUILDTAXDB=1)"
elif [ ! -x "$CBT" ] || [ ! -x "$BBT" ]; then
  btrec binaries "MISSING (candidate $CBT, baseline $BBT; set FASTAG_CANDIDATE_BUILDTAXDB / FASTAG_BASELINE_BUILDTAXDB)"
else
  ln -s "$GATE_IN/db/Homo_sapiens.fasta" "$BT/prot/9606.fasta"
  "$CBT" "$BT/prot" "$BT/c.taxdb" 7 > "$BT/c.log" 2>&1; c_rc=$?
  "$BBT" "$BT/prot" "$BT/b.taxdb" 7 > "$BT/b.log" 2>&1; b_rc=$?
  if [ $c_rc = $b_rc ] && [ $b_rc = 0 ]; then btrec exit SAME; else btrec exit "DIFF ($c_rc vs baseline $b_rc)"; fi
  if [ ! -s "$BT/b.taxdb" ]; then btrec taxdb "EMPTY (baseline wrote no .taxdb)"
  elif cmp -s "$BT/c.taxdb" "$BT/b.taxdb"; then btrec taxdb SAME; else btrec taxdb DIFF; fi
  echo "baseline_identity_gate: buildtaxdb $CBT vs $BBT: $(awk -F'\t' '$5 == "SAME"' "$BT/report.tsv" | wc -l) equal"
fi
cat "$OUT"/PXD*/report.tsv "$BT/report.tsv" | awk 'NR == 1 || $1 != "label"' > "$OUT/report.tsv"
npre=$(awk -F'\t' '$5 ~ /^PREFIX/' "$OUT/report.tsv" | wc -l | tr -d ' ')
if [ $rc = 0 ]; then echo "BASELINE IDENTITY PASS ($(awk -F'\t' '$5 == "SAME"' "$OUT/report.tsv" | wc -l | tr -d ' ') comparisons$([ "$npre" = 0 ] || echo ", $npre label.tsv with appended label_call rows"))"
else echo "BASELINE IDENTITY FAIL"; awk -F'\t' 'NR > 1 && $5 != "SAME" && $5 !~ /^INFO/ && $5 !~ /^PREFIX/' "$OUT/report.tsv"; fi
exit $rc
