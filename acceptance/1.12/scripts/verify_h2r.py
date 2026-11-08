#!/usr/bin/env python3
"""Post-download check of the PROPOSED #2/#6 reserve files (no FASTag run, no search, no peak arrays decoded).
mzML: MS2 count, first MS2 filter string, MS2 analyser class from the filter (ASTMS astral, FTMS orbitrap, ITMS ion
trap), isolation-window target m/z and width per MS2. DDA = median isolation width <= 4 Th, more than 5000 distinct
targets (0.01 Th) and the 1000 most frequent targets cover < 50% of the MS2 (a DIA scheme cycles through at most a
few hundred fixed windows, so a few targets cover ~100%). The first version used distinct/MS2 >= 0.3; the registered
H1 ddaPASEF run PXD050504 gives 0.286 under it, so that version is void (kept in the output as distinct_target_frac).
Thermo mzML also: share of MS2 filter strings with the data-dependent flag ' d ' (Thermo DDA: ~1; DIA: 0); for Thermo
files DDA additionally needs that share >= 0.99.
.d.zip: analysis.tdf read from the zip with sqlite3: rows in PasefFrameMsMsInfo (ddaPASEF) and DiaFrameMsMsWindows
(diaPASEF), the instrument name from GlobalMetadata. DDA = PASEF rows > 0 and no DIA window rows.
Usage: verify_h2r.py <file> [<file> ...]   (prints one TSV row per file)"""
import os, re, sqlite3, statistics, sys, tempfile, zipfile

def mzml(p):
    n = 0; first = ""; tgt = []; wid = []; lo = hi = None; lvl = None; t = None; cls = set(); nf = nd_flag = 0
    with open(p, errors="replace") as f:
        for line in f:
            if "<spectrum " in line:
                lvl = None; t = lo = hi = None
            elif 'accession="MS:1000511"' in line:
                m = re.search(r'value="(\d+)"', line); lvl = int(m.group(1)) if m else None
                if lvl == 2: n += 1
            elif lvl == 2 and 'accession="MS:1000512"' in line:
                m = re.search(r'value="([^"]*)"', line); s = m.group(1) if m else ""
                if not first: first = s
                nf += 1; nd_flag += " d " in s
                cls.add(s.split(" ")[0])
            elif lvl == 2 and 'accession="MS:1000827"' in line:
                t = float(re.search(r'value="([^"]*)"', line).group(1)); tgt.append(round(t, 2))
            elif lvl == 2 and 'accession="MS:1000828"' in line:
                lo = float(re.search(r'value="([^"]*)"', line).group(1))
            elif lvl == 2 and 'accession="MS:1000829"' in line:
                hi = float(re.search(r'value="([^"]*)"', line).group(1))
                if lo is not None: wid.append(lo + hi)
    mw = statistics.median(wid) if wid else float("nan")
    from collections import Counter
    cnt = Counter(tgt); nd = len(cnt)
    top = sum(c for _, c in cnt.most_common(1000)) / len(tgt) if tgt else 1
    dist = nd / n if n else 0
    dflag = nd_flag / nf if nf else None
    dda = bool(wid) and mw <= 4 and nd > 5000 and top < 0.5 and (dflag is None or dflag >= 0.99)
    return [n, first, ";".join(sorted(cls)), f"{mw:.2f}",
            f"{dist:.3f};distinct={nd};top1000_cover={top:.3f};dflag={'NA' if dflag is None else f'{dflag:.4f}'}", "DDA" if dda else "NOT_DDA"]

def dzip(p):
    z = zipfile.ZipFile(p)
    name = next(n for n in z.namelist() if n.endswith("analysis.tdf"))
    with tempfile.TemporaryDirectory(dir=os.path.dirname(os.path.abspath(p))) as d:
        z.extract(name, d); db = sqlite3.connect(os.path.join(d, name))
        tabs = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        pasef = db.execute("select count(*) from PasefFrameMsMsInfo").fetchone()[0] if "PasefFrameMsMsInfo" in tabs else 0
        dia = db.execute("select count(*) from DiaFrameMsMsWindows").fetchone()[0] if "DiaFrameMsMsWindows" in tabs else 0
        meta = dict(db.execute("select Key, Value from GlobalMetadata"))
        db.close()
    return [pasef, meta.get("InstrumentName", ""), f"dia_windows={dia}", "", "", "DDA" if pasef > 0 and dia == 0 else "NOT_DDA"]

print("file\tms2_or_pasef_rows\tfirst_filter_or_instrument\tms2_classes\tmedian_iso_width\tdistinct_target_frac\tcall")
for p in sys.argv[1:]:
    try:
        r = dzip(p) if p.endswith(".zip") else mzml(p)
    except Exception as e:
        r = ["ERROR", repr(e), "", "", "", "ERROR"]
    print(p, *r, sep="\t", flush=True)
