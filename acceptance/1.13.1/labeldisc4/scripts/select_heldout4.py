#!/usr/bin/env python3
"""Label discovery held-out test 4 (copy of labeldisc-nocall/select_nocall.py; seed and targets changed; second pool for dimethyl):
seeded selection of one run per PRIDE project (metadata only, no FASTag).
Usage: select_heldout4.py <pride cache dir (pool.json, pool_dimethyl_kw.json)> <excluded_pxd.txt> <bigbio SDRF datasets dir> <out dir>
Writes pool.tsv, selected.tsv, selection_log.tsv, stage_list.tsv. All rules are in PREREG-labeldisc4.md."""
import sys, os, re, json, random, time, csv, io, urllib.request, collections
CACHE, EXCL, BIGBIO, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE + "/files", exist_ok=True); os.makedirs(CACHE + "/sdrf", exist_ok=True)
SEED = "fastag-1.13.1:labeldisc4:"
I = re.I
# ---- targets: class -> instrument cell -> number of projects
TARGET = {
 "label-free": {"HYB": 24, "TRI": 10, "QE": 10},
 "SILAC":      {"HYB": 12, "TRI": 5, "QE": 5},
 "dimethyl":   {"HYB": 14, "TRI": 7, "QE": 7},
 "TMT":        {"HYB": 6, "TRI": 8, "QE": 6},
 "TMTpro":     {"HYB": 2, "TRI": 14, "QE": 8},
 "iTRAQ4":     {"HYB": 8, "QE": 2},
 "iTRAQ8":     {"HYB": 6, "TRI": 2, "QE": 4},
}
# ---- structured field: quantification method -> family
def qfam(v):
    s = v.lower()
    if "tmt" in s: return "TMT"
    if "itraq" in s: return "iTRAQ"
    if "silac" in s: return "SILAC"
    if "dimethyl" in s: return "dimethyl"
    if re.search(r"label[- ]free|ms1 intensity|spectr(um|al) count|peptide count|\btic\b|empai|apex|\bxic\b|ibaq|normalized spectral", s): return "label-free"
    if s in ("relative quantification", "absolute quantification"): return None
    return "other"
# ---- free text
R_TMT = re.compile(r"\bTMT|tandem[- ]mass[- ]tag", I)
R_PRO = re.compile(r"TMT[- ]?pro|1[68][- ]?plex|TMT[- ]?1[68]\b", I)
R_TMTLOW = re.compile(r"\b(6|10|11|six|ten|eleven)[- ]?plex|TMT[- ]?(6|10|11)\b|TMT[- ]?duplex|2[- ]?plex", I)
R_ITRAQ = re.compile(r"iTRAQ", I)
R_I8 = re.compile(r"\b8[- ]?plex|iTRAQ[- ]?8|eight[- ]?plex", I)
R_I4 = re.compile(r"\b4[- ]?plex|iTRAQ[- ]?4|four[- ]?plex", I)
R_SILAC = re.compile(r"SILAC|stable isotope label(l)?ing (by|with) amino acids", I)
R_DIM = re.compile(r"dimethyl[- ]?label|dimethyl(ation)?[- ]label|reductive (di)?methylation|reductive amination|isotop(e|ic) dimethyl|dimethyl[- ]?quanti|dimethyl isotop|(light|medium|intermediate|heavy)[ -](dimethyl|formaldehyde)|formaldehyde[- ](and|/)[- ]?(sodium )?cyanoborohydride|CH2O|CD2O", I)
R_LF = re.compile(r"label[- ]?free|\bLFQ\b|\biBAQ\b|spectral count|MaxLFQ|intensity[- ]based", I)
R_ANYLABEL = re.compile(r"isobaric|isotop(e|ic)[- ]?(label|cod|tag)|\bheavy\b|metabolic(ally)?[- ]label|chemical(ly)?[- ]label|isotopically", I)
R_OOV = re.compile(r"15N|N15\b|NeuCode|\bICAT\b|mTRAQ|18O\b|\bO18\b|\bICPL\b|\bAQUA\b|heavy[- ]methyl|BONCAT|azidohomoalanine|\bAHA\b|DiLeu|TMT[- ]?zero|TMT0|iodo-?TMT|cys-?TMT|aminoxy-?TMT|\bSILAM\b|deuterat|\bD2O\b|heavy water|13C[- ]?(6[- ])?glucose|\bIPTL\b|\bTAILS\b|COFRADIC|N-terminom|degradom|super[- ]?SILAC|spike[- ]in SILAC|puls(e|ed)[- ]?SILAC|\bpSILAC|dynamic SILAC|hyperplex|label[- ]swap|\bDiART\b|EASI-tag|\bSILIP\b|\bNAIL\b", I)
R_EXCL = re.compile(r"top[- ]down|intact[- ](protein|mass)|native[- ](MS|mass)|proteoform|middle[- ]down|cross[- ]?link|\bXL-?MS\b|\bDSSO\b|\bBS3\b|\bDSBU\b|\bDSS\b|hydrogen[-/ ]deuterium|\bHDX\b|imaging|\bMALDI\b|\bDIA\b|data[- ]independent|SWATH|\bSRM\b|\bMRM\b|\bPRM\b|reaction monitoring|targeted (proteomic|MS\b|mass)|metabolom|lipidom|\bglycans?\b|oligonucleotide|standard[- ]only|system suitability", I)
R_EXPT = re.compile(r"independent|SRM|MRM|cross-linking|top-down|imaging|SWATH|PRM|targeted", I)
R_OTHERENZ = re.compile(r"chymotryp|Glu-?C\b|Asp-?N\b|Lys-?N\b|\bpepsin|elastase|proteinase K|thermolysin|immunopeptid|\bHLA\b|\bMHC\b|peptidom|no[- ]enzyme|unspecific|non-?specific (cleavage|digest)|endogenous peptide", I)
def textof(p):
    return " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol", "dataProcessingProtocol")) + " " + " ".join(p.get("keywords") or [])
