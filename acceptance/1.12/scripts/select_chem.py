#!/usr/bin/env python3
"""#3 chemistry held-out runs and the #1 extra multi-organism runs, mined from bigbio/sdrf-annotated-datasets
at 452596762d38f46924b5719aae9969c467c7fa17 (2026-11-08; newer than the 70bd353 commit of the DEV truth).

#3 rule (PLAN-organism-chemistry #3 'Held-out protocol' / 'Validation data'; fixed before any held-out run):
  * PXDs NOT among the 234 PXDs of sdrf_truth_runs.tsv, the prose-auto validation sets and corpora, the 37 species
    DEV PXDs (and the E7-03 exclusion list, which contains the prose-auto sets, gate, registry and benchmark PXDs);
  * run = one comment[data file] of an SDRF; truth per run from fastag_bench.sdrftruth (as for the DEV table);
    eligible when: the SDRF acquisition is not DIA; the file name is not DIA/SWATH/PRM/SRM/MRM, blank, QC, standard
    or library; the file is a Thermo .raw or a Bruker .d on PRIDE (size <= 6 GiB); the enzyme truth maps to one
    class (Trypsin incl. 'Trypsin/Lys-C', Lys-C, Arg-C, Chymotrypsin, Glu-C incl. V8, Asp-N, unspecific,
    LysargiNase; 'mixed', CNBr, thermolysin, Lys-N dropped);
  * strata, drawn in this order, each PXD used in one stratum only, at most 3 runs per PXD per class:
      nontryptic:<class> for Lys-C, Arg-C, Chymotrypsin, Glu-C, Asp-N, unspecific - 15 runs each (gating needs
        >= 15 runs from >= 3 PXDs; fewer = descriptive only); LysargiNase - up to 6 runs (descriptive only);
      ddapasef - 10 runs (comment[instrument] timsTOF), any enzyme;
      alkylation_noncam - 15 runs with alkylation truth none or a non-CAM reagent;
      tryptic - 60 runs (Trypsin), filled last;
    within a stratum: PXDs sorted, shuffled with random.Random('fastag-1.12:#3:<stratum>'), taken round-robin,
    one run per PXD per round (runs per PXD shuffled with random.Random('fastag-1.12:#3:<stratum>:<PXD>')),
    a run without a PRIDE file is skipped (recorded).
#1 extra multi-organism rule (PLAN-organism-chemistry #1: 'further xenograft and host-pathogen PXDs come from SDRF
  fields with two organisms'): runs whose SDRF row names >= 2 organisms, PXD not a species DEV PXD and not in the
  #1 pool or the #3 draw, SDRF not DIA, instrument not ion-trap-only (MS2 checked after conversion); PXDs shuffled with
  random.Random('fastag-1.12:#1:multi_bigbio'), one run per PXD, 5 PXDs.
Usage: select_chem.py <bigbio_runs.tsv> <excl_chem.txt> <species_runs.tsv> <species_heldout.tsv> <pride cache> <out3.tsv> <out1.tsv>
"""
import csv, json, os, random, re, sys, time, urllib.request

RUNS, EXCL, SPEC, SP1, CACHE, OUT3, OUT1 = sys.argv[1:8]
R = lambda s: re.compile(s, re.I)
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM|DIA|SWATH|PRM|MSX|targeted")
MAX = 6 * 1024**3
CLS = {"trypsin": "Trypsin", "trypsin/lys-c": "Trypsin", "lys-c": "Lys-C", "arg-c": "Arg-C", "argc": "Arg-C",
       "chymotrypsin": "Chymotrypsin", "glu-c": "Glu-C", "v8-de": "Glu-C", "v8-e": "Glu-C", "asp-n": "Asp-N",
       "unspecific": "unspecific", "no-enzyme/unspecific cleavage": "unspecific", "lysarginase": "LysargiNase"}
NONCAM = {"none", "Propionamide", "Methylthio", "Nethylmaleimide", "Pyridylethyl", "Carboxymethyl"}

def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("#")), delimiter="\t"))

def stem(n):
    n = os.path.basename(n.replace("\\", "/")).lower()
    for e in (".d.zip", ".d.tar.gz", ".d.tgz", ".d.tar", ".zip", ".raw", ".d"):
        if n.endswith(e): return n[: -len(e)]
    return n

