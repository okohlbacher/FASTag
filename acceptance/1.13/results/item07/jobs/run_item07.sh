#!/bin/bash
# item07 E7-03 held-out runs (PREREG-item07.md, acceptance/1.13 amendment 1), CFG-07 on node data.
# One FASTag run per unit of acceptance/1.13/manifests/item07-E7-03.tsv: the conversion (fastag_input) of every
# staged file and the pseudo-DDA file (pseudo_input) of every DIA file that has one. RC binary at defaults, no added
# option. The input sha256 is checked against the manifest before the run; a mismatch is not run (RUN_FAILED).
# An existing run.log is never overwritten (a config is run once).
# Usage: run_item07.sh <manifest.tsv> <runs root> [parallel=4] [threads=8]
set -u
MAN=$1; RUNS=$2; P=${3:-4}; T=${4:-8}
H=/scratch/kohlbach/fastag-heldout-1.12
FT=$H/rc-a117801/opt/FASTag
BIN_SHA=c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3
[ "$(sha256sum $H/rc-a117801/opt/FASTag.bin | cut -c1-64)" = $BIN_SHA ] || { echo "RC binary sha256 mismatch"; exit 2; }
one() {
  IFS=$'\t' read -r rel sha <<< "$1"
  local d=$RUNS/CFG-07/item07-E7-03/${rel%.*}
  if [ -e "$d/run.log" ]; then echo "EXISTS $d"; return; fi
  mkdir -p "$d"; cd "$d" || return
  local got; got=$(sha256sum "$H/$rel" | cut -c1-64)
  echo "$got  $H/$rel" > input.sha256
  if [ "$got" != "$sha" ]; then echo "INPUT_SHA256_MISMATCH manifest=$sha" > run.log; echo "FASTAG_RC=99" >> run.log; echo "MISMATCH $rel"; return; fi
  echo "FASTag -in $H/$rel -out tags.tsv -threads $T" > cmd.txt
  echo "host=$(hostname) start=$(date -Is) binary=$BIN_SHA" >> cmd.txt
  "$FT" -in "$H/$rel" -out tags.tsv -threads "$T" > run.log 2>&1
  echo "FASTAG_RC=$?" >> run.log
  echo "end=$(date -Is)" >> cmd.txt
  echo "$(tail -1 run.log) $rel"
}
export -f one; export RUNS H FT T BIN_SHA
awk -F'\t' 'NR==1{for(i=1;i<=NF;i++)c[$i]=i; next} /^#/{next}
  $c["fastag_input_sha256"]!=""{print $c["fastag_input"]"\t"$c["fastag_input_sha256"]}
  $c["class"]=="DIA" && $c["pseudo_sha256"]!=""{print $c["pseudo_input"]"\t"$c["pseudo_sha256"]}' <(grep -v '^# ' "$MAN") |
  xargs -d '\n' -P "$P" -I{} bash -c 'one "$@"' _ {}
echo RUNS_DONE
