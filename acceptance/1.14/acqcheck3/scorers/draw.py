#!/usr/bin/env python3
"""acqcheck3 held-out draw: fresh public PRIDE files for the raw-DIA acquisition check (FASTag 1.13.4).

Adapted from the E7-03 / acqcheck2 sampler (same text and instrument regexes, same pick rule), extended to the
vendors acqcheck2 lacked: Orbitrap Astral (.raw), Bruker timsTOF (.d.zip), SCIEX (.wiff + .wiff.scan), plus
Orbitrap DIA with unusual window schemes, recurring-window DDA and targeted runs (PRM, SRM).

  * catalog = PRIDE v3 /projects (fetched by catalog.py), COMPLETE or PARTIAL;
  * a project in the exclusion list is never used;
  * each project goes to at most one stratum (first match in stratum()), by title, description, protocols,
    keywords and instruments;
  * NBACKUP further projects per stratum, in the same order, are drawn as backups (role backup1..3);
  * per stratum the projects are sorted by accession, shuffled with random.Random(SEED + stratum index) and taken
    in that order; per project one file is drawn with random.Random("SEED:PXD") among its usable files (stratum
    format, total size <= MAX_BYTES, name not contradicting the stratum); a project without one is skipped
    (logged) and the next is taken.
usage: draw.py <catalog.jsonl> <exclude.txt> <manifest.tsv> <draw.log> [--pools]
"""
import json, random, re, sys, urllib.request, time

SEED = 20261113
MAX_BYTES = 5 * 1024**3
NBACKUP = 3   # per stratum, drawn after the n main files in the same order; used only by the staging rule
QUOTA = [  # (stratum, drawn class, n)
    ("DIA_astral", "DIA", 15),
    ("DIA_diapasef", "DIA", 15),
    ("DIA_swath", "DIA", 15),
    ("DIA_orbitrap_scheme", "DIA", 15),
    ("DDA_astral", "nonDIA", 14),
    ("DDA_ddapasef", "nonDIA", 18),
    ("DDA_sciex", "nonDIA", 18),
    ("DDA_recurring", "nonDIA", 10),
    ("WWA_DDA", "nonDIA", 6),
    ("PRM", "nonDIA", 12),
    ("SRM", "nonDIA", 6),
]

def text(p):
    kw = " ".join(p.get("keywords") or [])
    return " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                                     "dataProcessingProtocol")) + " " + kw

def instr(p):
    return " | ".join(i.get("name", "") for i in (p.get("instruments") or []))

R = lambda s: re.compile(s, re.I)
DIA_T = R(r"\bDIA\b|data[- ]independent|\bSWATH|diaPASEF|dia-PASEF|\bMSX\b|\bpSMART\b")
SWATH_T = R(r"\bSWATH|\bDIA\b|data[- ]independent")
DIAPASEF_T = R(r"diaPASEF|dia-PASEF")
SCHEME_T = R(r"\bMSX\b|multiplexed DIA|stagger|overlapping (isolation )?windows|\bGPF\b|gas[- ]phase fraction|"
             r"variable(-| )(width |size )?windows?|narrow[- ]window|window scheme|chromatogram librar")
PRM_T = R(r"\bPRM\b|parallel reaction monitoring|prm-?PASEF")
SQ_T = R(r"SureQuant|inclusion list|internal standard triggered")
WWA_T = R(r"\bWWA\b|wide[- ]window acquisition|wide isolation window")
SRM_T = R(r"\bSRM\b|\bMRM\b|selected reaction monitoring|multiple reaction monitoring")
RECUR_T = R(r"cross-?link|\bXL-MS\b|\bAP-MS\b|affinity purification|immunoprecipitation|pull-?down|"
            r"purified protein|recombinant protein")
I_ASTRAL = R(r"Astral")
I_TIMS = R(r"timsTOF|tims ?TOF")
I_SCIEX = R(r"TripleTOF|Triple TOF|ZenoTOF|X500|SCIEX|QSTAR|5600|6600|7600|QTRAP|API ?[0-9]{4}|Triple Quad")
I_ORBI = R(r"Q Exactive|Exploris|Fusion|Lumos|Eclipse|Ascend|Orbitrap")
I_THERMO_QQQ = R(r"TSQ|Quantiva|Altis|Vantage|Endura")

def stratum(p):
    t, i = text(p), instr(p)
    dia, prm, sq, wwa, srm = DIA_T.search(t), PRM_T.search(t), SQ_T.search(t), WWA_T.search(t), SRM_T.search(t)
    sciex, tims, astral = I_SCIEX.search(i), I_TIMS.search(i), I_ASTRAL.search(i)
    orbi = I_ORBI.search(i) and not astral and not tims and not sciex
    if dia:
        if sciex and not tims and not astral and SWATH_T.search(t): return "DIA_swath"
        if tims and not sciex and DIAPASEF_T.search(t): return "DIA_diapasef"
        if astral and not prm and not wwa and not sciex: return "DIA_astral"
        if orbi and SCHEME_T.search(t): return "DIA_orbitrap_scheme"
        return None
    if sq: return None
    if srm and not prm: return "SRM"
    if prm and not srm: return "PRM"
    if wwa: return "WWA_DDA"
    if srm or prm: return None
    if astral and not tims and not sciex: return "DDA_astral"
    if tims and not sciex and not astral and R(r"ddaPASEF|dda-PASEF|\bPASEF\b|\bDDA\b|data[- ]dependent").search(t):
        return "DDA_ddapasef"
    if sciex and not tims and not astral and not I_ORBI.search(i) and R(r"\bIDA\b|\bDDA\b|information[- ]dependent|data[- ]dependent").search(t):
        return "DDA_sciex"
    if orbi and RECUR_T.search(t) and R(r"\bDDA\b|data[- ]dependent|\bTop ?\d+\b").search(t): return "DDA_recurring"
    return None

