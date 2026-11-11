#!/usr/bin/env python3
"""E7-03 step 2: draw the fresh PRIDE release-test sample for FASTag #7 (raw-DIA refusal).

Rule (validation-registry E7-03, PLAN-data-types item #7 "Release test"):
  a fresh public PRIDE set, unseen by E7-02, sampled by instrument class;
  >= 150 DDA/PRM/pseudo-DDA files (WWA-DDA and SureQuant/inclusion-list included),
  >= 40 DIA files covering Orbitrap DIA, Astral narrow-window, diaPASEF, SWATH/variable.
Procedure (fixed before drawing):
  * catalog = every PRIDE project (v3 /projects), COMPLETE or PARTIAL, published;
  * excluded = every accession named in the E7-02 inputs, the prose-auto corpora and
    lists, the FASTag gate and validation registry, and /ceph/.../benchmark;
  * each project goes to at most one stratum by its title, keywords, description and
    instruments (regexes below; DIA strata first, then targeted, then DDA by instrument class);
  * per stratum the projects are shuffled with random.Random(SEED + stratum index) and taken in
    that order; per project one file is drawn the same way among its raw files (Thermo .raw,
    Bruker .d archives, SCIEX .wiff with .wiff.scan, or mzML for SCIEX) of at most MAX_BYTES,
    whose name does not contradict the stratum; a project without such a file is skipped
    (recorded) and the next one is taken; one file per project.
Output: manifest.tsv (no download here; sha256 are added by fetch.sh).
"""
import json, random, re, sys, urllib.request, time

SEED = 20261110
MAX_BYTES = int(2.5 * 1024**3)
CAT, EXCL, OUT, LOG = sys.argv[1:5]

QUOTA = [  # (stratum, class, n)
    ("DIA_orbitrap", "DIA", 45),
    ("DIA_astral", "DIA", 12),
    ("PRM", "nonDIA", 8),
    ("WWA_DDA", "nonDIA", 6),
    ("DDA_qexactive", "nonDIA", 14),
    ("DDA_exploris", "nonDIA", 14),
    ("DDA_tribrid", "nonDIA", 14),
    ("DDA_astral", "nonDIA", 14),
]

def text(p):
    kw = " ".join(p.get("keywords") or [])
    return " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                                     "dataProcessingProtocol")) + " " + kw

def instr(p):
    return " | ".join(i.get("name", "") for i in (p.get("instruments") or []))

R = lambda s: re.compile(s, re.I)
DIA_T = R(r"\bDIA\b|data[- ]independent|\bSWATH|diaPASEF|dia-PASEF|\bMSX\b|\bpSMART\b")
SWATH_T = R(r"\bSWATH")
DIAPASEF_T = R(r"diaPASEF|dia-PASEF")
PRM_T = R(r"\bPRM\b|parallel reaction monitoring")
SQ_T = R(r"SureQuant|inclusion list|internal standard triggered")
WWA_T = R(r"\bWWA\b|wide[- ]window acquisition|wide isolation window")
SRM_T = R(r"\bSRM\b|\bMRM\b|selected reaction monitoring|multiple reaction monitoring")
DDA_T = R(r"\bDDA\b|data[- ]dependent|shotgun|\bTop ?\d+\b")
I_ASTRAL = R(r"Astral")
I_TIMS = R(r"timsTOF|tims ?TOF")
I_SCIEX = R(r"TripleTOF|Triple TOF|ZenoTOF|X500|SCIEX|QSTAR|5600|6600|7600")
I_QTOF = R(r"TripleTOF|Triple TOF|ZenoTOF|X500|Synapt|maXis|impact|Q-TOF|QTOF|6600|5600|Xevo")
I_QE = R(r"Q Exactive")
I_EXPL = R(r"Exploris")
I_TRIB = R(r"Fusion|Lumos|Eclipse|Ascend")
I_ORBI = R(r"Q Exactive|Exploris|Fusion|Lumos|Eclipse|Ascend|Orbitrap")
I_IT = R(r"LTQ|Velos|Elite|Orbitrap XL|Orbitrap Discovery|amaZon|HCTultra|ion trap")

def stratum(p):
    t, i = text(p), instr(p)
    dia, prm, sq, wwa, srm = DIA_T.search(t), PRM_T.search(t), SQ_T.search(t), WWA_T.search(t), SRM_T.search(t)
    if dia:
        if SWATH_T.search(t) and I_SCIEX.search(i): return "DIA_swath"
        if DIAPASEF_T.search(t) and I_TIMS.search(i): return "DIA_diapasef"
        if I_ASTRAL.search(i) and not prm and not wwa: return "DIA_astral"
        if I_ORBI.search(i) and not I_ASTRAL.search(i) and not I_TIMS.search(i) and not I_SCIEX.search(i): return "DIA_orbitrap"
        return None  # DIA text without a clean instrument class: not used for DDA either
    if sq: return "SureQuant_inclusion"
    if prm and not srm: return "PRM"
    if wwa: return "WWA_DDA"
    if srm: return None
    # DDA by instrument class (a single instrument class only)
    classes = []
    if I_ASTRAL.search(i): classes.append("DDA_astral")
    elif I_EXPL.search(i): classes.append("DDA_exploris")
    elif I_TRIB.search(i): classes.append("DDA_tribrid")
    elif I_QE.search(i): classes.append("DDA_qexactive")
    if I_TIMS.search(i): classes.append("DDA_ddapasef")
    if I_QTOF.search(i) and not I_TIMS.search(i): classes.append("DDA_qtof")
    if I_IT.search(i) and not classes: classes.append("DDA_iontrap_hybrid")
    if len(classes) != 1: return None
    c = classes[0]
    if c == "DDA_ddapasef" and not R(r"ddaPASEF|dda-PASEF|\bPASEF\b|\bDDA\b|data[- ]dependent").search(t): return None
    return c

