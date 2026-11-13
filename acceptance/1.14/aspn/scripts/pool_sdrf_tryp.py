#!/usr/bin/env python3
"""FASTag 1.14 held-out test aspn: trypsin control pool from SDRF metadata only (no raw file is read).
Copy of acceptance/1.13/nontryptic/scripts/pool_sdrf.py with trypsin as the only accepted cleavage agent.

pool_sdrf_tryp.py <bigbio SDRF catalogue root> <out.tsv>
One row per (project, protease, data file) whose SDRF row says:
  - the cleavage agent of the file is trypsin alone;
  - organism Homo sapiens (every SDRF row of the file);
  - label free;
  - instrument name contains "q exactive", "orbitrap" or "exploris";
  - acquisition not DIA/targeted when the column exists;
  - dissociation HCD when the column exists (multiple values: HCD must be the only one);
  - no modification parameter that names an enrichment or a label (phospho, glyc, hexnac, hex, gg, ubiq, tmt, itraq,
    silac, label:, dimethyl, biotin, xlink/crosslink, adp-ribos, sumo).
"""
import csv, glob, re, sys, collections
root, outp = sys.argv[1], sys.argv[2]
ENZ = {"trypsin": "Trypsin", "trypsin/p": "Trypsin"}
BADMOD = re.compile(r"phospho|glyc|hexnac|\bhex\b|gg\b|glygly|ubiq|tmt|itraq|silac|label:|dimethyl|biotin|xlink|"
                    r"crosslink|adp-ribos|sumo", re.I)
def nt(v):
    m = re.search(r"NT=([^;]+)", v, re.I)
    return (m.group(1) if m else v).strip()
rows = []
for p in sorted(glob.glob(root + "/**/*.sdrf.tsv", recursive=True)):
    a = re.search(r"/(PXD\d{6})/", p)
    if not a: continue
    acc = a.group(1)
    try:
        with open(p, newline="", errors="replace") as f:
            r = csv.reader(f, delimiter="\t"); h = [c.strip().lower() for c in next(r)]
            col = lambda name: [i for i, c in enumerate(h) if c.startswith(name)]
            ci, fi = col("comment[cleavage agent details]"), col("comment[data file]")
            oi, li, ii = col("characteristics[organism]"), col("comment[label]"), col("comment[instrument]")
            ai, di, mi = col("comment[proteomics data acquisition method]"), col("comment[dissociation method]"), col("comment[modification parameters]")
            if not ci or not fi: continue
            per = collections.defaultdict(list)
            for row in r:
                row = row + [""] * (len(h) - len(row))
                per[row[fi[0]].strip()].append(row)
        for fn, rs in per.items():
            get = lambda idx: sorted({nt(x[i]).lower() for x in rs for i in idx if nt(x[i]).lower() not in ("", "not applicable", "not available")})
            enz = get(ci)
            if len(enz) != 1 or enz[0] not in ENZ: continue
            why = []
            org = get(oi)
            if org != ["homo sapiens"]: why.append("organism:" + ";".join(org))
            lab = get(li)
            if lab != ["label free sample"]: why.append("label:" + ";".join(lab))
            ins = get(ii)
            if not ins or not all(re.search(r"q exactive|orbitrap|exploris", x) for x in ins): why.append("instrument:" + ";".join(ins))
            acq = get(ai)
            if any(re.search(r"independent|dia|prm|srm|targeted|parallel reaction", x) for x in acq): why.append("acquisition:" + ";".join(acq))
            dis = get(di)
            if dis and dis != ["hcd"] and not all("hcd" in x or "beam-type" in x or "higher" in x for x in dis): why.append("dissociation:" + ";".join(dis))
            mods = sorted({x[i] for x in rs for i in mi if x[i].strip()})
            bad = [nt(m) for m in mods if BADMOD.search(m)]
            if bad: why.append("mod:" + ";".join(sorted(set(bad))))
            rows.append((acc, ENZ[enz[0]], fn, "ok" if not why else "|".join(why), ";".join(ins), ";".join(dis)))
    except Exception as e:
        print("ERR", p, e, file=sys.stderr)
with open(outp, "w") as f:
    f.write("accession\tprotease\tfile\tsdrf_check\tinstrument\tdissociation\n")
    for x in sorted(set(rows)):
        if x[3] == "ok": f.write("\t".join(x) + "\n")
