#!/usr/bin/env python3
"""acqcheck3 held-out: acquisition truth of one run from vendor metadata, independent of FASTag.

FASTag's check reads the selected-ion m/z, window and charge sequence of the first 4000 MS2. This script reads
every MS2 and decides from metadata FASTag does not use:

  thermo  (.raw -> ThermoRawFileParser mzML): the scan filter's data-dependent flag ("d" before "Full ms2"),
          SRM filters, and isolation-window coverage (the acqcheck2 rule, unchanged, plus SRM).
          dep  = share of MS2 whose filter marks a dependent scan; srm = share whose filter says SRM
          NONDIA dependent   dep >= 0.95
          NONDIA targeted    srm >= 0.95, or dep <= 0.05 and cov <= 0.5
          DIA                dep <= 0.05, cov >= 0.8 over span >= 100 Th, visits >= 5
  sciex   (.wiff -> msconvert mzML): the experiment index in the native id ("... experiment=<k>").
          An experiment is fixed when one isolation window holds >= 95 % of its MS2, varying when < 50 %.
          NONDIA dependent   >= 95 % of MS2 in varying experiments (IDA: each MS2 slot takes a new precursor)
          DIA                >= 95 % of MS2 in fixed experiments, >= 5 such experiments, cov >= 0.8 over
                             span >= 100 Th, visits >= 5
          NONDIA targeted    >= 95 % of MS2 in fixed experiments and cov <= 0.5
  bruker  (.d.zip; analysis.tdf read from the archive): Frames.MsMsType of the MS/MS frames
          (8 PASEF = DDA, 9 diaPASEF, 10 prm-PASEF, 2 MS/MS without PASEF)
          DIA >= 95 % type 9;  NONDIA dependent >= 95 % type 8;  NONDIA targeted >= 95 % types 10 or 2
  UNCLEAR for everything else, fewer than 500 MS2 (frames), or > 5 % of MS2 without filter/window/experiment.

Descriptive columns (used by the scorer for rows K4/K5, not for the truth label):
  per    = single-cycle share of the window sequence over all MS2 (consecutive repeats collapsed, W distinct
           windows): share of positions i where s[i:i+W] holds all W windows; thermo and sciex only
  recur  = share of MS2 (bruker: PASEF precursor selections) on a window (target and width to 0.1 Th) used
           >= 10 times
  astral = share of MS2 whose Thermo filter starts with ASTMS (Astral analyser)

usage: truth.py <id> <route thermo|sciex|bruker> <mzML or -> <raw or -> -> one TSV line
       truth.py --selftest
"""
import re, sys, os, sqlite3, tempfile, zipfile, shutil

RE_ACC = re.compile(r'accession="(MS:\d+)"[^>]*?value="([^"]*)"')
RE_DEP = re.compile(r'\sd\s+(Full\s+|Z\s+)?(msx\s+)?ms2\b', re.I)
RE_SRM = re.compile(r'\bSRM\b', re.I)
RE_EXP = re.compile(r'experiment=(\d+)')
COLS = ["id", "route", "truth", "kind", "n_ms2", "dep", "srm", "W", "cov", "span", "visits", "per", "recur",
        "astral", "fixed_share", "varying_share", "n_missing", "note"]

def coverage(keys):
    """keys = iterable of (target, width). Returns (cov, span)."""
    iv = sorted((t - w / 2.0, t + w / 2.0) for (t, w) in keys)
    if not iv: return 0.0, 0.0
    lo, hi = iv[0][0], max(b for _, b in iv)
    span = hi - lo
    covered, a0, b0 = 0.0, iv[0][0], iv[0][1]
    for a, b in iv[1:]:
        if a > b0: covered += b0 - a0; a0, b0 = a, b
        else: b0 = max(b0, b)
    covered += b0 - a0
    return (covered / span if span > 0 else 0.0), span

