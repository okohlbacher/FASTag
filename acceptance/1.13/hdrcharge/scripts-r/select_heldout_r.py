#!/usr/bin/env python3
"""FASTag 1.13 hdrcharge (backlog #14), second held-out round (PREREG-item14r.md): draw the runs from PRIDE.

Fixed before any download. No FASTag run reads these files before the freeze commit.

Pool: the rows of acceptance/1.12/inputs/h2r_pride_candidates.tsv (PRIDE keyword search records, 2026-11) with
  class qe     and result sample_type (select_h2r_pride.py: every instrument a Q Exactive, DDA named, never DIA or
               targeted, trypsin, label-free, no PTM enrichment; rejected there only for the sample type, which does
               not matter for a charge check), or
  class astral with any result (the h2r results judge DDA naming and PTM terms for another purpose; the project
               and file rules below are applied afresh),
  whose PXD number is divisible by 4 (cross-arm rule) and which is not in inputs-r/excl_pxd.tsv (the union of
  alknodb/prereg-exclude-pxd.txt, the lists reserved by shifts, census and species, and the hdrcharge DEV and spent
  runs).
Order: the pool accessions of a class sorted, shuffled with random.Random('fastag-1.13:hdrcharge:heldout-r:<class>'),
  read in that order until TAKE[class] projects are taken (qe 3, astral 2).
Project rule, on the PRIDE v3 project record (inputs-r/pride/<PXD>.project.json):
  - exactly one organism, Homo sapiens;
  - every instrument of the class (qe: name contains 'q exactive'; astral: contains 'astral');
  - text (title, description, sample and data protocol, keywords): trypsin named; no label (TMT, iTRAQ, SILAC,
    dimethyl, heavy); no PTM enrichment or special chemistry (the regexes of select_h2r_pride.py, without the
    bare words 'cysteine' and 'ubiquit', which also hit the alkylation text and protein names; the ubiquitin terms
    kept are ubiquitinat-, ubiquitylat-, ubiquitinom-, ubiquitylom-, K-GG and diglycine; 'phospho' does not count in
    the tool name phosphoRS); and none of:
    recombinant or purified protein, gel band, non-human or mixed material (xenograft, infection, co-culture,
    microbiome), HLA peptides;
  - REVIEW: a project the regexes pass is read against its text before any download; a rule criterion the regexes
    miss rejects it, with the reason recorded here (lesson of PXD074582: the organism must fit the sample).
File rule: .raw files, names without blank/QC/wash/standard/PRM/HeLa/test/library, 0.2-8 GB; qe: name without a DIA
  token; astral: no DIA token, and either the name contains 'dda' (case-insensitive) or the PRIDE record lists the
  experiment type 'Data-dependent acquisition' and not 'Data-independent acquisition'. Sorted by name, shuffled with
  random.Random('fastag-1.13:hdrcharge:heldout-r:<class>:<PXD>'); the first is the chosen file, the second the backup
  file (used only when the chosen file fails the download or the conversion).
Revision before any download (2026-11-10): the first form of the Astral rule (pool results sample_type,
  no_dda_named, dia_or_targeted; file name must contain 'dda'; PTM regex with 'cysteine' and 'ubiquit') took none of
  86 candidates: no such project has a file named DDA. The pool, the DDA evidence and three regex terms (cysteine,
  ubiquit, phosphoRS) were changed as stated above; the seeds are unchanged. With the revised rule the Astral pool
  the first two passing Astral projects are ranks 73 and 89 of 119 (the 30 behind rank 89 are not judged), so the Astral class is close to exhaustive. The Q Exactive draw is the same under both forms.
Qualification (before the freeze, without FASTag; scripts-r/stage_r.sh, truth_r.sh): the converted file must be
  DDA on an instrument of the class, and the Sage truth search must give at least 500 truth spectra. A project
  that fails is recorded in QUALFAIL and replaced by the next project of the seeded order.
Usage: select_heldout_r.py <out dir>      (reads inputs-r/pride/; names the next record to fetch when one is missing)
"""
import csv, json, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
IN = f"{HERE}/../inputs-r"
CAND = f"{HERE}/../../../1.12/inputs/h2r_pride_candidates.tsv"
OUT = sys.argv[1]
SEED = "fastag-1.13:hdrcharge:heldout-r"
TAKE = {"qe": 3, "astral": 2}
POOL = {"qe": {"sample_type"}, "astral": None}  # None: any h2r result
KEY = {"qe": "q exactive", "astral": "astral"}
REVIEW = {  # protocol-text review in draw order, before any download: accession -> reason
}
QUALFAIL = {  # qualification before the freeze (no FASTag): accession -> reason
}
LAB = re.compile(r"\btmt|itraq|silac|dimethyl|\blabel(l)?ed\b|\bheavy\b|15n|13c|isobaric", re.I)
PTM = re.compile(r"phospho(?!rs)|glyco|ubiquitinat|ubiquitylat|ubiquitinom|ubiquitylom|\bk-?gg\b|diglycine|sumo|acetylom|succinyl|crotonyl|lactyl|citrullin|methylom|redox|biotin|click|crosslink|cross-link|\bxl-ms|lip-ms|limited proteolysis|thermal|tpp\b|hdx|nitrosyl|palmitoyl|enrich|imac|tio2|fe-nta", re.I)
SAMPLE = re.compile(r"recombinant|purified protein|in[- ]gel|gel band|sds-page band|excised|metaprote|fecal|stool|microbiom|\bhla\b|immunopeptid|\bmhc\b|xenograft|\bpdx\b|infect|co-?cultur", re.I)
BADFILE = re.compile(r"blank|\bqc\b|_qc|qc_|wash|std|standard|prm|hela|test|librar", re.I)
DIAFILE = re.compile(r"(^|[^a-z])dia([^a-z]|$)|diapasef|swath", re.I)
DDAFILE = re.compile(r"dda", re.I)


