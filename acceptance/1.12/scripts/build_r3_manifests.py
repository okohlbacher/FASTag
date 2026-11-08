#!/usr/bin/env python3
"""Round 3 manifests (DECISIONS-2026-11-08.md, decision 3). Writes new files only; the committed manifests stay as
they are, because their sha256 is in the registry:
  manifests/item02-H2r.tsv    #2 H2 reserve from PRIDE: Astral PXD055983, timsTOF PXD070494, PXD081146
  manifests/item06-H2r.tsv    #6 H2 reserve from PRIDE: Astral PXD055983 (no timsTOF class in #6)
  manifests/item02-H1-r2.tsv  item02-H1 with PXD001540 in stratum ion_trap, plus PXD069528 (qe)
  manifests/item06-H1-r2.tsv  item06-H1 with PXD001540 in stratum ion_trap, plus PXD069528 (qe)
PXD068073 (the proposal's first Astral run) is dropped by decision 3 and appears in no manifest.
Values: staging logs from node data (inputs/staged/h2r_chosen.staged.tsv, h2r_yeast.staged.tsv: raw and FASTag
input sha256 and bytes, conversion), header checks (inputs/staged/h2r_verify_all.tsv), the draw
(inputs/h2r_stage_chosen.tsv: PRIDE URL, bytes). Selection rule: scripts/select_h2r_pride.py (cb76d59).
Usage: build_r3_manifests.py <acceptance dir>"""
import csv, os, sys

A = sys.argv[1]
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
def rows_raw(p):
    return [l.rstrip("\n").split("\t") for l in open(p) if l.strip()]
HDR_COMMENT = "# staged under data:/scratch/kohlbach/fastag-heldout-1.12\n"

staged = {}
for f in ("inputs/staged/h2r_chosen.staged.tsv", "inputs/staged/h2r_yeast.staged.tsv"):
    for r in rows_raw(f"{A}/{f}"):
        staged[r[0].split(":")[1]] = dict(raw=r[1], stage=r[2], raw_sha=r[3], mzml=r[5], mzml_bytes=r[6],
                                          mzml_sha=r[7], conv=r[8].strip())
draw = {r[0].split(":")[1]: dict(file=r[2], bytes=r[3], url=r[5]) for r in rows_raw(f"{A}/inputs/h2r_stage_chosen.tsv")}
verify = {}
for r in rows_raw(f"{A}/inputs/staged/h2r_verify_all.tsv"):
    verify[r[0].split("/")[1] + ("|zip" if r[0].endswith(".zip") else "")] = r

INFO = {  # pxd: stratum, instrument, ms2_analyser, ms2 filter / PASEF evidence, DDA evidence
 "PXD055983": ("astral", "Orbitrap Astral", "orbitrap", verify["PXD055983"][2]),
 "PXD070494": ("timstof", "timsTOF Pro", "tof", f"PASEF: PasefFrameMsMsInfo {verify['PXD070494|zip'][1]} rows, DiaFrameMsMsWindows 0"),
 "PXD081146": ("timstof", "timsTOF SCP (PRIDE lists timsTOF Pro)", "tof", f"PASEF: PasefFrameMsMsInfo {verify['PXD081146|zip'][1]} rows, DiaFrameMsMsWindows 0"),
 "PXD069528": ("qe", "Q Exactive", "orbitrap", verify["PXD069528"][2]),
}
def dda(p):
    v = verify[p]
    return f"verify_h2r.py: {v[-1]} (MS2 {v[1]}, isolation median {v[4]} Th, {v[5]})"

def new_row(item, split, pxd, cols, selection):
    s, d = staged[pxd], draw[pxd]
    stratum, instr, ana, filt = INFO[pxd]
    run = d["file"]
    for ext in (".d.zip", ".raw"):
        if run.endswith(ext): run = run[: -len(ext)]
    v = dict(item=item, split=split, stratum=stratum, pxd=pxd, run=run, corpus="PRIDE (h2r rule)", source=d["url"],
             source_sha256=s["raw_sha"], source_bytes=d["bytes"], fastag_input=s["mzml"], fastag_input_sha256=s["mzml_sha"],
             conversion=s["conv"], instrument=instr, ms2_filter=filt, ms2_analyser=ana,
             e7_frozen_call="not run (header check only)", prose_acq_truth=dda(pxd), selection=selection,
             check="ok (headers: verify_h2r.py)", stage_status=s["stage"], staged_raw=s["raw"], raw_sha256=s["raw_sha"],
             fastag_input_bytes=s["mzml_bytes"], source_fastag_input=s["mzml"], expected_sha256=s["mzml_sha"])
    return [v.get(c, "") for c in cols]

def write(name, cols, rows):
    with open(f"{A}/manifests/{name}.tsv", "w") as o:
        o.write(HDR_COMMENT + "\t".join(cols) + "\n")
        for r in rows:
            o.write("\t".join(r) + "\n")
    print(name, len(rows), "rows")

RULE = ("H2r reserve (DECISIONS-2026-11-08 #3, PRIDE, plan deviation): select_h2r_pride.py, "
        "random.Random('fastag-1.12:#2:H2r:{c}') project draw, file draw random.Random('fastag-1.12:#2:H2r:{c}:{p}')")
h2cols = open(f"{A}/manifests/item02-H2.tsv").readlines()[1].rstrip("\n").split("\t")
write("item02-H2r", h2cols, [new_row("#2", "H2r", p, h2cols, RULE.format(c=INFO[p][0], p=p))
                             for p in ("PXD055983", "PXD070494", "PXD081146")])
write("item06-H2r", h2cols, [new_row("#6", "H2r", "PXD055983", h2cols, RULE.format(c="astral", p="PXD055983")
                                     + "; #6 takes the Astral row of item02-H2r")])

for item, src in (("#2", "item02-H1"), ("#6", "item06-H1")):
    lines = open(f"{A}/manifests/{src}.tsv").readlines()
    cols = lines[1].rstrip("\n").split("\t")
    out = []
    for l in lines[2:]:
        f = l.rstrip("\n").split("\t")
        r = dict(zip(cols, f))
        if r["pxd"] == "PXD001540":
            r["stratum"] = "ion_trap"
            r["selection"] += "; r2 (DECISIONS-2026-11-08 #3): moved from the qe cell to ion_trap (Orbitrap Elite, ITMS CID MS2)"
        out.append([r[c] for c in cols])
    out.append(new_row(item, "H1", "PXD069528", cols,
                       "H1 QE cell replacement (DECISIONS-2026-11-08 #3; proposal P-H1r-qe-1, PRIDE): select_h2r_pride.py, "
                       "random.Random('fastag-1.12:#2:H2r:qe') project draw, file draw random.Random('fastag-1.12:#2:H2r:qe:PXD069528')"))
    write(f"{src}-r2", cols, out)
