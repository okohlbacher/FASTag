#!/usr/bin/env python3
"""Census triage evaluation (FASTag 1.13 item 7, backlog #11).

Question: do the spectra that `-census_ids` marks as triage candidates (not identified by the first search, status
tagged or placed, best_evalue <= -census_triage_evalue) get identified by a second, wider search more often than the
other unidentified spectra, and more often than the same number of unidentified spectra picked by a tagging-free
signal?

Inputs, one row per run (TSV with a header, columns by name):
    run      a run label (unique)
    census   the run's <out>.census.tsv written with -census -census_ids (columns spectrum, identified, triage, ...)
    second   the second search's Sage results.sage.tsv (columns filename, scannr, rank, label, spectrum_q, and
             sage_discriminant_score for --fdr subset)
    mzml     optional: the mzML basename the second search must name in `filename` (default: no check)

Population U of a run: census rows with identified == 0 (rows with an empty identified, which the join could not
match, are left out and counted). Truth T: the spectrum's rank-1 PSM in the second search is a target (label 1) with
q <= --q (default 0.01). Spectra the second search does not report are not T. --fdr global takes the second
search's own spectrum_q (estimated over all its spectra); --fdr subset recomputes target-decoy q-values among the
rank-1 PSMs of U only, by sage_discriminant_score (a separate FDR for the newly identified spectra).

Per run and pooled over runs (counts summed):
    n_u, n_triage, n_rest, t_triage, t_rest, p_triage = t_triage / n_triage, p_rest = t_rest / n_rest,
    rr = p_triage / p_rest (inf when the rest has no hit and the candidates have), recall = t_triage / (t_triage + t_rest),
    for each baseline column B: p_B = precision of the n_triage rows of U with the largest B (ties: lower input
    index first), d_B = p_triage - p_B,
    q_min = the lowest q-value of a target of U (empty: U has no target PSM), evaluable = 1 when U has a hit
    (t_u > 0), else 0: with --fdr subset a run with fewer than 1 / q targets above its decoys has q_min > q, no
    hit in either group and an undefined rr whatever triage does (pooled: the number of evaluable runs),
    auroc of -log10(best_evalue) for T within U (spectra without a tag rank lowest; ties count one half).
Join diagnostics: u_in_second, triage_in_second, rest_in_second (U spectra the second search reports); a run where no
spectrum of U joins is refused. Non-finite or empty baseline values, spectrum_q and discriminants are refused.
Run-cluster bootstrap (--boot resamples of the runs with replacement, --seed): percentile 95% intervals of the
pooled rr and d_B. With one run the intervals are empty.

Output: a long TSV (scope, key, value) on stdout or --out; scope is a run label or `pooled`.
Only the Python standard library is used.
"""
import argparse
import csv
import math
import os
import random
import sys

TRUE_LABEL = "1"


class EvalError(Exception):
    pass


def read_tsv(path, quoted=False):
    """quoted: fields may be enclosed in double quotes (Sage writes its TSV with a CSV writer); FASTag's census
    tables are unquoted."""
    with open(path, newline="") as f:
        r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL if quoted else csv.QUOTE_NONE)
        try:
            header = next(r)
        except StopIteration:
            raise EvalError(f"{path}: empty file")
        rows = [row for row in r if row]
    return header, rows


def col(header, name, path):
    try:
        return header.index(name)
    except ValueError:
        raise EvalError(f"{path}: no column '{name}'")


def second_psms(path, mzml=None):
    """Rank-1 PSMs of the second search: {native id: (is_target, spectrum_q, discriminant)}."""
    h, rows = read_tsv(path, quoted=True)
    cf, cs, cr, cl, cq = (col(h, n, path) for n in ("filename", "scannr", "rank", "label", "spectrum_q"))
    cd = h.index("sage_discriminant_score") if "sage_discriminant_score" in h else None
    psms = {}
    for row in rows:
        if row[cr] != "1":
            continue
        if mzml is not None and os.path.basename(row[cf]) != mzml:
            raise EvalError(f"{path}: filename '{row[cf]}' is not the run's mzML '{mzml}'")
        sid = row[cs]
        if sid in psms:
            raise EvalError(f"{path}: two rank-1 rows for '{sid}'")
        if row[cl] not in (TRUE_LABEL, "-1"):
            raise EvalError(f"{path}: label '{row[cl]}' for '{sid}' (1 target, -1 decoy)")
        sq = finite(row[cq], path, "spectrum_q")
        psms[sid] = (row[cl] == TRUE_LABEL, sq, finite(row[cd], path, "sage_discriminant_score") if cd is not None
                     else None)
    return psms


