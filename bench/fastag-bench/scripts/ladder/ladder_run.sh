#!/bin/bash
# Load-gated thread ladder for the FASTag paper (Figures 4 and 5): FASTag and DirecTag runs from a
# plan file, one row per run appended to <outdir>/raw.tsv.
#
#   ladder_run.sh <plan.tsv> <outdir>
#
# plan.tsv columns (tab-separated, '#' lines ignored):
#   tool(fastag|directag)  profile(default|matched)  dataset  format(mzML|point|chunked)  input  threads  rep  [extra args]
#
# Every run: wait until the node is quiet (1-min load average / logical CPUs < GATE and fewer than
# GATE x CPUs running threads on the node), record both before and after, run under
# /usr/bin/time -v, take wall/CPU/peak RSS, the FASTAG_TIMING phase lines, the tag count and the
# sha256 of the tag file, then delete the tag file. Environment: FASTAG, DIRECTAG, GATE (0.25),
# GATE_MAX_WAIT (s, 1800), OPENMS_TMPDIR, KEEP_OUT=1 to keep the outputs.
set -u
PLAN=$1
OUT=$2
FASTAG=${FASTAG:-/ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FASTag/FASTag}
DIRECTAG=${DIRECTAG:-/ceph/ibmi/abi/oliver/jpr-bench/envs/bumbershoot/bin/directag}
GATE=${GATE:-0.25}
GATE_MAX_WAIT=${GATE_MAX_WAIT:-1800}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=1 OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$OUT/work" "$OPENMS_TMPDIR"
NCPU=$(nproc)
RAW=$OUT/raw.tsv
COLS="tool	profile	dataset	format	threads	rep	exit	wall_s	user_s	sys_s	maxrss_kb	load1_before	load1_after	foreign_r_before	foreign_r_after	gate_wait_s	spectra	tags	sha256	out_bytes	t_open	t_pre_loop	t_parallel	t_write	t_teardown	t_program	thr_read_s	thr_tag_s	start_utc	input	args	note"
[ -s "$RAW" ] || echo "$COLS" > "$RAW"

load1() { cut -d' ' -f1 /proc/loadavg; }
# running threads of every process on the node (any user, including other jobs of this user);
# sampled only between runs, so the benchmark itself is never counted
foreign_r() { ps -eLo stat,comm --no-headers | awk '$1 ~ /^R/ && $2 != "ps" && $2 != "awk"' | wc -l; }
quiet() { awk -v l="$(load1)" -v f="$(foreign_r)" -v n="$NCPU" -v g="$GATE" 'BEGIN{exit !((l/n)<g && (f/n)<g)}'; }

