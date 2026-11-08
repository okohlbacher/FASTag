#!/usr/bin/env python3
"""FASTag 1.12 held-out selection from the prose-auto heldout and validation_v3 corpora (#2, #6, #9).

Selection rules (PLAN-data-types.md, fixed here before any held-out run; no FASTag output is read):
  #2 H1   the 12 runs the plan names (PXD066944, PXD070049, PXD074582 Astral; PXD000806, PXD001473, PXD001739,
          PXD002429, PXD003397 ion trap; PXD033741, PXD050504, PXD076520 timsTOF; PXD001540 QE). Each corpus PXD
          has exactly one run; that run is H1.
  #2 H2   reserve, >= 2 per class from the same corpora, drawn BEFORE H1 runs: candidates are corpus runs that are
          DDA (frozen #7 call 'DDA' on the E7-02 sweep and prose-auto acquisition truth DDA where given) with MS2 in
          the class analyser (Astral: ASTMS filter; ion trap: ITMS filter; timsTOF: ddaPASEF .d; QE: Q Exactive
          model with FTMS MS2); not an H1 PXD, not a #2 DEV PXD, not a FASTag gate/dev-case input PXD. Per class the
          candidates are sorted by PXD and shuffled with random.Random('fastag-1.12:#2:H2:<class>'); first 2 taken.
  #6 H1   the 5 runs the plan names (PXD000806, PXD001473, PXD002429, PXD066944, PXD001540) = the #2 H1 runs.
  #6 H2   the #2 H2 runs of the #6 classes (ion trap, Astral, QE), reserved per class.
  #9 H1   profile-MS2 runs: corpus runs whose first MS2 filter string shows profile acquisition (' p '), DDA as
          above, raw file on /ceph (bench2/raw; needed to convert without peak picking so the MS2 are MS:1000128),
          collisional MS2 only (HCD/CID in the filter, no ETD/EThcD: the truth is a b/y Sage search),
          not PXD000865 (DEV) and not a gate/dev-case PXD. Strata by MS2 analyser: orbitrap_tof (FTMS) and
          ion_trap (ITMS). Draw per stratum with random.Random('fastag-1.12:#9:<stratum>'): ion_trap 1,
          orbitrap_tof 2 (>= 3 runs, >= 1 ion trap). Reserve: next ion_trap candidate, else next orbitrap_tof.
Usage: select_corpus.py <inputs dir> <manifests dir>
"""
import csv, os, random, sys

INP, OUT = sys.argv[1], sys.argv[2]
GATE_PXD = {"PXD003531", "PXD004541", "PXD040407", "PXD014764", "PXD010783",      # refs-1.10.0 gate inputs
            "PXD006096", "PXD000865", "PXD060724", "PXD047793", "PXD017703", "PXD049692"}  # 1.12 dev cases/checks
DEV = {"#2": {"PXD076528", "PXD001819", "PXD003531", "PXD054073", "PXD000001"},
       "#6": {"PXD001819", "PXD003531"},
       "#9": {"PXD000865"}}
H1_2 = {"PXD066944": "astral", "PXD070049": "astral", "PXD074582": "astral",
        "PXD000806": "ion_trap", "PXD001473": "ion_trap", "PXD001739": "ion_trap", "PXD002429": "ion_trap",
        "PXD003397": "ion_trap", "PXD033741": "timstof", "PXD050504": "timstof", "PXD076520": "timstof",
        "PXD001540": "qe"}
H1_6 = ["PXD000806", "PXD001473", "PXD002429", "PXD066944", "PXD001540"]

def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("#")), delimiter="\t"))

sweep = {r["id"]: r for r in rd(f"{INP}/e7-02-sweep.tsv") if r["corpus"] in ("heldout", "validation_v3")}
scan = {r["id"]: r for r in rd(f"{INP}/prose_corpus_ms2scan.tsv")}
truth = {}
for r in rd(f"{INP}/prose_corpus_settings.tsv"):
    if r["parameter"] == "acquisition":
        truth[r["dataset"]] = r["truth"]
raw = {}
for l in open(f"{INP}/prose_bench2_raw.tsv"):
    p, path, size = l.rstrip("\n").split("\t")
    if path.lower().endswith(".raw"):
        raw.setdefault(p, []).append((path, size))

def cls(i):
    s, c = sweep[i], scan.get(i, {})
    filt, model = c.get("filter", ""), c.get("model", "")
    if s["input"].endswith("analysis.tdf_bin"):
        return "timstof"
    if filt.startswith("ASTMS"): return "astral"
    if filt.startswith("ITMS"): return "ion_trap"
    if filt.startswith("FTMS") and "Q Exactive" in model: return "qe"
    if filt.startswith("FTMS"): return "orbitrap_other"
    return "unknown"

