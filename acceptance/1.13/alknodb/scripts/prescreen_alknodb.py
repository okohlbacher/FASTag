#!/usr/bin/env python3
"""FASTag 1.13 alknodb held-out: mechanical keyword pre-screen of the PRIDE project records, in draw order.

No file of any project is opened here and no FASTag output exists for them. The pre-screen only decides which
projects a reader looks at, and for which stratum; the reader decides the truth (PREREG-alknodb.md, Truth).

Project rules (all text fields = title, projectDescription, sampleProcessingProtocol, dataProcessingProtocol, keywords,
projectTags, experimentTypes, quantificationMethods):
  out `not_dda`   any text field names DIA, SWATH, PRM/SRM/MRM, top-down or intact-mass work (pattern NOT_DDA);
  out `no_text`   the sampleProcessingProtocol has fewer than 100 characters.
Keyword classes, on the sampleProcessingProtocol only:
  CAM    iodoacetamide / chloroacetamide and their abbreviations, carbamidomethyl
  OTHER  N-ethylmaleimide, MMTS, acrylamide (not polyacrylamide / bis-acrylamide), iodoacetic acid / iodoacetate,
         and reagents the method cannot name (vinylpyridine, iodoTMT), so that a reader can exclude those projects
  NONE   an explicit negative (not alkylated, without alkylation, no alkylation, non-alkylated, unalkylated,
         "without reduction and alkylation", "did not include reduction or alkylation", alkylation omitted/skipped)
         -- searched in the sampleProcessingProtocol, the dataProcessingProtocol and the projectDescription
  NONE_B no CAM / OTHER / NONE match, neither protocol names any reducing or alkylating agent or a cysteine
         modification (pattern ALK), and the dataProcessingProtocol states a search without fixed modifications or
         without a cysteine modification (pattern NOFIX). Evidence grade B: a candidate only, the reader must find
         a complete preparation without a reduction/alkylation step (PREREG-alknodb.md, Truth).
A project with a NONE match is a NONE candidate whatever else matches (the negative often names the reagent that
was left out; the reader excludes projects that also contain alkylated samples). Otherwise it is a candidate of
CAM or OTHER when exactly that one class matches (`mixed` when both); with no match it is a NONE_B candidate or `no_keyword`. NONE and NONE_B share the quota <n NONE>
and are all written for reading when that quota is large.
Usage: prescreen_alknodb.py <draw_order.tsv> <meta cache dir> <out tsv> <reading dir> <n CAM> <n OTHER> <n NONE>
Writes the table of all projects and, for the first n candidates of each stratum in draw order, one text file
<reading dir>/<PXD>.txt (title, description, sample processing text, reference) for the reader."""
import json, os, re, sys

ORDER, C, OUT, RD = sys.argv[1:5]
QUOTA = dict(zip(("CAM", "OTHER", "NONE"), map(int, sys.argv[5:8])))
NOT_DDA = re.compile(r"\bDIA\b|data[- ]independent|SWATH|dia-?PASEF|\bPRM\b|parallel reaction monitoring|\bSRM\b|"
                     r"\bMRM\b|reaction monitoring|top[- ]down|intact[- ](protein[- ])?mass|native MS|"
                     r"native mass spectrometry")
CAM = re.compile(r"iodo?acet(o)?amide|chloro?acetamide|\bIAA\b|\bIAM\b|\bCAA\b|\bIAAm\b|\bIAAM\b|\bClAA\b|"
                 r"[Cc]arbamidomethyl")
OTHER = re.compile(r"[Ee]thyl[- ]?maleimide|\bNEM\b|\bMMTS\b|methane ?thiosulfonate|(?<![Pp]oly)(?<![Bb]is)"
                   r"(?<![Bb]is-)(?<![Bb]is )[Aa]crylamide|[Ii]odoacetic|[Ii]odoacetate|[Vv]inyl ?pyridine|"
                   r"[Ii]odo-?TMT|\bIAc\b")
