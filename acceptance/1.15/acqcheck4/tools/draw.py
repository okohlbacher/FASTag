#!/usr/bin/env python3
"""acqcheck4 held-out draw: fresh public PRIDE Thermo .raw files for the raw-DIA acquisition check (FASTag 1.14.0).

Adapted from the acqcheck3 draw (same catalog fields, pick rule and size limit). Closes acqcheck3's two short rows:
Astral DDA (K3 Astral NONDIA) and closed-window DIA (K4).

  * catalog = PRIDE v3 /projects (catalog.py), COMPLETE or PARTIAL; projects in the exclusion list are never used;
  * Thermo only: every instrument listed by the project is a Thermo Orbitrap/ion-trap model (I_THERMO) and none is
    of another vendor or a triple quadrupole (I_OTHER);
  * each project goes to at most one stratum (first match in stratum()), by title, description, protocols, keywords
    and instruments;
  * per stratum the projects are sorted by accession and shuffled with random.Random(SEED + stratum index); for
    DIA_closed the tier-A projects (TIER_A text) come first, in their shuffled order, then the tier-B projects;
    projects are taken in that order; per project one file is drawn with random.Random("SEED:PXD") among its
    usable files (.raw, size <= MAX_BYTES, name rules below); a project without one is skipped (logged);
  * DDA_astral only: up to 3 files per project (random.Random("SEED:PXD").sample among its usable files, DDA-named
    files preferred), emitted in rounds (first files of all projects in pool order, then second, then third);
    the Astral DDA pool is too small for one file per project;
  * per stratum N main files, then NB backups in the same order (role backup1..NB). How backups are used is the
    selection rule of select.py (PREREG).
usage: draw.py <catalog.jsonl> <exclude.txt> <manifest.tsv> <draw.log> [--pools]
"""
import json, random, re, sys, urllib.request, time

SEED = 20261115
MAX_BYTES = 5 * 1024**3
QUOTA = [  # (stratum, drawn class, main n, backups)
    ("DDA_astral", "nonDIA", 20, 40),
    ("DIA_closed", "DIA", 20, 20),
    ("DIA_orbitrap", "DIA", 20, 5),
    ("PRM", "nonDIA", 8, 3),
    ("DDA_orbitrap", "nonDIA", 36, 6),
]

def text(p):
    kw = " ".join(p.get("keywords") or [])
    return " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                                     "dataProcessingProtocol")) + " " + kw

def instr(p):
    return " | ".join(i.get("name", "") for i in (p.get("instruments") or []))

R = lambda s: re.compile(s, re.I)
DIA_T = R(r"\bDIA\b|data[- ]independent|\bSWATH|diaPASEF|dia-PASEF|\bMSX\b|\bpSMART\b")
DDA_T = R(r"\bDDA\b|data[- ]dependent|\bTop ?\d+\b|\bTopN\b|\btop[- ]speed\b")
TIER_A = R(r"retention[- ]time[- ]dependent (DIA )?(segments|windows?|isolation)|\bRT[- ]dependent (DIA )?(segments|windows?|isolation)|"
           r"segments of DIA cycles|time[- ]segment(ed|s)? (DIA|windows?|isolation)|scheduled DIA|dynamic (isolation )?windows?|"
           r"dynamic window widths|MSX count (of |to |set to |: ?)?[2-9]|BoxCarmax|multiplexed data[- ]independent acquisition|"
           r"\bMSX[- ]DIA|\bmsxDIA")
TIER_B = R(r"\bMSX\b|multiplexed DIA|stagger|overlapping (isolation )?windows|demultiplex|\bGPF\b|gas[- ]phase fraction|"
           r"variable(-| )(width |size )?windows?|narrow[- ]window|window scheme|chromatogram librar|window segments?|"
           r"windows? of (differing|varying|variable) widths?")
PRM_T = R(r"\bPRM\b|parallel reaction monitoring")
SRM_T = R(r"\bSRM\b|\bMRM\b|selected reaction monitoring|multiple reaction monitoring")
SQ_T = R(r"SureQuant|inclusion list|internal standard triggered")
WWA_T = R(r"\bWWA\b|wide[- ]window acquisition|wide isolation window")
I_THERMO = R(r"Q Exactive|Exploris|Fusion|Lumos|Eclipse|Ascend|Orbitrap|Astral|LTQ|Velos|Elite|Stellar")
I_OTHER = R(r"timsTOF|tims ?TOF|TripleTOF|Triple TOF|ZenoTOF|SCIEX|QTRAP|Synapt|Xevo|Agilent|Waters|maXis|impact|Bruker|"
            r"TSQ|Quantiva|Altis|Vantage|Endura|Shimadzu|Q-?TOF")
I_ASTRAL = R(r"Astral")

def stratum(p):
    t, i = text(p), instr(p)
    if not I_THERMO.search(i) or I_OTHER.search(i): return None
    dia, dda = DIA_T.search(t), DDA_T.search(t)
    if I_ASTRAL.search(i) and (dda or not dia) and not WWA_T.search(t): return "DDA_astral"
    if dia:
        if TIER_A.search(t) or TIER_B.search(t): return "DIA_closed"
        return "DIA_orbitrap"
    if SQ_T.search(t) or SRM_T.search(t) or WWA_T.search(t): return None
    if PRM_T.search(t): return "PRM"
    if dda and not I_ASTRAL.search(i): return "DDA_orbitrap"
    return None

def tier(p):
    return "A" if TIER_A.search(text(p)) else "B"

