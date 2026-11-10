"""Calibration of the random-hit null on DEV negatives, v2 (oracle2.py output). DEV only.
usage: cal2.py ORACLE2.tsv
Nulls: poisson plug-in; NB with the run's pooled replicate dispersion phi_run = sum var / sum mean over the genera of
the run (leave the tested genus out), predictive: mean (D + 0.5) / R, variance phi * (1 + 1/R) * mean.
Reported: share of rows with the (non-randomised, as implemented) upper-tail p <= 0.01 / 0.05 and the randomised
PIT share; 95 % interval by bootstrap over runs."""
import sys, numpy as np, pandas as pd
from scipy import stats
rng = np.random.default_rng(7)

def tails(o, m, phi):
    """(P(X >= o), P(X > o)) for mean m, variance phi * m."""
    if phi <= 1.0 + 1e-9: return stats.poisson.sf(o - 1, m), stats.poisson.sf(o, m)
    p = 1.0 / phi; n = m * p / (1 - p)
    return stats.nbinom.sf(o - 1, n, p), stats.nbinom.sf(o, n, p)

def pvals(o, K, mode, floor=1.0):
    """o: observed per genus (one run); K: genus x R replicate counts."""
    R = K.shape[1]; D = K.sum(1); m = K.mean(1); v = K.var(1, ddof=1)
    out = []
    for i in range(len(o)):
        if mode == "poisson": ge, gt = tails(o[i], max(m[i], 1e-12), 1.0)
        else:
            oth = np.arange(len(o)) != i
            phi = max(floor, v[oth].sum() / max(m[oth].sum(), 1e-12))
            if mode == "nb_run_pg": phi = max(phi, v[i] / max(m[i], 1e-12))
            mm = (D[i] + 0.5) / R
            if mode == "nb_run_plug": ge, gt = tails(o[i], max(m[i], 1e-12), phi)
            else: ge, gt = tails(o[i], mm, phi * (1 + 1.0 / R))
        out.append((ge, gt + rng.random() * (ge - gt)))
    return out

def summarize(nm, df):
    runs = df.run.unique()
    def sh(x, col, t): return float((x[col] <= t).mean())
    res = {}
    for col in ("p", "pit"):
        for t in (0.01, 0.05):
            est = sh(df, col, t)
            by = {r: g[col].values for r, g in df.groupby("run")}
            bs = []
            for _ in range(2000):
                pick = rng.choice(runs, len(runs))
                x = np.concatenate([by[r] for r in pick]); bs.append((x <= t).mean())
            res[(col, t)] = (est, np.percentile(bs, 2.5), np.percentile(bs, 97.5))
    perrun = df.groupby("run").apply(lambda g: (g.p <= 0.01).sum())
    f = lambda k: "%.4f [%.4f, %.4f]" % res[k]
    print(f" {nm:34s} n {len(df):5d} p<=.01 {f(('p',0.01))} p<=.05 {f(('p',0.05))} | PIT<=.01 {f(('pit',0.01))} <=.05 {f(('pit',0.05))} | runs with a row p<=.01: {(perrun>0).sum()}/{len(runs)}")

if __name__ == "__main__":
    d = pd.read_csv(sys.argv[1], sep="\t")
    print("== simulated exact null (compound Poisson clumps, R = 10, 50 genera x 400 runs)")
    sim = []
    for r in range(400):
        mu = rng.gamma(0.7, 30.0, 50); phi = rng.uniform(1.0, 6.0)
        def draw(size):
            if phi <= 1.01: return rng.poisson(mu[:, None], size)
            p = 1 / phi; n = mu * p / (1 - p)
            return rng.negative_binomial(n[:, None], p, size)
        K = draw((50, 10)); o = draw((50, 1))[:, 0]
        for mode in ("poisson", "nb_run_plug", "nb_run_pred"):
            for ge, pit in pvals(o, K, mode): sim.append((mode, r, ge, pit))
    sim = pd.DataFrame(sim, columns=["mode", "run", "p", "pit"])
    for mode, g in sim.groupby("mode"): summarize("sim " + mode, g)
    for unit, oc, kc in (("spectra", "u", "kd"), ("tags", "tu", "tkd")):
        for arm in ("alldecoy", "real"):
            x = d[(d.arm == arm)]
            print(f"== unit {unit}, arm {arm}")
            rows = {m: [] for m in ("poisson", "nb_run_plug", "nb_run_pred", "nb_run_pg")}
            tot_o = tot_m = 0; phis = []
            for run, g in x.groupby("run"):
                g = g[g.status == "negative"]
                K = np.array([[int(v) for v in s.split(",")] for s in g[kc]]); o = g[oc].values
                tot_o += o.sum(); tot_m += K.mean(1).sum(); phis.append(K.var(1, ddof=1).sum() / max(K.mean(1).sum(), 1e-9))
                for m in rows:
                    for (ge, pit), gen, oo, kk in zip(pvals(o, K, m), g.genus, o, K): rows[m].append((run, gen, oo, kk.mean(), ge, pit))
            print(f" sum observed / sum decoy mean {tot_o / tot_m:.3f}; phi_run median {np.median(phis):.2f} range {min(phis):.2f}-{max(phis):.2f}")
            for m in rows:
                df = pd.DataFrame(rows[m], columns=["run", "genus", "o", "m", "p", "pit"]); summarize(m, df)
                if m == "nb_run_pred":
                    print(df.sort_values("p").head(14 if arm == "real" else 8).to_string(index=False))
