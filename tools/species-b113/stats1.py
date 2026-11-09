"""Calibration of the random-hit null on DEV negatives (oracle.py output). DEV only.

usage: stats1.py ORACLE.tsv
Every negative row is kept (no selection on the outcome). The replicate mean m is used as is; m == 0 rows are a
point mass at 0 (randomised PIT uniform for u == 0, 0 for u > 0) and are also counted separately. The NB dispersion
phi of a genus is estimated out of sample (leave-one-genus-out: rows of every other genus) and, as a second
variant, from the all-decoy arm only. A simulated exact-null case runs first: if it is not uniform, the test itself
is broken and stats1 output must not be read.
"""
import sys, numpy as np, pandas as pd
from scipy import stats

def pit(o, m, phi, rng):
    if m <= 0:
        return rng.random() if o == 0 else 0.0
    v = m * phi
    if phi <= 1.0 + 1e-9:
        return stats.poisson.sf(o, m) + rng.random() * stats.poisson.pmf(o, m)
    p = m / v; n = m * p / (1 - p)
    return stats.nbinom.sf(o, n, p) + rng.random() * stats.nbinom.pmf(o, n, p)

def report(nm, u):
    u = np.asarray(u)
    ks = stats.kstest(u, "uniform")
    print(f" {nm}: n {len(u)} KS D {ks.statistic:.3f} p {ks.pvalue:.2g}; share<=0.01 {np.mean(u<=0.01):.4f} <=0.05 {np.mean(u<=0.05):.4f}")

def disp(rows):
    r = rows[rows.kd_mean >= 5]
    return float((r.kd_var / r.kd_mean).median()) if len(r) else 1.0

rng = np.random.default_rng(1)
# ---- exact-null sanity: o and R replicates from the same law, m and phi estimated as in the real test ----
print("== simulated exact null")
R = 10
for law, phi_true in (("poisson", 1.0), ("nb", 3.0)):
    mus = rng.gamma(0.7, 4.0, 20000)
    def draw(mu, size):
        if phi_true == 1.0: return rng.poisson(mu, size)
        p = 1 / phi_true; n = mu * p / (1 - p)
        return rng.negative_binomial(n, p, size) if mu > 0 else np.zeros(size, int)
    o = np.array([draw(m, 1)[0] for m in mus])
    reps = [draw(m, R) for m in mus]
    m_hat = np.array([r.mean() for r in reps])
    v_hat = np.array([r.var(ddof=1) for r in reps])
    sel = m_hat >= 5
    phi_hat = max(1.0, float(np.median(v_hat[sel] / m_hat[sel]))) if sel.any() else 1.0
    report(f"{law} truth, poisson test", [pit(a, b, 1.0, rng) for a, b in zip(o, m_hat)])
    report(f"{law} truth, nb test (phi_hat {phi_hat:.2f})", [pit(a, b, phi_hat, rng) for a, b in zip(o, m_hat)])

d = pd.read_csv(sys.argv[1], sep="\t")
alldec = d[(d.arm == "alldecoy") & (d.status == "negative")]
phi_alldecoy = max(1.0, disp(alldec))
for arm in ("alldecoy", "real"):
    x = d[(d.arm == arm) & (d.status == "negative")].copy()
    print("==", arm, "negative rows", len(x), "runs", x.run.nunique())
    print(" rows m==0:", int((x.kd_mean == 0).sum()), " of them u>0:", int(((x.kd_mean == 0) & (x.u > 0)).sum()))
    print(" sum u / sum kd_mean:", x.u.sum() / max(x.kd_mean.sum(), 1e-12))
    print(" dispersion v/m median (rows m>=5):", round(disp(x), 3))
    logo = {g: max(1.0, disp(x[x.genus != g])) for g in x.genus.unique()}
    x["phi_logo"] = x.genus.map(logo)
    up = [pit(o, m, 1.0, rng) for o, m in zip(x.u, x.kd_mean)]
    ul = [pit(o, m, f, rng) for o, m, f in zip(x.u, x.kd_mean, x.phi_logo)]
    ua = [pit(o, m, phi_alldecoy, rng) for o, m in zip(x.u, x.kd_mean)]
    report("poisson", up)
    report("nb phi leave-one-genus-out", ul)
    report(f"nb phi all-decoy arm ({phi_alldecoy:.2f})" + (" [in-sample for this arm]" if arm == "alldecoy" else ""), ua)
    x["ratio"] = (x.u + 0.5) / (x.kd_mean + 0.5)
    print(" ratio u/kd quantiles:", x.ratio.quantile([0.1, 0.5, 0.9, 0.99]).round(2).tolist())
    if arm == "real":
        x["cratio"] = (x.conc_u + 0.5) / (x.conc_dec_u + 0.5)
        print(" conc ratio quantiles:", x.cratio.quantile([0.1, 0.5, 0.9, 0.99]).round(2).tolist())
        print(x.sort_values("ratio", ascending=False)[["run","genus","o","u","kd_mean","kd_var","conc_u","conc_dec_u"]].head(25).to_string())