def digestion(t):
    other = bool(R_OTHERENZ.search(t)); tryp = bool(re.search(r"tryp", re.sub(r"chymotryp\w*", "", t, flags=I), I))
    return "mixed" if other and tryp else "other" if other else "tryptic" if tryp else "unstated"
# ---- instruments
def iclass(name):
    if re.search(r"nLC|UltiMate|HPLC|nanoAcquity|chromatograph", name, I): return None
    if re.search(r"Fusion|Lumos|Eclipse|Ascend|Tribrid", name, I): return "TRI"
    if re.search(r"Q Exactive|Exploris|Astral", name, I): return "QE"
    if re.search(r"LTQ Orbitrap|Orbitrap Elite|Orbitrap Velos|LTQ FT|Orbitrap XL|Orbitrap Discovery|Orbitrap Classic", name, I): return "HYB"
    return "X"
def classify(p):
    """-> (class, cell, digestion) or (None, reason, '')"""
    fams = {qfam(v) for v in (p.get("quantificationMethods") or [])} - {None}
    if p.get("_kw") and not fams - {"dimethyl"}: fams = {"dimethyl"}   # keyword pool: no other quantification method named
    if len(fams) != 1: return None, "several_or_no_quant_methods", ""
    fam = fams.pop()
    if fam == "other": return None, "method_outside_vocabulary", ""
    ics = {iclass(i) for i in (p.get("instruments") or [])} - {None}
    if len(ics) != 1 or "X" in ics: return None, "instrument_not_one_thermo_orbitrap_class", ""
    ic = ics.pop()
    t = textof(p)
    if any(R_EXPT.search(e) for e in (p.get("experimentTypes") or [])): return None, "experiment_type_excluded", ""
    m = R_EXCL.search(t)
    if m: return None, "text_excluded:" + m.group(0).lower(), ""
    m = R_OOV.search(t)
    if m: return None, "text_label_outside_vocabulary:" + m.group(0).lower(), ""
    has = dict(TMT=bool(R_TMT.search(t)), iTRAQ=bool(R_ITRAQ.search(t)), SILAC=bool(R_SILAC.search(t)), dimethyl=bool(R_DIM.search(t)))
    dig = digestion(t)
    if fam == "label-free":
        if any(has.values()) or R_ANYLABEL.search(t): return None, "text_mentions_a_label", ""
        if not R_LF.search(t): return None, "text_does_not_state_label_free", ""
        return "label-free", ("NT" if dig == "other" else ic), dig
    if not has[fam]: return None, "text_does_not_state_family", ""
    if sum(has.values()) != 1 or R_LF.search(t): return None, "text_mentions_another_family_or_label_free", ""
    if fam == "TMT":
        pro, low = bool(R_PRO.search(t)), bool(R_TMTLOW.search(t))
        if pro and low: return None, "tmt_and_tmtpro_plex_both_stated", ""
        return ("TMTpro" if pro else "TMT"), ic, dig
    if fam == "iTRAQ":
        i8, i4 = bool(R_I8.search(t)), bool(R_I4.search(t))
        if i8 == i4: return None, "itraq_plex_not_stated_or_both", ""
        return ("iTRAQ8" if i8 else "iTRAQ4"), ic, dig
    return fam, ic, dig