def periodicity(seq):
    """Single-cycle share: consecutive repeats collapsed, W distinct windows; share of the positions i at which
    the W consecutive windows s[i:i+W] are W distinct ones (one pass through every window)."""
    s = [k for i, k in enumerate(seq) if i == 0 or k != seq[i - 1]]
    W = len(set(s))
    if W < 2 or len(s) < 2 * W: return float("nan")
    cnt, dist, full = {}, 0, 0
    for j in range(len(s)):
        k = s[j]; cnt[k] = cnt.get(k, 0) + 1
        if cnt[k] == 1: dist += 1
        if j >= W:
            o = s[j - W]; cnt[o] -= 1
            if cnt[o] == 0: dist -= 1
        if j >= W - 1 and dist == W: full += 1
    return full / float(len(s) - W + 1)

def recur_share(counts):
    n = sum(counts.values())
    return sum(c for c in counts.values() if c >= 10) / float(n) if n else 0.0

def classify_thermo(n, dep, srm, wins):
    W = len(wins)
    if n < 500: return "UNCLEAR", "few_ms2"
    if srm >= 0.95: return "NONDIA", "targeted_srm"
    if dep >= 0.95: return "NONDIA", "dependent"
    cov, span = coverage(wins)
    visits = n / float(max(W, 1))
    if dep <= 0.05:
        if cov >= 0.8 and span >= 100 and visits >= 5: return "DIA", "tiling_nondependent"
        if cov <= 0.5: return "NONDIA", "targeted"
        return "UNCLEAR", "nondependent_other"
    return "UNCLEAR", "mixed_dependence"

def classify_sciex(n, exps, wins):
    """exps = experiment -> {key: count}."""
    if n < 500: return "UNCLEAR", "few_ms2", 0.0, 0.0
    fixed = varying = nfixed_exp = 0
    for e, c in exps.items():
        m, t = max(c.values()), sum(c.values())
        if m >= 0.95 * t: fixed += t; nfixed_exp += 1
        elif m < 0.5 * t: varying += t
    fs, vs = fixed / float(n), varying / float(n)
    if vs >= 0.95: return "NONDIA", "dependent_ida", fs, vs
    if fs >= 0.95:
        cov, span = coverage(wins)
        visits = n / float(max(len(wins), 1))
        if nfixed_exp >= 5 and cov >= 0.8 and span >= 100 and visits >= 5: return "DIA", "fixed_tiling", fs, vs
        if cov <= 0.5: return "NONDIA", "targeted", fs, vs
        return "UNCLEAR", "fixed_other", fs, vs
    return "UNCLEAR", "mixed_experiments", fs, vs

def classify_bruker(types):
    n = sum(v for k, v in types.items() if k != 0)
    if n < 500: return "UNCLEAR", "few_ms2", n
    t = lambda *ks: sum(types.get(k, 0) for k in ks) / float(n)
    if t(9) >= 0.95: return "DIA", "diapasef", n
    if t(8) >= 0.95: return "NONDIA", "dependent_pasef", n
    if t(10, 2) >= 0.95: return "NONDIA", "targeted", n
    return "UNCLEAR", "mixed_frames", n

def read_mzml(path):
    n = dep = srm = ast = nofilt = nowin = noexp = 0
    wins, seq, exps = {}, [], {}
    level = filt = tgt = lo = up = exp = None
    with open(path, "r", errors="replace") as f:
        for line in f:
            if len(line) > 2000: continue
            if "<spectrum " in line:
                level = filt = tgt = lo = up = None
                m = RE_EXP.search(line); exp = m.group(1) if m else None
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
                else:
                    if RE_DEP.search(" " + filt): dep += 1
                    if RE_SRM.search(filt): srm += 1
                    if filt.lstrip().upper().startswith("ASTMS"): ast += 1
                try:
                    k = (round(float(tgt), 1), round(float(lo) + float(up), 1))
                except (TypeError, ValueError):
                    nowin += 1; continue
                wins[k] = wins.get(k, 0) + 1
                seq.append(k)
                if exp is None: noexp += 1
                else:
                    c = exps.setdefault(exp, {}); c[k] = c.get(k, 0) + 1
    return dict(n=n, dep=dep, srm=srm, ast=ast, nofilt=nofilt, nowin=nowin, noexp=noexp, wins=wins, seq=seq, exps=exps)