def finite(v, path, name):
    try:
        x = float(v)
    except ValueError:
        raise EvalError(f"{path}: {name} '{v}' is not a number")
    if not math.isfinite(x):
        raise EvalError(f"{path}: {name} '{v}' is not finite")
    return x


def global_truth(psms, q):
    """Native ids whose rank-1 PSM is a target at the search's own spectrum_q <= q."""
    return {sid for sid, (t, sq, _) in psms.items() if t and sq <= q}


def subset_qvalues(psms, sids):
    """Target-decoy q-values recomputed among the rank-1 PSMs of the spectra @p sids only (separate FDR of the
    spectra the first search left unidentified), ordered by sage_discriminant_score (higher better; equal scores
    enter together). FDR at a cut = (decoys + 1) / targets above it (the finite-sample target-decoy
    competition estimate); q = the lowest FDR at or below the score.
    Returns [(q, is_target, native id)], best score first."""
    sub = [(psms[s][2], psms[s][0], s) for s in sids if s in psms]
    if any(d is None for d, _, _ in sub):
        raise EvalError("subset FDR needs the column sage_discriminant_score")
    sub.sort(key=lambda x: -x[0])
    groups, i = [], 0
    while i < len(sub):
        j = i
        while j + 1 < len(sub) and sub[j + 1][0] == sub[i][0]:
            j += 1
        groups.append(sub[i:j + 1])
        i = j + 1
    fdr, nt, nd = [], 0, 0
    for g in groups:
        nt += sum(1 for x in g if x[1])
        nd += sum(1 for x in g if not x[1])
        fdr.append((nd + 1) / nt if nt else math.inf)
    qv = [0.0] * len(groups)
    m = math.inf
    for k in range(len(groups) - 1, -1, -1):
        m = min(m, fdr[k])
        qv[k] = m
    return [(qq, x[1], x[2]) for g, qq in zip(groups, qv) for x in g]


def subset_truth(psms, sids, q):
    """The targets with a subset q-value (subset_qvalues) <= @p q."""
    return {s for qq, t, s in subset_qvalues(psms, sids) if t and qq <= q}


def score_key(ev):
    """-log10(best_evalue); an empty best_evalue (no reported tag) ranks below every tagged spectrum."""
    if ev == "":
        return -math.inf
    v = float(ev)
    return math.inf if v <= 0 else -math.log10(v)


def auroc(scores, labels):
    """Mann-Whitney AUROC with midranks; None when one class is empty."""
    pos = sum(labels)
    neg = len(labels) - pos
    if pos == 0 or neg == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        mid = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = mid
        i = j + 1
    rsum = sum(r for r, l in zip(ranks, labels) if l)
    return (rsum - pos * (pos + 1) / 2.0) / (pos * neg)


