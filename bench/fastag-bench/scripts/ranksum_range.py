#!/usr/bin/env python3
"""Numerical range of FASTag's rank-sum null tables (Note S1).

FASTag 1.9.0 builds the null distribution of the intensity rank sum with the recurrence
N_v(j, s) = N_{v-1}(j, s) + N_{v-1}(j-1, s-v) in double precision and stores the CDF in single
precision (include/FASTag/ranksum.h, ranksumCdfs). This script

  1. replicates ranksumCdfs in numpy, operation for operation (same additions in the same order,
     so the doubles and floats are identical), and checks the replica bit for bit against a dump
     of the C++ function (scripts/ranksum_dump.cpp), when one is given;
  2. runs the same recurrence in exact integer arithmetic;
  3. reports, per peak count k and peak budget n_max, the table sizes, the largest n for which
     C(n, k) <= 2^53, the largest relative error of the double counts, and the largest absolute
     and relative error of the stored float CDF against the exact CDF, over every n <= n_max and
     every rank sum s.

    c++ -std=c++20 -O2 -I <FASTag v1.9.0>/include scripts/ranksum_dump.cpp -o ranksum_dump
    ./ranksum_dump 2 17 1024 dump1024.bin > times1024.tsv      # likewise for 100 and 400
    python3 scripts/ranksum_range.py --k-min 2 --k-max 17 --n-max 100 400 1024 \
        --dump 1024=dump1024.bin --times 100=times100.tsv 400=times400.tsv 1024=times1024.tsv \
        --out results/ranksum_range_v190.tsv
"""
from __future__ import annotations

import argparse
import math
import platform
import sys
from pathlib import Path

import numpy as np

TWO53 = 2 ** 53


