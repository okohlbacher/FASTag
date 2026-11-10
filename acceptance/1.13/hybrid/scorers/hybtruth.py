"""Truth of the hybrid arm: Sage PSMs of the hybrid, Orbitrap-detected MS2 spectra of one run.

truth(sage_tsv, scans_tsv): rank-1 Sage rows whose scan is class 'hybrid' with analyzer FTMS (hybrid_scans.py);
within that subset a target-decoy q-value on sage_discriminant_score (best first, q = running min of
decoys / targets); kept: targets with subset q <= 0.01 and Sage's own spectrum_q <= 0.01.
Returns (DataFrame key, peptide, cluster (I/L-folded, modification-free peptide), charge; number of hybrid FTMS MS2)."""
import re

import pandas as pd

_MOD = re.compile(r"\[[^\]]*\]")
FDR = 0.01


def cluster(pep):
    return re.sub(r"[^A-Z]", "", _MOD.sub("", str(pep))).replace("I", "L")


def truth(sage_tsv, scans_tsv, fdr=FDR):
    sc = pd.read_csv(scans_tsv, sep="\t")
    hyb = set(sc.loc[(sc["class"] == "hybrid") & (sc["analyzer"] == "FTMS"), "scan"].astype(int))
    df = pd.read_csv(sage_tsv, sep="\t")
    if "rank" in df.columns:
        df = df[df["rank"] == 1]
    df = df.assign(scan=df["scannr"].str.extract(r"scan=(\d+)", expand=False).astype(int))
    df = df[df["scan"].isin(hyb)].sort_values("sage_discriminant_score", ascending=False, kind="mergesort")
    df = df.drop_duplicates("scan")
    dec = (df["label"] != 1).cumsum()
    tgt = (df["label"] == 1).cumsum().clip(lower=1)
    df = df.assign(subset_q=(dec / tgt)[::-1].cummin()[::-1])
    keep = df[(df["label"] == 1) & (df["subset_q"] <= fdr) & (df["spectrum_q"] <= fdr)]
    out = pd.DataFrame({"key": "scan=" + keep["scan"].astype(str), "peptide": keep["peptide"].to_numpy(),
                        "cluster": keep["peptide"].map(cluster).to_numpy(),
                        "charge": keep["charge"].astype(int).to_numpy()})
    return out, len(hyb)


if __name__ == "__main__":
    import sys
    t, n = truth(sys.argv[1], sys.argv[2])
    print(f"hybrid_ftms_ms2\t{n}\ntruth_spectra\t{len(t)}\ntruth_clusters\t{t['cluster'].nunique()}")
