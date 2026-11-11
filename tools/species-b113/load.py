"""Shared loader for the b113 species DEV dumps (DEV data only)."""
import gzip, json, math
from pathlib import Path
import numpy as np
TAX = "/scratch/kohlbach/fastag112-dev/tax"
DUMP = Path("/scratch/kohlbach/b113/species/devdump")
MAN = "/scratch/kohlbach/b113/species/src/bench/fastag-bench/config/species_runs.tsv"
CONTAM = {"Bos", "Sus", "Oryctolagus", "Ovis", "Equus"}

def taxonomy():
    parent, rank, name = {}, {}, {}
    for l in open(f"{TAX}/nodes.dmp"):
        f = [x.strip() for x in l.split("|")]
        parent[int(f[0])] = int(f[1]); rank[int(f[0])] = f[2]
    for l in open(f"{TAX}/names.dmp"):
        f = [x.strip() for x in l.split("|")]
        if f[3] == "scientific name": name[int(f[0])] = f[1]
    return parent, rank, name

def genus_of(t, parent, rank):
    seen = 0
    while t in parent and seen < 100:
        if rank.get(t) == "genus": return t
        if parent[t] == t: return None
        t = parent[t]; seen += 1
    return None

def manifest():
    rows = {}
    hdr = None
    for l in open(MAN):
        if l.startswith("#"): continue
        f = l.rstrip("\n").split("\t")
        if hdr is None: hdr = f; continue
        r = dict(zip(hdr, f)); rows[r["run_id"]] = r
    return rows

def parse_truth(s):
    out = {}
    for p in str(s).split(";"):
        p = p.strip()
        if not p: continue
        if "=" in p: g, v = p.split("=", 1); out[g.strip()] = float(v)
        else: out[p] = None
    return out

def load_dump(path, parent, rank):
    """-> dict with genus list, per-spectrum best-evidence genus index sets for target, k-mer decoy replicates, ddb."""
    leaf_g = {}
    taxa = []
    ov_rows = {}
    specs = {}
    nkd = 0
    with gzip.open(path, "rt") as fh:
        for l in fh:
            if l[0] == "#":
                f = l.rstrip("\n").split("\t")
                if f[0] == "#k": nkd = int(f[3])
                elif f[0] == "#taxon": taxa.append(int(f[1]))
                elif f[0] == "#overlap": ov_rows[int(f[1])] = [int(x) for x in f[2:]]
                continue
            f = l.rstrip("\n").split("\t")
            specs.setdefault(int(f[1]), []).append((float(f[2]), f[4], f[5].split("|"), f[6]))
    for t in taxa: leaf_g[t] = genus_of(t, parent, rank)
    genera = sorted({g for g in leaf_g.values() if g})
    gi = {g: i for i, g in enumerate(genera)}
    def gset(s):
        if s in ("-", "X", ""): return None
        r = frozenset(gi[leaf_g[int(x)]] for x in s.split(",") if leaf_g.get(int(x)))
        return r or None
    def best(tags):
        b = None; out = set()
        for e, ts in tags:
            if ts is None: continue
            if b is None or e < b: b = e
        if b is None: return frozenset()
        for e, ts in tags:
            if ts is not None and e == b: out |= ts
        return frozenset(out)
    T, KD, DDB, CONC = [], [[] for _ in range(nkd)], [], []
    cache = {}
    def cs(s):
        r = cache.get(s)
        if r is None and s not in cache: r = gset(s); cache[s] = r
        return r
    for sid in sorted(specs):
        tags = specs[sid]
        T.append(best([(e, cs(t)) for e, t, _, _ in tags]))
        for j in range(nkd):
            KD[j].append(best([(e, cs(k[j])) for e, _, k, _ in tags]))
        DDB.append(best([(e, cs(d)) for e, _, _, d in tags]))
        # concatenated target+decoy-index competition: decoy genera offset by n
        n = len(genera)
        conc = []
        for e, t, _, d in tags:
            a, b2 = cs(t), cs(d)
            u = set()
            if a: u |= a
            if b2: u |= {x + n for x in b2}
            conc.append((e, frozenset(u) if u else None))
        CONC.append(best(conc))
    # leaf overlap -> genus distinct k-mer overlap is not derivable exactly from leaf pairs; keep leaf matrix
    return dict(genera=genera, T=T, KD=KD, DDB=DDB, CONC=CONC, taxa=taxa, overlap=ov_rows, leaf_g=leaf_g)
