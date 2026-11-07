"""#4 (FASTag 1.12, cluster F): pool truth for unidentified ProteomeTools spectra (S3-PT).

A ProteomeTools run measures one synthetic peptide pool (about 1,000 peptides). A spectrum that the
closed full-database search does not identify is labelled by the pool peptides whose mass fits its
precursor (mass-constrained candidates):

    |M_obs - k * C13 - M_pep| <= tol_ppm * M_pep * 1e-6,  M_obs = z * (mz - proton),
    k in the isotope errors (0, 1), z the given charge or 2-4 when none is given,
    M_pep over the pool's static and variable modifications.

Candidate-set size 0 is 'no_pool_candidate' (reported, not scored), size 1 a spectrum-level label
('size1'), size > 1 'pool_consistent' (correct for any candidate, reported separately, never merged
into a correctness claim). Identities are I/L-normalized, modification-free peptides.

Validity controls (PLAN-qc.md item #4): a same-size shuffled decoy pool (entrapment in the pool search),
a byproduct class (N- and C-terminal truncations by one and two residues, single deletions), the
pool-swap chance (candidates from a pool of another LC-MS batch with shared identities removed) and a
carryover class (peptides of the neighbouring pools). split_pools draws every split at once with
grouped disjointness.
"""
from __future__ import annotations

import bisect
import itertools
from pathlib import Path

import numpy as np
import pandas as pd

from .score import WATER, normalize_peptide, peptide_masses

PROTON = 1.007276467
C13 = 1.0033548378
SIZE_LABELS = ("no_pool_candidate", "size1", "pool_consistent")
CLASSES = ("target", "byproduct", "decoy", "carryover")


def peptide_mass(peptide: str) -> float:
    """Neutral monoisotopic mass of a peptide in Sage notation (mass deltas in brackets)."""
    res, pref, total = peptide_masses(peptide)
    if not pref:
        raise ValueError(f"peptide_mass: unsupported residue in {peptide!r}")
    return total + WATER


def _fmt(delta: float) -> str:
    return f"[{delta:+.6f}]"


def expand_variants(peptide: str, static: dict[str, float] | None, variable: dict[str, list[float]] | None,
                    max_var: int = 1) -> list[str]:
    """Modified forms of a plain peptide in Sage notation: static modifications on every site, then all
    combinations of at most max_var variable modifications (one per residue). The static-only form is
    first; the order is deterministic."""
    static = static or {}
    variable = variable or {}
    seq = str(peptide).upper()
    base = [static.get(a, 0.0) for a in seq]
    sites = [(i, d) for i, a in enumerate(seq) for d in variable.get(a, [])]
    out = []
    for k in range(0, max_var + 1):
        for combo in itertools.combinations(sites, k):
            pos = [i for i, _ in combo]
            if len(set(pos)) < len(pos):
                continue
            delta = list(base)
            for i, d in combo:
                delta[i] += d
            out.append("".join(a + (_fmt(x) if abs(x) > 1e-9 else "") for a, x in zip(seq, delta)))
    return list(dict.fromkeys(out))


def byproducts(peptide: str, min_len: int = 5) -> dict[str, str]:
    """Synthesis byproducts of a pool peptide: N-terminal truncations by 1 and 2 residues ('nterm-1',
    'nterm-2'), C-terminal ones ('cterm-1', 'cterm-2'), and single deletions ('del<i>', i 1-based).
    Variants shorter than min_len or equal to the peptide are dropped; a sequence reached twice keeps the
    first kind in that order."""
    p = str(peptide).upper()
    cand = [(p[1:], "nterm-1"), (p[2:], "nterm-2"), (p[:-1], "cterm-1"), (p[:-2], "cterm-2")]
    cand += [(p[:i] + p[i + 1:], f"del{i + 1}") for i in range(len(p))]
    out: dict[str, str] = {}
    for s, kind in cand:
        if len(s) >= min_len and s != p and s not in out:
            out[s] = kind
    return out