THERMO = R(r"\.raw$")
BRUKER = R(r"\.d\.zip$")
SCIEXF = R(r"\.wiff2?$")
FORMATS = {"DIA_astral": [THERMO], "DDA_astral": [THERMO], "DIA_orbitrap_scheme": [THERMO], "DDA_recurring": [THERMO],
           "WWA_DDA": [THERMO], "DIA_diapasef": [BRUKER], "DDA_ddapasef": [BRUKER], "DIA_swath": [SCIEXF],
           "DDA_sciex": [SCIEXF], "PRM": [THERMO, BRUKER, SCIEXF], "SRM": [THERMO, BRUKER, SCIEXF]}
NAME_DIA = R(r"DIA|SWATH|MSX|window|GPF|stagger")
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM")
NAME_BAD_SCHEME = R(r"blank|wash|QC|std|standard|test|calib")
NAME_BAD_SRM = R(r"blank|wash|QC|test|calib")
NAME_NOTDDA = R(r"DIA|SWATH|PRM|SRM|MRM|MSX|SIM\b|targeted|GPF")
PREFER = {"PRM": R(r"PRM|target"), "SRM": R(r"SRM|MRM|target"), "WWA_DDA": R(r"WWA|wide|DDA"),
          "DDA_sciex": R(r"IDA|DDA")}

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
        if not any(rx.search(n) for rx in FORMATS[st]): continue
        extra = []
        if SCIEXF.search(n):
            stem = n[:n.rfind(".")]
            sc = by.get(n + ".scan") or by.get(stem + ".wiff.scan")
            if n.lower().endswith(".wiff") and not sc: continue
            if sc: extra = [sc]
        tot = sz + sum(x.get("fileSizeBytes") or 0 for x in extra)
        if tot <= 0 or tot > MAX_BYTES: continue
        bad = NAME_BAD_SCHEME if st == "DIA_orbitrap_scheme" else NAME_BAD_SRM if st == "SRM" else NAME_BAD
        if bad.search(n): continue
        if st.startswith("DDA") or st == "WWA_DDA":
            if NAME_NOTDDA.search(n): continue
        cand.append((n, f, extra, tot))
    if st.startswith("DIA"):
        named = [c for c in cand if NAME_DIA.search(c[0])]
        if named: cand = named
    if st in PREFER:
        named = [c for c in cand if PREFER[st].search(c[0])]
        if named: cand = named
    if not cand:
        log.write("%s\t%s\tskip\tno usable file (format, size <= 5 GiB, name)\n" % (acc, st)); return None
    cand.sort(key=lambda c: c[0])
    return rng.choice(cand)

def main():
    CAT, EXCL, OUT, LOG = sys.argv[1:5]
    pools_only = "--pools" in sys.argv
    excl = set(l.strip() for l in open(EXCL) if l.strip())
    by_st, nexcl = {}, 0
    for l in open(CAT):
        p = json.loads(l)
        a = p["accession"]
        if not a.startswith("PXD"): continue
        if a in excl: nexcl += 1; continue
        if (p.get("submissionType") or "") not in ("COMPLETE", "PARTIAL"): continue
        s = stratum(p)
        if s: by_st.setdefault(s, []).append(p)
    log = open(LOG, "w")
    log.write("#excluded_in_catalog\t%d\n" % nexcl)
    for s, _, n in QUOTA:
        log.write("#pool\t%s\t%d projects\n" % (s, len(by_st.get(s, []))))
    log.flush()
    if pools_only: return
    with open(OUT, "w") as o:
        o.write("id\tstratum\tclass\tpxd\tinstrument\tfile\tsize_bytes\tpride_sha1\tftp\textra_files\tproject_title\trole\n")
        for k, (s, cls, n) in enumerate(QUOTA):
            pool = sorted(by_st.get(s, []), key=lambda p: p["accession"])
            rng = random.Random(SEED + k)
            rng.shuffle(pool)
            got = 0
            for p in pool:
                if got >= n + NBACKUP: break
                c = pick(p["accession"], s, random.Random("%d:%s" % (SEED, p["accession"])), log)
                if not c: continue
                name, f, extra, tot = c
                got += 1
                ex = ";".join("%s|%d|%s|%s" % (x["fileName"], x.get("fileSizeBytes") or 0, x.get("checksum") or "", ftp(x))
                              for x in extra)
                o.write("\t".join(" ".join(str(v).split()) for v in [
                    "AQ3.%s.%02d" % (s, got), s, cls, p["accession"], instr(p), name, str(tot),
                    f.get("checksum") or "", ftp(f), ex, (p.get("title") or "")[:150],
                    "main" if got <= n else "backup%d" % (got - n)]) + "\n")
                o.flush()
            log.write("#drawn\t%s\t%d of %d (+%d backups)\n" % (s, min(got, n), n, max(0, got - n)))
            log.flush()

main()
