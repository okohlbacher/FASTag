#!/usr/bin/env python3
"""FASTag 1.13 alknodb held-out scorer and verdict (PREREG-alknodb.md). Scores once: refuses when <out>/verdict.txt
exists.

Per manifest row (one run per PXD): the call is the `alkylation_tags_call reagent` of <runs>/<PXD>/alkt.tsv when
`status` is `call`, else `no_call` with its `reason`; `no_report` when status.json is missing, rc is not 0, or the
report has no call section. Truth -> expected call: the manifest column `truth` is already one of the method's class
names (Carbamidomethyl, Nethylmaleimide, Methylthio, Propionamide, Carboxymethyl, none).

Primary endpoint: accuracy among called runs = (runs with call == truth) / (runs with status call), with the 95 %
Wilson interval (z = 1.959963984540054).
Verdict:
  INCONCLUSIVE  more than 10 % of the manifest rows are `no_report` (the run failed technically); else
  FAIL          fewer than 30 runs are called, or the accuracy among calls is below 0.80; else
  PASS          the lower end of the Wilson interval is at least 0.80; else
  INCONCLUSIVE  (at least 30 calls, accuracy at least 0.80, lower end below 0.80).
Secondary (no verdict): call rate overall and per stratum; recall of `none` on the not-alkylated stratum; accuracy
among calls per stratum and per truth reagent; truth x call table with the no-call reasons; agreement with the
database call (<runs>/<PXD>/alkdb.tsv, section alkylation_call) on the rows that have one.
Usage: score_alknodb.py <manifest.tsv> <runs dir> <out dir>"""
import csv, json, math, os, sys
from collections import Counter

Z = 1.959963984540054
MIN_CALLS, MIN_ACC, MAX_NO_REPORT = 30, 0.80, 0.10
CLASSES = ("Carbamidomethyl", "Nethylmaleimide", "Methylthio", "Propionamide", "Carboxymethyl", "none")
STRATA = ("CAM", "OTHER", "NONE")