def text(p):
    return " ".join([p.get("title") or "", p.get("projectDescription") or "", p.get("sampleProcessingProtocol") or "",
                     p.get("dataProcessingProtocol") or "", " ".join(p.get("keywords") or [])])


def project_rule(p, cls):
    orgs = sorted({(o.get("name") or "").strip().lower() for o in p.get("organisms") or []})
    if len(orgs) != 1 or not orgs[0].startswith("homo sapiens"):
        return "organism", ";".join(orgs)
    ins = [(i.get("name") or "").lower() for i in p.get("instruments") or []]
    if not ins or not all(KEY[cls] in i for i in ins):
        return "instr", ";".join(ins)
    t = text(p)
    if not re.search(r"trypsin|tryptic", t, re.I):
        return "no_trypsin", ""
    for name, rx in (("label", LAB), ("ptm_or_special", PTM), ("sample", SAMPLE)):
        m = rx.search(t)
        if m:
            return name, m.group(0)
    return "OK", ""


def eligible(fl, cls, p):
    et = {(e.get("name") or "").lower() for e in p.get("experimentTypes") or []}
    dda_project = "data-dependent acquisition" in et and "data-independent acquisition" not in et
    el = []
    for x in fl:
        n = x["fileName"]
        if not n.lower().endswith(".raw") or BADFILE.search(n) or DIAFILE.search(n):
            continue
        if cls == "astral" and not (DDAFILE.search(n) or dda_project):
            continue
        if 0.2e9 <= x["fileSizeBytes"] <= 8e9:
            el.append(x)
    return sorted(el, key=lambda x: x["fileName"])


excl = {r["pxd"] for r in csv.DictReader(open(f"{IN}/excl_pxd.tsv"), delimiter="\t")}
pool = {"qe": set(), "astral": set()}
for r in csv.DictReader(open(CAND), delimiter="\t"):
    c = r["class"]
    if c in POOL and (POOL[c] is None or r["result"] in POOL[c]) and int(r["accession"][3:]) % 4 == 0 and r["accession"] not in excl:
        pool[c].add(r["accession"])
os.makedirs(OUT, exist_ok=True)
rows, stage, missing = [], [], []
for cls in ("qe", "astral"):
    order = sorted(pool[cls])
    random.Random(f"{SEED}:{cls}").shuffle(order)
    taken = 0
    for rank, a in enumerate(order, 1):
        if taken >= TAKE[cls]:
            rows.append((cls, a, rank, "not_needed", "")); continue
        pj, fj = f"{IN}/pride/{a}.project.json", f"{IN}/pride/{a}.files.json"
        if not os.path.exists(pj) or not os.path.exists(fj):
            missing.append(a); rows.append((cls, a, rank, "NOT_FETCHED", "")); taken += 1; continue
        p = json.load(open(pj))
        res, note = project_rule(p, cls)
        if res != "OK":
            rows.append((cls, a, rank, res, note)); continue
        el = eligible(json.load(open(fj)), cls, p)
        if not el:
            rows.append((cls, a, rank, "no_eligible_file", "")); continue
        if a in REVIEW:
            rows.append((cls, a, rank, "review_reject", REVIEW[a])); continue
        random.Random(f"{SEED}:{cls}:{a}").shuffle(el)
        if a in QUALFAIL:
            rows.append((cls, a, rank, "qualification_failed", f"{el[0]['fileName']}: {QUALFAIL[a]}")); continue
        taken += 1
        rows.append((cls, a, rank, "TAKEN", f"{len(el)} eligible files; chosen {el[0]['fileName']}"))
        for role, x in (("chosen", el[0]), ("backup", el[1] if len(el) > 1 else None)):
            if x is None:
                continue
            url = next(l["value"] for l in x["publicFileLocations"] if l["name"] == "FTP Protocol")
            url = url.replace("ftp://ftp.pride.ebi.ac.uk/", "https://ftp.pride.ebi.ac.uk/")
            stage.append((role, cls, a, x["fileName"], x["fileSizeBytes"], x.get("checksum") or "-", url))
if missing:
    print("FETCH", *missing)
    sys.exit(1)
with open(f"{OUT}/draw.tsv", "w") as f:
    f.write("class\taccession\tdraw_rank\tresult\tnote\n")
    for r in rows:
        f.write("\t".join(map(str, r)) + "\n")
with open(f"{OUT}/stage.tsv", "w") as f:
    f.write("role\tclass\taccession\tfile\tbytes\tpride_sha1\turl\n")
    for r in stage:
        f.write("\t".join(map(str, r)) + "\n")
for r in rows:
    if r[3] != "not_needed":
        print(*r, sep="\t")
