#!/usr/bin/env python3
"""Descriptive scorer of backlog 23 (digqual): FASTag -digest_quality vs Sage.

    score_digqual.py <manifest.tsv> <split> <runs_dir> <out_dir>

For every manifest row of <split> it reads <runs_dir>/<run_id>/digest.tsv (FASTag) and the
row's Sage results.sage.tsv and writes <out_dir>/per_run.tsv and
<out_dir>/summary.tsv. Refuses to run when <out_dir> exists (scored once).

Sage reference per run (PREREG-digqual.md): target PSMs (label 1) with
spectrum_q <= 0.01; peptide with modifications stripped, I counted as L; a PSM
counts when its last residue (P1) is K or R; its P2..P4 are the up to three
residues before P1; sites are K or R there (no proline rule). The odds ratio
uses the background share b_S of K+R that FASTag's report states
(quality C.mc_background_share), so both sides use the same background:
retention = (sites / (positions - sites)) / (b_S / (1 - b_S)).
Also Sage's own missed_cleavages column: mean and share >= 1 over the same PSMs
(all target PSMs at 1 %, any C-terminus).

Standard library only.
"""
import csv
import math
import os
import re
import sys

csv.field_size_limit(1 << 30)


def quality(path):
    q = {}
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["section"] == "quality":
                q[r["key"]] = r["value"]
    return q


def sage(path):
    n = pos = sites = 0
    psms = mc_sum = mc_pos = 0
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["label"] != "1" or float(r["spectrum_q"]) > 0.01:
                continue
            psms += 1
            mc = int(r["missed_cleavages"])
            mc_sum += mc
            mc_pos += mc >= 1
            seq = re.sub(r"\[[^]]*\]", "", r["peptide"]).replace("-", "").replace("I", "L")
            if not seq or seq[-1] not in "KR":
                continue
            n += 1
            for c in seq[-4:-1]:
                pos += 1
                sites += c in "KR"
    return {"psms": psms, "kr_psms": n, "positions": pos, "sites": sites,
            "mc_mean": mc_sum / psms if psms else float("nan"),
            "mc_share": mc_pos / psms if psms else float("nan")}


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(x, y):
    n = len(x)
    if n < 3:
        return float("nan")
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return sxy / (sx * sy) if sx > 0 and sy > 0 else float("nan")


def spearman(x, y):
    return pearson(ranks(x), ranks(y))


def median(v):
    s = sorted(v)
    n = len(s)
    if not n:
        return float("nan")
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def main():
    manifest, split, runs, out = sys.argv[1:5]
    if os.path.exists(out):
        sys.exit(f"refusing: {out} exists (the evaluation is scored once)")
    rows = [m for m in csv.DictReader(open(manifest, newline=""), delimiter="\t") if m["split"] == split]
    per = []
    for m in rows:
        d = os.path.join(runs, m["run_id"], "digest.tsv")
        rec = {"run_id": m["run_id"], "pxd": m["pxd"]}
        if not os.path.exists(d):
            rec["status"] = "missing_fastag"
            per.append(rec)
            continue
        q = quality(d)
        s = sage(m["sage_results"])
        rec["status"] = q.get("status", "absent")
        for k in ("C.ends", "C.nonspecific_share", "C.nonspecific_mle", "C.mc_positions", "C.mc_sites",
                  "C.mc_site_share", "C.mc_background_share", "C.mc_retention"):
            rec["fastag_" + k[2:]] = q.get(k, "-")
        rec.update({"sage_" + k: v for k, v in s.items()})
        try:
            b = float(q["C.mc_background_share"])
            o, n = s["sites"], s["positions"]
            rec["sage_site_share"] = o / n if n else float("nan")
            rec["sage_retention"] = (o / (n - o)) / (b / (1 - b)) if n > o else float("nan")
        except (KeyError, ValueError):
            rec["sage_site_share"] = rec["sage_retention"] = float("nan")
        per.append(rec)
    os.makedirs(out)
    cols = []
    for r in per:
        for k in r:
            if k not in cols:
                cols.append(k)
    with open(os.path.join(out, "per_run.tsv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, cols, delimiter="\t", restval="-", lineterminator="\n")
        w.writeheader()
        w.writerows(per)

    def num(x):
        try:
            v = float(x)
            return v if math.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    ok = [r for r in per if r.get("status") == "measured" and num(r.get("fastag_mc_retention")) is not None
          and num(r.get("sage_retention")) is not None]
    fx = [num(r["fastag_mc_retention"]) for r in ok]
    sx = [num(r["sage_retention"]) for r in ok]
    mcs = [num(r["sage_mc_share"]) for r in ok]
    fs = [num(r["fastag_mc_site_share"]) for r in ok]
    ss = [num(r["sage_site_share"]) for r in ok]
    ratio = [a / b for a, b in zip(fx, sx) if b and b > 0]
    summary = [
        ("runs_manifest", len(rows)), ("runs_scored", len(ok)),
        ("runs_not_scored", ";".join(f"{r['run_id']}:{r.get('status')}" for r in per if r not in ok) or "-"),
        ("E1_spearman_retention_fastag_vs_sage", spearman(fx, sx)),
        ("E1_pearson_retention_fastag_vs_sage", pearson(fx, sx)),
        ("E2_spearman_retention_fastag_vs_sage_mc_share", spearman(fx, mcs)),
        ("E3_median_ratio_retention_fastag_over_sage", median(ratio)),
        ("E3_median_abs_diff_site_share", median([abs(a - b) for a, b in zip(fs, ss)])),
        ("median_fastag_retention", median(fx)), ("median_sage_retention", median(sx)),
        ("median_sage_mc_share", median(mcs)),
        ("median_fastag_nonspecific_mle", median([v for v in (num(r.get("fastag_nonspecific_mle")) for r in ok) if v is not None])),
    ]
    with open(os.path.join(out, "summary.tsv"), "w") as fh:
        fh.write("metric\tvalue\n")
        for k, v in summary:
            fh.write(f"{k}\t{v}\n")
    for k, v in summary:
        print(f"{k}\t{v}")


if __name__ == "__main__":
    main()
