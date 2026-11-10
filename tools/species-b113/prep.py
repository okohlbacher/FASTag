"""Compact per-run cache of the b113 species DEV dumps (DEV data only).

usage: prep.py OUTDIR [workers]
For every FTMS DEV run and arm (real, alldecoy) writes OUTDIR/<run>.<arm>.pkl with
  genera  : genus names (index = genus id)
  n_spec  : spectra with at least one evaluated tag (trials)
  target  : list of contributing units (spec, seq_id, frozenset(genus ids)); a unit is a tag with taxon evidence
            at the best E-value of its spectrum (the -species_evidence best rule)
  decoys  : the same for each k-mer decoy replicate (seq_id is the id of the TARGET tag the decoy was made from)
  ddb     : the same for the lookup in the shuffled-proteome index (real arm only)
"""
import gzip, json, pickle, sys
from pathlib import Path
from multiprocessing import Pool
from load import taxonomy, genus_of, manifest, DUMP

def units(tags, col):
    """tags: list of (E, seq_id, [gset per column]); -> contributing (seq_id, gset) at the best E with evidence."""
    b = None
    for e, _, g in tags:
        if g[col] is not None and (b is None or e < b): b = e
    if b is None: return []
    return [(sid, g[col]) for e, sid, g in tags if g[col] is not None and e == b]

def one(job):
    run, arm, out = job
    parent, rank, name = TAXO
    p = DUMP / run / arm / "dump.tsv.gz"
    taxa, nkd = [], 0
    specs, seqs = {}, {}
    rows = []
    with gzip.open(p, "rt") as fh:
        for l in fh:
            f = l.rstrip("\n").split("\t")
            if l[0] == "#":
                if f[0] == "#k": nkd = int(f[3])
                elif f[0] == "#taxon": taxa.append(int(f[1]))
                continue
            rows.append(f)
    leaf_g = {t: genus_of(t, parent, rank) for t in taxa}
    gids = sorted({g for g in leaf_g.values() if g})
    gi = {g: i for i, g in enumerate(gids)}
    cache = {}
    def gset(s):
        r = cache.get(s, 0)
        if r == 0:
            if s in ("-", "X", ""): r = None
            else:
                r = frozenset(gi[leaf_g[int(x)]] for x in s.split(",") if leaf_g.get(int(x))) or None
            cache[s] = r
        return r
    for f in rows:
        sid = seqs.setdefault(f[3], len(seqs))
        cols = [gset(f[4])] + [gset(x) for x in f[5].split("|")][:nkd] + [gset(f[6])]
        specs.setdefault(int(f[1]), []).append((float(f[2]), sid, cols))
    T, KD, DDB = [], [[] for _ in range(nkd)], []
    for s in sorted(specs):
        tg = specs[s]
        T += [(s, a, b) for a, b in units(tg, 0)]
        for j in range(nkd): KD[j] += [(s, a, b) for a, b in units(tg, 1 + j)]
        DDB += [(s, a, b) for a, b in units(tg, 1 + nkd)]
    d = dict(run=run, arm=arm, genera=[name[g] for g in gids], n_spec=len(specs), n_seq=len(seqs), target=T, decoys=KD, ddb=DDB)
    with open(Path(out) / f"{run}.{arm}.pkl", "wb") as fh: pickle.dump(d, fh, protocol=4)
    return f"{run} {arm} spec {len(specs)} units {len(T)}"

TAXO = None
def init():
    global TAXO
    TAXO = taxonomy()

if __name__ == "__main__":
    out = sys.argv[1]; Path(out).mkdir(parents=True, exist_ok=True)
    w = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    man = manifest()
    jobs = []
    for rd in sorted(DUMP.iterdir()):
        mp = rd / "meta.json"
        if not rd.is_dir() or not mp.exists(): continue
        if json.loads(mp.read_text()).get("analyzer") != "FTMS" or rd.name not in man: continue
        for arm in ("real", "alldecoy"):
            if (rd / arm / "dump.tsv.gz").exists() and not (Path(out) / f"{rd.name}.{arm}.pkl").exists():
                jobs.append((rd.name, arm, out))
    with Pool(w, initializer=init) as pool:
        for r in pool.imap_unordered(one, jobs): print(r, flush=True)
    print("PREP_DONE")
