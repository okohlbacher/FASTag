import sys, numpy as np, pandas as pd
from scipy import stats
d = pd.read_csv(sys.argv[1], sep="\t")
d["kdl"] = d.kd.apply(lambda s: np.array([int(x) for x in s.split(",")]))
def pit_pois(o, m, rng):
    m = max(m, 0.5)
    return stats.poisson.sf(o, m) + rng.random() * stats.poisson.pmf(o, m)
def pit_nb(o, m, v, rng):
    m = max(m, 0.5); v = max(v, m * 1.0001)
    p = m / v; n = m * p / (1 - p)
    return stats.nbinom.sf(o, n, p) + rng.random() * stats.nbinom.pmf(o, n, p)
rng = np.random.default_rng(1)
for arm in ("alldecoy", "real"):
    x = d[(d.arm == arm) & (d.status == "negative")].copy()
    x = x[(x.u > 0) | (x.kd_mean > 0)]
    print("==", arm, "negative rows", len(x), "runs", x.run.nunique())
    print(" sum u / sum kd_mean:", x.u.sum() / x.kd_mean.sum())
    print(" dispersion v/m median (rows m>=5):", (x.kd_var / x.kd_mean)[x.kd_mean >= 5].median())
    # dispersion per run: pooled v/m
    disp = x[x.kd_mean >= 5].groupby("run").apply(lambda g: (g.kd_var / g.kd_mean).median())
    print(" per-run v/m quantiles:", disp.quantile([0.1, 0.5, 0.9]).round(2).tolist())
    x["phi"] = x.run.map(disp).fillna(1.0)
    up = np.array([pit_pois(o, m, rng) for o, m in zip(x.u, x.kd_mean)])
    un = np.array([pit_nb(o, m, m * max(f, 1.0), rng) for o, m, f in zip(x.u, x.kd_mean, x.phi)])
    for nm, u in (("poisson", up), ("nb_rep", un)):
        ks = stats.kstest(u, "uniform")
        print(f" {nm}: KS D {ks.statistic:.3f} p {ks.pvalue:.2g}; share<=0.01 {np.mean(u<=0.01):.3f} <=0.05 {np.mean(u<=0.05):.3f}")
    x["ratio"] = (x.u + 0.5) / (x.kd_mean + 0.5)
    print(" ratio u/kd quantiles:", x.ratio.quantile([0.1, 0.5, 0.9, 0.99]).round(2).tolist())
    if arm == "real":
        x["cratio"] = (x.conc_u + 0.5) / (x.conc_dec_u + 0.5)
        print(" conc ratio quantiles:", x.cratio.quantile([0.1, 0.5, 0.9, 0.99]).round(2).tolist())
        print(x.sort_values("ratio", ascending=False)[["run","genus","o","u","kd_mean","kd_var","conc_u","conc_dec_u"]].head(25).to_string())
