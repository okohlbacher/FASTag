#!/usr/bin/env bash
# FASTag 1.13 #17r held-out test (PREREG-item17r.md): one run, both arms, both engines, plus the MSFragger open-search
# reference. Node data. FASTag = build of feat/b113-shifts 28cc8ce (FASTag.bin sha256 ff09dea1...), both arms;
# Sage 0.14.7, Comet 2026.03.0 with the real `comet -p` template; MSFragger 4.4.1 (jar sha256 56b15a35...).
# Arms (CFG-17r-base-113 / CFG-17r-cand-113): base = FASTag -search_config_out with the run's declared chemistry
# (chem17r.tsv) and no -search_shifts; cand = base + -search_shifts variable (Sage) | both (Comet), defaults
# (-shift_max_variable 3 -shift_max_offsets 10, no site expansion). Every engine search runs on target + shuffled
# entrapment (entrap.py, r = 1); the engines add their decoys. FASTag places against the target database only.
# Same commands as run_item17.sh; changed: binary, digest directory, chemistry table, manifest, '-' = no fixed
# modification, mzML checksum checked on every split.
# Usage: run_item17r.sh <pxd> <workdir> <threads>
set -euo pipefail
PXD=$1; W=$2; TH=$3
S=$(cd "$(dirname "$0")" && pwd); CHEM=$S/../chem17r.tsv
C=/scratch/kohlbach/b113/shifts/heldout/cand
FT=$C/opt/FASTag
export FASTAG_DIGEST_DIR=$C/src/data/digest
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
COMET=/ceph/ibmi/abi/oliver/opt/comet-2026.03.0/comet.linux.exe
MSF=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
TPL=/scratch/kohlbach/fastag112-engines/cometp/comet.params.new
echo "ff09dea181334569ea1498db0b7c39adae131bea8ebfdd7afaf7997468a33d13  $C/opt/FASTag.bin
c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106  $FASTAG_DIGEST_DIR/massgap_mods.tsv
d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625  $SAGE
ad93b4cf60c2ed7afc2f41b8a3a05567c3938d999f17deb7b3676bc1fa91e7ed  $COMET
56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112  $MSF
0b6abd4c7415a9289d858d3c8fc84031c31d62acf10f174a8123070ebd8fb8fc  $TPL" | sha256sum -c --quiet
IFS=$'\t' read -r _ MZ FA FASHA FIX VAR _ < <(awk -F'\t' -v p="$PXD" '$1==p' "$CHEM")
[ -n "${MZ:-}" ] || { echo "no chem17r row for $PXD" >&2; exit 2; }
echo "$FASHA  $FA" | sha256sum -c --quiet
MSHA=$(awk -F'\t' -v p="$PXD" '$4==p {print $15}' "$S/../../manifests/item17r-heldout.tsv")
echo "$MSHA  $MZ" | sha256sum -c --quiet
FIXA=(); [ "$FIX" = - ] || IFS=';' read -r -a FIXA <<< "$FIX"
IFS=';' read -r -a VARA <<< "$VAR"
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
echo "ITEM17R_RUN_DONE $PXD $(date -Is)"