def dda(i):
    s = sweep[i]
    return s["call_frozen"].startswith("Acquisition check: DDA") and truth.get(i, "DDA") in ("DDA", "")

def row(i, item, split, stratum, note):
    s, c = sweep[i], scan.get(i, {})
    d = s["input"].endswith("analysis.tdf_bin")
    return {"item": item, "split": split, "stratum": stratum, "pxd": s["pxd"], "run": s["run"], "corpus": s["corpus"],
            "source": s["input"], "source_sha256": s["input_sha256"], "source_bytes": s["input_bytes"],
            "fastag_input": s["probed_mzml"] if d else s["input"],
            "fastag_input_sha256": s["probed_mzml_sha256"] if d else s["input_sha256"],
            "conversion": "diaweaver-7ed1169 FileConverter -threads 8 (E7-02 dconv)" if d else "as in the corpus (TRFP 2.0.0 -f 2)",
            "instrument": c.get("model", ""), "ms2_filter": c.get("filter", ""), "ms2_analyser": c.get("ms2_analyser", ""),
            "e7_frozen_call": s["call_frozen"][:60], "prose_acq_truth": truth.get(i, ""), "selection": note}

def draw(cands, seed, n):
    c = sorted(cands)
    random.Random(seed).shuffle(c)
    return c[:n], c[n:]

def write(name, rows):
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/{name}.tsv", "w") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter="\t", lineterminator="\n")
        w.writeheader(); w.writerows(rows)
    print(name, len(rows))

# #2 H2 first (hashed before H1)
h2 = []
for k in ["astral", "ion_trap", "timstof", "qe"]:
    cands = [i for i in sweep if cls(i) == k and dda(i) and i not in H1_2 and i not in DEV["#2"] and i not in GATE_PXD]
    pick, rest = draw(cands, f"fastag-1.12:#2:H2:{k}", 2)
    for i in pick:
        h2.append(row(i, "#2", "H2", k, f"H2 reserve: random.Random('fastag-1.12:#2:H2:{k}') over {len(cands)} candidates"))
write("item02-H2", h2)
h1 = []
for i, k in H1_2.items():
    r = row(i, "#2", "H1", k, "H1 named by PLAN-data-types #2")
    r["check"] = "ok" if (cls(i) == k and dda(i)) else f"CHECK: class {cls(i)} dda {dda(i)}"
    h1.append(r)
write("item02-H1", h1)
write("item06-H1", [dict(r, item="#6", selection="H1 named by PLAN-data-types #6 (same run as #2 H1)")
                    for r in h1 if r["pxd"] in H1_6])
write("item06-H2", [dict(r, item="#6", selection="H2 reserve per class = the #2 H2 run of this class")
                    for r in h2 if r["stratum"] in ("ion_trap", "astral", "qe")])
# #9
c9 = {}
for i in sweep:
    f = scan.get(i, {}).get("filter", "")
    if " p " not in f or "etd" in f or "ecd" in f or not dda(i) or i in DEV["#9"] or i in GATE_PXD or i not in raw or len(raw[i]) != 1:
        continue
    k = "ion_trap" if f.startswith("ITMS") else ("orbitrap_tof" if f.startswith(("FTMS", "ASTMS")) else None)
    if k: c9.setdefault(k, []).append(i)
rows9, left = [], {}
for k, n in (("ion_trap", 1), ("orbitrap_tof", 2)):
    pick, left[k] = draw(c9.get(k, []), f"fastag-1.12:#9:{k}", n)
    for i in pick:
        rows9.append(row(i, "#9", "H1", k, f"profile MS2; random.Random('fastag-1.12:#9:{k}') over {len(c9.get(k, []))}"))
res = ("ion_trap", left["ion_trap"][0]) if left["ion_trap"] else ("orbitrap_tof", left["orbitrap_tof"][0])
rows9.append(row(res[1], "#9", "reserve", res[0], "reserve: next ion_trap candidate" if res[0] == "ion_trap" else
                 "reserve: NO second ion-trap profile run with raw in the corpus; next orbitrap_tof candidate"))
for r in rows9:
    p = raw[r["pxd"]][0]
    r.update({"source": p[0], "source_bytes": p[1], "source_sha256": "",
              "conversion": "ThermoRawFileParser 2.0.0 -f 2 -p (no peak picking: MS2 stay profile, MS:1000128)",
              "fastag_input": "", "fastag_input_sha256": "",
              "truth_input": sweep[r["pxd"]]["input"], "truth_input_sha256": sweep[r["pxd"]]["input_sha256"]})
write("item09-H1", rows9)
