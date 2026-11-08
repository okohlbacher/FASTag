#!/usr/bin/env python3
"""#3 replacement rule (amendment 2026-11-08, before any run, decided from file formats only): a drawn run whose file
cannot be converted on Linux (SCIEX .wiff or Agilent/old Bruker data inside a zip, or no MS data) is replaced within
its own stratum: the stratum's seeded PXD order (random.Random('fastag-1.12:#3:<stratum>'), as select_chem.py) is
continued after the PXDs already used by ANY stratum of the first draw, skipping the unconvertible PXDs, one run per
PXD (run order random.Random('fastag-1.12:#3:<stratum>:<PXD>')), until the stratum has its first-draw count again.
All other rows of the first draw stay as they are.
Usage: replace_chem.py <bigbio_runs.tsv> <excl_chem.txt> <chem_heldout.tsv> <bad_pxd.tsv> <pride cache> <out.tsv>"""
import csv, os, random, re, sys
sys.argv = sys.argv  # noqa
RUNS, EXCL, FIRST, BAD, CACHE, OUT = sys.argv[1:7]
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "select_chem.py")).read()
# reuse the helper definitions of select_chem.py (stem, pride, ftp, pfile, CLS, NAME_BAD, NONCAM, rd)
ns = {"__name__": "select_chem_helpers", "sys": sys}
exec(src[src.index("import csv"):src.index("excl = set(")].replace("RUNS, EXCL, SPEC, SP1, CACHE, OUT3, OUT1 = sys.argv[1:8]", "CACHE = %r" % CACHE), ns)
first = list(csv.DictReader((l for l in open(FIRST) if not l.startswith("# ")), delimiter="\t"))
bad = {l.split("\t")[0] for l in open(BAD) if l.strip()}
excl = set(l.strip() for l in open(EXCL) if l.strip())
used = {r["pxd"] for r in first}
runs = {}
for r in ns["rd"](RUNS):
    a = r["acquisition"].lower()
    if "independent" in a or re.search(r"\bdia\b", a): continue
    if not re.search(r"\.(raw|d|d\.zip|zip)$", r["data_file"], re.I) or ns["NAME_BAD"].search(os.path.basename(r["data_file"])): continue
    r["cls"] = ns["CLS"].get((r["enzyme_truth"] or "").lower(), "")
    runs.setdefault(r["pxd"], []).append(r)
PRED = {"ddapasef": lambda x: x["cls"] != "" and re.search(r"tims", x["instrument"], re.I) is not None,
        "alkylation_noncam": lambda x: x["cls"] != "" and x["alk_truth"] in ns["NONCAM"],
        "tryptic": lambda x: x["cls"] == "Trypsin"}
keep = [r for r in first if r["pxd"] not in bad]
out = list(keep)
for name in sorted({r["stratum"] for r in first if r["pxd"] in bad}):
    need = sum(1 for r in first if r["stratum"] == name) - sum(1 for r in keep if r["stratum"] == name)
    pred = PRED.get(name) or (lambda x, c=name.split(":", 1)[1]: x["cls"] == c)
    accs = sorted(a for a, rs in runs.items() if a not in excl and any(pred(x) for x in rs))
    random.Random(f"fastag-1.12:#3:{name}").shuffle(accs)
    for a in accs:
        if need <= 0: break
        if a in used or a in bad: continue
        rs = sorted([x for x in runs[a] if pred(x)], key=lambda x: x["data_file"])
        random.Random(f"fastag-1.12:#3:{name}:{a}").shuffle(rs)
        for x in rs:
            f = ns["pfile"](a, x["data_file"])
            if f:
                out.append(dict(item="#3", split="heldout", stratum=name, pxd=a, run=x["run"], data_file=x["data_file"],
                                file=f["fileName"], bytes=str(f.get("fileSizeBytes")), pride_sha1=f.get("checksum") or "",
                                url=ns["ftp"](f), enzyme_truth=x["cls"], alk_truth=x["alk_truth"], label_truth=x["label_truth"],
                                instrument=x["instrument"], sdrf=x["sdrf"], organisms=x["organisms"],
                                selection=f"REPLACEMENT (amendment): next PXD of random.Random('fastag-1.12:#3:{name}')"))
                used.add(a); need -= 1; break
    print(name, "replaced, still missing", need)
with open(OUT, "w") as f:
    w = csv.DictWriter(f, fieldnames=list(first[0].keys()), delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(out)
print("rows", len(out))