def decoy_pool(peptides: list[str], seed: int, max_tries: int = 200) -> list[str]:
    """Same-size shuffled-peptide decoy pool: each target's residues shuffled with its C-terminal residue
    kept (same composition and mass, tryptic end). No decoy shares a normalized identity with any target
    or another decoy. Deterministic per seed; ValueError when a target cannot be shuffled away."""
    rng = np.random.default_rng(seed)
    taken = {normalize_peptide(p) for p in peptides}
    out = []
    for p in peptides:
        p = str(p).upper()
        body, last = list(p[:-1]), p[-1:]
        for _ in range(max_tries):
            d = "".join(rng.permutation(body)) + last
            nd = normalize_peptide(d)
            if nd not in taken:
                taken.add(nd)
                out.append(d)
                break
        else:
            raise ValueError(f"decoy_pool: no shuffle of {p!r} avoids the target identities")
    return out


_byproducts = byproducts


class PoolIndex:
    """Sorted neutral masses of pool entries (variant string, class, identity) for mass queries."""

    def __init__(self, entries):
        rows = sorted(((peptide_mass(v), v, c, i) for v, c, i in entries), key=lambda r: (r[0], r[1]))
        self.masses = [r[0] for r in rows]
        self.entries = [(r[1], r[2], r[3]) for r in rows]

    @classmethod
    def from_peptides(klass, peptides, static=None, variable=None, max_var: int = 1, cls: str = "target",
                      byproducts: bool = False, decoys=None, carryover=None, min_len: int = 5):
        """Index of a pool: targets (class cls), optionally its byproducts (class 'byproduct', identities
        that are themselves targets are dropped), decoys (class 'decoy') and carryover peptides (class
        'carryover', target identities dropped)."""
        name = cls
        targets = [str(p).upper() for p in peptides]
        tid = {normalize_peptide(p) for p in targets}
        ent = []
        for p in targets:
            ent += [(v, name, normalize_peptide(p)) for v in expand_variants(p, static, variable, max_var)]
        if byproducts:
            seen = set()
            for p in targets:
                for b in _byproducts(p, min_len):
                    nb = normalize_peptide(b)
                    if nb in tid or nb in seen:
                        continue
                    seen.add(nb)
                    ent += [(v, "byproduct", nb) for v in expand_variants(b, static, variable, max_var)]
        for extra, name2 in ((decoys, "decoy"), (carryover, "carryover")):
            for p in extra or []:
                n = normalize_peptide(p)
                if name2 == "carryover" and n in tid:
                    continue
                ent += [(v, name2, n) for v in expand_variants(p, static, variable, max_var)]
        return klass(ent)

    def query(self, mass: float, tol_ppm: float):
        lo = bisect.bisect_left(self.masses, mass / (1 + tol_ppm * 1e-6))
        hi = bisect.bisect_right(self.masses, mass / (1 - tol_ppm * 1e-6))
        return [self.entries[i] for i in range(lo, hi) if abs(mass - self.masses[i]) <= tol_ppm * 1e-6 * self.masses[i]]


def candidates_by_mass(spectrum_meta: dict, pool: PoolIndex, tol_ppm: float = 10.0, charges=(2, 3, 4),
                       iso=(0, 1)) -> dict[str, dict[str, list[str]]]:
    """Mass-constrained candidates of one spectrum: {class: {identity: [variant strings]}} with every
    class of CLASSES present (empty dicts when nothing fits). spectrum_meta needs precursor_mz and charge
    (None or 0 = unknown: the charges are tried)."""
    mz = float(spectrum_meta["precursor_mz"])
    z0 = spectrum_meta.get("charge")
    zs = [int(z0)] if z0 not in (None, 0, "") and not (isinstance(z0, float) and np.isnan(z0)) and int(z0) > 0 \
        else list(charges)
    out: dict[str, dict[str, list[str]]] = {c: {} for c in CLASSES}
    for z in zs:
        m = z * (mz - PROTON)
        for k in iso:
            for v, c, ident in pool.query(m - k * C13, tol_ppm):
                lst = out.setdefault(c, {}).setdefault(ident, [])
                if v not in lst:
                    lst.append(v)
    for c in out:
        out[c] = {i: sorted(v) for i, v in sorted(out[c].items())}
    return out


