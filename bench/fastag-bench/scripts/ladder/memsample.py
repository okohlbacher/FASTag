#!/usr/bin/env python3
"""Run a command under /usr/bin/time -v and sample the resident memory of the timed process.

  memsample.py <time.txt> <samples.tsv> <summary.tsv> <interval_s> <smaps:0|1> -- cmd [args...]

Every <interval_s> seconds it reads /proc/<pid>/status (VmRSS, VmHWM, RssAnon, RssFile, Threads) of
the program that /usr/bin/time started (the FASTag wrapper execs, so the pid is the program) and,
with smaps=1, the page-table walk /proc/<pid>/smaps_rollup (Rss). The summary holds the maxima over
all samples, also for VmHWM. The VmHWM maximum is no check on missed peaks: the kernel reports VmHWM as
max(mm->hiwater_rss, current RSS), hiwater_rss is also what ru_maxrss is computed from at exit, so
whenever ru_maxrss is below the sampled VmRSS maximum the VmHWM maximum simply equals that maximum.
Check missed peaks by sampling more densely (interval 0.005) instead.
Exit status is that of /usr/bin/time.
"""
import os, subprocess, sys, time

timef, samplesf, summf, iv, smaps = sys.argv[1:6]
iv = float(iv); smaps = smaps == "1"
cmd = sys.argv[sys.argv.index("--") + 1:]
t0 = time.monotonic()
p = subprocess.Popen(["/usr/bin/time", "-v", "-o", timef] + cmd)
child = None
while child is None and p.poll() is None:
    try:
        with open(f"/proc/{p.pid}/task/{p.pid}/children") as f:
            c = f.read().split()
        if c:
            child = int(c[0])
    except OSError:
        pass
    if child is None:
        time.sleep(0.001)

def status(pid):
    d = {}
    with open(f"/proc/{pid}/status") as f:
        for line in f:
            k, _, v = line.partition(":")
            if k in ("VmRSS", "VmHWM", "RssAnon", "RssFile", "Threads"):
                d[k] = int(v.split()[0])
    return d

def rollup(pid):
    with open(f"/proc/{pid}/smaps_rollup") as f:
        for line in f:
            if line.startswith("Rss:"):
                return int(line.split()[1])
    return None

mx = {"VmRSS": 0, "VmHWM": 0, "Threads": 0, "smapsRss": 0}
n = 0; at_max = (0, 0); gaps = []; last = None
with open(samplesf, "w") as out:
    out.write("t_s\tVmRSS_kb\tVmHWM_kb\tRssAnon_kb\tRssFile_kb\tThreads\tsmapsRss_kb\n")
    nxt = time.monotonic()
    while child is not None and p.poll() is None:
        try:
            d = status(child)
            r = rollup(child) if smaps else None
        except (OSError, ValueError):
            d = None
        now = time.monotonic()
        if d and "VmRSS" in d:   # VmRSS is absent once the process is a zombie
            n += 1
            if last is not None:
                gaps.append(now - last)
            last = now
            for k in ("VmHWM", "Threads"):
                mx[k] = max(mx[k], d.get(k, 0))
            if d["VmRSS"] > mx["VmRSS"]:
                mx["VmRSS"] = d["VmRSS"]; at_max = (d.get("RssAnon", 0), d.get("RssFile", 0))
            if r is not None:
                mx["smapsRss"] = max(mx["smapsRss"], r)
            out.write(f"{now - t0:.3f}\t{d['VmRSS']}\t{d.get('VmHWM', '')}\t{d.get('RssAnon', '')}\t"
                      f"{d.get('RssFile', '')}\t{d.get('Threads', '')}\t{'' if r is None else r}\n")
        nxt += iv
        time.sleep(max(0.0, nxt - time.monotonic()))
rc = p.wait()
gaps.sort()
med = gaps[len(gaps) // 2] if gaps else float("nan")
mxg = gaps[-1] if gaps else float("nan")
with open(summf, "w") as f:
    f.write("vmrss_max_kb\tvmhwm_kb\trssanon_at_max_kb\trssfile_at_max_kb\tthreads_max\tsmaps_rss_max_kb\tn_samples\tgap_med_s\tgap_max_s\n")
    f.write(f"{mx['VmRSS']}\t{mx['VmHWM']}\t{at_max[0]}\t{at_max[1]}\t{mx['Threads']}\t"
            f"{mx['smapsRss'] if smaps else ''}\t{n}\t{med:.4f}\t{mxg:.4f}\n")
sys.exit(rc)
