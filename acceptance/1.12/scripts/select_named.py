#!/usr/bin/env python3
"""Draw files from PXDs that an item plan names (FASTag 1.12 held-out), from cached PRIDE v3 file lists.

Rule (fixed before any held-out run; no FASTag output is read):
  * candidates = the project's raw files (Thermo .raw or a Bruker .d archive) of at most 6 GiB whose names are not
    blanks/QC/standards/libraries and not DIA/SWATH/PRM/SRM/MRM (the E7-03 name filters), and, where the spec gives
    a name pattern (the plan's scenario, e.g. PXD028735 mixtures), whose names match it;
  * files used anywhere in FASTag development or benchmarks (dev_file_stems.txt: the gate inputs, the species and
    digest run tables, public_runs.tsv, the E7-02 corpus, jpr-bench/data, /ceph/.../benchmark) are removed; if that
    leaves none, the used file stays eligible and the row says so;
  * n files are drawn with random.Random('fastag-1.12:<item>:<split>:<PXD>') from the name-sorted candidates.
Usage: select_named.py <pride cache> <dev_file_stems.txt> <spec.tsv> <out.tsv>
spec: item, split, stratum, pxd, n, name_regex ('-' = none), note
"""
import json, random, re, sys

CACHE, DEVF, SPEC, OUT = sys.argv[1:5]
R = lambda s: re.compile(s, re.I)
RAW_OK = R(r"\.(raw|d\.zip|d\.tar|d\.tar\.gz|d\.tgz)$")
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM")
NAME_NOTDDA = R(r"DIA|SWATH|PRM|SRM|MRM|MSX|SIM\b|targeted")
MAX = 6 * 1024**3
dev = set(l.strip() for l in open(DEVF) if l.strip())

def stem(n):
    n = n.lower()
    for e in (".d.zip", ".d.tar.gz", ".d.tgz", ".d.tar", ".raw"):
        if n.endswith(e): return n[: -len(e)]
    return n

def ftp(f):
    for l in f.get("publicFileLocations") or []:
        if l.get("name") == "FTP Protocol": return l.get("value", "").replace("ftp://", "https://")
    return ""

rows = []
for l in open(SPEC):
    if l.startswith("#item") or l.startswith("##") or not l.strip(): continue
    item, split, stratum, pxd, n, rx, note = l.rstrip("\n").split("\t")
    fs = json.load(open(f"{CACHE}/{pxd}.files.json"))
    cand = [f for f in fs if RAW_OK.search(f["fileName"]) and 0 < (f.get("fileSizeBytes") or 0) <= MAX
            and not NAME_BAD.search(f["fileName"]) and not NAME_NOTDDA.search(f["fileName"])
            and (rx == "-" or R(rx).search(f["fileName"]))]
    fresh = [f for f in cand if stem(f["fileName"]) not in dev]
    used_note = "" if fresh else ("; ONLY development-used files exist: one of them is taken" if cand else "")
    pool = sorted(fresh or cand, key=lambda f: f["fileName"])
    seed = f"fastag-1.12:{item}:{split}:{pxd}"
    random.Random(seed).shuffle(pool)
    for f in pool[: int(n)]:
        rows.append([item, split, stratum, pxd, f["fileName"], str(f.get("fileSizeBytes")), f.get("checksum") or "",
                     ftp(f), f"random.Random('{seed}') over {len(fresh or cand)} of {len(cand)} name-eligible "
                     f"({len(cand) - len(fresh)} development-used removed){used_note}; {note}"])
    if len(pool) < int(n):
        rows.append([item, split, stratum, pxd, "", "", "", "", f"SHORT: {len(pool)} of {n} eligible files; {note}"])
with open(OUT, "w") as o:
    o.write("item\tsplit\tstratum\tpxd\tfile\tbytes\tpride_sha1\turl\tselection\n")
    for r in rows: o.write("\t".join(r) + "\n")
print(OUT, len(rows))