while IFS=$'\t' read -r tool profile ds fmt input thr rep extra; do
  [ -z "$tool" ] || [ "${tool:0:1}" = "#" ] && continue
  w0=$(date +%s)
  while ! quiet; do
    [ $(( $(date +%s) - w0 )) -gt "$GATE_MAX_WAIT" ] && break
    sleep 15
  done
  gw=$(( $(date +%s) - w0 ))
  run=$OUT/work/cur
  rm -rf "$run"; mkdir -p "$run"
  l0=$(load1); f0=$(foreign_r); st=$(date -u +%FT%TZ)
  xa=(); eval "xa=(${extra:-})"   # extra args may carry quoted values, e.g. -fixed_modifications ''
  if [ "$tool" = fastag ]; then
    (cd "$run" && FASTAG_TIMING=1 /usr/bin/time -v -o time.txt "$FASTAG" -in "$input" -out tags.tsv \
        -threads "$thr" "${xa[@]}" > out.log 2> err.log)
    rc=$?
  else
    # DirecTag writes directag_intensity_ranksum_bins.cache into its working directory and spends
    # seconds building it; reuse one cache per argument set so only the first run ever builds it.
    ck=$OUT/directag_cache/$(echo "${extra:-}" | md5sum | cut -c1-12)
    mkdir -p "$ck"; cp "$ck"/*.cache "$run"/ 2>/dev/null
    (cd "$run" && LC_ALL=C /usr/bin/time -v -o time.txt "$DIRECTAG" -cpus "$thr" "${xa[@]}" "$input" \
        > out.log 2> err.log)
    rc=$?
    [ -f "$ck/directag_intensity_ranksum_bins.cache" ] || cp "$run"/*.cache "$ck"/ 2>/dev/null
  fi
  l1=$(load1); f1=$(foreign_r)
  tv() { grep -m1 "$1" "$run/time.txt" | awk -F': ' '{print $NF}'; }
  wall=$(tv "Elapsed (wall clock)" | awk -F: '{s=0; for(i=1;i<=NF;i++) s=s*60+$i; printf "%.2f", s}')
  usr=$(tv "User time"); sys=$(tv "System time"); rss=$(tv "Maximum resident set size")
  ex=$(tv "Exit status"); [ -n "$ex" ] && rc=$ex
  # GNU time prints 'Exit status: 0' for a process killed by a signal; report 128 + signal instead
  sig=$(grep -m1 -oE "terminated by signal [0-9]+" "$run/time.txt" | awk '{print $NF}'); [ -n "$sig" ] && rc=$((128 + sig))
  tm() { grep -ahoE "(^| )$1=[0-9.e+-]+" "$run/err.log" | tail -1 | cut -d= -f2; }
  if [ "$tool" = fastag ]; then
    summ=$(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$run/out.log")
    nsp=$(echo "$summ" | awk '{print $1}'); ntag=$(echo "$summ" | awk '{print $4}')
    of=$run/tags.tsv
    phases="$(tm open)	$(tm pre_loop)	$(tm parallel)	$(tm write)	$(tm teardown)	$(tm since_program_start)	$(tm read)	$(tm tag)"
  else
    of=$(ls "$run"/*.tags 2>/dev/null | head -1)
    if [ -n "$of" ]; then nsp=$(grep -c '^S' "$of"); ntag=$(grep -c '^T' "$of"); else nsp=; ntag=; fi
    # DirecTag's own log: read time and tagging time; total from 'Finished tagging'
    dr=$(grep -a -m1 -oE '^Read [0-9]+ spectra.*; [0-9.]+ seconds' "$run/out.log" | grep -oE '[0-9.]+ seconds' | cut -d' ' -f1)
    dt=$(grep -a -m1 -oE 'Finished sequence tagging spectra; [0-9.]+' "$run/out.log" | awk '{print $NF}')
    da=$(grep -a -m1 -oE 'Finished tagging [0-9]+ files; [0-9.]+' "$run/out.log" | awk '{print $NF}')
    phases="	$dr	$dt			$da		"
  fi
  if [ -n "${of:-}" ] && [ -f "$of" ]; then sha=$(sha256sum "$of" | cut -d' ' -f1); ob=$(stat -c %s "$of"); else sha=; ob=; fi
  note=$(grep -a -m1 -iE "error|exception|abort|invalid" "$run/err.log" "$run/out.log" 2>/dev/null | head -1 | cut -d: -f2- | tr '\t' ' ' | cut -c1-200)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$tool" "$profile" "$ds" "$fmt" "$thr" "$rep" "$rc" "$wall" "$usr" "$sys" "$rss" "$l0" "$l1" "$f0" "$f1" "$gw" \
    "$nsp" "$ntag" "$sha" "$ob" "$phases" "$st" "$input" "${extra:-}	$note" >> "$RAW"
  if [ "${KEEP_OUT:-0}" = 1 ]; then mv "$run" "$OUT/work/keep_${tool}_${profile}_${ds}_${fmt}_${thr}_${rep}"; else
    mkdir -p "$OUT/logs"; tail -c 4000 "$run/err.log" > "$OUT/logs/${tool}_${profile}_${ds}_${fmt}_${thr}_${rep}.err"
    tail -c 2000 "$run/out.log" > "$OUT/logs/${tool}_${profile}_${ds}_${fmt}_${thr}_${rep}.out"
    rm -rf "$run"; fi
done < "$PLAN"
echo "plan $PLAN finished $(date -u +%FT%TZ)" >> "$OUT/done.log"