# ---- PRIDE files
def get(url, path, binary=False):
    if os.path.exists(path): return open(path, "rb").read()
    for a in range(5):
        try:
            d = urllib.request.urlopen(url, timeout=120).read()
            open(path + ".part", "wb").write(d); os.rename(path + ".part", path); return d
        except Exception as e:
            time.sleep(3 * (a + 1))
    return None
def files(acc):
    d = get(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{acc}/files/all", f"{CACHE}/files/{acc}.json")
    try: return json.loads(d) if d else None
    except Exception: return None
def ftp(f):
    for l in f.get("publicFileLocations") or []:
        if l.get("name") == "FTP Protocol": return l.get("value", "").replace("ftp://", "https://")
    return ""
NAME_BAD = re.compile(r"blank|wash|QC|std|standard|test|calib|library|lib\b|_lib|GPF|SRM|MRM|DIA|SWATH|PRM|MSX|targeted|hela|BSA|iRT|intact|topdown|top_down|XL|crosslink", I)
NAME_LF = re.compile(r"label.?free|LFQ|unlabel|nolabel|_LF_|_LF\.", I)
# ---- SDRF
def sdrf_class(labels):
    L = {l.strip().lower() for l in labels if l.strip()}
    if not L: return None
    if all("label free" in l for l in L): return "label-free"
    if any(l.startswith("tmt") for l in L):
        return "TMTpro" if any(re.search(r"13[2-5]|pro", l) for l in L) or len(L) > 11 else "TMT"
    if any(l.startswith("itraq") for l in L):
        return "iTRAQ8" if any(re.search(r"11[389]|121", l) for l in L) or len(L) > 4 else "iTRAQ4"
    if any("silac" in l for l in L): return "SILAC"
    if any("dimethyl" in l for l in L): return "dimethyl"
    return "other"
def sdrf_rows(text):
    rd = csv.reader(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), delimiter="\t", quoting=csv.QUOTE_NONE); hdr = [h.strip().lower() for h in next(rd, [])]
    if "comment[data file]" not in hdr or "comment[label]" not in hdr: return {}
    fi, li = hdr.index("comment[data file]"), hdr.index("comment[label]"); m = collections.defaultdict(set)
    for r in rd:
        if len(r) > max(fi, li): m[os.path.basename(r[fi].strip()).lower()].add(r[li])
    return m
def sdrf_for(acc, fl, fname):
    """-> (source, class or None). source: none | pride | bigbio; class None = file not listed."""
    texts = []
    for f in fl:
        if "sdrf" in f["fileName"].lower() and f.get("fileSizeBytes", 0) < 50e6 and ftp(f):
            d = get(ftp(f), f"{CACHE}/sdrf/{acc}__{re.sub(r'[^A-Za-z0-9._-]', '_', f['fileName'])}")
            if d: texts.append(("pride", d.decode("utf-8", "replace")))
    bb = f"{BIGBIO}/{acc}"
    if os.path.isdir(bb):
        for n in sorted(os.listdir(bb)):
            if n.endswith(".sdrf.tsv"): texts.append(("bigbio", open(f"{bb}/{n}", encoding="utf-8", errors="replace").read()))
    if not texts: return "none", None
    for src, t in texts:
        rows = sdrf_rows(t)
        if fname.lower() in rows: return src, sdrf_class(rows[fname.lower()])
    return texts[0][0], None
