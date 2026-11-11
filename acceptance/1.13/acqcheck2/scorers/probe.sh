#!/bin/bash
# probe.sh <list: id<TAB>mzML> <binary> <out.tsv>   -- metadata probe only, one line per file
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
export LD_LIBRARY_PATH=$E/lib:$P/lib OPENMS_DATA_PATH=$P/share/OpenMS OMP_NUM_THREADS=2
export BIN=$2
one() { IFS=$'\t' read -r id f <<< "$1"
  o=$($BIN -probe_input "$f" 2>/dev/null); rc=$?
  a=$(printf "%s\n" "$o" | grep '"record":"acquisition"')
  mode=$(printf "%s" "$a" | sed -n 's/.*"mode":"\([^"]*\)".*/\1/p'); ref=$(printf "%s" "$a" | sed -n 's/.*"refuse":\([a-z]*\).*/\1/p')
  why=$(printf "%s" "$a" | sed -n 's/.*"why":"\([^"]*\)".*/\1/p')
  printf "%s\t%s\t%s\t%s\t%s\n" "$id" "$rc" "${mode:-NA}" "${ref:-NA}" "$why"; }
export -f one
xargs -d "\n" -P 16 -I{} bash -c 'one "{}"' < "$1" | sort > "$3"
