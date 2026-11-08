#!/usr/bin/env python3
"""FASTag 1.12 #2/#6: PROPOSED replacement reserves from PRIDE (not registered; the user approves first).

Why: the prose-auto heldout/validation_v3 corpora hold no Astral or timsTOF DDA run outside H1/DEV (select_corpus.py
draws 0/2 for both classes), and the #2/#6 H1 'QE' cell PXD001540 has ion-trap MS2 (Orbitrap Elite, ITMS CID).
Fixed before any download; no FASTag run, no search and no scoring reads these files.

Project rule (PRIDE Archive v3 search records; keyword 'Astral'+'Orbitrap Astral', 'timsTOF'+'ddaPASEF', 'Q Exactive'):
  instruments: only the class (astral: every name contains 'astral'; timstof: 'timstof'; qe: 'q exactive');
  text (title, description, sample/data protocols, keywords, SDRF) names DDA (DDA/data-dependent/ddaPASEF/TopN)
  and never DIA or a targeted method; trypsin; label-free (no TMT/iTRAQ/SILAC/dimethyl/heavy); no PTM enrichment or
  special chemistry; whole-cell/tissue lysate (no IP, pull-down, proximity, beads, single-cell/low-input, body
  fluids, EVs, FFPE, purified/recombinant proteins, in-gel bands, subcellular/organelle fractions); one organism of
  human, mouse, S. cerevisiae, E. coli; accession not in inputs/h2r_exclude_pxd.txt (every PXD named anywhere in
  the FASTag repo, outputs, /ceph/ibmi/abi/oliver and data:/scratch/kohlbach, metadata mirrors excepted).
Order: OK accessions sorted, shuffled with random.Random('fastag-1.12:#2:H2r:<class>'), then read in that order
  against the protocol text (REVIEW below: a rule criterion the regexes miss rejects the project; reason recorded).
  Taken: astral 2, timstof 2 (H2 reserves for #2; astral also for #6), qe 1 (H1 'QE' cell replacement for #2/#6).
File rule: class data files (.raw; timsTOF .d.zip), names without blank/QC/wash/standard/DIA/PRM/HeLa/test/library,
  0.2-25 GB; sorted, shuffled with random.Random('fastag-1.12:#2:H2r:<class>:<PXD>'); first = chosen,
  second = backup (staged only if the chosen file fails the post-download check: class analyser in the MS2 and DDA).
Usage: select_h2r_pride.py <search json dir> <files cache dir> <out dir>"""
import json, os, random, re, sys
from collections import Counter

S, C, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
EXCL = {l.strip() for l in open(f"{HERE}/../inputs/h2r_exclude_pxd.txt") if l.strip()}
SEARCH = {"astral": ["astral.json", "astral2.json"], "timstof": ["ddapasef.json", "timstof.json"], "qe": ["qe.json"]}
TAKE = {"astral": 2, "timstof": 2, "qe": 1}
REVIEW = {  # protocol-text review in draw order (only projects read before the quota was filled)
    "PXD066684": "reject: fractionated sample (cellular / soluble ECM / insoluble ECM fractions), not a whole lysate",
    "PXD078292": "reject: GFP / GFP-ZNF512B / GFP-ZNF512B-delta conditions, a GFP affinity purification (IP)",
    "PXD022789": "reject: FFPE (paraffin-embedded) tissue",
    "PXD016043": "reject: no raw data file in PRIDE",
    "PXD051945": "reject: tear fluid (Schirmer strips), a body fluid",
    "PXD050360": "reject: no raw data file in PRIDE",
}
DDA = re.compile(r"data[- ]dependent|\bdda\b|ddapasef|dda-pasef|pasef dda|top ?\d+|top-\d+|dd-ms2|ddms2", re.I)
DIA = re.compile(r"data[- ]independent|\bdia\b|diapasef|dia-pasef|swath|directdia|spectronaut|dia-nn|diann|\bprm\b|parallel reaction|\bsrm\b|\bmrm\b|scanning swath|slice-pasef|midia|synchro", re.I)
LAB = re.compile(r"\btmt|itraq|silac|dimethyl|\blabel(l)?ed\b|\bheavy\b|15n|13c|isobaric", re.I)
PTM = re.compile(r"phospho|glyco|ubiquit|\bk-?gg\b|diglycine|sumo|acetylom|succinyl|crotonyl|lactyl|citrullin|methylom|redox|cysteine|biotin|click|crosslink|cross-link|\bxl-ms|lip-ms|limited proteolysis|thermal|tpp\b|hdx|nitrosyl|palmitoyl|enrich|imac|tio2|fe-nta", re.I)
SAMPLE = re.compile(r"immunoprecip|\bip\b|co-ip|pull[- ]?down|interactom|affinity|\bap-?ms|bioid|turboid|apex2?\b|proximity|probe|bead|metaprote|fecal|stool|microbiom|single[- ]cell|low[- ]input|nanogram|\d+ ?cells\b|hla|immunopeptid|\bmhc\b|exosome|extracellular vesicle|\bplasma\b|\bserum\b|\burine\b|saliva|csf|cerebrospinal|purified protein|recombinant|in[- ]gel|gel band|sds-page band|excised|secretom|membrane fraction|organelle|mitochondri|nucle(ar|i) fraction|subcellular|ffpe|laser capture|spatial", re.I)
ORG_OK = ("homo sapiens", "mus musculus", "saccharomyces cerevisiae", "escherichia coli")
BADFILE = re.compile(r"blank|\bqc\b|_qc|qc_|wash|std|standard|(^|[_\-.])dia([_\-.]|$)|prm|hela|test|librar", re.I)
EXT = {"astral": (".raw",), "qe": (".raw",), "timstof": (".d.zip",)}