def pride(acc):
    p = f"{CACHE}/{acc}.files.json"
    if os.path.exists(p): return json.load(open(p))
    for a in range(4):
        try:
            with urllib.request.urlopen(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{acc}/files/all", timeout=120) as r:
                d = json.load(r)
            json.dump(d, open(p, "w")); return d
        except Exception:
            time.sleep(4 * (a + 1))
    return []

def ftp(f):
    for l in f.get("publicFileLocations") or []:
        if l.get("name") == "FTP Protocol": return l.get("value", "").replace("ftp://", "https://")
    return ""

def pfile(acc, data_file):
    s = stem(data_file)
    for f in pride(acc):
        n = f["fileName"]
        if stem(n) == s and re.search(r"\.(raw|d\.zip|zip|d\.tar|d\.tar\.gz|d\.tgz)$", n, re.I) \
                and 0 < (f.get("fileSizeBytes") or 0) <= MAX:
            return f
    return None

excl = set(l.strip() for l in open(EXCL) if l.strip())
dev1 = {r["pxd"] for r in rd(SPEC)}
pool1 = {r["pxd"] for r in rd(SP1)}
runs = {}
for r in rd(RUNS):
    a = r["acquisition"].lower()
    if "independent" in a or re.search(r"\bdia\b", a): continue
    if not re.search(r"\.(raw|d|d\.zip|zip)$", r["data_file"], re.I) or NAME_BAD.search(os.path.basename(r["data_file"])): continue
    r["cls"] = CLS.get((r["enzyme_truth"] or "").lower(), "")
    runs.setdefault(r["pxd"], []).append(r)

used, out3, log = set(), [], []
def stratum(name, quota, pred, cap=3):
    accs = sorted(a for a, rs in runs.items() if a not in excl and a not in used and any(pred(x) for x in rs))
    random.Random(f"fastag-1.12:#3:{name}").shuffle(accs)
    queue = {}
    for a in accs:
        rs = sorted([x for x in runs[a] if pred(x)], key=lambda x: x["data_file"])
        random.Random(f"fastag-1.12:#3:{name}:{a}").shuffle(rs); queue[a] = rs
    got, per = 0, {}
    for rnd in range(cap):
        for a in accs:
            if got >= quota: break
            while queue[a]:
                x = queue[a].pop(0)
                f = pfile(a, x["data_file"])
                if not f:
                    log.append(f"{name}\t{a}\t{x['data_file']}\tno PRIDE raw file <= 6 GiB"); continue
                out3.append(dict(item="#3", split="heldout", stratum=name, pxd=a, run=x["run"], data_file=x["data_file"],
                                 file=f["fileName"], bytes=str(f.get("fileSizeBytes")), pride_sha1=f.get("checksum") or "",
                                 url=ftp(f), enzyme_truth=x["cls"], alk_truth=x["alk_truth"], label_truth=x["label_truth"],
                                 instrument=x["instrument"], sdrf=x["sdrf"], organisms=x["organisms"],
                                 selection=f"round {rnd + 1}; random.Random('fastag-1.12:#3:{name}') over {len(accs)} PXDs"))
                got += 1; per[a] = per.get(a, 0) + 1; break
        if got >= quota: break
    for a in per: used.add(a)
    log.append(f"#stratum\t{name}\t{got} runs from {len(per)} PXDs (pool {len(accs)} PXDs)")

for c in ("Lys-C", "Arg-C", "Chymotrypsin", "Glu-C", "Asp-N", "unspecific"):
    stratum(f"nontryptic:{c}", 15, lambda x, c=c: x["cls"] == c)
stratum("nontryptic:LysargiNase", 6, lambda x: x["cls"] == "LysargiNase")
stratum("ddapasef", 10, lambda x: x["cls"] != "" and re.search(r"tims", x["instrument"], re.I) is not None, cap=1)
stratum("alkylation_noncam", 15, lambda x: x["cls"] != "" and x["alk_truth"] in NONCAM, cap=1)
stratum("tryptic", 60, lambda x: x["cls"] == "Trypsin", cap=1)

cols = list(out3[0].keys())
with open(OUT3, "w") as f:
    w = csv.DictWriter(f, fieldnames=cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(out3)
open(OUT3 + ".log", "w").write("\n".join(log) + "\n")

# #1 extra multi-organism
used1 = used | pool1 | dev1 | excl
accs = sorted(a for a, rs in runs.items() if a not in used1 and a not in dev1
              and any(len([o for o in x["organisms"].split(";") if o and o not in ("not available", "not applicable")]) >= 2
                      and not re.fullmatch(r"(LTQ|LTQ XL|LTQ Velos|Velos Pro|LCQ.*)", x["instrument"] or "") for x in rs))
random.Random("fastag-1.12:#1:multi_bigbio").shuffle(accs)
out1, l1 = [], []
for a in accs:
    if len(out1) >= 5: break
    rs = sorted([x for x in runs[a] if len(x["organisms"].split(";")) >= 2], key=lambda x: x["data_file"])
    random.Random(f"fastag-1.12:#1:multi_bigbio:{a}").shuffle(rs)
    for x in rs:
        f = pfile(a, x["data_file"])
        if f:
            out1.append(dict(item="#1", split="heldout", stratum="multi_bigbio", pxd=a, run=x["run"], data_file=x["data_file"],
                             file=f["fileName"], bytes=str(f.get("fileSizeBytes")), pride_sha1=f.get("checksum") or "",
                             url=ftp(f), organisms=x["organisms"], instrument=x["instrument"], sdrf=x["sdrf"],
                             selection=f"random.Random('fastag-1.12:#1:multi_bigbio') over {len(accs)} PXDs"))
            break
    else:
        l1.append(f"{a}\tno PRIDE raw file")
with open(OUT1, "w") as f:
    w = csv.DictWriter(f, fieldnames=list(out1[0].keys()), delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(out1)
open(OUT1 + ".log", "w").write("\n".join(l1) + "\n")
print("#3", len(out3), "#1 extra", len(out1))