def size_label(n: int) -> str:
    return SIZE_LABELS[0] if n == 0 else SIZE_LABELS[1] if n == 1 else SIZE_LABELS[2]


def write_pool_fasta(path: str | Path, targets: list[str], decoys: list[str] | None = None,
                     pool: str = "pool", decoy_prefix: str = "ENTRAP_") -> Path:
    """Pool FASTA for Sage's pool mode: one entry per target peptide and one per decoy-pool peptide.
    Decoy-pool entries are ordinary entries to Sage (it adds its own reversed decoys for the FDR); their
    accession prefix lets the scorer count the entrapment hits."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for i, p in enumerate(targets, 1):
            fh.write(f">{pool}|T{i:05d}\n{p}\n")
        for i, p in enumerate(decoys or [], 1):
            fh.write(f">{decoy_prefix}{pool}|D{i:05d}\n{p}\n")
    return path


# ----------------------------------------------------------------------------------------------- chance

def pool_swap(pools: pd.DataFrame, seed: int) -> dict[str, str]:
    """Pool-swap partner of every pool: a pool of another LC-MS batch with the closest size (ties broken
    at random, deterministic per seed). Columns pool, batch, size. ValueError when a pool has no partner."""
    rng = np.random.default_rng(seed)
    p = pools.reset_index(drop=True)
    out = {}
    for r in p.itertuples():
        other = p[p["batch"] != r.batch]
        if other.empty:
            raise ValueError(f"pool_swap: {r.pool} has no pool in another batch")
        d = (other["size"] - r.size).abs()
        best = other[d == d.min()].sort_values("pool")
        out[r.pool] = str(best["pool"].iloc[int(rng.integers(len(best)))])
    return out


def swap_peptides(source: list[str], swap: list[str], seed: int) -> list[str]:
    """Peptides of the swap pool used as the chance candidates of the source pool: identities shared
    with the source removed, then sampled down (deterministically) to the source pool's size."""
    sid = {normalize_peptide(p) for p in source}
    keep = sorted({p for p in swap if normalize_peptide(p) not in sid})
    if len(keep) > len(source):
        rng = np.random.default_rng(seed)
        keep = sorted(rng.choice(keep, size=len(source), replace=False).tolist())
    return keep


def carryover_pools(pools: pd.DataFrame) -> dict[str, list[str]]:
    """Neighbouring pools of each pool: same synthesis set and LC-MS batch, pool number +-1 (pool
    numbers are the acquisition order within a queue; an approximation, the run start times of the
    neighbours are not downloaded). Columns pool, set, num, batch."""
    idx = {(r.set, r.batch, int(r.num)): r.pool for r in pools.itertuples()}
    out = {}
    for r in pools.itertuples():
        out[r.pool] = [idx[k] for k in ((r.set, r.batch, int(r.num) - 1), (r.set, r.batch, int(r.num) + 1)) if k in idx]
    return out


# ----------------------------------------------------------------------------------------------- splits

def _groups(pools: list[str], peptides: dict[str, set] | None) -> dict[str, str]:
    """Union-find over pools that share a normalized peptide; group id = smallest pool name."""
    parent = {p: p for p in pools}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    if peptides:
        owner: dict[str, str] = {}
        for p in pools:
            for pep in peptides.get(p, ()):
                n = normalize_peptide(pep)
                if n in owner:
                    a, b = find(owner[n]), find(p)
                    if a != b:
                        parent[max(a, b)] = min(a, b)
                else:
                    owner[n] = p
    return {p: find(p) for p in pools}