THERMO = R(r"\.raw$")
NAME_DIA = R(r"DIA|SWATH|MSX|window|GPF|stagger")
NAME_DDA = R(r"DDA|data[-_]?dep|Top ?\d+|TopN|dd-?MS2|(^|[_-])dd([_-]|$)")
NAME_BAD = R(r"blank|wash|QC|std|standard|test|calib")
NAME_LIB = R(r"library|lib\b|_lib|GPF")
NAME_NOTDDA = R(r"DIA|SWATH|PRM|SRM|MRM|MSX|SIM\b|targeted|GPF|WWA|SureQuant")
ASTRAL_PER_PROJECT = 3
PREFER = {"PRM": R(r"PRM|target")}

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

def usable(st, n, dia_text):
    """Name rules per stratum. DDA_astral: never a DIA/targeted/SureQuant name. DDA_orbitrap, PRM: no blank/QC/library or non-DDA name (PRM may
    name PRM). DIA strata: no blank/QC name."""
    if NAME_BAD.search(n): return False
    if st == "DDA_astral": return not NAME_NOTDDA.search(n)
    if st == "DDA_orbitrap": return not (NAME_LIB.search(n) or NAME_NOTDDA.search(n))
    if st == "PRM": return not (NAME_LIB.search(n) or R(r"DIA|SWATH|SRM|MRM|MSX|GPF|WWA").search(n))
    return True

def pick(p, st, rng, log, k=1):
    acc = p["accession"]
    fs = files(acc)
    if fs is None:
        log.write("%s\t%s\tskip\tfile listing failed\n" % (acc, st)); return None
    dia_text = bool(DIA_T.search(text(p)))
    cand = []
    for f in fs:
        n, sz = f["fileName"], f.get("fileSizeBytes") or 0
        if not THERMO.search(n) or sz <= 0 or sz > MAX_BYTES: continue
        if not usable(st, n, dia_text): continue
        cand.append((n, f, sz))
    if st.startswith("DIA"):
        named = [c for c in cand if NAME_DIA.search(c[0])]
        if named: cand = named
    if st == "DDA_astral":
        named = [c for c in cand if NAME_DDA.search(c[0])]
        if named: cand = named
    if st in PREFER:
        named = [c for c in cand if PREFER[st].search(c[0])]
        if named: cand = named
    if not cand:
        log.write("%s\t%s\tskip\tno usable file (.raw, size <= 5 GiB, name)\n" % (acc, st)); return None
    cand.sort(key=lambda c: c[0])
    if k == 1: return rng.choice(cand)
    return rng.sample(cand, min(k, len(cand)))

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
    log.write("#seed\t%d\n#excluded_in_catalog\t%d\n" % (SEED, nexcl))
    for s, _, n, nb in QUOTA:
        pool = by_st.get(s, [])
        extra = "" if s != "DIA_closed" else " (tier A %d)" % sum(tier(p) == "A" for p in pool)
        log.write("#pool\t%s\t%d projects%s\n" % (s, len(pool), extra))
    log.flush()
    if pools_only: return
    with open(OUT, "w") as o:
        o.write("id\tstratum\tclass\tpxd\tinstrument\tfile\tsize_bytes\tpride_checksum\tftp\ttier\tproject_title\trole\n")
        for k, (s, cls, n, nb) in enumerate(QUOTA):
            pool = sorted(by_st.get(s, []), key=lambda p: p["accession"])
            random.Random(SEED + k).shuffle(pool)
            if s == "DIA_closed":
                pool = [p for p in pool if tier(p) == "A"] + [p for p in pool if tier(p) == "B"]
            got = 0
            if s == "DDA_astral":
                # up to ASTRAL_PER_PROJECT files per project (DDA-named files preferred, as pick()); emitted in rounds:
                # the first file of every project in pool order, then the second files, then the third
                picks = []
                for p in pool:
                    c = pick(p, s, random.Random("%d:%s" % (SEED, p["accession"])), log, ASTRAL_PER_PROJECT)
                    if c: picks.append((p, c))
                for rnd in range(ASTRAL_PER_PROJECT):
                    for p, c in picks:
                        if rnd >= len(c) or got >= n + nb: continue
                        name, f, sz = c[rnd]
                        got += 1
                        o.write("\t".join(" ".join(str(v).split()) for v in [
                            "AQ4.%s.%02d" % (s, got), s, cls, p["accession"], instr(p), name, str(sz),
                            f.get("checksum") or "", ftp(f), "", (p.get("title") or "")[:150],
                            "main" if got <= n else "backup%d" % (got - n)]) + "\n")
                log.write("#drawn\t%s\t%d of %d (+%d backups of %d; %d projects)\n" % (s, min(got, n), n, max(0, got - n), nb, len(picks)))
                continue
            for p in pool:
                if got >= n + nb: break
                c = pick(p, s, random.Random("%d:%s" % (SEED, p["accession"])), log)
                if not c: continue
                name, f, sz = c
                got += 1
                o.write("\t".join(" ".join(str(v).split()) for v in [
                    "AQ4.%s.%02d" % (s, got), s, cls, p["accession"], instr(p), name, str(sz),
                    f.get("checksum") or "", ftp(f), tier(p) if s == "DIA_closed" else "",
                    (p.get("title") or "")[:150], "main" if got <= n else "backup%d" % (got - n)]) + "\n")
                o.flush()
            log.write("#drawn\t%s\t%d of %d (+%d backups of %d)\n" % (s, min(got, n), n, max(0, got - n), nb))
            log.flush()

main()
