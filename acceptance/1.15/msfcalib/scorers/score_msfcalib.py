#!/usr/bin/env python3
"""Score one run directory of the msfcalib held-out test (written by scripts/run_one.sh): one TSV row per run with
both arms (0 = export with calibrate_mass 0, 2 = the candidate's export, calibrate_mass 2).

FDR and peptide rules: accepted() and wall() of score_msfragger.py (the earlier tests' scorer, imported unchanged).
  kept_X     scans accepted in b that a{X}_r1 accepts with the same stripped peptide; recall_X = kept_X / b_psm
  aEX_fdp    entrapment FDP 2 E / (T + E) of aE{X} over its accepted PSMs
  speedup_X  wall(b) / (wall(fastag) + median(wall(a{X}_r1), wall(a{X}_r2)))
  aX_rc      "0" when both repetitions returned 0, else "<r1>,<r2>"
  rep_same_X 1 when r1 and r2 accept the same scans with the same peptides (informational)
Informational from a2_r1's log: MSFragger's optimized fragment tolerance and the median MS2 mass error before
calibration (calibration table row 001).
Usage: score_msfcalib.py <run_id> <run dir>     -> one TSV row on stdout (--header prints the header)"""
import os, re, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_msfragger import accepted, wall

COLS = ["run", "fastag_rc", "calib_logline", "export_unchanged", "shortlist_targets", "b_rc", "b_psm", "t_fastag", "t_b"]
for X in "02":
    COLS += [f"a{X}_rc", f"a{X}_psm", f"kept_{X}", f"recall_{X}", f"aE{X}_rc", f"aE{X}_t", f"aE{X}_e", f"aE{X}_fdp",
             f"t_a{X}_r1", f"t_a{X}_r2", f"speedup_{X}", f"rep_same_{X}"]
COLS += ["a2_frag_tol", "a2_cal_ms2_old_median"]

def rc(d, lab):
    try: return open(f"{d}/{lab}.rc").read().strip()
    except OSError: return "NA"

def fmt(x, n=4):
    return "NA" if x is None else (f"{x:.{n}f}" if isinstance(x, float) else str(x))

def score(run, d):
    o = {"run": run, "fastag_rc": rc(d, "fastag"), "b_rc": rc(d, "b")}
    try: o["calib_logline"] = int(open(f"{d}/calib_logline").read().strip() or 0)
    except (OSError, ValueError): o["calib_logline"] = 0
    try:
        o["export_unchanged"] = int(open(f"{d}/export.sha256.before").read() == open(f"{d}/export.sha256.after").read())
    except OSError:
        o["export_unchanged"] = 0
    try:
        o["shortlist_targets"] = sum(1 for l in open(f"{d}/fastag/red.fasta") if l.startswith(">") and not l.startswith(">rev_"))
    except OSError:
        o["shortlist_targets"] = None
    pin = lambda lab: f"{d}/{lab}/{run}.pin"
    B = accepted(pin("b"))
    o["b_psm"] = None if B is None else len(B)
    o["t_fastag"], o["t_b"] = wall(f"{d}/fastag.time"), wall(f"{d}/b.time")
    for X in "02":
        r1, r2 = rc(d, f"a{X}_r1"), rc(d, f"a{X}_r2")
        o[f"a{X}_rc"] = "0" if r1 == r2 == "0" else f"{r1},{r2}"
        A, A2 = accepted(pin(f"a{X}_r1")), accepted(pin(f"a{X}_r2"))
        o[f"a{X}_psm"] = None if A is None else len(A)
        if B:
            o[f"kept_{X}"] = sum(1 for s, (p, _) in B.items() if s in (A or {}) and A[s][0] == p)
            o[f"recall_{X}"] = o[f"kept_{X}"] / len(B)
        if A is not None and A2 is not None:
            o[f"rep_same_{X}"] = int({s: v[0] for s, v in A.items()} == {s: v[0] for s, v in A2.items()})
        o[f"aE{X}_rc"] = rc(d, f"aE{X}")
        E = accepted(pin(f"aE{X}"))
        if E is not None:
            t = sum(1 for v in E.values() if v[1] == "t"); e = len(E) - t
            o[f"aE{X}_t"], o[f"aE{X}_e"] = t, e
            o[f"aE{X}_fdp"] = 2 * e / (t + e) if t + e else None
        o[f"t_a{X}_r1"], o[f"t_a{X}_r2"] = wall(f"{d}/a{X}_r1.time"), wall(f"{d}/a{X}_r2.time")
        if None not in (o["t_b"], o["t_fastag"], o[f"t_a{X}_r1"], o[f"t_a{X}_r2"]):
            o[f"speedup_{X}"] = o["t_b"] / (o["t_fastag"] + statistics.median([o[f"t_a{X}_r1"], o[f"t_a{X}_r2"]]))
    try:
        log = open(f"{d}/a2_r1.log", errors="replace").read()
        m = re.search(r"New fragment_mass_tolerance = ([\d.]+)", log)
        c = re.search(r"\n 001 \|\s+\S+\s+\S+ \|\s+\S+\s+\S+ \|\s+(\S+)\s+(\S+) \|", log)
        o["a2_frag_tol"] = m.group(1) if m else None
        o["a2_cal_ms2_old_median"] = c.group(1) if c else None
    except OSError:
        pass
    return "\t".join(fmt(o.get(c)) for c in COLS)

if __name__ == "__main__":
    if sys.argv[1] == "--header":
        print("\t".join(COLS))
    else:
        print(score(sys.argv[1], sys.argv[2]))
