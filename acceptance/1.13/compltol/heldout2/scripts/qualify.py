#!/usr/bin/env python3
"""compltol held-out 2: qualification of the staged candidates and the manifest rows. No FASTag run.
qualify.py <candidates.tsv> <H = work dir on data> <out qualification.tsv> <out manifest.tsv>
A candidate qualifies when: download ok, mzML present, at least 95 % of its MS2 filter strings name the stratum's
analyser (ion_trap ITMS, qe FTMS, astral ASTMS), Sage rc 0, and at least 1000 target rank-1 PSMs at
spectrum_q <= 0.01. Selected: per stratum the qualifying projects in draw order, at most 3 projects."""
import csv, hashlib, re, subprocess, sys
from pathlib import Path

AN = {"ion_trap": "ITMS", "qe": "FTMS", "astral": "ASTMS"}
MAXP, MINPSM = 3, 1000
cand, H, outq, outm = sys.argv[1:5]
H = Path(H)


def sha(p):
    return subprocess.run(["sha256sum", str(p)], capture_output=True, text=True).stdout[:64]


rows = list(csv.DictReader(open(cand), delimiter="\t"))
taken = {}
Q, M = [], []
for r in rows:
    stem = r["file"][:-4]
    mz = H / "staged/compltol/H2" / r["pxd"] / f"{stem}.mzML"
    T = H / "truth/compltol-H2/compltol/H2" / r["pxd"] / stem
    raw = H / "raw" / r["pxd"] / r["file"]
    q = dict(stratum=r["stratum"], draw_rank=r["draw_rank"], pxd=r["pxd"], file=r["file"])
    q["download"] = "ok" if raw.exists() and raw.stat().st_size == int(r["bytes"]) else "FAILED"
    counts, psm, src = {}, {}, "-"
    if mz.exists():
        out = subprocess.run(f"grep -o 'MS:1000512\" value=\"[A-Z]*MS [^\"]* ms2 ' '{mz}' | sed 's/.*value=\"//' | cut -d' ' -f1 | sort | uniq -c",
                             shell=True, capture_output=True, text=True).stdout
        counts = {b: int(a) for a, b in (l.split() for l in out.splitlines())}
    if (T / "sage.log").exists():
        m = re.search(r"SAGE_RC=(\d+)", (T / "sage.log").read_text(errors="replace"))
        src = m.group(1) if m else "-"
    if (T / "results.sage.tsv").exists():
        with open(T / "results.sage.tsv") as f:
            for x in csv.DictReader(f, delimiter="\t"):
                if x["label"] == "1" and x["rank"] == "1" and float(x["spectrum_q"]) <= 0.01:
                    z = min(int(x["charge"]), 4)
                    psm[z] = psm.get(z, 0) + 1
    n, want = sum(counts.values()), counts.get(AN[r["stratum"]], 0)
    q["ms2"] = n
    q["ms2_filter"] = ",".join(f"{k}:{v}" for k, v in sorted(counts.items())) or "-"
    q["sage_rc"] = src
    q["target_psms_q01"] = sum(psm.values())
    q["by_charge"] = ",".join(f"z{k}{'+' if k == 4 else ''}:{v}" for k, v in sorted(psm.items())) or "-"
    why = ("download" if q["download"] != "ok" else "no mzML" if not mz.exists() else
           f"MS2 analyser not {AN[r['stratum']]}" if n == 0 or want / n < 0.95 else
           "Sage failed" if src != "0" else f"fewer than {MINPSM} PSMs" if q["target_psms_q01"] < MINPSM else "")
    q["qualifies"] = "no: " + why if why else "yes"
    pr = taken.setdefault(r["stratum"], [])
    sel = not why and (r["pxd"] in pr or len(pr) < MAXP)
    if sel and r["pxd"] not in pr:
        pr.append(r["pxd"])
    q["selected"] = "yes" if sel else "no"
    Q.append(q)
    if sel:
        M.append(dict(item="compltol", split="H2", stratum=r["stratum"], pxd=r["pxd"], run=stem, corpus="PRIDE",
                      source=r["url"], source_sha256=sha(raw), source_bytes=r["bytes"],
                      fastag_input=f"compltol/H2/{r['pxd']}/{stem}.mzML", fastag_input_sha256=sha(mz),
                      conversion="ThermoRawFileParser -f 2", instrument=r["instruments"], ms2_filter=q["ms2_filter"],
                      ms2_analyser={"ion_trap": "ion_trap", "qe": "orbitrap", "astral": "astral"}[r["stratum"]],
                      truth_sha256=sha(T / "results.sage.tsv"), truth_psms_q01=str(q["target_psms_q01"]),
                      truth_by_charge=q["by_charge"], fastag_input_bytes=str(mz.stat().st_size),
                      draw_rank=r["draw_rank"]))
for path, R in ((outq, Q), (outm, M)):
    with open(path, "w") as f:
        if path == outm:
            f.write("# compltol-H2: held-out 2 of compltol; staged under data:/scratch/kohlbach/b113/compltol/heldout2/staged (fastag_input relative to it); rows written by compltol/heldout2/scripts/qualify.py\n")
        f.write("\t".join(R[0].keys()) + "\n")
        for x in R:
            f.write("\t".join(str(v) for v in x.values()) + "\n")