def wilson(k, n):
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + Z * Z / n
    c = (ph + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(ph * (1 - ph) / n + Z * Z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def report(f):
    rep = {}
    if os.path.exists(f):
        for line in open(f):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3:
                rep[(p[0], p[1])] = p[2]
    return rep


def read_call(d, name, section):
    """(call, reason): reagent | no_call | no_report"""
    rep = report(f"{d}/{name}")
    st = rep.get((section, "status"))
    if st is None:
        return "no_report", "-"
    if st == "call":
        return rep.get((section, "reagent"), "no_report"), "-"
    return "no_call", rep.get((section, "reason"), "-")


def verdict(n, n_no_report, called, right):
    lo, hi = wilson(right, called)
    acc = right / called if called else float("nan")
    if n == 0 or n_no_report > MAX_NO_REPORT * n:
        v = "INCONCLUSIVE"
        why = f"{n_no_report} of {n} runs gave no report (more than {MAX_NO_REPORT:.0%})"
    elif called < MIN_CALLS:
        v, why = "FAIL", f"{called} runs called, fewer than {MIN_CALLS}"
    elif acc < MIN_ACC:
        v, why = "FAIL", f"accuracy among calls {acc:.3f} below {MIN_ACC}"
    elif lo >= MIN_ACC:
        v, why = "PASS", f"{called} runs called, Wilson lower end {lo:.3f} at least {MIN_ACC}"
    else:
        v, why = "INCONCLUSIVE", f"accuracy among calls {acc:.3f} at least {MIN_ACC}, Wilson lower end {lo:.3f} below it"
    return v, why, acc, lo, hi


def frac(k, n):
    return f"{k}/{n}" + (f" = {k / n:.3f}" if n else "")


def main(man, runs, out):
    if os.path.exists(f"{out}/verdict.txt"):
        sys.exit("verdict.txt exists: the held-out run is scored once")
    rows = list(csv.DictReader((l for l in open(man) if not l.startswith("#")), delimiter="\t"))
    for r in rows:
        if r["truth"] not in CLASSES or r["stratum"] not in STRATA:
            sys.exit(f"bad manifest row {r['pxd']}")
    if len({r["pxd"] for r in rows}) != len(rows):
        sys.exit("a PXD occurs twice in the manifest")
    tab = []
    for r in rows:
        d = f"{runs}/{r['pxd']}"
        st = json.load(open(f"{d}/status.json")) if os.path.exists(f"{d}/status.json") else {}
        call, reason = read_call(d, "alkt.tsv", "alkylation_tags_call") if st.get("rc") == 0 else ("no_report", "-")
        if call == "no_report":
            reason = st.get("status", "no_status") + (f",rc={st.get('rc')}" if st else "")
        rep = report(f"{d}/alkt.tsv")
        votes = [rep.get(("alkt_form", c if c != "none" else "unmodified"), "-") for c in CLASSES]
        db, db_reason = ("-", "-")
        if r.get("db_fasta", "-") != "-":
            db, db_reason = read_call(d, "alkdb.tsv", "alkylation_call") if st.get("rc_db") == 0 else ("no_report", "-")
        ok = "-" if call in ("no_call", "no_report") else str(int(call == r["truth"]))
        tab.append(dict(pxd=r["pxd"], run=r["run"], stratum=r["stratum"], truth=r["truth"], call=call, reason=reason,
                        right=ok, share=rep.get(("alkylation_tags_call", "share"), "-"),
                        votes=rep.get(("alkt_run", "spectra"), "-"), **{f"v_{c}": v for c, v in zip(CLASSES, votes)},
                        db_call=db, db_reason=db_reason))
    os.makedirs(out, exist_ok=True)
    with open(f"{out}/calls.tsv", "w") as o:
        o.write("\t".join(tab[0].keys()) + "\n")
        for t in tab:
            o.write("\t".join(str(x) for x in t.values()) + "\n")
    n = len(tab)
    nr = sum(t["call"] == "no_report" for t in tab)
    called = [t for t in tab if t["right"] != "-"]
    right = sum(t["right"] == "1" for t in called)
    v, why, acc, lo, hi = verdict(n, nr, len(called), right)
    L = [f"alknodb held-out: {n} runs; no_report {nr}",
         f"PRIMARY accuracy among calls {frac(right, len(called))} (Wilson 95 % {lo:.3f}-{hi:.3f}); "
         f"criterion: at least {MIN_CALLS} calls and lower end at least {MIN_ACC}",
         f"VERDICT {v}: {why}", "", "SECONDARY (no verdict)", f"call rate {frac(len(called), n)}"]
    for s in STRATA:
        ts = [t for t in tab if t["stratum"] == s]
        cs = [t for t in ts if t["right"] != "-"]
        k = sum(t["right"] == "1" for t in cs)
        l2, h2 = wilson(k, len(cs))
        L.append(f"stratum {s}: runs {len(ts)}; call rate {frac(len(cs), len(ts))}; accuracy among calls "
                 f"{frac(k, len(cs))}" + (f" (Wilson {l2:.3f}-{h2:.3f})" if cs else ""))
    for c in CLASSES:
        ts = [t for t in tab if t["truth"] == c]
        cs = [t for t in ts if t["right"] != "-"]
        if ts:
            L.append(f"truth {c}: runs {len(ts)}; called {len(cs)}; right {sum(t['right'] == '1' for t in cs)}")
    nn = [t for t in tab if t["truth"] == "none"]
    L.append(f"recall of none on the not-alkylated stratum {frac(sum(t['call'] == 'none' for t in nn), len(nn))}")
    L += ["", "truth x call (no_call with its reason)"]
    conf = Counter((t["truth"], t["call"] if t["call"] != "no_call" else f"no_call:{t['reason']}") for t in tab)
    with open(f"{out}/confusion.tsv", "w") as o:
        o.write("truth\tcall\truns\n")
        for (a, b), c in sorted(conf.items()):
            o.write(f"{a}\t{b}\t{c}\n")
            L.append(f"    {a:16s} -> {b:28s} {c}")
    dbr = [t for t in tab if t["db_call"] != "-"]
    both = [t for t in dbr if t["right"] != "-" and t["db_call"] not in ("no_call", "no_report")]
    L += ["", f"database call (-alkylation_out, human proteome): rows {len(dbr)}; called "
              f"{sum(t['db_call'] not in ('no_call', 'no_report') for t in dbr)}; no_report "
              f"{sum(t['db_call'] == 'no_report' for t in dbr)}; right among its calls "
              f"{frac(sum(t['db_call'] == t['truth'] for t in dbr if t['db_call'] not in ('no_call', 'no_report')), sum(t['db_call'] not in ('no_call', 'no_report') for t in dbr))}",
          f"both methods call: {len(both)}; same class {sum(t['call'] == t['db_call'] for t in both)}"]
    json.dump(dict(runs=n, no_report=nr, called=len(called), right=right, accuracy=acc, wilson_lo=lo, wilson_hi=hi,
                   verdict=v, why=why), open(f"{out}/summary.json", "w"), indent=1)
    open(f"{out}/verdict.txt", "w").write("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main(*sys.argv[1:4])