def run(k: int, n_max: int, dump: np.ndarray | None, dump_pos: int):
    """One pass v = 1..n_max for this k; yields per-n statistics. Returns (rows, dump_pos, bit_ok)."""
    smax = k * n_max - k * (k - 1) // 2
    dp = [np.zeros(smax + 1, dtype=np.float64) for _ in range(k + 1)]
    ex = [np.zeros(smax + 1, dtype=object) for _ in range(k + 1)]
    for j in range(k + 1):
        ex[j][:] = 0
    dp[0][0] = 1.0
    ex[0][0] = 1
    per_n = {}
    bit_ok = True
    for v in range(1, n_max + 1):
        for j in range(min(k, v), 0, -1):
            # C++: for s = smax..v: cur[s] += prev[s - v] (prev is row j-1, not yet updated for v).
            # Adding 0.0 leaves a double unchanged, so skipping zeros (as the C++ does) is the same.
            dp[j][v:] += dp[j - 1][: smax + 1 - v]
            ex[j][v:] += ex[j - 1][: smax + 1 - v]
        if v < k:
            continue
        length = k * v - k * (k - 1) // 2 + 1
        counts = dp[k][:length]
        exact = ex[k][:length]
        # CDF exactly as ranksumCdfs: sequential double sums, ratio, cast to float.
        running = np.cumsum(counts)          # sequential, like the C++ loop
        total = running[-1]
        cdf = (running / total).astype(np.float32)
        if dump is not None:
            got = dump[dump_pos: dump_pos + length]
            dump_pos += length
            if got.shape != cdf.shape or not np.array_equal(got.view(np.uint32), cdf.view(np.uint32)):
                bit_ok = False
        c_exact = math.comb(v, k)
        nz = exact != 0
        # relative error of the double counts (doubles >= 2^53 are integers, so int() is exact)
        if c_exact <= TWO53:
            rel_counts = 0.0
            assert all(int(a) == b for a, b in zip(counts[nz], exact[nz]))
        else:
            ci = np.array([int(a) for a in counts], dtype=object)
            diff = np.abs(ci[nz] - exact[nz])
            rel_counts = max(float(d) / float(e) for d, e in zip(diff, exact[nz])) if len(diff) else 0.0
        cum_exact = np.cumsum(exact)
        ref = np.array([c / c_exact for c in cum_exact], dtype=np.float64)   # correctly rounded
        f64 = cdf.astype(np.float64)
        abs_err = float(np.max(np.abs(f64 - ref)))
        pos = ref > 0
        rel_err = float(np.max(np.abs(f64[pos] - ref[pos]) / ref[pos]))
        underflow = int(np.sum((ref > 0) & (f64 == 0)))
        smin = k * (k + 1) // 2
        per_n[v] = dict(c=c_exact, rel_counts=rel_counts, abs_err=abs_err, rel_err=rel_err,
                        underflow=underflow, min_cdf=float(cdf[smin]), min_exact=1.0 / c_exact,
                        length=length)
    return per_n, dump_pos, bit_ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--k-min", type=int, default=2)
    ap.add_argument("--k-max", type=int, default=17)
    ap.add_argument("--n-max", type=int, nargs="+", default=[100, 400, 1024])
    ap.add_argument("--dump", nargs="*", default=[], help="N=FILE: C++ dump for n_max N")
    ap.add_argument("--times", nargs="*", default=[], help="N=FILE: C++ build times for n_max N")
    ap.add_argument("--host", default=f"{platform.node()} ({platform.machine()})")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    dumps = {int(x.split("=", 1)[0]): np.fromfile(x.split("=", 1)[1], dtype="<f4") for x in a.dump}
    times = {}
    for x in a.times:
        n, f = x.split("=", 1)
        for line in open(f):
            p = line.split("\t")
            if p[0] == "k":
                continue
            times[(int(p[0]), int(n))] = float(p[2])
    top = max(a.n_max)
    rows, checked = [], []
    dpos = 0
    all_bit_ok = True
    for k in range(a.k_min, a.k_max + 1):
        print(f"k={k}", file=sys.stderr, flush=True)
        per_n, dpos_new, ok = run(k, top, dumps.get(top), dpos)
        if top in dumps:
            dpos = dpos_new
            checked.append(k)
            all_bit_ok &= ok
            if not ok:
                print(f"  k={k}: replica differs from the C++ dump", file=sys.stderr)
        for n_max in sorted(a.n_max):
            ns = [n for n in per_n if n <= n_max]
            if not ns:
                continue
            smax = k * n_max - k * (k - 1) // 2
            floats = sum(per_n[n]["length"] for n in ns)
            exact_ns = [n for n in ns if per_n[n]["c"] <= TWO53]
            rows.append({
                "k": k, "n_max": n_max, "s_max": smax,
                "dp_doubles": (k + 1) * (smax + 1),
                "table_floats": floats,
                "table_MiB": f"{floats * 4 / 2 ** 20:.3f}",
                "n_exact_max": max(exact_ns) if exact_ns else 0,
                "n_inexact": sum(1 for n in ns if per_n[n]["c"] > TWO53),
                "max_rel_err_counts": f"{max(per_n[n]['rel_counts'] for n in ns):.3g}",
                "max_abs_err_cdf": f"{max(per_n[n]['abs_err'] for n in ns):.3g}",
                "max_rel_err_cdf": f"{max(per_n[n]['rel_err'] for n in ns):.3g}",
                "cdf_underflows": sum(per_n[n]["underflow"] for n in ns),
                "min_p_exact_at_n_max": f"{per_n[n_max]['min_exact']:.4g}",
                "min_p_float_at_n_max": f"{per_n[n_max]['min_cdf']:.4g}",
                "build_seconds_cxx": f"{times[(k, n_max)]:.4g}" if (k, n_max) in times else "-",
            })
    if top in dumps and dpos != dumps[top].size:
        all_bit_ok = False
        print(f"dump has {dumps[top].size} floats, replica consumed {dpos}", file=sys.stderr)
    cols = list(rows[0].keys())
    with open(a.out, "w") as fh:
        fh.write("# source: scripts/ranksum_range.py on FASTag 1.9.0 include/FASTag/ranksum.h (commit 153bd23, "
                 f"ranksumCdfs); host {a.host}; numpy {np.__version__}, Python {platform.python_version()}\n")
        bit = ("replica == C++ ranksumCdfs bit for bit for k = " + ", ".join(map(str, checked)) +
               f" at n_max = {top}" if checked else "no C++ dump given") if all_bit_ok else "REPLICA MISMATCH"
        fh.write(f"# check: {bit}; exact reference = the same recurrence in Python integers\n")
        fh.write("# columns: s_max = largest rank sum at n_max; dp_doubles = DP work array (doubles); table_floats/MiB = stored "
                 "float CDFs over n = k..n_max (vector overhead excluded); n_exact_max = largest n <= n_max with C(n,k) <= 2^53; "
                 "n_inexact = number of n with C(n,k) > 2^53; max_rel_err_counts = max |double - exact| / exact over n <= n_max "
                 "and all s; max_abs_err_cdf / max_rel_err_cdf = stored float CDF against the exact CDF, over n <= n_max and all s "
                 "with exact CDF > 0; cdf_underflows = entries with exact CDF > 0 stored as 0; min_p_* = CDF at the smallest rank "
                 "sum k(k+1)/2 at n = n_max (exact 1/C(n_max,k), and as stored); build_seconds_cxx = ranksumCdfs(k, n_max), best "
                 "of 5, -O2\n")
        fh.write("\t".join(cols) + "\n")
        for r in rows:
            fh.write("\t".join(str(r[c]) for c in cols) + "\n")
    print(f"wrote {a.out} ({len(rows)} rows); bit check: {'ok' if all_bit_ok else 'FAILED'}", file=sys.stderr)
    return 0 if all_bit_ok else 1


if __name__ == "__main__":
    sys.exit(main())