def run_counts(census, psms, q, fdr, baselines):
    """Counts of one run. census: path; psms: second_psms(); fdr: 'global' or 'subset'.
    Returns a dict of integer counts plus auroc inputs."""
    h, rows = read_tsv(census)
    ci, cs, cid, ctr, cev = (col(h, n, census) for n in ("index", "spectrum", "identified", "triage", "best_evalue"))
    cb = {b: col(h, b, census) for b in baselines}
    u_ids = {row[cs] for row in rows if row[cid] == "0"}
    for b in baselines:
        for row in rows:
            if row[cid] == "0":
                finite(row[cb[b]], census, b)
    if fdr == "global":
        tq = [sq for sid, (t, sq, _) in psms.items() if t and sid in u_ids]
    elif fdr == "subset":
        sub = subset_qvalues(psms, u_ids)
        tq = [qq for qq, t, _ in sub if t]
    else:
        raise EvalError(f"unknown FDR mode '{fdr}'")
    truth = global_truth(psms, q) if fdr == "global" else {s for qq, t, s in sub if t and qq <= q}
    u = []  # (index, is_triage, is_true, score, {baseline: value}, in_second)
    unknown = 0
    for row in rows:
        ident = row[cid]
        if ident == "":
            unknown += 1
            continue
        if ident != "0":
            continue
        tr = row[ctr]
        if tr not in ("0", "1"):
            raise EvalError(f"{census}: identified 0 with triage '{tr}'")
        u.append((int(row[ci]), tr == "1", row[cs] in truth, score_key(row[cev]),
                  {b: float(row[cb[b]]) for b in baselines}, row[cs] in psms))
    n_tri = sum(1 for x in u if x[1])
    c = {
        "n_unknown": unknown,
        "n_u": len(u),
        "n_triage": n_tri,
        "n_rest": len(u) - n_tri,
        "t_triage": sum(1 for x in u if x[1] and x[2]),
        "t_rest": sum(1 for x in u if not x[1] and x[2]),
    }
    for b in baselines:
        top = sorted(u, key=lambda x: (-x[4][b], x[0]))[:n_tri]
        c[f"t_top_{b}"] = sum(1 for x in top if x[2])
    # join diagnostics: U spectra with a rank-1 PSM in the second search (an unreported spectrum is not a hit)
    c["u_in_second"] = sum(1 for x in u if x[5])
    c["triage_in_second"] = sum(1 for x in u if x[1] and x[5])
    c["rest_in_second"] = sum(1 for x in u if not x[1] and x[5])
    if u and c["u_in_second"] == 0:
        raise EvalError(f"{census}: no spectrum of U has a PSM in the second search (native ids do not join)")
    c["second_rank1"] = len(psms)
    c["second_true_global"] = len(global_truth(psms, q))
    c["t_u"] = c["t_triage"] + c["t_rest"]
    # A run where U has no hit at all cannot show an enrichment: the truth cannot resolve q there (with --fdr
    # subset, (D + 1) / T <= q needs 1 / q targets above the decoys). Judged from U as a whole, never from triage.
    c["evaluable"] = 1 if c["t_u"] > 0 else 0
    c["_q_min"] = [min(tq)] if tq else []
    c["_scores"] = [x[3] for x in u]
    c["_labels"] = [1 if x[2] else 0 for x in u]
    return c


def ratio(a, b):
    return a / b if b else None


def rate_ratio(pt, pr):
    """p_triage / p_rest; inf when only the rest has no hit; None when a group is empty or neither has a hit."""
    if pt is None or pr is None:
        return None
    if pr == 0:
        return math.inf if pt > 0 else None
    return pt / pr


def summarize(c, baselines):
    s = {k: v for k, v in c.items() if not k.startswith("_")}
    s["p_triage"] = ratio(c["t_triage"], c["n_triage"])
    s["p_rest"] = ratio(c["t_rest"], c["n_rest"])
    s["rr"] = rate_ratio(s["p_triage"], s["p_rest"])
    s["recall"] = ratio(c["t_triage"], c["t_triage"] + c["t_rest"])
    for b in baselines:
        pb = ratio(c[f"t_top_{b}"], c["n_triage"])
        s[f"p_top_{b}"] = pb
        s[f"d_{b}"] = s["p_triage"] - pb if s["p_triage"] is not None and pb is not None else None
    s["auroc_neglog10_evalue"] = auroc(c["_scores"], c["_labels"])
    s["q_min"] = min(c["_q_min"]) if c.get("_q_min") else None
    return s


def pool(cs):
    out = {}
    for c in cs:
        for k, v in c.items():
            if k.startswith("_"):
                out.setdefault(k, []).extend(v)
            else:
                out[k] = out.get(k, 0) + v
    return out