def text(p):
    return " ".join([p.get("title") or "", p.get("projectDescription") or "", p.get("sampleProcessingProtocol") or "",
                     p.get("dataProcessingProtocol") or "", " ".join(p.get("keywords") or []), p.get("sdrf") or ""])

def rule(p, cls):
    ins = [i.lower() for i in p.get("instruments", [])]
    key = {"astral": "astral", "timstof": "timstof", "qe": "q exactive"}[cls]
    if not ins or not all(key in i for i in ins): return "instr"
    t = text(p)
    if DIA.search(t): return "dia_or_targeted"
    if not DDA.search(t): return "no_dda_named"
    if not re.search(r"trypsin|tryptic", t, re.I): return "no_trypsin"
    if LAB.search(t): return "label"
    if PTM.search(t): return "ptm_or_special"
    if SAMPLE.search(t): return "sample_type"
    orgs = {o.lower() for o in p.get("organisms", [])}
    sp = {next((k for k in ORG_OK if o.startswith(k)), None) for o in orgs}
    if None in sp or len(sp) != 1: return "organism"
    if p["accession"] in EXCL: return "excluded_used"
    return "OK"

os.makedirs(OUT, exist_ok=True)
rows, stage = [], []
for cls in ("astral", "timstof", "qe"):
    d = {}
    for f in SEARCH[cls]:
        for p in json.load(open(f"{S}/{f}")): d[p["accession"]] = p
    res = {a: rule(p, cls) for a, p in d.items()}
    print(cls, len(d), dict(Counter(res.values())))
    for a in sorted(res):
        if res[a] != "OK": rows.append((cls, a, "", res[a], ""))
    ok = sorted(a for a in res if res[a] == "OK")
    random.Random(f"fastag-1.12:#2:H2r:{cls}").shuffle(ok)
    taken = 0
    for rank, a in enumerate(ok, 1):
        if taken >= TAKE[cls]:
            rows.append((cls, a, rank, "OK_not_needed", "")); continue
        if a in REVIEW:
            rows.append((cls, a, rank, "OK_review", REVIEW[a])); continue
        fl = json.load(open(f"{C}/{a}.files.json"))
        el = sorted((x for x in fl if x["fileName"].lower().endswith(EXT[cls]) and not BADFILE.search(x["fileName"])
                     and 0.2e9 <= x["fileSizeBytes"] <= 25e9), key=lambda x: x["fileName"])
        if not el:
            rows.append((cls, a, rank, "OK_review", "reject: no eligible data file")); continue
        random.Random(f"fastag-1.12:#2:H2r:{cls}:{a}").shuffle(el)
        taken += 1
        rows.append((cls, a, rank, "TAKEN", f"{len(el)} eligible files; chosen {el[0]['fileName']}"))
        for role, x in (("chosen", el[0]), ("backup", el[1] if len(el) > 1 else None)):
            if x is None: continue
            url = next(l["value"] for l in x["publicFileLocations"] if l["name"] == "FTP Protocol")
            url = url.replace("ftp://ftp.pride.ebi.ac.uk/", "https://ftp.pride.ebi.ac.uk/")
            split = "H1r" if cls == "qe" else "H2r"
            stage.append((role, f"{cls}:{a}:{x['fileName']}", f"item02/{split}/{a}", x["fileName"], x["fileSizeBytes"],
                          x.get("checksum") or "-", url, "fileconverter" if cls == "timstof" else "trfp", "-"))
with open(f"{OUT}/h2r_pride_candidates.tsv", "w") as f:
    f.write("class\taccession\tdraw_rank\tresult\tnote\n")
    for r in rows: f.write("\t".join(map(str, r)) + "\n")
for role in ("chosen", "backup"):
    with open(f"{OUT}/h2r_stage_{role}.tsv", "w") as f:
        for r in stage:
            if r[0] == role: f.write("\t".join(map(str, r[1:])) + "\n")
for r in rows:
    if r[3] in ("TAKEN", "OK_review"): print(*r, sep="\t")
