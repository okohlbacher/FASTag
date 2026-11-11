#!/usr/bin/env python3
"""acqcheck2 held-out: acquisition truth of one Thermo run, from the converted mzML alone.

Independent of FASTag: reads every MS2 of the file (FASTag probes the first 4000), and uses the
Thermo scan filter's data-dependent flag ("d" before "Full ms2"), which FASTag does not read.
No periodicity, no charge, no cycle criterion.

  dep   = share of MS2 whose filter string carries the dependent flag
  W     = distinct isolation windows (target and width rounded to 0.1 Th)
  cov   = share of [lowest lower limit, highest upper limit] covered by the union of the windows
  span  = that range in Th;  visits = MS2 / W

  truth NONDIA  (data-dependent)  dep >= 0.95
  truth DIA                       dep <= 0.05 and cov >= 0.8 and span >= 100 and visits >= 5
  truth NONDIA  (targeted)        dep <= 0.05 and cov <= 0.5
  truth UNCLEAR                   everything else, or fewer than 500 MS2, or MS2 without filter
                                  string or isolation window in more than 5 %

usage: truth.py <id> <file.mzML>   -> one TSV line
       truth.py --selftest
"""
import re, sys

RE_ACC = re.compile(r'accession="(MS:\d+)"[^>]*?value="([^"]*)"')
RE_DEP = re.compile(r'\sd\s+(Full\s+|Z\s+)?(msx\s+)?ms2\b', re.I)

def classify(n, dep, wins):
    """n MS2, dep share, wins = dict (target, width) -> count. Returns (truth, kind, W, cov, span, visits)."""
    W = len(wins)
    if n < 500: return ("UNCLEAR", "few_ms2", W, 0.0, 0.0, 0.0)
    if dep >= 0.95: return ("NONDIA", "dependent", W, 0.0, 0.0, n / max(W, 1))
    iv = sorted((t - w / 2.0, t + w / 2.0) for (t, w) in wins)
    lo, hi = iv[0][0], max(b for _, b in iv)
    span = hi - lo
    covered, cur_a, cur_b = 0.0, iv[0][0], iv[0][1]
    for a, b in iv[1:]:
        if a > cur_b:
            covered += cur_b - cur_a; cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    covered += cur_b - cur_a
    cov = covered / span if span > 0 else 0.0
    visits = n / float(W)
    if dep <= 0.05:
        if cov >= 0.8 and span >= 100 and visits >= 5: return ("DIA", "tiling_nondependent", W, cov, span, visits)
        if cov <= 0.5: return ("NONDIA", "targeted", W, cov, span, visits)
        return ("UNCLEAR", "nondependent_other", W, cov, span, visits)
    return ("UNCLEAR", "mixed_dependence", W, cov, span, visits)

def read(path):
    n = dep = nofilt = nowin = 0
    wins = {}
    level = filt = tgt = lo = up = None
    with open(path, "r", errors="replace") as f:
        for line in f:
            if len(line) > 2000: continue          # binary arrays
            if "<spectrum " in line:
                level = filt = tgt = lo = up = None
            elif "cvParam" in line:
                m = RE_ACC.search(line)
                if not m: continue
                a, v = m.groups()
                if a == "MS:1000511": level = v
                elif a == "MS:1000512": filt = v
                elif a == "MS:1000827": tgt = v
                elif a == "MS:1000828": lo = v
                elif a == "MS:1000829": up = v
            elif "</spectrum>" in line and level == "2":
                n += 1
                if filt is None: nofilt += 1
                elif RE_DEP.search(" " + filt): dep += 1
                try:
                    k = (round(float(tgt), 1), round(float(lo) + float(up), 1))
                    wins[k] = wins.get(k, 0) + 1
                except (TypeError, ValueError):
                    nowin += 1
    return n, dep, nofilt, nowin, wins

def main():
    if sys.argv[1] == "--selftest":
        assert RE_DEP.search(" FTMS + c NSI d Full ms2 445.12@hcd28.00 [100.00-900.00]")
        assert RE_DEP.search(" ITMS + c NSI r d Full ms2 445.12@cid35.00 [110.00-900.00]")
        assert not RE_DEP.search(" FTMS + p NSI Full ms2 500.00@hcd27.00 [200.00-1800.00]")
        assert not RE_DEP.search(" ASTMS + c NSI Full ms2 501.00@hcd25.00 [150.00-2000.00]")
        dia = {(400.0 + 20 * i, 20.0): 100 for i in range(30)}
        assert classify(3000, 0.0, dia)[0] == "DIA"
        prm = {(400.0 + 37 * i, 1.6): 100 for i in range(30)}
        assert classify(3000, 0.0, prm)[:2] == ("NONDIA", "targeted")
        dda = {(400.0 + 0.3 * i, 1.6): 1 for i in range(3000)}
        assert classify(3000, 1.0, dda)[:2] == ("NONDIA", "dependent")
        assert classify(3000, 0.5, dda)[0] == "UNCLEAR"
        assert classify(100, 0.0, dia)[0] == "UNCLEAR"
        half = {(400.0 + 30 * i, 20.0): 100 for i in range(30)}      # coverage 0.67
        assert classify(3000, 0.0, half)[0] == "UNCLEAR"
        print("truth selftest ok"); return
    id_, path = sys.argv[1:3]
    n, dep, nofilt, nowin, wins = read(path)
    d = dep / float(n) if n else 0.0
    if n and (nofilt > 0.05 * n or nowin > 0.05 * n):
        t = ("UNCLEAR", "missing_metadata", len(wins), 0.0, 0.0, 0.0)
    elif not wins:
        t = ("UNCLEAR", "few_ms2", 0, 0.0, 0.0, 0.0)
    else:
        t = classify(n, d, wins)
    ws = sorted(w for (_, w) in wins)
    medw = ws[len(ws) // 2] if ws else 0.0
    print("\t".join([id_, t[0], t[1], str(n), "%.4f" % d, str(t[2]), "%.3f" % t[3], "%.1f" % t[4], "%.1f" % t[5],
                     "%.1f" % medw, str(nofilt), str(nowin)]))

main()
