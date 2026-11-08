"""Shared code of the FASTag 1.12 held-out scorers (acceptance/1.12/scorers). Pre-registered with the PREREG files;
its sha256 is in scorers/SHA256SUMS. Nothing here reads a held-out result by itself.

Conventions used by every scorer:
  - run directory: <runs>/<CFG>/<manifest>/<dir of fastag_input>/<stem of fastag_input>/<cell>/ holding the outputs
    (tags.tsv, run.log with the FASTAG_RC=<rc> line, ...) of one FASTag run (jobs/example-fastag.slurm layout plus
    one sub-directory per cell);
  - truth directory: <truth>/<manifest>/<dir of fastag_input>/<stem of fastag_input>/ holding results.sage.tsv
    (or the MSFragger tsv for #15B) of the pre-registered truth search;
  - correctness: the paper rule (bench/fastag-bench score.py `_mark`, rule 'flank', the lt_score.py rule): a tag is
    correct for a spectrum when its sequence or its reverse is in the truth peptide (I = L) and one flanking mass
    agrees within 0.05 Da (per ion series offset for c/z); rank 1 = the spectrum's first row in the tag TSV;
  - truth PSMs: target, rank 1, Sage spectrum_q <= 0.01 (parsers.read_sage_psms);
  - a truth spectrum an arm leaves untagged counts as not correct (fixed, arm-independent denominator);
  - clusters: the I/L-folded, modification-free truth peptide (score.normalize_peptide); spectra of one peptide are
    one cluster across all runs of a cell;
  - non-inferiority (#2 margins): point estimate (candidate - baseline, percentage points) > -0.5 and the
    Holm-adjusted lower confidence bound > -1.0. The bound uses the standard error of 2,000 peptide-cluster
    bootstrap draws (numpy default_rng, seed fixed per cell) and the normal quantile at one-sided level
    alpha_i = 0.025 / (m - r_i + 1) (Holm step-down over the m powered cells, r_i the cell's rank by its one-sided
    p-value for H0: difference <= -1.0); a cell with fewer than 200 clusters is underpowered: inconclusive, and it
    blocks the endpoint."""
from __future__ import annotations

import csv
import hashlib
import math
import os
import sys
from pathlib import Path
from statistics import NormalDist

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "bench/fastag-bench/src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402

B_DRAWS = 2000
ALPHA = 0.025          # one-sided (the 95% two-sided lower bound)
NI_MARGIN = -1.0       # points, lower bound must be above
NI_POINT = -0.5        # points, point estimate must be above
MIN_CLUSTERS = 200
FDR = 0.01
ND = NormalDist()


def sha256(p) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def run_rel(fastag_input: str) -> str:
    """'item02/H1/PXD000806/S2-2.mzML' -> 'item02/H1/PXD000806/S2-2' (run directory below <CFG>/<manifest>)."""
    d, b = os.path.split(fastag_input)
    return os.path.join(d, b.rsplit(".", 1)[0]) if "." in b else fastag_input


def run_rc(run_dir: Path) -> int | None:
    """FASTAG_RC=<rc> of run.log (jobs/example-fastag.slurm), None when there is none."""
    p = Path(run_dir) / "run.log"
    if not p.exists():
        return None
    rc = None
    for line in open(p, errors="replace"):
        if line.startswith("FASTAG_RC="):
            rc = int(line.strip().split("=", 1)[1])
    return rc


# ---------------------------------------------------------------- statistics

def wilson(k: int, n: int, z: float = 1.959963984540054):
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def binom_cdf(k: int, n: int, p: float) -> float:
    if p <= 0:
        return 1.0
    if p >= 1:
        return 1.0 if k >= n else 0.0
    return sum(math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1)
                        + i * math.log(p) + (n - i) * math.log1p(-p)) for i in range(0, k + 1))


def cp_upper(k: int, n: int, conf: float = 0.95) -> float:
    """One-sided exact (Clopper-Pearson) upper bound of a binomial rate; k = 0 gives 1 - (1 - conf)^(1/n)."""
    if n == 0:
        return float("nan")
    if k >= n:
        return 1.0
    lo, hi = k / n, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if binom_cdf(k, n, mid) > 1 - conf:
            lo = mid
        else:
            hi = mid
    return hi


def cell_seed(name: str) -> int:
    return int(hashlib.sha256(("fastag-1.12:" + name).encode()).hexdigest()[:8], 16)


def cluster_arrays(records):
    """records: iterable of (cluster, base_ok, cand_ok) -> (n, base, cand) arrays per cluster."""
    agg: dict[str, list[int]] = {}
    for c, b, k in records:
        a = agg.setdefault(c, [0, 0, 0])
        a[0] += 1
        a[1] += bool(b)
        a[2] += bool(k)
    if not agg:
        return np.zeros(0), np.zeros(0), np.zeros(0)
    arr = np.array(list(agg.values()), dtype=float)
    return arr[:, 0], arr[:, 1], arr[:, 2]