RAW_OK = R(r"\.raw$")
NAME_DIA = R(r"DIA|SWATH|MSX|window|GPF")
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM")
NAME_NOTDDA = R(r"DIA|SWATH|PRM|SRM|MRM|MSX|SIM\b|targeted")

def files(acc):
    out, page = [], 0
    while True:
        u = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects/%s/files?pageSize=100&page=%d" % (acc, page)
        for a in range(5):
            try:
                with urllib.request.urlopen(u, timeout=120) as r:
                    d = json.load(r)
                break
            except Exception:
                time.sleep(5 * (a + 1))
        else:
            return None
        if not d: break
        out += d
        if len(d) < 100 or page > 60: break
        page += 1
    return out

def ftp(f):
    for l in f.get("publicFileLocations") or []:
        if l.get("name") == "FTP Protocol": return l.get("value")
    return ""

def pick(acc, st, rng, log):
    fs = files(acc)
    if fs is None:
        log.write("%s\t%s\tskip\tfile listing failed\n" % (acc, st)); return None
    by = {f["fileName"]: f for f in fs}
    cand = []
    for f in fs:
        n, sz = f["fileName"], f.get("fileSizeBytes") or 0
        if not RAW_OK.search(n) or n.lower().endswith(".wiff.scan"): continue
        if R(r"\.mzML(\.gz)?$").search(n) and st not in ("DIA_swath", "DDA_qtof"): continue
        extra = []
        if n.lower().endswith(".wiff"):
            sc = by.get(n + ".scan")
            if not sc: continue
            extra = [sc]
        tot = sz + sum(x.get("fileSizeBytes") or 0 for x in extra)
        if tot <= 0 or tot > MAX_BYTES: continue
        if NAME_BAD.search(n): continue
        if st.startswith("DIA"):
            pass
        elif NAME_NOTDDA.search(n) and st.startswith("DDA"):
            continue
        cand.append((n, f, extra, tot))
    if st.startswith("DIA"):  # a mixed project: prefer names that say DIA
        named = [c for c in cand if NAME_DIA.search(c[0])]
        if named: cand = named
    if st in ("PRM", "SureQuant_inclusion", "WWA_DDA"):
        key = {"PRM": R(r"PRM|target"), "SureQuant_inclusion": R(r"SQ|SureQuant|incl|target"),
               "WWA_DDA": R(r"WWA|wide|DDA")}[st]
        named = [c for c in cand if key.search(c[0])]
        if named: cand = named
    if not cand:
        log.write("%s\t%s\tskip\tno usable raw file (format, size <= 6 GiB, name)\n" % (acc, st)); return None
    cand.sort(key=lambda c: c[0])
    return rng.choice(cand)

def main():
    excl = set(l.strip() for l in open(EXCL) if l.strip())
    projs = [json.loads(l) for l in open(CAT)]
    by_st = {}
    for p in projs:
        a = p["accession"]
        if not a.startswith("PXD") or a in excl: continue
        if (p.get("submissionType") or "") not in ("COMPLETE", "PARTIAL"): continue
        s = stratum(p)
        if s: by_st.setdefault(s, []).append(p)
    log = open(LOG, "w")
    for s, _, n in QUOTA:
        log.write("#pool\t%s\t%d projects\n" % (s, len(by_st.get(s, []))))
    with open(OUT, "w") as o:
        o.write("id\tstratum\tclass\tpxd\tinstrument\tfile\tsize_bytes\tpride_sha1\tftp\textra_files\tproject_title\n")
        for k, (s, cls, n) in enumerate(QUOTA):
            pool = sorted(by_st.get(s, []), key=lambda p: p["accession"])
            rng = random.Random(SEED + k)
            rng.shuffle(pool)
            got = 0
            for p in pool:
                if got >= n: break
                c = pick(p["accession"], s, random.Random("%d:%s" % (SEED, p["accession"])), log)
                if not c: continue
                name, f, extra, tot = c
                got += 1
                ex = ";".join("%s|%d|%s|%s" % (x["fileName"], x.get("fileSizeBytes") or 0, x.get("checksum") or "", ftp(x))
                              for x in extra)
                o.write("\t".join(" ".join(str(v).split()) for v in [
                    "AQ2.%s.%02d" % (s, got), s, cls, p["accession"], instr(p), name, str(tot),
                    f.get("checksum") or "", ftp(f), ex, (p.get("title") or "")[:150]]) + "\n")
                o.flush()
            log.write("#drawn\t%s\t%d of %d\n" % (s, got, n))
            log.flush()

main()
