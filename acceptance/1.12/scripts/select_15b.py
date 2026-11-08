#!/usr/bin/env python3
"""#15B held-out split (PLAN-data-types #15 phase B; registry E15B-03): H1 = 2 tryptic ETD/EThcD DDA sets
(Fusion/Lumos/Eclipse), H2 = 1 reserve set, from PRIDE, chosen by dissociation metadata, recorded before any c/z run.

Rule (fixed before drawing; no FASTag output is read):
  * pool = PRIDE projects (E7-03 catalog of all v3 /projects; COMPLETE or PARTIAL) whose instruments name an
    Orbitrap Fusion, Fusion Lumos or Eclipse; whose title/description/protocols/keywords name ETD, EThcD, ETciD or
    electron-transfer dissociation, and trypsin/tryptic; and that do not name DIA/SWATH/PRM/SRM, cross-linking,
    top-down/intact/native MS, HLA/MHC/immunopeptidomics, glycoproteomics or non-tryptic main proteases
    (chymotrypsin, elastase, Glu-C, Asp-N, Lys-N, pepsin, proteinase K) - c/z truth is a standard tryptic MSFragger search;
  * excluded accessions: #15 development and robustness sets (PXD060724, PXD010783, PXD004732), PXD064573
    (screened out in E15B-03), and the E7-03 exclusion list (every accession used in FASTag development, the
    prose-auto corpora, the gate, the registry, /ceph/.../benchmark) plus the E7-03 sample;
  * the pool is sorted by accession and shuffled with random.Random('fastag-1.12:#15B'); projects are taken in
    that order; per project up to 3 raw files (Thermo .raw <= 6 GiB, E7-03 name filters; names saying ETD/EThcD
    preferred when the project has them) drawn with random.Random('fastag-1.12:#15B:<PXD>');
  * a project is accepted only if the first drawn file's MS2 include electron activation (ETD/EThcD in the first 50
    MS2 of its TRFP mzML); otherwise the next project is taken (recorded). Accepted projects 1-2 = H1, 3 = H2.
This script writes the ordered candidate list; stage + verification is done by verify_15b.sh.
Usage: select_15b.py <catalog.jsonl> <exclude.txt> <e703_manifest.tsv> <pride cache> <out.tsv> [n_projects]
"""
import json, os, random, re, sys, urllib.request, time

CAT, EXCL, E703, CACHE, OUT = sys.argv[1:6]
N = int(sys.argv[6]) if len(sys.argv) > 6 else 12
R = lambda s: re.compile(s, re.I)
I_OK = R(r"Fusion|Lumos|Eclipse")
ETD = R(r"\bETD\b|EThcD|ETciD|electron[- ]transfer dissociation")
TRYP = R(r"trypsin|tryptic")
BAD = R(r"\bDIA\b|data[- ]independent|SWATH|\bPRM\b|\bSRM\b|cross-?link|\bXL-?MS|top[- ]down|intact protein|native MS|"
        r"\bHLA\b|\bMHC\b|immunopeptid|glyco|chymotryp|elastase|Glu-?C\b|Asp-?N\b|Lys-?N\b|pepsin|proteinase K")
RAW_OK = R(r"\.raw$")
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM")
NAME_NOTDDA = R(r"DIA|SWATH|PRM|SRM|MRM|MSX|SIM\b|targeted")
NAME_ETD = R(r"ETD|EThcD|ETciD")
MAX = 6 * 1024**3
DEV = {"PXD060724", "PXD010783", "PXD004732", "PXD064573"}

def text(p):
    return " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                                     "dataProcessingProtocol", "keywords"))

def files(acc):
    p = f"{CACHE}/{acc}.files.json"
    if os.path.exists(p): return json.load(open(p))
    for a in range(4):
        try:
            with urllib.request.urlopen(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{acc}/files/all", timeout=120) as r:
                d = json.load(r)
            json.dump(d, open(p, "w")); return d
        except Exception:
            time.sleep(5 * (a + 1))
    return None

def ftp(f):
    for l in f.get("publicFileLocations") or []:
        if l.get("name") == "FTP Protocol": return l.get("value", "").replace("ftp://", "https://")
    return ""

excl = set(l.strip() for l in open(EXCL) if l.strip()) | DEV
excl |= {l.split("\t")[3] for l in open(E703) if l.startswith("E7-03.")}
pool = []
for l in open(CAT):
    p = json.loads(l); a = p["accession"]
    if not a.startswith("PXD") or a in excl or (p.get("submissionType") or "") not in ("COMPLETE", "PARTIAL"): continue
    t, i = text(p), str(p.get("instruments") or "")
    if I_OK.search(i) and ETD.search(t) and TRYP.search(t) and not BAD.search(t):
        pool.append(p)
pool.sort(key=lambda p: p["accession"])
random.Random("fastag-1.12:#15B").shuffle(pool)
with open(OUT, "w") as o:
    o.write("order\tpxd\tfile\tbytes\tpride_sha1\turl\tnote\ttitle\n")
    k = 0
    for p in pool:
        if k >= N: break
        fs = files(p["accession"])
        if not fs:
            o.write(f"-\t{p['accession']}\t\t\t\t\tskip: no file list\t{p['title'][:120]}\n"); continue
        c = [f for f in fs if RAW_OK.search(f["fileName"]) and 0 < (f.get("fileSizeBytes") or 0) <= MAX
             and not NAME_BAD.search(f["fileName"]) and not NAME_NOTDDA.search(f["fileName"])]
        named = [f for f in c if NAME_ETD.search(f["fileName"])]
        c = sorted(named or c, key=lambda f: f["fileName"])
        if not c:
            o.write(f"-\t{p['accession']}\t\t\t\t\tskip: no eligible raw file\t{p['title'][:120]}\n"); continue
        random.Random(f"fastag-1.12:#15B:{p['accession']}").shuffle(c)
        k += 1
        for f in c[:3]:
            o.write("\t".join([str(k), p["accession"], f["fileName"], str(f.get("fileSizeBytes")), f.get("checksum") or "-",
                               ftp(f), f"pool {len(pool)}; {len(c)} eligible files" + ("; ETD-named" if named else ""),
                               " ".join(p["title"].split())[:120]]) + "\n")
print("pool", len(pool))
