"""Greedy explain-away call simulated on the compact cache (prep.py); the model for -species_call explain. DEV only.
usage: greedy.py CACHE OUT.tsv [alpha] [n_min] [eps] [R: use only the first R decoy replicates]
Loop: every genus not yet called is scored on the DISTINCT TAGS it has in spectra not explained by the genera called
so far; the same count on each k-mer decoy replicate gives the null (predictive negative binomial: mean
(D + 0.5) / R + eps * shared, variance phi * (1 + 1/R) * mean, phi = max(1, pooled replicate dispersion of the run));
the genus with the smallest p is called when p * (genera still tested) <= alpha (step-down Bonferroni); its spectra
become explained; stop at the first failure."""
import pickle, sys
from pathlib import Path
import numpy as np
from scipy import stats
from load import manifest, parse_truth, CONTAM

def upper(o, m, phi):
    if o <= 0: return 1.0
    if phi <= 1.0 + 1e-9: return float(stats.poisson.sf(o - 1, m))
    p = 1.0 / phi
    return float(stats.nbinom.sf(o - 1, m * p / (1 - p), p))

def greedy(d, alpha=0.01, n_min=10, eps=0.0, trace=False):
    n = len(d["genera"]); R = len(d["decoys"])
    def counts(units, expl):
        tg = [set() for _ in range(n)]
        for s, sid, g in units:
            if s in expl: continue
            for i in g: tg[i].add(sid)
        return np.array([len(x) for x in tg])
    total = counts(d["target"], ())
    expl, called, steps = set(), [], []
    while True:
        t = counts(d["target"], expl)
        K = np.array([counts(k, expl) for k in d["decoys"]]).T          # genus x R
        rest = [i for i in range(n) if i not in called]
        m = K.mean(1); v = K.var(1, ddof=1)
        phi = max(1.0, v[rest].sum() / max(m[rest].sum(), 1e-12))
        test = [i for i in rest if t[i] >= n_min]
        cand = []
        for i in test:
            lam = (K[i].sum() + 0.5) / R + eps * (total[i] - t[i])
            cand.append((upper(t[i], lam, phi * (1 + 1.0 / R)), -int(t[i]), i, lam))
        if not cand: break
        cand.sort()
        p, ti, i, lam = cand[0]
        ok = p * len(test) <= alpha
        steps.append((d["genera"][i], int(total[i]), -ti, lam, phi, p, len(test), ok))
        if not ok:
            if trace:   # the remaining genera at the stopping point: the full negative table of the run
                for p2, t2, i2, lam2 in cand[1:]: steps.append((d["genera"][i2], int(total[i2]), -t2, lam2, phi, p2, len(test), False))
            break
        called.append(i)
        expl |= {s for s, _, g in d["target"] if i in g}
    return steps

if __name__ == "__main__":
    alpha = float(sys.argv[3]) if len(sys.argv) > 3 else 0.01
    n_min = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    eps = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    R = int(sys.argv[6]) if len(sys.argv) > 6 else 0
    man = manifest()
    out = open(sys.argv[2], "w")
    out.write("run\tarm\tstep\tgenus\tstatus\ttags\tunexplained\texpected\tphi\tp\ttested\tcalled\n")
    for p in sorted(Path(sys.argv[1]).glob("*.pkl")):
        d = pickle.load(open(p, "rb"))
        if R: d["decoys"] = d["decoys"][:R]
        truth = parse_truth(man[d["run"]]["truth"]); human = "Homo" in truth
        def status(x):
            if d["arm"] == "alldecoy": return "negative"
            if x in truth: return "positive"
            if x in CONTAM or (x == "Homo" and not human): return "excluded"
            return "negative"
        for k, (g, tot, ti, lam, phi, pv, nt, ok) in enumerate(greedy(d, alpha, n_min, eps, True)):
            out.write(f"{d['run']}\t{d['arm']}\t{k}\t{g}\t{status(g)}\t{tot}\t{ti}\t{lam:.2f}\t{phi:.2f}\t{pv:.3g}\t{nt}\t{int(ok)}\n")
        out.flush()
    print("GREEDY_DONE")
