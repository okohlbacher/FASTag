#!/usr/bin/env python3
"""compltol held-out 3: qualification of the staged candidates and the manifest rows (freeze 2). No FASTag run.

qualify.py <heldout3 dir> <H = work dir on data> <out qualification.tsv> <out manifest.tsv>
Inputs: select/candidates.tsv, $H/staged.tsv (stage_all.sh), audit.tsv (truth audit, heldout3 dir), the Sage results.
Set of a candidate: draw timstof -> timstof; draw ltq -> ion_trap when >= 95 % of its MS2 filter strings are ITMS,
ft_old when >= 95 % are FTMS (else it does not qualify).
Qualifies: download ok (size, and SHA-1 where PRIDE gives one), mzML written, Sage rc 0, >= 1000 target rank-1 PSMs at
spectrum_q <= 0.01; ion_trap also >= 1000 of them at charge 3; timstof also <= 10 % of the MS2 without a precursor m/z
(dropped for the truth); the truth audit says ok. Selected: per set the first 3 qualifying projects in draw order.
Minimums: ion_trap 3 and timstof 3 selected projects, else INSUFFICIENT DATA (exit 3; the test stops before FASTag).
ft_old has no minimum (0 to 3)."""
import csv, subprocess, sys
from pathlib import Path

MAXP, MINPSM, MINZ3_IT, MAXDROP_TIMS = 3, 1000, 1000, 0.10
MINSEL = {"ion_trap": 3, "timstof": 3, "ft_old": 0}
D, H, outq, outm = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]


def tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def sha(p):
    return subprocess.run(["sha256sum", str(p)], capture_output=True, text=True).stdout[:64]


cand = tsv(D / "select/candidates.tsv")
staged = {r["pxd"]: r for r in tsv(H / "staged.tsv")}
audit = {r["pxd"]: r for r in tsv(D / "audit.tsv")}
taken, Q, M = {}, [], []
for c in cand:
    s = staged.get(c["pxd"], {})
    stem = s.get("run", "-")
    rel = f"compltol/H3/{c['pxd']}/{stem}"
    mz = H / "staged" / f"{rel}.mzML"
    T = H / "truth/compltol-H3" / rel / "results.sage.tsv"
    st = ("timstof" if c["draw"] == "timstof" else {"H3-ltq-itms": "ion_trap", "H3-ltq-ftms": "ft_old"}.get(s.get("truth_table"), "-"))
    psm = {}
    if T.exists():
        for x in tsv(T):
            if x["label"] == "1" and x["rank"] == "1" and float(x["spectrum_q"]) <= 0.01:
                z = min(int(x["charge"]), 4)
                psm[z] = psm.get(z, 0) + 1
    n = sum(psm.values())
    ms2 = int(s["ms2"]) if s.get("ms2", "-") not in ("-", "") else 0
    drop = int(s["ms2_dropped_noprec"]) if s.get("ms2_dropped_noprec", "-") not in ("-", "") else 0
    a = audit.get(c["pxd"], {"audit": "missing", "reason": "no audit row"})
    why = ("download" if s.get("download") not in ("size_ok", "sha1_ok") else
           "no mzML" if not mz.exists() else
           "MS2 analyser neither >= 95 % ITMS nor >= 95 % FTMS" if st == "-" else
           "Sage failed" if s.get("sage_rc") != "0" or not T.exists() else
           f"fewer than {MINPSM} PSMs" if n < MINPSM else
           f"fewer than {MINZ3_IT} charge-3 PSMs" if st == "ion_trap" and psm.get(3, 0) < MINZ3_IT else
           "more than 10 % of the MS2 without precursor m/z" if st == "timstof" and (not ms2 or drop > MAXDROP_TIMS * ms2) else
           f"truth audit: {a['reason']}" if a["audit"] != "ok" else "")
    pr = taken.setdefault(st, [])
    sel = not why and len(pr) < MAXP
    if sel:
        pr.append(c["pxd"])
    by = ",".join(f"z{k}{'+' if k == 4 else ''}:{v}" for k, v in sorted(psm.items())) or "-"
    Q.append(dict(draw=c["draw"], draw_rank=c["draw_rank"], pxd=c["pxd"], file=c["file"], set=st,
                  download=s.get("download", "-"), ms2=ms2, ms2_filter=s.get("ms2_filter", "-"), ms2_dropped_noprec=drop,
                  sage_rc=s.get("sage_rc", "-"), target_psms_q01=n, by_charge=by, audit=a["audit"],
                  qualifies="no: " + why if why else "yes", selected="yes" if sel else "no"))
    if sel:
        M.append(dict(item="compltol", split="H3", stratum=st, pxd=c["pxd"], run=stem, corpus="PRIDE", source=c["url"],
                      source_sha256=s["raw_sha256"], source_bytes=c["bytes"], fastag_input=f"{rel}.mzML",
                      fastag_input_sha256=sha(mz), fastag_input_bytes=str(mz.stat().st_size),
                      conversion=("ThermoRawFileParser -f 2" if c["draw"] == "ltq" else "diaweaver-7ed1169 FileConverter"),
                      instrument=c["instruments"], ms2_filter=s.get("ms2_filter", "-"),
                      ms2_analyser={"ion_trap": "ion_trap", "ft_old": "orbitrap", "timstof": "tof"}[st],
                      truth_table=s["truth_table"], truth_sha256=sha(T), truth_psms_q01=str(n), truth_by_charge=by,
                      draw_rank=c["draw_rank"]))
with open(outq, "w") as f:
    f.write("\t".join(Q[0].keys()) + "\n")
    for x in Q:
        f.write("\t".join(str(v) for v in x.values()) + "\n")
with open(outm, "w") as f:
    f.write("# compltol-H3: held-out 3 of compltol; staged under data:/scratch/kohlbach/acc114/compltol3/staged (fastag_input relative to it); rows written by compltol/heldout3/scripts/qualify.py\n")
    if M:
        f.write("\t".join(M[0].keys()) + "\n")
        for x in M:
            f.write("\t".join(str(v) for v in x.values()) + "\n")
short = {k: len(taken.get(k, [])) for k in MINSEL if len(taken.get(k, [])) < MINSEL[k]}
print({k: len(v) for k, v in taken.items()})
if short:
    print("INSUFFICIENT DATA", short)
    sys.exit(3)
print("QUALIFY OK", len(M), "runs")
