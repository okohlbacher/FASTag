#!/usr/bin/env python3
"""Held-out runs for -label_discovery_out (FASTag 1.13 label discovery), selected before any held-out FASTag run.

Two parts:
  A. the 172 included rows of acceptance/1.13/manifests/item08-heldout.tsv (label-free 150, SILAC 15, TMT 4,
     TMTpro/iTRAQ8 3; drawn from bigbio/sdrf-annotated-datasets 452596762d38 outside the 234 DEV PXDs; staged and
     sha256-hashed on 2026-11-08 under data:/scratch/kohlbach/fastag-heldout-1.12). -label_discovery_out was never
     run on them. (item #8 scored -label_out's label_call on them; that is a different output.) A row is kept only
     when its PXD is not among the 236 PXDs of the 256-run first evaluation.
  B. a new labelled draw from the same bigbio table (bigbio_runs.tsv, mined from 452596762d38 by
     acceptance/1.12/scripts/mine_bigbio.py), rule:
       * PXD not among: the 256 runs' PXDs, excl_chem.txt (prose-auto validation sets and corpora, gate, registry and
         benchmark PXDs), and every PXD named in any acceptance/1.12 or acceptance/1.13 manifest;
       * label class from the SDRF truth (label_truth): TMT, TMTpro, iTRAQ4, iTRAQ8, dimethyl (also
         'other:dimethyl*'); quota 6 runs each, at most 2 runs per PXD;
       * eligible run: SDRF acquisition not DIA; file name not blank/QC/standard/library/DIA/SWATH/PRM/SRM/MRM;
         enzyme truth Trypsin (incl. Trypsin/Lys-C); Thermo .raw on PRIDE, 0 < size <= 6 GiB (as #3); high-resolution
         collisional MS2 by the SDRF: the instrument is a Q Exactive, Exploris or Astral (HCD-only instruments, whatever
         the SDRF's dissociation says), or the dissociation names HCD or beam-type;
       (revision 1, before any staging: try 0 required HCD/beam-type in the dissociation column and 3 GiB; SDRFs
         annotate Q Exactive runs as 'collision-induced dissociation', so it found no dimethyl run at all);
       * within a class: PXDs sorted, shuffled with random.Random('fastag-1.13:labeldisc:heldout:<class>'), taken
         round-robin, one run per PXD per round (runs per PXD shuffled with
         random.Random('fastag-1.13:labeldisc:heldout:<class>:<PXD>')); a run with no PRIDE file is skipped (logged).
Truth: label_class = the SDRF label_truth (TMTpro and iTRAQ8 kept apart here; the scorer merges them for the
primary endpoint).
Usage: select_heldout_labeldisc.py <bigbio_runs.tsv> <excl_chem.txt> <runs256.tsv> <item08-heldout.tsv>
         <manifest dir list file> <pride cache dir> <outA.tsv> <outB.tsv>"""
import csv, json, os, random, re, sys, time, urllib.request