# ---- main
pool = json.load(open(CACHE + "/pool.json"))
for acc, p in json.load(open(CACHE + "/pool_dimethyl_kw.json")).items():
    if acc not in pool: p["_kw"] = True; pool[acc] = p
excl = {l.strip() for l in open(EXCL) if l.strip()}
cells = collections.defaultdict(list); poolrows = []
for acc in sorted(pool):
    p = pool[acc]
    if acc in excl: poolrows.append((acc, "", "", "", "excluded_pxd")); continue
    if not acc.startswith("PXD"): poolrows.append((acc, "", "", "", "not_pxd")); continue
    cl, cell, dig = classify(p)
    if cl is None: poolrows.append((acc, "", "", "", cell)); continue
    poolrows.append((acc, cl, cell, dig, "eligible_kw" if p.get("_kw") else "eligible")); cells[(cl, cell)].append((acc, dig))
with open(OUT + "/pool.tsv", "w") as o:
    o.write("pxd\tclass\tcell\tdigestion\tstatus\n")
    for r in poolrows: o.write("\t".join(r) + "\n")
sel = []; log = []
for cl in TARGET:
    for cell, want in TARGET[cl].items():
        cand = sorted(cells[(cl, cell)]); random.Random(SEED + cl + ":" + cell).shuffle(cand); got = 0
        for acc, dig in cand:
            if got >= want: break
            fl = files(acc)
            if not fl: log.append((acc, cl, cell, "no_file_list")); continue
            raws = sorted((f for f in fl if f["fileName"].lower().endswith(".raw") and 30e6 <= (f.get("fileSizeBytes") or 0) <= 2 * 2**30
                           and not NAME_BAD.search(f["fileName"]) and not (cl != "label-free" and NAME_LF.search(f["fileName"])) and ftp(f)),
                          key=lambda f: f["fileName"])
            if not raws: log.append((acc, cl, cell, "no_eligible_raw")); continue
            random.Random(SEED + acc).shuffle(raws)
            src, sc = sdrf_for(acc, fl, raws[0]["fileName"])
            if sc is not None and sc != cl: log.append((acc, cl, cell, f"sdrf_disagrees:{src}:{sc}")); continue
            sd = "none" if src == "none" else f"{src}:{'agrees' if sc else 'file_not_listed'}"
            for rank, f in enumerate(raws[:3]):
                stem = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.splitext(f["fileName"])[0])
                sel.append(dict(id=f"{acc}__{stem}", pxd=acc, truth=cl, cell=cell, digestion=dig, rank=rank, file=f["fileName"], bytes=f["fileSizeBytes"],
                                sha1=f.get("checksum") or "-", url=ftp(f), sdrf=sd if rank == 0 else "-", instruments="; ".join(pool[acc].get("instruments") or []),
                                n_eligible_raw=len(raws)))
            got += 1; log.append((acc, cl, cell, "selected"))
        log.append(("-", cl, cell, f"cell_filled {got}/{want} of {len(cand)} eligible projects"))
cols = ["id", "pxd", "truth", "cell", "digestion", "rank", "file", "bytes", "sha1", "url", "sdrf", "instruments", "n_eligible_raw"]
with open(OUT + "/selected.tsv", "w") as o:
    o.write("# label-discovery held-out test 4 selection; rank 0 = the run, rank 1,2 = backups used only if download or conversion of the lower rank fails\n")
    o.write("\t".join(cols) + "\n")
    for s in sel: o.write("\t".join(str(s[c]) for c in cols) + "\n")
with open(OUT + "/selection_log.tsv", "w") as o:
    o.write("pxd\tclass\tcell\tevent\n")
    for r in log: o.write("\t".join(r) + "\n")
with open(OUT + "/stage_list.tsv", "w") as o:   # key, dir, file, bytes, pride_sha1, url, route, sha256_expected
    for s in sel:
        if s["rank"] == 0: o.write("\t".join([s["id"], s["pxd"], s["file"], str(s["bytes"]), s["sha1"], s["url"], "trfp", "-"]) + "\n")
for r in log:
    if r[0] == "-": print(*r[1:])