def read_tdf(raw):
    tmp = tempfile.mkdtemp(prefix="aq3tdf_")
    try:
        if os.path.isdir(raw): tdf = os.path.join(raw, "analysis.tdf")
        else:
            z = zipfile.ZipFile(raw)
            names = [x for x in z.namelist() if x.endswith("analysis.tdf")]
            if len(names) != 1: return None, None, "analysis.tdf entries: %d" % len(names)
            tdf = os.path.join(tmp, "analysis.tdf")
            with z.open(names[0]) as s, open(tdf, "wb") as d: shutil.copyfileobj(s, d)
        c = sqlite3.connect("file:%s?mode=ro" % tdf, uri=True)
        types = dict(c.execute("select MsMsType, count(*) from Frames group by MsMsType"))
        tabs = set(r[0] for r in c.execute("select name from sqlite_master where type='table'"))
        prec = {}
        if "PasefFrameMsMsInfo" in tabs:
            for mz, w in c.execute("select IsolationMz, IsolationWidth from PasefFrameMsMsInfo"):
                k = (round(mz, 1), round(w, 1)); prec[k] = prec.get(k, 0) + 1
        model = dict(c.execute("select Key, Value from GlobalMetadata where Key in ('InstrumentName')")).get("InstrumentName", "")
        c.close()
        return types, prec, "instrument=%s" % model.strip()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def fmt(x, p="%.4f"):
    return "NA" if x is None or x != x else p % x

def run(id_, route, mzml, raw):
    r = dict((k, "NA") for k in COLS); r.update(id=id_, route=route, note="")
    if route == "bruker":
        try: types, prec, note = read_tdf(raw)
        except Exception as e: types, prec, note = None, None, "tdf_error:%s" % type(e).__name__
        if types is None:
            r.update(truth="UNCLEAR", kind="no_tdf", note=note); return r
        t, k, n = classify_bruker(types)
        r.update(truth=t, kind=k, n_ms2=str(n), recur=fmt(recur_share(prec)) if prec else "NA", n_missing="0",
                 note=note + ";types=" + ",".join("%s:%s" % kv for kv in sorted(types.items())))
        return r
    d = read_mzml(mzml)
    n = d["n"]
    r.update(n_ms2=str(n), W=str(len(d["wins"])))
    if n == 0:
        r.update(truth="UNCLEAR", kind="no_ms2"); return r
    cov, span = coverage(d["wins"])
    r.update(cov=fmt(cov, "%.3f"), span=fmt(span, "%.1f"), visits=fmt(n / float(max(len(d["wins"]), 1)), "%.1f"),
             per=fmt(periodicity(d["seq"])), recur=fmt(recur_share(d["wins"])))
    if route == "thermo":
        r.update(dep=fmt(d["dep"] / float(n)), srm=fmt(d["srm"] / float(n)), astral=fmt(d["ast"] / float(n)),
                 n_missing=str(max(d["nofilt"], d["nowin"])))
        if d["srm"] >= 0.95 * n and n >= 500: t, k = "NONDIA", "targeted_srm"
        elif d["nofilt"] > 0.05 * n or d["nowin"] > 0.05 * n: t, k = "UNCLEAR", "missing_metadata"
        else: t, k = classify_thermo(n, d["dep"] / float(n), d["srm"] / float(n), d["wins"])
    elif route == "sciex":
        r.update(n_missing=str(max(d["nowin"], d["noexp"])))
        if d["nowin"] > 0.05 * n or d["noexp"] > 0.05 * n: t, k, fs, vs = "UNCLEAR", "missing_metadata", None, None
        else: t, k, fs, vs = classify_sciex(n, d["exps"], d["wins"])
        r.update(fixed_share=fmt(fs), varying_share=fmt(vs))
    else:
        t, k = "UNCLEAR", "unknown_route"
    r.update(truth=t, kind=k)
    return r

