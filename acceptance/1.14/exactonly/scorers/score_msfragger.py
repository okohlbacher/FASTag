#!/usr/bin/env python3
"""Score one run directory of the msfragger held-out test (written by scripts/run_one.sh). Backlog item 18.

FDR, the same for every arm: one PSM per scan (rank 1; the highest hyperscore if a scan has several rows), sorted by
hyperscore descending (ties: decoys first, then scan number). A PSM is a decoy when every protein starts with rev_,
entrapment when every non-decoy protein starts with ENTRAP_, else target. q = decoys / max(non-decoys, 1) at each
position, made monotone from the end. Accepted: non-decoy PSMs with q <= 0.01. Peptides are compared stripped
(flanks, modifications and charge removed, I -> L).
Recall (C2): of the scans accepted in b, the share accepted in a with the same stripped peptide.
Entrapment FDP (G2) of aE and bE: 2 E / (T + E) over their accepted PSMs (r = 1).
Speed-up (G1): wall(b) / (wall(fastag) + wall(a)), wall = "Elapsed (wall clock) time" of /usr/bin/time -v.
Informational, no verdict: the expectation-value FDR; arm c (exported parameters, full proteome): recall_of_c = share of
c's accepted scans accepted in a with the same peptide (database reduction alone); b_in_c_recall = share of b's in c
(parameters alone).
Usage: score_msfragger.py <run_id> <run dir>     -> one TSV row on stdout (--header prints the header)"""
import csv, os, re, sys

COLS = ["run", "fastag_rc", "a_rc", "b_rc", "aE_rc", "bE_rc", "export_unchanged", "shortlist_targets",
        "a_psm", "b_psm", "b_in_a_same_peptide", "recall", "b_in_a_scan", "recall_scan",
        "aE_t", "aE_e", "aE_fdp", "bE_t", "bE_e", "bE_fdp",
        "t_fastag", "t_a", "t_b", "speedup", "a_psm_expect", "b_psm_expect", "recall_expect",
        "c_rc", "c_psm", "recall_of_c", "b_in_c_recall"]

def strip(p):
    p = p[2:-2] if len(p) > 4 and p[1] == "." and p[-2] == "." else p
    return re.sub(r"[^A-Z]", "", re.sub(r"\[[^\]]*\]", "", p)).replace("I", "L")

def kind(prots):
    nd = [x for x in prots if not x.startswith("rev_")]
    if not nd: return "d"
    return "e" if all(x.startswith("ENTRAP_") for x in nd) else "t"

def accepted(pin, score="hyperscore", sign=1.0):
    """{scan: (stripped peptide, kind)} of the non-decoy PSMs at q <= 0.01; None if the pin is missing."""
    if not os.path.isfile(pin):
        return None
    best = {}
    with open(pin) as f:
        hdr = f.readline().rstrip("\n").split("\t")
        ix = {n: hdr.index(n) for n in ("ScanNr", "rank", score, "Peptide", "Proteins")}
        for line in f:
            r = line.rstrip("\n").split("\t")
            if r[ix["rank"]] != "1": continue
            prots = [x for t in r[ix["Proteins"]:] for x in t.split(";") if x]
            row = (sign * float(r[ix[score]]), int(r[ix["ScanNr"]]), strip(r[ix["Peptide"]]), kind(prots))
            if row[1] not in best or row[0] > best[row[1]][0]:
                best[row[1]] = row
    rows = sorted(best.values(), key=lambda x: (-x[0], x[3] != "d", x[1]))
    d = t = 0; q = []
    for r in rows:
        if r[3] == "d": d += 1
        else: t += 1
        q.append(d / max(t, 1))
    for i in range(len(q) - 2, -1, -1):
        q[i] = min(q[i], q[i + 1])
    return {r[1]: (r[2], r[3]) for r, qq in zip(rows, q) if qq <= 0.01 and r[3] != "d"}

