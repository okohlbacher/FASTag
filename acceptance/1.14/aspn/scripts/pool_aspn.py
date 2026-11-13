#!/usr/bin/env python3
"""pool_aspn.py <pool_raw.tsv> <proj dir> -> pool.tsv (stdout). Metadata filter of the Asp-N pool (PREREG-aspn):
record exists; a panel organism; an Orbitrap instrument that can do HCD; not cross-linking or top-down only;
the sample processing protocol or description names Asp-N."""
import csv, json, re, sys
PANEL = {"homo sapiens": "Homo_sapiens", "mus musculus": "Mus_musculus", "rattus norvegicus": "Rattus_norvegicus",
         "saccharomyces cerevisiae": "Saccharomyces_cerevisiae", "escherichia coli": "Escherichia_coli",
         "arabidopsis thaliana": "Arabidopsis_thaliana", "bacillus subtilis": "Bacillus_subtilis", "bos taurus": "Bos_taurus",
         "caenorhabditis elegans": "Caenorhabditis_elegans", "danio rerio": "Danio_rerio",
         "drosophila melanogaster": "Drosophila_melanogaster", "sus scrofa": "Sus_scrofa"}
INS = re.compile(r"exactive|fusion|lumos|eclipse|exploris|astral|elite|velos|ascend|tribrid", re.I)
ASPN = re.compile(r"asp[-_ ]?n(?![a-z])|endoproteinase asp|aspn", re.I)
BADX = re.compile(r"cross-linking|top-down", re.I)
print("accession\tsource\torganisms\tpanel\tinstruments\texperiment\tn_raw\tn_raw_aspn_named\ttitle")
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    a = r["accession"]
    try: d = json.load(open(f"{sys.argv[2]}/{a}.project.json"))
    except Exception: continue
    if not d or isinstance(d, list): continue
    nm = lambda k: [x.get("name", "") if isinstance(x, dict) else str(x) for x in d.get(k, [])]
    orgs = nm("organisms"); panel = sorted({v for o in orgs for k, v in PANEL.items() if k in o.lower()})
    ins = nm("instruments"); ex = nm("experimentTypes")
    text = (d.get("sampleProcessingProtocol") or "") + " " + (d.get("projectDescription") or "") + " " + (d.get("title") or "")
    if not panel or not any(INS.search(i) for i in ins) or not ASPN.search(text): continue
    if ex and all(BADX.search(e) for e in ex): continue
    raws = [n for n in d.get("projectFileNames", []) if n.lower().endswith(".raw")]
    named = [n for n in raws if re.search(r"asp[-_ ]?n(?![a-z])", n, re.I)]
    print(a, r["source"], ";".join(orgs), ";".join(panel), ";".join(ins), ";".join(ex), len(raws), len(named), d.get("title", "")[:120], sep="\t")
