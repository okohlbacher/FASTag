#!/usr/bin/env python3
"""FASTag 1.13 backlog item 18 (-search_engine msfragger): draw the held-out runs from PRIDE.

Fixed before any download; no FASTag run, no search and no scoring has read these files.

Candidate projects: the `qe` rows of acceptance/1.12/inputs/h2r_pride_candidates.tsv whose result is `OK_not_needed`
(they passed select_h2r_pride.py's project rule: every instrument a Q Exactive, DDA named, never DIA/targeted,
trypsin, label-free, no PTM enrichment or special chemistry, whole-cell/tissue lysate, one organism of human, mouse,
S. cerevisiae, E. coli; no run of them was downloaded by #2/#6).
Further project rules, applied here:
  - accession not in inputs/excl_pxd.tsv (build_exclusions.py: every PXD named in any origin branch of the FASTag
    repository or under output/backlog-1.13, candidate and exclusion lists themselves excepted);
  - the PRIDE v3 project record names exactly one organism and it is Homo sapiens (one search database for all
    runs: the UP000005640 file FASTag ships, data/alkylation/human.fasta.gz).
Order: accepted accessions sorted, shuffled with random.Random('fastag-1.13:#18:msfragger:qe'), read in that order.
Take: 8 projects (8 runs, one per project).
File rule (as select_census_heldout2.py): .raw files whose names have no blank/QC/wash/standard/DIA/PRM/HeLa/test/
  library, 0.2-4 GB; sorted by name, shuffled with random.Random('<seed>:<PXD>'); first = chosen, second = backup.
  The backup is staged only if the chosen file fails the post-download check (PRIDE SHA-1; MS2 in the Orbitrap
  (FTMS), HCD, >= 5000 MS2 with a charge).
Usage: select_msfragger_heldout.py <cache dir> <out dir>   (the cache holds <PXD>.project.json, <PXD>.files.json)
"""
import json, os, random, re, sys

C, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
CAND = f"{HERE}/../../../1.12/inputs/h2r_pride_candidates.tsv"
EXCL = {l.split("\t")[0].strip() for l in open(f"{HERE}/excl_pxd.tsv") if l.strip()}
SEED = "fastag-1.13:#18:msfragger:qe"
TAKE = 8
BADFILE = re.compile(r"blank|\bqc\b|_qc|qc_|wash|std|standard|(^|[_\-.])dia([_\-.]|$)|prm|hela|test|librar", re.I)

cand = []
for i, line in enumerate(open(CAND)):
    f = line.rstrip("\n").split("\t")
    if i and f[0] == "qe" and f[3] == "OK_not_needed":
        cand.append(f[1])
cand = sorted(set(cand))
random.Random(SEED).shuffle(cand)

os.makedirs(OUT, exist_ok=True)
rows, stage, taken = [], [], 0
for rank, a in enumerate(cand, 1):
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
if taken < TAKE:
    sys.exit(f"only {taken} projects")
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