def split_pools(pools: pd.DataFrame, plan: list[dict], peptides: dict[str, set] | None = None) -> pd.DataFrame:
    """Draw every split at once. pools: one row per run file or pool (columns pool, batch; repeats of a
    pool share the pool name and travel together). plan: ordered specs {split, seed, n, exclude_batches_of}
    with n in pools. Pools that share a normalized peptide (peptides: pool -> peptides) form one group,
    which goes to one split as a whole. Each split draws with its own seed from the groups left over,
    excluding batches used by the splits named in exclude_batches_of. Returns pool, split, seed, group,
    batch."""
    p = pools.drop_duplicates("pool").sort_values("pool").reset_index(drop=True)
    batch = dict(zip(p["pool"], p["batch"].astype(str)))
    grp = _groups(list(p["pool"]), peptides)
    members: dict[str, list[str]] = {}
    for q in p["pool"]:
        members.setdefault(grp[q], []).append(q)
    assigned: dict[str, str] = {}
    seeds = {}
    for spec in plan:
        name, n = spec["split"], int(spec["n"])
        seeds[name] = int(spec["seed"])
        banned = {batch[q] for q, s in assigned.items() if s in set(spec.get("exclude_batches_of") or [])}
        free = sorted(g for g, ms in members.items()
                      if not any(m in assigned for m in ms) and not {batch[m] for m in ms} & banned)
        rng = np.random.default_rng(int(spec["seed"]))
        order = [free[i] for i in rng.permutation(len(free))]
        got = 0
        for g in order:
            if got >= n:
                break
            if got + len(members[g]) > n:
                continue
            for m in members[g]:
                assigned[m] = name
            got += len(members[g])
        if got < n:
            raise ValueError(f"split_pools: split {name!r} got {got} of {n} pools")
    rows = [{"pool": q, "split": s, "seed": seeds[s], "group": grp[q], "batch": batch[q]}
            for q, s in assigned.items()]
    order = {s["split"]: i for i, s in enumerate(plan)}
    out = pd.DataFrame(rows, columns=["pool", "split", "seed", "group", "batch"])
    out["_o"] = out["split"].map(order)
    return out.sort_values(["_o", "pool"]).drop(columns="_o").reset_index(drop=True)


def shared_identities(assign: pd.DataFrame, peptides: dict[str, set]) -> dict[str, list[str]]:
    """Normalized identities that occur in pools of more than one split: identity -> sorted splits.
    ProteomeTools pools share a few peptides (1-5 of about 1,000 between some pools); rather than merging
    pools (which would chain most pools into one group), these identities are excluded from scoring in
    every split."""
    seen: dict[str, set] = {}
    split = dict(zip(assign["pool"], assign["split"]))
    for q, sname in split.items():
        for pep in peptides.get(q, ()):
            seen.setdefault(normalize_peptide(pep), set()).add(sname)
    return {i: sorted(v) for i, v in sorted(seen.items()) if len(v) > 1}


def assert_disjoint(assign: pd.DataFrame, peptides: dict[str, set] | None = None,
                    batches: dict[str, str] | None = None, batch_exclusive=None) -> None:
    """Raise ValueError unless every pool is in one split only, no normalized peptide occurs in two
    splits, and (batch_exclusive: pairs of split names) no batch is shared by such a pair."""
    dup = assign.groupby("pool")["split"].nunique()
    if (dup > 1).any():
        raise ValueError(f"pool in two splits: {sorted(dup[dup > 1].index)[:5]}")
    split = dict(zip(assign["pool"], assign["split"]))
    if peptides:
        seen: dict[str, str] = {}
        for q, s in split.items():
            for pep in peptides.get(q, ()):
                n = normalize_peptide(pep)
                if n in seen and seen[n] != s:
                    raise ValueError(f"peptide {n} in splits {seen[n]} and {s}")
                seen.setdefault(n, s)
    if batch_exclusive:
        b = batches if batches is not None else dict(zip(assign["pool"], assign.get("batch", assign["pool"])))
        for x, y in batch_exclusive:
            bx = {b[q] for q, s in split.items() if s == x}
            by = {b[q] for q, s in split.items() if s == y}
            if bx & by:
                raise ValueError(f"batch shared by {x} and {y}: {sorted(bx & by)[:5]}")