RUNS, EXCL, R256, I08, MANLIST, CACHE, OUTA, OUTB = sys.argv[1:9]
NAME_BAD = re.compile(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM|DIA|SWATH|PRM|MSX|targeted", re.I)
MAX = 6 * 1024**3
QUOTA, CAP = 6, 2
CLASSES = ["TMT", "TMTpro", "iTRAQ4", "iTRAQ8", "dimethyl"]


def rd(p):
    with open(p) as f:
        # comment lines start with '# '; item rows of the acceptance manifests start with '#<item>'
        return list(csv.DictReader((l for l in f if not re.match(r"#(\s|$)", l)), delimiter="\t"))


def stem(n):
    n = os.path.basename(n.replace("\\", "/")).lower()
    for e in (".raw",):
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
        if stem(n) == s and n.lower().endswith(".raw") and 0 < (f.get("fileSizeBytes") or 0) <= MAX:
            return f
    return None


def lclass(t):
    t = (t or "").strip()
    if t in ("TMT", "TMTpro", "iTRAQ4", "iTRAQ8", "dimethyl"): return t
    if t.lower().startswith("other:dimethyl"): return "dimethyl"
    return ""


def highres(r):
    d, ins = (r["dissociation"] or "").lower(), r["instrument"] or ""
    if re.search(r"q exactive|exploris|astral", ins, re.I): return True
    return "hcd" in d or "beam" in d


r256 = {r["acc"] for r in rd(R256)}
excl = set(l.strip() for l in open(EXCL) if l.strip())
man = set()
for p in (l.strip() for l in open(MANLIST) if l.strip()):
    for line in open(p, errors="replace"):
        man.update(re.findall(r"PXD\d{6}", line))

# A
outA, logA = [], []
for r in rd(I08):
    if r["include"] != "yes": continue
    if r["pxd"] in r256:
        logA.append(f"A\t{r['pxd']}\t{r['run']}\tdropped: PXD among the 256"); continue
    outA.append(dict(part="A", pxd=r["pxd"], run=r["run"], stratum=r["stratum"], instrument=r["instrument"],
                     label_truth=r["label_truth"], label_class=r["label_class"], fastag_input=r["fastag_input"],
                     fastag_input_sha256=r["fastag_input_sha256"], source="item08-heldout.tsv"))

# B
banned = r256 | excl | man
runs = {}
for r in rd(RUNS):
    a = (r["acquisition"] or "").lower()
    if "independent" in a or re.search(r"\bdia\b", a): continue
    if not r["data_file"].lower().endswith(".raw") or NAME_BAD.search(os.path.basename(r["data_file"])): continue
    if (r["enzyme_truth"] or "").lower() not in ("trypsin", "trypsin/lys-c"): continue
    c = lclass(r["label_truth"])
    if not c or not highres(r): continue
    r["cls"] = c
    runs.setdefault(r["pxd"], []).append(r)
outB, logB = [], []
for c in CLASSES:
    accs = sorted(a for a, rs in runs.items() if a not in banned and any(x["cls"] == c for x in rs))
    random.Random(f"fastag-1.13:labeldisc:heldout:{c}").shuffle(accs)
    q = {}
    for a in accs:
        rs = sorted([x for x in runs[a] if x["cls"] == c], key=lambda x: x["data_file"])
        random.Random(f"fastag-1.13:labeldisc:heldout:{c}:{a}").shuffle(rs); q[a] = rs
    got, per = 0, {}
    for rnd in range(CAP):
        for a in accs:
            if got >= QUOTA: break
            if a in {o["pxd"] for o in outB if o["label_class"] != c}: continue  # a PXD serves one class only
            while q[a]:
                x = q[a].pop(0)
                f = pfile(a, x["data_file"])
                if not f:
                    logB.append(f"B\t{c}\t{a}\t{x['data_file']}\tno PRIDE .raw <= 6 GiB"); continue
                outB.append(dict(part="B", pxd=a, run=x["run"], stratum=f"label:{c}", instrument=x["instrument"],
                                 label_truth=x["label_truth"], label_class=c, data_file=x["data_file"], file=f["fileName"],
                                 bytes=str(f.get("fileSizeBytes")), pride_sha1=f.get("checksum") or "", url=ftp(f),
                                 dissociation=x["dissociation"], mods=x["mods"], sdrf=x["sdrf"],
                                 selection=f"round {rnd + 1}; random.Random('fastag-1.13:labeldisc:heldout:{c}') over {len(accs)} PXDs"))
                got += 1; per[a] = per.get(a, 0) + 1; break
        if got >= QUOTA: break
    logB.append(f"#class\t{c}\t{got} runs from {len(per)} PXDs (pool {len(accs)} PXDs)")

for out, rows, log in ((OUTA, outA, logA), (OUTB, outB, logB)):
    with open(out, "w") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
    open(out + ".log", "w").write("\n".join(log) + "\n")
print("A", len(outA), "B", len(outB))
