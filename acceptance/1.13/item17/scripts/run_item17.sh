#!/usr/bin/env bash
# FASTag 1.13 #17 held-out test (PREREG-item17.md): one run, both arms, both engines, plus the MSFragger open-search
# reference. Node data. FASTag = RC a117801 FASTag.bin (sha256 c4c2ad67...), the DEV-freeze binary; Sage 0.14.7,
# Comet 2026.03.0 with the real `comet -p` template; MSFragger 4.4.1 (jar sha256 56b15a35...).
# Arms (CFG-17-base-113 / CFG-17-cand-113): base = FASTag -search_config_out with the run's declared chemistry
# (chem17.tsv) and no -search_shifts; cand = base + -search_shifts variable (Sage) | both (Comet), defaults
# (-shift_max_variable 3 -shift_max_offsets 10, no site expansion). Every engine search runs on target + shuffled
# entrapment (entrap.py, r = 1); the engines add their decoys. FASTag places against the target database only.
# Usage: run_item17.sh <split dev|heldout> <pxd> <workdir> <threads>
set -euo pipefail
SPLIT=$1; PXD=$2; W=$3; TH=$4
S=$(cd "$(dirname "$0")" && pwd); CHEM=$S/../chem17.tsv
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801
FT=$RC/opt/FASTag
export FASTAG_DIGEST_DIR=$RC/data/digest
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
COMET=/ceph/ibmi/abi/oliver/opt/comet-2026.03.0/comet.linux.exe
MSF=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
TPL=/scratch/kohlbach/fastag112-engines/cometp/comet.params.new
echo "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3  $RC/opt/FASTag.bin
56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112  $MSF
0b6abd4c7415a9289d858d3c8fc84031c31d62acf10f174a8123070ebd8fb8fc  $TPL" | sha256sum -c --quiet
IFS=$'\t' read -r _ _ MZ FA FASHA FIX VAR _ < <(awk -F'\t' -v s="$SPLIT" -v p="$PXD" '$1==s && $2==p' "$CHEM")
[ -n "${MZ:-}" ] || { echo "no chem17 row for $SPLIT $PXD" >&2; exit 2; }
echo "$FASHA  $FA" | sha256sum -c --quiet
if [ "$SPLIT" = heldout ]; then
  MSHA=$(awk -F'\t' -v p="$PXD" '$4==p {print $15}' "$S/../../manifests/item17-heldout.tsv")
  echo "$MSHA  $MZ" | sha256sum -c --quiet
fi
IFS=';' read -r -a FIXA <<< "$FIX"; IFS=';' read -r -a VARA <<< "$VAR"
R=$W/$PXD; mkdir -p "$R"; cd "$R"
ln -sf "$MZ" run.mzML
[ -s target_e.fasta ] || python3 -I "$S/entrap.py" target_e.fasta "$FA" > entrap.log
[ -s target_td.fasta ] || python3 -I "$S/revdecoy.py" target_td.fasta "$FA" > revdecoy.log
DB=$PWD/target_e.fasta
BASE=(-in run.mzML -recon_fasta "$FA" -tag_length 4 -extension 6 -fixed_modifications "${FIXA[@]}"
      -variable_modifications "${VARA[@]}" -threads "$TH")
sage_run() {
  python3 -I - "$2" "$DB" "$PWD/run.mzML" "$1/sage.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); c["database"]["fasta"] = sys.argv[2]; c["mzml_paths"] = [sys.argv[3]]
json.dump(c, open(sys.argv[4], "w"), indent=1)
PY
  RAYON_NUM_THREADS=$TH "$SAGE" "$1/sage.json" -o "$1/sage_out" > "$1/sage.log" 2>&1
}
comet_run() {
  sed -e "s|^database_name = .*|database_name = $DB|" -e "s/^num_threads = .*/num_threads = $TH/" \
      -e "s/^output_txtfile = .*/output_txtfile = 1/" -e "s/^output_pepxmlfile = .*/output_pepxmlfile = 0/" \
      "$2" > "$1/comet.params"
  ( cd "$1" && "$COMET" -Pcomet.params -Ncomet ../run.mzML > comet.log 2>&1 )
}
mkdir -p base cand open
"$FT" "${BASE[@]}" -out base/tags.tsv -search_config_out base/cfg_sage.json > base/fastag_sage.log 2>&1
"$FT" "${BASE[@]}" -out base/tags_c.tsv -search_engine comet -search_config_template "$TPL" \
  -search_config_out base/cfg_comet.params > base/fastag_comet.log 2>&1
"$FT" "${BASE[@]}" -out cand/tags.tsv -search_shifts variable -search_shifts_out cand/shifts_sage.tsv \
  -search_config_out cand/cfg_sage.json > cand/fastag_sage.log 2>&1
"$FT" "${BASE[@]}" -out cand/tags_c.tsv -search_engine comet -search_config_template "$TPL" -search_shifts both \
  -search_shifts_out cand/shifts_comet.tsv -search_config_out cand/cfg_comet.params > cand/fastag_comet.log 2>&1
for A in base cand; do sage_run $A $A/cfg_sage.json; comet_run $A $A/cfg_comet.params; done
python3 -I "$S/mkfragger.py" base/cfg_comet.params "$PWD/target_td.fasta" "$TH" open/open.params > open/mk.log
( cd open && java -Xmx96g -jar "$MSF" open.params ../run.mzML > msfragger.log 2>&1 )
mv run.tsv open/run.tsv 2>/dev/null || true
printf 'run\tarm\tengine\tresult\tconfig\tshifts\topen\n' > searches.tsv
for A in base cand; do
  sh_s=-; sh_c=-; [ $A = cand ] && { sh_s=$PWD/cand/shifts_sage.tsv; sh_c=$PWD/cand/shifts_comet.tsv; }
  printf '%s\t%s\tsage\t%s\t%s\t%s\t%s\n' "$PXD" $A "$PWD/$A/sage_out/results.sage.tsv" "$PWD/$A/cfg_sage.json" "$sh_s" "$PWD/open/run.tsv" >> searches.tsv
  printf '%s\t%s\tcomet\t%s\t%s\t%s\t%s\n' "$PXD" $A "$PWD/$A/comet.txt" "$PWD/$A/cfg_comet.params" "$sh_c" "$PWD/open/run.tsv" >> searches.tsv
done
echo "ITEM17_RUN_DONE $SPLIT $PXD $(date -Is)"
