#!/bin/bash
# Memory re-measurement for the FASTag 1.9.0 thread ladder: same gate and command lines as
# ../ladder_run.sh, but every run goes through memsample.py, which samples /proc/<pid>/status VmRSS
# every INTERVAL s (0.05) next to ru_maxrss from /usr/bin/time -v.
#   mem_run.sh <plan.tsv> <outdir>      (plan columns as in ladder_run.sh)
# Environment: FASTAG, DIRECTAG, GATE (0.05), GATE_MAX_WAIT (1800), INTERVAL (0.05), SMAPS (0|1).
set -u
PLAN=$1; OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)
FASTAG=${FASTAG:-/ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/FASTag}
DIRECTAG=${DIRECTAG:-/ceph/ibmi/abi/oliver/jpr-bench/envs/bumbershoot/bin/directag}
GATE=${GATE:-0.05}; GATE_MAX_WAIT=${GATE_MAX_WAIT:-1800}; INTERVAL=${INTERVAL:-0.05}; SMAPS=${SMAPS:-0}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=1 OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$OUT/work" "$OUT/logs" "$OPENMS_TMPDIR"
NCPU=$(nproc)
RAW=$OUT/raw.tsv
COLS="tool	profile	dataset	format	threads	rep	exit	wall_s	user_s	sys_s	ru_maxrss_kb	vmrss_max_kb	vmhwm_kb	rssanon_at_max_kb	rssfile_at_max_kb	threads_max	smaps_rss_max_kb	n_samples	gap_med_s	gap_max_s	load1_before	load1_after	foreign_r_before	foreign_r_after	gate_wait_s	spectra	tags	sha256	start_utc	input	args"
[ -s "$RAW" ] || echo "$COLS" > "$RAW"
load1() { cut -d' ' -f1 /proc/loadavg; }
foreign_r() { ps -eLo stat,comm --no-headers | awk '$1 ~ /^R/ && $2 != "ps" && $2 != "awk"' | wc -l; }
quiet() { awk -v l="$(load1)" -v f="$(foreign_r)" -v n="$NCPU" -v g="$GATE" 'BEGIN{exit !((l/n)<g && (f/n)<g)}'; }
while IFS=$'\t' read -r tool profile ds fmt input thr rep extra; do
  [ -z "$tool" ] || [ "${tool:0:1}" = "#" ] && continue
  w0=$(date +%s)
  while ! quiet; do [ $(( $(date +%s) - w0 )) -gt "$GATE_MAX_WAIT" ] && break; sleep 15; done
  gw=$(( $(date +%s) - w0 ))
  run=$OUT/work/cur; rm -rf "$run"; mkdir -p "$run"
  l0=$(load1); f0=$(foreign_r); st=$(date -u +%FT%TZ)
  xa=(); eval "xa=(${extra:-})"
  tag=${tool}_${profile}_${ds}_${fmt}_${thr}_${rep}
  if [ "$tool" = fastag ]; then
    (cd "$run" && FASTAG_TIMING=1 python3 "$HERE/memsample.py" time.txt samples.tsv summ.tsv "$INTERVAL" "$SMAPS" -- \
        "$FASTAG" -in "$input" -out tags.tsv -threads "$thr" "${xa[@]}" > out.log 2> err.log)
    rc=$?
  else
    ck=$OUT/directag_cache/$(echo "${extra:-}" | md5sum | cut -c1-12); mkdir -p "$ck"; cp "$ck"/*.cache "$run"/ 2>/dev/null
    (cd "$run" && LC_ALL=C python3 "$HERE/memsample.py" time.txt samples.tsv summ.tsv "$INTERVAL" "$SMAPS" -- \
        "$DIRECTAG" -cpus "$thr" "${xa[@]}" "$input" > out.log 2> err.log)
    rc=$?
    [ -f "$ck/directag_intensity_ranksum_bins.cache" ] || cp "$run"/*.cache "$ck"/ 2>/dev/null
  fi
  l1=$(load1); f1=$(foreign_r)
  tv() { grep -m1 "$1" "$run/time.txt" | awk -F': ' '{print $NF}'; }
  wall=$(tv "Elapsed (wall clock)" | awk -F: '{s=0; for(i=1;i<=NF;i++) s=s*60+$i; printf "%.2f", s}')
  usr=$(tv "User time"); sys=$(tv "System time"); rss=$(tv "Maximum resident set size")
  ex=$(tv "Exit status"); [ -n "$ex" ] && rc=$ex
  sig=$(grep -m1 -oE "terminated by signal [0-9]+" "$run/time.txt" | awk '{print $NF}'); [ -n "$sig" ] && rc=$((128 + sig))
  summ=$(tail -1 "$run/summ.tsv" 2>/dev/null)
  if [ "$tool" = fastag ]; then
    s=$(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$run/out.log"); nsp=$(echo "$s" | awk '{print $1}'); ntag=$(echo "$s" | awk '{print $4}')
    of=$run/tags.tsv
  else
    of=$(ls "$run"/*.tags 2>/dev/null | head -1)
    if [ -n "$of" ]; then nsp=$(grep -c '^S' "$of"); ntag=$(grep -c '^T' "$of"); else nsp=; ntag=; fi
  fi
  if [ -n "${of:-}" ] && [ -f "$of" ]; then sha=$(sha256sum "$of" | cut -d' ' -f1); else sha=; fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$tool" "$profile" "$ds" "$fmt" "$thr" "$rep" "$rc" "$wall" "$usr" "$sys" "$rss" "$summ" "$l0" "$l1" "$f0" "$f1" "$gw" \
    "$nsp" "$ntag" "$sha" "$st	$input	${extra:-}" >> "$RAW"
  cp "$run/time.txt" "$OUT/logs/$tag.time"; gzip -c "$run/samples.tsv" > "$OUT/logs/$tag.samples.tsv.gz"
  tail -c 4000 "$run/err.log" > "$OUT/logs/$tag.err"; tail -c 2000 "$run/out.log" > "$OUT/logs/$tag.out"
  rm -rf "$run"
done < "$PLAN"
echo "plan $PLAN finished $(date -u +%FT%TZ)" >> "$OUT/done.log"
