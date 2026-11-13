#!/bin/bash
# acqcheck3: one default FASTag run on one file, observed until the acquisition decision is made.
#   decide.sh <id> <input mzML> <run dir> <FASTag binary>
# Command: FASTag -in <mzML> -out <run dir>/tags.tsv -threads 2   (all options at their defaults, so
# -acquisition_check refuse). The run is left alone until it exits, or until 120 s after its
# "Acquisition check:" line (a run that has not refused by then is tagging and is stopped), or 3600 s without
# that line (stopped). Prints: id, how (exited | stopped_after_check | timeout_no_check), exit code,
# number of "FASTAG_REFUSED reason=raw_dia" lines, the "Acquisition check:" line.
set -u
id=$1; f=$2; O=$3; BIN=$4
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
export LD_LIBRARY_PATH=$E/lib:$P/lib OPENMS_DATA_PATH=$P/share/OpenMS
mkdir -p "$O"; cd "$O" || exit 9
"$BIN" -in "$f" -out "$O/tags.tsv" -threads 2 > stdout.log 2> stderr.log &
pid=$!; t0=$(date +%s); seen=0; how=""
while kill -0 $pid 2>/dev/null; do
  sleep 2; now=$(date +%s)
  if [ $seen = 0 ] && grep -q "Acquisition check:" stderr.log; then seen=$now; fi
  if [ $seen != 0 ] && [ $((now - seen)) -ge 120 ]; then kill $pid; how=stopped_after_check; break; fi
  if [ $seen = 0 ] && [ $((now - t0)) -ge 3600 ]; then kill $pid; how=timeout_no_check; break; fi
done
wait $pid; rc=$?
[ -z "$how" ] && how=exited
rm -f "$O/tags.tsv"
sent=$(grep -c "FASTAG_REFUSED reason=raw_dia" stderr.log)
chk=$(grep -m1 "Acquisition check:" stderr.log | tr '\t' ' ' | cut -c1-300)
printf "%s\t%s\t%s\t%s\t%s\n" "$id" "$how" "$rc" "$sent" "${chk:-NA}"