def paired_diff(name: str, records, draws: int = B_DRAWS):
    """Point difference (cand - base, points), bootstrap SE and 2.5/97.5 percentiles over peptide clusters."""
    n, b, k = cluster_arrays(records)
    out = {"cell": name, "clusters": int(len(n)), "spectra": int(n.sum()),
           "base_pct": float(100 * b.sum() / n.sum()) if n.sum() else float("nan"),
           "cand_pct": float(100 * k.sum() / n.sum()) if n.sum() else float("nan")}
    out["diff"] = out["cand_pct"] - out["base_pct"]
    if len(n) < 2:
        out.update(se=float("nan"), p2_5=float("nan"), p97_5=float("nan"))
        return out
    rng = np.random.default_rng(cell_seed(name))
    idx = rng.integers(0, len(n), size=(draws, len(n)))
    dn, db, dk = n[idx].sum(1), b[idx].sum(1), k[idx].sum(1)
    d = 100 * (dk - db) / dn
    out["se"] = float(d.std(ddof=1))
    out["p2_5"], out["p97_5"] = (float(x) for x in np.percentile(d, [2.5, 97.5]))
    return out


def holm_ni(cells: list[dict]):
    """Adds to each cell dict: powered, p_one_sided, holm_alpha, holm_lb, ni ('pass'|'fail'|'inconclusive').
    Returns the endpoint verdict: PASS (every cell powered and non-inferior), FAIL, or INCONCLUSIVE."""
    powered = [c for c in cells if c["clusters"] >= MIN_CLUSTERS and c["se"] == c["se"]]
    for c in cells:
        c["powered"] = c in powered
        if not c["powered"]:
            c.update(p_one_sided=float("nan"), holm_alpha=float("nan"), holm_lb=float("nan"), ni="inconclusive")
    for c in powered:   # se 0 (both arms equal on every draw): the bound is the point estimate itself
        c["p_one_sided"] = (1 - ND.cdf((c["diff"] - NI_MARGIN) / c["se"]) if c["se"] > 0 else
                            0.0 if c["diff"] > NI_MARGIN else 1.0)
    m = len(powered)
    still = True
    for r, c in enumerate(sorted(powered, key=lambda c: (c["p_one_sided"], c["cell"])), start=1):
        a = ALPHA / (m - r + 1)
        c["holm_alpha"] = a
        c["holm_lb"] = c["diff"] - ND.inv_cdf(1 - a) * c["se"]
        reject = still and c["p_one_sided"] <= a
        still = reject
        c["ni"] = "pass" if reject and c["diff"] > NI_POINT else "fail"
    if not cells:
        return "INCONCLUSIVE"
    if any(c["ni"] == "fail" for c in cells):
        return "FAIL"
    if any(c["ni"] == "inconclusive" for c in cells):
        return "INCONCLUSIVE"
    return "PASS"


# ---------------------------------------------------------------- truth and tags

def sage_truth(path, truth_fields: bool = True) -> pd.DataFrame:
    """Target rank-1 PSMs at spectrum_q <= 0.01, with charge and isotope_error, and the cluster id."""
    df = P.read_sage_psms(path, FDR, truth_fields=truth_fields)
    df = df.drop_duplicates("key")
    df["cluster"] = df["peptide"].map(S.normalize_peptide)
    return df


def rank1_correct(tags_path, psms: pd.DataFrame) -> dict[str, bool]:
    """key -> rank-1 tag correct (paper flank rule) for every truth key; untagged truth keys are False."""
    out = {k: False for k in psms["key"]}
    if tags_path is None or not Path(tags_path).exists():
        return out
    tags = P.read_fastag_tags(tags_path)
    if len(tags) == 0:
        return out
    tags = tags[tags["rank"] == 1]
    m = S._mark(tags, psms[["key", "peptide"]], "flank")
    for k, ok in m.groupby("key")["correct"].any().items():
        out[k] = bool(ok)
    return out


def tagged_spectra(tags_path) -> int:
    if tags_path is None or not Path(tags_path).exists():
        return 0
    seen = set()
    with open(tags_path) as f:
        f.readline()
        for line in f:
            seen.add(line.split("\t", 1)[0])
    return len(seen)


def charge_stratum(c: int) -> str:
    return "4+" if c >= 4 else str(int(c))


def fmt(x, nd=4):
    if isinstance(x, float):
        return "nan" if x != x else f"{x:.{nd}f}"
    return str(x)


def write_rows(path, rows: list[dict], cols=None):
    cols = cols or (list(rows[0].keys()) if rows else [])
    with open(path, "w") as o:
        o.write("\t".join(cols) + "\n")
        for r in rows:
            o.write("\t".join(fmt(r.get(c, "")) for c in cols) + "\n")


def provenance() -> dict:
    files = ["acclib.py"] + sorted(p.name for p in HERE.glob("score_*.py"))
    bench = ["bench/fastag-bench/src/fastag_bench/score.py", "bench/fastag-bench/src/fastag_bench/parsers.py"]
    return {"python": sys.version.split()[0], "numpy": np.__version__, "pandas": pd.__version__,
            **{f: sha256(HERE / f) for f in files}, **{b: sha256(REPO / b) for b in bench}}
