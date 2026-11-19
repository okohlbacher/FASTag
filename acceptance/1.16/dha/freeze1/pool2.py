#!/usr/bin/env python3
"""Pool the six dev runs' -delta_spectra_out files into one table.

Spectra are binned on FASTag's 0.0005 Da grid and grouped as FASTag's
-delta_group 0.004 does (seeds by count, then lower bin; each takes the
untaken bins within 8 bins; no chaining). Per pooled row: spectra, runs,
localized/unlocalized, residues, top interpretations; names (unimod, psimod,
isotope_error) are those of the largest per-run FASTag row whose delta lies
in the pooled row (first two entries), not recomputed.
usage: pool2.py <run dir> <out prefix>
"""
import collections, csv, glob, os, sys
src, out = sys.argv[1], sys.argv[2]
W = 8
spec, rows = [], []
for f in sorted(glob.glob(os.path.join(src, "*.spectra.tsv"))):
    run = os.path.basename(f).split(".")[0]
    for r in csv.DictReader(open(f), delimiter="\t"):
        r["run"] = run; spec.append(r)
    for r in csv.DictReader(open(f.replace(".spectra.tsv", ".delta.tsv")), delimiter="\t"):
        r["run"] = run; rows.append(r)
def key(x):
    v = x / 0.0005
    return int(v + 0.5) if v >= 0 else -int(-v + 0.5)
bins = collections.defaultdict(list)
for r in spec: bins[key(float(r["delta"]))].append(r)
order = sorted(bins, key=lambda k: (-len(bins[k]), k))
taken, groups = set(), []
for s in order:
    if s in taken: continue
    mem = [k for k in range(s - W, s + W + 1) if k in bins and k not in taken]
    taken.update(mem); groups.append((s, mem))
groups.sort()
first2 = lambda c: ";".join(c.split(";")[:2]) if c and c != "-" else "-"
res = []
for c, mem in groups:
    rs = [r for k in mem for r in bins[k]]
    lo, hi = (min(mem) - 0.5) * 0.0005, (max(mem) + 0.5) * 0.0005
    gap = [r for r in rs if r["interp"] != "-"]
    loc = [r for r in gap if r["localized"] != "-"]
    resid = collections.Counter(r["localized"] for r in loc)
    interp = collections.Counter(r["interp"] for r in gap)
    cand = [r for r in rows if lo <= float(r["delta"]) < hi]
    big = max(cand, key=lambda r: int(r["spectra"])) if cand else {}
    res.append(dict(delta="%.4f" % (c * 0.0005), spectra=len(rs), runs=len({r["run"] for r in rs}),
                    localized=len(loc), unlocalized=len(gap) - len(loc),
                    residues=",".join("%s:%d" % kv for kv in sorted(resid.items(), key=lambda x: (-x[1], x[0]))[:6]) or "-",
                    top_interps=";".join("%s:%d" % kv for kv in sorted(interp.items(), key=lambda x: (-x[1], x[0]))[:2]) or "-",
                    unimod=first2(big.get("unimod", "-")), psimod=first2(big.get("psimod", "-")),
                    isotope_error=big.get("isotope_error", "-")))
cols = ["delta", "spectra", "runs", "localized", "unlocalized", "residues", "top_interps", "unimod", "psimod", "isotope_error"]
def write(path, items):
    with open(path, "w") as f:
        f.write("\t".join(cols) + "\n")
        for s in items: f.write("\t".join(str(s[c]) for c in cols) + "\n")
write(out + "pooled.tsv", res)
top = [s for s in sorted(res, key=lambda s: (-s["spectra"], float(s["delta"]))) if float(s["delta"]) != 0.0]
write(out + "pooled_top30.tsv", top[:30])
want = (-91.0092, -57.0215, -43.0058, -33.9877, -18.0106, 0.9840, 1.0034, 2.0067, 15.9949, 21.9819, 31.9898, 42.0106, 43.0058)
write(out + "watch.tsv", [s for s in res if any(abs(float(s["delta"]) - x) < 0.006 for x in want)])
tl = sum(s["localized"] for s in res); tu = sum(s["unlocalized"] for s in res)
print("samples\t%d\nrows\t%d\nrow_sum\t%d\nlocalized\t%d\nunlocalized\t%d" % (len(spec), len(res), sum(s["spectra"] for s in res), tl, tu))
for n in (20, 30):
    t = top[:n]
    print("top%d_unimod\t%d\ntop%d_localized\t%d\ntop%d_isotope\t%d" % (n, sum(s["unimod"] != "-" for s in t), n, sum(s["localized"] > 0 for s in t), n, sum(s["isotope_error"] != "-" for s in t)))
print("runs_rows_total\t%d" % len(rows))
subs = sum(1 for r in spec if r["interp"].startswith("sub:")); q = sum(1 for r in spec if r["interp"] == "?")
print("samples_sub\t%d\nsamples_unexplained\t%d" % (subs, q))