NONE = re.compile(r"\b(not|non|never)[- ](reduced (and|or|nor) )?alkylated|\bun-?alkylated|"
                  r"\b(without|no|omitting|omitted|skipping|skipped|neither)[- ]((any|prior|the|a) )?"
                  r"((cysteine|cys|thiol)[- ])?((reduction|reducing|reduced)[ ,/]*(and|or|nor|&|/)[ ]*)?"
                  r"(alkylat|carbamidomethylat)|"
                  r"\b(not|n't) (include|involve|undergo|perform|subjected to|contain) ((any|a) )?"
                  r"((reduction|reducing)[ ,/]*(and|or|nor|&|/)[ ]*)?alkylat|"
                  r"alkylation (steps? )?(was|were|is|are) (omitted|skipped|not performed|not carried out|"
                  r"not done|not applied|left out)", re.I)
ALK = re.compile(r"alkylat|carbamidomethyl|iodoacet|chloroacet|maleimide|MMTS|\bDTT\b|dithiothreitol|"
                 r"dithioerythritol|TCEP|phosphine|mercaptoethanol|\bIAA\b|\bIAM\b|\bCAA\b|\bNEM\b|acrylamide|"
                 r"pyridine|thiosulfonate|reduc(ed|tion|ing)", re.I)
NOFIX = re.compile(r"\bno (fixed|static) mod|without (any )?(fixed|static) mod|"
                   r"(fixed|static) modifications?:? ?(were |was )?(not |none)|"
                   r"no (cysteine|cys) (modif|alkyl|carbamido)|unmodified cysteine", re.I)


def txt(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return " ; ".join(txt(x) for x in v)
    if isinstance(v, dict):
        return v.get("name") or v.get("referenceLine") or ""
    return str(v)


os.makedirs(RD, exist_ok=True)
rows, n = [], dict.fromkeys(QUOTA, 0)
for line in list(open(ORDER))[1:]:
    rank, a = line.split()
    f = f"{C}/{a}.project.json"
    if not os.path.exists(f):
        rows.append((rank, a, "no_record", "", "")); continue
    p = json.load(open(f))
    spp = txt(p.get("sampleProcessingProtocol"))
    allt = " \n ".join(txt(p.get(k)) for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                               "dataProcessingProtocol", "keywords", "projectTags", "experimentTypes",
                                               "quantificationMethods"))
    m = NOT_DDA.search(allt)
    if m:
        rows.append((rank, a, "not_dda", "", m.group(0))); continue
    if len(spp) < 100:
        rows.append((rank, a, "no_text", "", "")); continue
    dpp, desc = txt(p.get("dataProcessingProtocol")), txt(p.get("projectDescription"))
    hit = {"CAM": CAM.search(spp), "OTHER": OTHER.search(spp),
           "NONE": NONE.search(spp) or NONE.search(dpp) or NONE.search(desc)}
    cl = [k for k, v in hit.items() if v]
    if not cl:
        m = None if ALK.search(spp) or ALK.search(dpp) else NOFIX.search(dpp)
        if not m:
            rows.append((rank, a, "no_keyword", "", "")); continue
        hit, cl = {"NONE_B": m}, ["NONE_B"]
    kw = " | ".join(hit[k].group(0) for k in cl)
    if len(cl) > 1 and "NONE" not in cl:
        rows.append((rank, a, "mixed", "+".join(cl), kw)); continue
    k = "NONE" if "NONE" in cl else cl[0]
    q = "NONE" if k == "NONE_B" else k
    n[q] += 1
    if n[q] > QUOTA[q]:
        rows.append((rank, a, "candidate_not_read", k, kw)); continue
    rows.append((rank, a, "to_read", k, kw))
    refs = " ; ".join(f"{txt(r)} PMID {r.get('pubmedID')} DOI {r.get('doi')}" for r in p.get("references") or [])
    with open(f"{RD}/{a}.txt", "w") as o:
        o.write(f"ACCESSION: {a}\nTITLE: {txt(p.get('title'))}\nORGANISMS: {txt(p.get('organisms'))}\n"
                f"INSTRUMENTS: {txt(p.get('instruments'))}\nREFERENCE: {refs or '-'}\n"
                f"PROJECT DESCRIPTION: {txt(p.get('projectDescription'))}\n"
                f"SAMPLE PROCESSING PROTOCOL: {spp}\nDATA PROCESSING PROTOCOL: {dpp}\n")
with open(OUT, "w") as o:
    o.write("draw_rank\tpxd\tprescreen\tkeyword_class\tkeyword\n")
    for r in rows:
        o.write("\t".join(r) + "\n")
from collections import Counter
print(Counter((r[2], r[3]) for r in rows))