def wall(path):
    try:
        for l in open(path):
            if "Elapsed (wall clock)" in l:
                parts = l.rsplit(" ", 1)[1].strip().split(":")
                return sum(float(x) * 60 ** i for i, x in enumerate(reversed(parts)))
    except OSError:
        pass
    return None

def rc(d, arm):
    try: return open(f"{d}/{arm}.rc").read().strip()
    except OSError: return "NA"

def fmt(x, n=4):
    return "NA" if x is None else (f"{x:.{n}f}" if isinstance(x, float) else str(x))

def score(run, d):
    o = {"run": run}
    for arm in ("fastag", "a", "b", "aE", "bE"):
        o[f"{arm}_rc"] = rc(d, arm)
    try:
        o["export_unchanged"] = int(open(f"{d}/export.sha256.before").read() == open(f"{d}/export.sha256.after").read())
    except OSError:
        o["export_unchanged"] = 0
    try:
        o["shortlist_targets"] = sum(1 for l in open(f"{d}/fastag/red.fasta") if l.startswith(">") and not l.startswith(">rev_"))
    except OSError:
        o["shortlist_targets"] = None
    pin = lambda arm: f"{d}/{arm}/{run}.pin"
    A, B = accepted(pin("a")), accepted(pin("b"))
    o["a_psm"] = None if A is None else len(A)
    o["b_psm"] = None if B is None else len(B)
    if B:
        A0 = A or {}
        o["b_in_a_same_peptide"] = sum(1 for s, (p, _) in B.items() if s in A0 and A0[s][0] == p)
        o["b_in_a_scan"] = sum(1 for s in B if s in A0)
        o["recall"] = o["b_in_a_same_peptide"] / len(B)
        o["recall_scan"] = o["b_in_a_scan"] / len(B)
    for arm in ("aE", "bE"):
        X = accepted(pin(arm))
        if X is not None:
            t = sum(1 for v in X.values() if v[1] == "t"); e = len(X) - t
            o[f"{arm}_t"], o[f"{arm}_e"] = t, e
            o[f"{arm}_fdp"] = 2 * e / (t + e) if t + e else None
    o["t_fastag"], o["t_a"], o["t_b"] = wall(f"{d}/fastag.time"), wall(f"{d}/a.time"), wall(f"{d}/b.time")
    if None not in (o["t_fastag"], o["t_a"], o["t_b"]):
        o["speedup"] = o["t_b"] / (o["t_fastag"] + o["t_a"])
    # secondary, no verdict: the same FDR on the expectation value (log10_evalue ascending)
    Ae, Be = accepted(pin("a"), "log10_evalue", -1.0), accepted(pin("b"), "log10_evalue", -1.0)
    o["a_psm_expect"] = None if Ae is None else len(Ae)
    o["b_psm_expect"] = None if Be is None else len(Be)
    if Be:
        o["recall_expect"] = sum(1 for s, (p, _) in Be.items() if s in (Ae or {}) and Ae[s][0] == p) / len(Be)
    Cc = accepted(pin("c"))
    o["c_rc"] = rc(d, "c")
    o["c_psm"] = None if Cc is None else len(Cc)
    if Cc:
        o["recall_of_c"] = sum(1 for s, (p, _) in Cc.items() if s in (A or {}) and A[s][0] == p) / len(Cc)
    if B and Cc is not None:
        o["b_in_c_recall"] = sum(1 for s, (p, _) in B.items() if s in Cc and Cc[s][0] == p) / len(B)
    return "\t".join(fmt(o.get(c)) for c in COLS)

if __name__ == "__main__":
    if sys.argv[1:2] == ["--selftest"]:   # 1.14: synthetic checks of scorer and verdict (verdict_msfragger_test.py)
        import runpy; runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "verdict_msfragger_test.py"), run_name="__main__"); sys.exit(0)
    if sys.argv[1] == "--header":
        print("\t".join(COLS))
    else:
        print(score(sys.argv[1], sys.argv[2]))
