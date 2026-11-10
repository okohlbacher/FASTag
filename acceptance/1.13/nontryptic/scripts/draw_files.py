#!/usr/bin/env python3
"""draw_files.py <picks.tsv> <proj dir> -> stage.tsv on stdout.
Per (project, protease): candidate files = .raw, 0.2-4 GB, name carries the protease token,
name does not match the exclusion pattern; sorted, shuffled with a fixed seed; first = chosen, second = backup."""
import csv, json, random, re, sys
TOK = {"Lys-C": r"lys[-_ ]?c(?![a-z])", "Glu-C": r"glu[-_ ]?c(?![a-z])", "Asp-N": r"asp[-_ ]?n(?![a-z])",
       "Chymotrypsin": r"chym", "Arg-C": r"arg[-_ ]?c(?![a-z])", "Lys-N": r"lys[-_ ]?n(?![a-z])"}
EXCL = r"blank|wash|negative|tma|rectex|(?<![a-z])qc(?![a-z])|tryp|ethcd|etd|(?<![a-z])cid|(?<![a-z])dia(?![a-z])"
print("run\trole\tprotease\taccession\tfile\tbytes\tpride_sha1\turl\tn_candidates")
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    p, a = r["protease"], r["accession"]
    c = {}
    for f in json.load(open(f"{sys.argv[2]}/{a}.files.json")):
        n, b = f["fileName"], f["fileSizeBytes"]
        if n.lower().endswith(".raw") and 2e8 <= b <= 4e9 and re.search(TOK[p], n, re.I) and not re.search(EXCL, n, re.I):
            url = [l["value"] for l in f["publicFileLocations"] if l["value"].startswith("ftp://")][0].replace("ftp://", "https://")
            c[n] = (b, f.get("checksum") or "-", url)
    names = sorted(c); random.Random(f"nontryptic-heldout-1.13:{p}:{a}").shuffle(names)
    for role, n in zip(("chosen", "backup"), names):
        print(r["run"], role, p, a, n, *c[n], len(names), sep="\t")