def percentile(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if xs[lo] == xs[hi] or k == lo:
        return xs[lo]
    if math.isinf(xs[hi]):
        return math.inf
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def bootstrap(cs, baselines, n, seed):
    """Percentile 95% intervals of the pooled rr and d_B over run resamples (no auroc: too slow, not an endpoint).
    rr = inf (no rest hit) is kept in the resamples; a resample where rr is undefined (no hit in either group) is
    left out and counted in <key>_boot_undefined."""
    if len(cs) < 2 or n <= 0:
        return {}
    rng = random.Random(seed)
    keys = ["rr"] + [f"d_{b}" for b in baselines]
    vals = {k: [] for k in keys}
    lite = [{k: v for k, v in c.items() if not k.startswith("_")} for c in cs]
    for _ in range(n):
        p = pool([lite[rng.randrange(len(lite))] for _ in lite])
        p["_scores"], p["_labels"] = [], []
        s = summarize(p, baselines)
        for k in keys:
            if s[k] is not None:
                vals[k].append(s[k])
    out = {}
    for k in keys:
        out[f"{k}_ci_lo"] = percentile(vals[k], 0.025)
        out[f"{k}_ci_hi"] = percentile(vals[k], 0.975)
        out[f"{k}_boot_n"] = len(vals[k])
        out[f"{k}_boot_undefined"] = n - len(vals[k])
    return out


def fmt(v):
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        return repr(round(v, 10))
    return str(v)


def evaluate(runs_path, q=0.01, baselines=("n_peaks",), boot=10000, seed=20261109, fdr="global"):
    h, rows = read_tsv(runs_path)
    cr, cc, cs = (col(h, n, runs_path) for n in ("run", "census", "second"))
    cm = h.index("mzml") if "mzml" in h else None
    base = os.path.dirname(os.path.abspath(runs_path))
    res, counts, names = [], [], set()
    for row in rows:
        name = row[cr]
        if name in names:
            raise EvalError(f"{runs_path}: run '{name}' twice")
        names.add(name)
        cen = row[cc] if os.path.isabs(row[cc]) else os.path.join(base, row[cc])
        sec = row[cs] if os.path.isabs(row[cs]) else os.path.join(base, row[cs])
        mz = row[cm] if cm is not None and row[cm] != "" else None
        c = run_counts(cen, second_psms(sec, mz), q, fdr, baselines)
        counts.append(c)
        res.append((name, summarize(c, baselines)))
    if not counts:
        raise EvalError(f"{runs_path}: no runs")
    pooled = summarize(pool(counts), baselines)
    pooled["n_runs"] = len(counts)
    pooled.update(bootstrap(counts, baselines, boot, seed))
    res.append(("pooled", pooled))
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", help="TSV: run, census, second[, mzml]")
    ap.add_argument("--q", type=float, default=0.01, help="second-search spectrum_q threshold (default 0.01)")
    ap.add_argument("--baseline", action="append", default=None,
                    help="census column for the size-matched baseline (repeatable; default n_peaks)")
    ap.add_argument("--fdr", choices=("global", "subset"), default="global",
                    help="truth q-values: the second search's own spectrum_q (global, default), or recomputed "
                         "among the spectra the first search left unidentified (subset)")
    ap.add_argument("--boot", type=int, default=10000, help="run-cluster bootstrap resamples (default 10000)")
    ap.add_argument("--seed", type=int, default=20261109, help="bootstrap seed (default 20261109)")
    ap.add_argument("--out", help="output TSV (default stdout)")
    a = ap.parse_args(argv)
    try:
        res = evaluate(a.runs, a.q, tuple(a.baseline or ["n_peaks"]), a.boot, a.seed, a.fdr)
    except (EvalError, OSError, ValueError) as e:
        print(f"census_triage_eval: {e}", file=sys.stderr)
        return 2
    f = open(a.out, "w") if a.out else sys.stdout
    f.write("scope\tkey\tvalue\n")
    for scope, s in res:
        for k in sorted(s):
            f.write(f"{scope}\t{k}\t{fmt(s[k])}\n")
    if a.out:
        f.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
