#!/usr/bin/env python3
"""FASTag post-1.15 held-out test of calibrate_mass 2 in the MSFragger export (msfcalib): draw the runs.

Fixed before any download; no FASTag run, no search and no scoring has read these files.
Same rules as acceptance/1.14/exactonly/inputs/select_exactonly.py (branch acc114/exactonly); changed: seed, exclusion
list (excl_pxd.tsv of this test), the pool rule for a short pool.

Candidate projects: the `qe` rows of acceptance/1.12/inputs/h2r_pride_candidates.tsv (copy beside this script) whose
result is `OK_not_needed` (Q Exactive only, DDA, trypsin, label-free, no enrichment, lysate, one organism).
Project rules: accession not in excl_pxd.tsv (build_exclusions.py); the PRIDE v3 project record names exactly one
organism and it is Homo sapiens.
Order: accepted accessions sorted, shuffled with random.Random(SEED), read in that order. Take: 10 projects.
Short pool: fewer than 10 projects with an eligible file -> all of them, if at least 6; fewer than 6 -> the `astral`
  rows (the next Orbitrap DDA class of the pool file) with the same filters, shuffled with random.Random(SEED +
  ':astral'), are read after the qe rows until 10 are taken; still fewer than 6 -> no draw (exit 2).
File rule: .raw files whose names have no blank/QC/wash/standard/DIA/PRM/HeLa/test/library, 0.2-4 GB; sorted by
  name, shuffled with random.Random('<seed>:<PXD>'); first = chosen, second = backup.
Usage: select_msfcalib.py <cache dir> <out dir>   (the cache holds <PXD>.project.json, <PXD>.files.json)
"""
import json, os, random, re, sys

C, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
CAND = f"{HERE}/h2r_pride_candidates.tsv"
EXCL = {l.split("\t")[0].strip() for l in open(f"{HERE}/excl_pxd.tsv") if l.strip()}
SEED = "fastag-post-1.15:msfcalib:qe"
MIN_TAKE = 6
TAKE = 10
BADFILE = re.compile(r"blank|\bqc\b|_qc|qc_|wash|std|standard|(^|[_\-.])dia([_\-.]|$)|prm|hela|test|librar", re.I)

def pool(cls):
    out = []
    for i, line in enumerate(open(CAND)):
        f = line.rstrip("\n").split("\t")
        if i and f[0] == cls and f[3] == "OK_not_needed":
            out.append(f[1])
    return sorted(set(out))
cand = pool("qe")
random.Random(SEED).shuffle(cand)
wide = [a for a in pool("astral") if a not in cand]
random.Random(SEED + ":astral").shuffle(wide)

os.makedirs(OUT, exist_ok=True)
rows, stage, taken = [], [], 0
def eligible_qe():   # counted from metadata only, before the draw is read
    n = 0
    for a in cand:
        if a in EXCL: continue
        p = json.load(open(f"{C}/{a}.project.json"))
        orgs = sorted({(o.get("name") or "").strip().lower() for o in p.get("organisms") or []})
        if len(orgs) != 1 or not orgs[0].startswith("homo sapiens"): continue
        fl = json.load(open(f"{C}/{a}.files.json"))
        n += any(x["fileName"].lower().endswith(".raw") and not BADFILE.search(x["fileName"])
                 and 0.2e9 <= x["fileSizeBytes"] <= 4e9 for x in fl)
    return n
n_qe = eligible_qe()
order = cand + (wide if n_qe < MIN_TAKE else [])
print(f"eligible qe projects: {n_qe}; pool widened to astral: {n_qe < MIN_TAKE}", file=sys.stderr)
for rank, a in enumerate(order, 1):
    if taken >= TAKE:
        rows.append((a, rank, "not_needed", "")); continue
    if a in EXCL:
        rows.append((a, rank, "excluded_used", "")); continue
    pj = f"{C}/{a}.project.json"
    if not os.path.exists(pj):
        sys.exit(f"missing {pj}: fetch it first (the draw reads the cache only)")
    p = json.load(open(pj))
    orgs = sorted({(o.get("name") or "").strip().lower() for o in p.get("organisms") or []})
    if len(orgs) != 1 or not orgs[0].startswith("homo sapiens"):  # PRIDE writes 'Homo sapiens (human)'
        rows.append((a, rank, "organism", ";".join(orgs))); continue
    fl = json.load(open(f"{C}/{a}.files.json"))
    el = sorted((x for x in fl if x["fileName"].lower().endswith(".raw") and not BADFILE.search(x["fileName"])
                 and 0.2e9 <= x["fileSizeBytes"] <= 4e9), key=lambda x: x["fileName"])
    if not el:
        rows.append((a, rank, "no_eligible_file", "")); continue
    random.Random(f"{SEED}:{a}").shuffle(el)
    taken += 1
    rows.append((a, rank, "TAKEN", f"{len(el)} eligible files; chosen {el[0]['fileName']}"))
    for role, x in (("chosen", el[0]), ("backup", el[1] if len(el) > 1 else None)):
        if x is None:
            continue
        url = next(l["value"] for l in x["publicFileLocations"] if l["name"] == "FTP Protocol")
        url = url.replace("ftp://ftp.pride.ebi.ac.uk/", "https://ftp.pride.ebi.ac.uk/")
        stage.append((role, a, x["fileName"], x["fileSizeBytes"], x.get("checksum") or "-", url))
if taken < MIN_TAKE:
    print(f"only {taken} projects (< {MIN_TAKE}): no draw", file=sys.stderr); sys.exit(2)
with open(f"{OUT}/draw.tsv", "w") as f:
    f.write("accession\tdraw_rank\tresult\tnote\n")
    for r in rows:
        f.write("\t".join(map(str, r)) + "\n")
with open(f"{OUT}/stage.tsv", "w") as f:
    f.write("role\taccession\tfile\tbytes\tpride_sha1\turl\n")
    for r in stage:
        f.write("\t".join(map(str, r)) + "\n")
for r in rows:
    if r[2] != "not_needed":
        print(*r, sep="\t")
