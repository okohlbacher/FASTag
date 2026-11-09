#!/usr/bin/env python3
"""hdrcharge (FASTag 1.13, backlog #14) scorer: -check_header_charge verdicts against a Sage charge truth.

Inputs per run: the -check_header_out table of a warn (or override) run on the input AS GIVEN, and Sage's
results.sage.tsv of the charge-stripped copy (charge_truth: precursor_charge [1, 4], isotope_errors [-1, 3]).
Truth: target, rank 1, spectrum_q <= 0.01 PSMs; the Sage charge labels the spectrum. Denominator: truth spectra
that carry a header charge in 1..4 (Sage's charge range) and appear in the check table. A header is 'right' when it
equals the Sage charge, else 'wrong'. Optional third argument: a perturbation table (key, header_original,
header_given; DEV only) -- then the truth is the original header where Sage confirms it (perturbed spectra whose
original header Sage does not confirm are left out).

Per run and pooled:
  n, n_wrong, flagged (verdict disagree), tp (flagged & wrong), fp (flagged & right),
  sensitivity = tp / n_wrong, false_alarm = fp / n_right (Wilson 95 % upper bound), precision = tp / flagged,
  call_right = flagged & call == truth, fixed = flagged & wrong & call == truth, broken = fp,
  net = (fixed - broken) per 1000 truth spectra, with a 95 % bootstrap interval over spectra (2000 draws, seed 1).
A label '<run>:<stratum>' also pools its rows per stratum.
Usage: score_hdrcharge.py <out.tsv> <label>=<check.tsv>,<results.sage.tsv>[,<perturbed.tsv>] ..."""
import csv
import math
import random
import re
import sys

SCAN = re.compile(r"scan=(\d+)")


def key(native):
    m = SCAN.search(native)
    return f"scan={m.group(1)}" if m else native


def sage_truth(path):
    out = {}
    with open(path) as f:
        r = csv.DictReader(f, delimiter="\t")
        best = {}
        for row in r:
            if int(row["label"]) != 1 or float(row["spectrum_q"]) > 0.01:
                continue
            if "rank" in row and row["rank"] not in ("", "1"):
                continue
            k = key(row["scannr"])
            if k in best:
                continue
            best[k] = int(row["charge"])
        out = best
    return out


def wilson_hi(k, n, z=1.959964):
    if n == 0:
        return float("nan")
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    a = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c + a) / d


def score(rows):
    n = len(rows)
    wrong = sum(1 for r in rows if r["header"] != r["truth"])
    flagged = [r for r in rows if r["verdict"] == "disagree"]
    tp = sum(1 for r in flagged if r["header"] != r["truth"])
    fp = len(flagged) - tp
    fixed = sum(1 for r in flagged if r["header"] != r["truth"] and r["call"] == r["truth"])
    call_right = sum(1 for r in flagged if r["call"] == r["truth"])
    right = n - wrong
    gain = [(1 if (r["verdict"] == "disagree" and r["header"] != r["truth"] and r["call"] == r["truth"]) else 0)
            - (1 if (r["verdict"] == "disagree" and r["header"] == r["truth"]) else 0) for r in rows]
    rng = random.Random(1)
    boot = []
    if n:
        for _ in range(2000):
            s = sum(gain[rng.randrange(n)] for _ in range(n))
            boot.append(1000.0 * s / n)
        boot.sort()
    nan = float("nan")
    return {
        "n": n, "n_wrong": wrong, "flagged": len(flagged), "tp": tp, "fp": fp, "fixed": fixed,
        "call_right": call_right,
        "sensitivity": tp / wrong if wrong else nan,
        "false_alarm": fp / right if right else nan, "false_alarm_hi95": wilson_hi(fp, right),
        "precision": tp / len(flagged) if flagged else nan,
        "call_precision": call_right / len(flagged) if flagged else nan,
        "net_per_1000": 1000.0 * (fixed - fp) / n if n else nan,
        "net_lo95": boot[int(0.025 * len(boot))] if boot else nan,
        "net_hi95": boot[int(0.975 * len(boot)) - 1] if boot else nan,
    }


def load(spec):
    label, paths = spec.split("=", 1)
    parts = paths.split(",")
    check, sage = parts[0], parts[1]
    pert = parts[2] if len(parts) > 2 else None
    truth = sage_truth(sage)
    orig = {}
    if pert:
        with open(pert) as f:
            for row in csv.DictReader(f, delimiter="\t"):
                orig[row["key"]] = int(row["header_original"])
    rows = []
    with open(check) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            k = key(row["native_id"])
            if k not in truth:
                continue
            h = int(row["header_charge"])
            t = truth[k]
            if pert:
                o = orig.get(k, h)
                if o != t:
                    continue  # Sage does not confirm the original header
                t = o
            if not 1 <= h <= 4:
                continue
            rows.append({"header": h, "truth": t, "call": int(row["call_charge"]), "verdict": row["verdict"],
                         "basis": row["basis"]})
    return label, rows


def main():
    out = sys.argv[1]
    allrows = []
    res = []
    strata = {}
    for spec in sys.argv[2:]:
        label, rows = load(spec)
        allrows += rows
        res.append((label, score(rows)))
        if ":" in label:
            strata.setdefault(label.split(":", 1)[1], []).extend(rows)
    for st in sorted(strata):
        res.append(("stratum:" + st, score(strata[st])))
    res.append(("pooled", score(allrows)))
    cols = list(res[0][1].keys())
    with open(out, "w") as f:
        f.write("run\t" + "\t".join(cols) + "\n")
        for label, s in res:
            f.write(label + "\t" + "\t".join(f"{s[c]:.4f}" if isinstance(s[c], float) else str(s[c]) for c in cols) + "\n")
    with open(out) as f:
        sys.stdout.write(f.read())


if __name__ == "__main__":
    main()