def selftest():
    assert RE_DEP.search(" FTMS + c NSI d Full ms2 445.12@hcd28.00 [100.00-900.00]")
    assert RE_DEP.search(" ASTMS + c NSI d Full ms2 445.12@hcd28.00 [100.00-900.00]")
    assert not RE_DEP.search(" ASTMS + c NSI Full ms2 501.00@hcd25.00 [150.00-2000.00]")
    assert RE_SRM.search("+ c NSI SRM ms2 500.300 [600.300-600.310]")
    dia = {(400.0 + 20 * i, 20.0): 100 for i in range(30)}
    assert classify_thermo(3000, 0.0, 0.0, dia)[0] == "DIA"
    prm = {(400.0 + 37 * i, 1.6): 100 for i in range(30)}
    assert classify_thermo(3000, 0.0, 0.0, prm) == ("NONDIA", "targeted")
    dda = {(400.0 + 0.3 * i, 1.6): 1 for i in range(3000)}
    assert classify_thermo(3000, 1.0, 0.0, dda) == ("NONDIA", "dependent")
    assert classify_thermo(3000, 0.5, 0.0, dda)[0] == "UNCLEAR"
    assert classify_thermo(3000, 0.0, 1.0, {}) == ("NONDIA", "targeted_srm")
    assert classify_thermo(100, 0.0, 0.0, dia)[0] == "UNCLEAR"
    # sciex: 40 SWATH experiments of fixed windows vs IDA with 20 varying slots
    sw = {str(e): {(400.0 + 20 * e, 21.0): 100} for e in range(2, 42)}
    swin = {k: v for c in sw.values() for k, v in c.items()}
    assert classify_sciex(4000, sw, swin)[:2] == ("DIA", "fixed_tiling")
    ida = {str(e): {(400.0 + 0.7 * i + e, 1.0): 1 for i in range(200)} for e in range(2, 22)}
    iwin = {k: v for c in ida.values() for k, v in c.items()}
    assert classify_sciex(4000, ida, iwin)[:2] == ("NONDIA", "dependent_ida")
    mrmhr = {str(e): {(400.0 + 37 * e, 1.0): 100} for e in range(2, 22)}
    mwin = {k: v for c in mrmhr.values() for k, v in c.items()}
    assert classify_sciex(2000, mrmhr, mwin)[:2] == ("NONDIA", "targeted")
    assert classify_bruker({0: 3000, 9: 30000}) == ("DIA", "diapasef", 30000)
    assert classify_bruker({0: 3000, 8: 30000})[:2] == ("NONDIA", "dependent_pasef")
    assert classify_bruker({0: 3000, 10: 3000})[:2] == ("NONDIA", "targeted")
    assert classify_bruker({0: 3000, 8: 1000, 9: 1000})[0] == "UNCLEAR"
    cyc = [(400.0 + 20 * (i % 30), 20.0) for i in range(3000)]
    assert periodicity(cyc) > 0.99
    blocks = []
    for b in range(3):
        for rep in range(20): blocks += [(400.0 + 20 * (12 * b + j), 20.0) for j in range(12)]
    assert periodicity(blocks * 3) < 0.5
    stag = []
    for c in range(100): stag += [(400.0 + 20 * j + (10 if c % 2 else 0), 20.0) for j in range(30)]
    assert periodicity(stag) > 0.99
    assert abs(recur_share({(1, 1): 10, (2, 1): 1}) - 10 / 11.0) < 1e-9
    print("truth selftest ok")

def main():
    if sys.argv[1] == "--selftest": selftest(); return
    if sys.argv[1] == "--header": print("\t".join(COLS)); return
    id_, route, mzml, raw = sys.argv[1:5]
    r = run(id_, route, mzml, raw)
    print("\t".join(str(r[k]) for k in COLS))

main()
