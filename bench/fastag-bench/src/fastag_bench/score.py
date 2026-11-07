"""Scoring rules.

Tag correctness, same rule for every tool (paper rule, as in DirecTag's own validity test):
a tag is correct for a spectrum when its sequence, or the reversed sequence, is a substring of the
spectrum's database-search peptide with I and L treated as identical, AND at least one of the
tag's two flanking masses agrees with the peptide within 0.05 Da at that position
(`tag_correct_flank`, rule "flank"). The sequence-only rule (`tag_matches`, rule "sequence") is
kept as a secondary, more lenient column. The 'shuffled' control (tags scored against another
spectrum's peptide) gives the chance level under either rule.

Flank convention (FASTag and DirecTag 1.4.21142 write the same numbers; calibrated on PXD003531):
tags are stored N->C under a y-ion assumption with nterm_mass + tag residues + cterm_mass + H2O =
precursor neutral mass. For an occurrence of the tag as written at peptide position i the
nterm_mass is the residue mass before it (N-terminal modification included) and cterm_mass the
residue mass after it. A b-ion read appears reversed; for an occurrence of the reversed tag at
position j, cterm_mass = prefix mass before j minus H2O and nterm_mass = suffix mass plus H2O.

Ion series (FASTag 1.12 #15 phase B, -ion_series cz|auto): a tag read as c/z-dot ions carries
`ion_series` = cz in the tag TSV. Its forward reads use the same residue-sum convention; its
reversed (c-ion) reads carry the offset offC - offN = (H2O - NH2) - NH3 = -15.034708 instead of
+H2O (`REVERSED_OFFSET`). A TSV without the column is b/y throughout.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

_MOD_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}")
_NONRES = re.compile(r"[^A-Z]")


def normalize_peptide(seq: str) -> str:
    """Strip modification annotations and terminal markers, fold I to L.

    Residues are upper case in every supported output; lower-case letters are terminal markers
    (ProForma-style 'n', 'c') or modification names and are dropped.
    """
    s = _MOD_RE.sub("", str(seq))
    s = _NONRES.sub("", s)
    return s.replace("I", "L")


def normalize_tag(tag: str) -> str:
    """Upper-case residues, I folded to L. Inline modifications ('S[Phospho]') are removed before
    upper-casing so their names do not turn into residues."""
    return _NONRES.sub("", _MOD_RE.sub("", str(tag)).upper()).replace("I", "L")


def tag_matches(tag: str, peptide: str) -> bool:
    """True when tag or its reverse occurs in peptide (I=L, modifications ignored)."""
    t = normalize_tag(tag)
    p = normalize_peptide(peptide)
    if not t or not p:
        return False
    return t in p or t[::-1] in p


# Monoisotopic residue masses (unmodified); modifications come from the peptide string.
RESIDUE_MASS = {
    "G": 57.021464, "A": 71.037114, "S": 87.032028, "P": 97.052764, "V": 99.068414,
    "T": 101.047679, "C": 103.009185, "L": 113.084064, "I": 113.084064, "N": 114.042927,
    "D": 115.026943, "Q": 128.058578, "K": 128.094963, "E": 129.042593, "M": 131.040485,
    "H": 137.058912, "F": 147.068414, "R": 156.101111, "Y": 163.063329, "W": 186.079313,
    "U": 150.953636, "O": 237.147727,
}
WATER = 18.010565
# Reversed-read flank offset per ion series (offC - offN; FASTag src/IonSeries.h, OpenMS
# Residue::getInternalTo{B,Y,C,Zp1}Ion): b/y one water, c/z-dot H2O - NH2 - NH3.
REVERSED_OFFSET = {"by": WATER, "cz": 1.991841 - 17.026549}
FLANK_TOL = 0.05
RULES = ("flank", "sequence")
_TOKEN = re.compile(r"([A-Z])((?:\[[^\]]*\])*)")
_MASS = re.compile(r"\[([+-]?\d+(?:\.\d*)?)\]")


def peptide_masses(peptide: str) -> tuple[str, list[float], float]:
    """Parse a modified peptide written with mass deltas, as Sage writes it
    ('[+229.1629]-PEPC[+57.0215]TIDEK[+229.1629]', C-terminal '-[+x]' allowed).

    Returns (residues with I folded to L, prefix masses P, total) where P[i] is the residue mass
    N-terminal of position i (the N-terminal modification is in P[0]) and total the residue mass
    of the whole peptide including both terminal modifications. Unknown residues (X, B, Z) make
    P empty.
    """
    s = str(peptide)
    nterm = 0.0
    m = re.match(r"^((?:\[[^\]]*\])+)-", s)
    if m:
        nterm = sum(float(x) for x in _MASS.findall(m.group(1)))
        s = s[m.end():]
    cterm = 0.0
    m = re.search(r"-((?:\[[^\]]*\])+)$", s)
    if m:
        cterm = sum(float(x) for x in _MASS.findall(m.group(1)))
        s = s[:m.start()]
    res, pref = [], [nterm]
    for aa, mods in _TOKEN.findall(s):
        if aa not in RESIDUE_MASS:
            return "", [], 0.0
        res.append(aa)
        pref.append(pref[-1] + RESIDUE_MASS[aa] + sum(float(x) for x in _MASS.findall(mods)))
    return "".join(res).replace("I", "L"), pref, pref[-1] + cterm


def _find_all(hay: str, needle: str) -> list[int]:
    out, i = [], hay.find(needle)
    while i >= 0:
        out.append(i)
        i = hay.find(needle, i + 1)
    return out


def tag_correct_flank(tag: str, nterm_mass: float, cterm_mass: float, residues: str, pref: list[float],
                      total: float, tol: float = FLANK_TOL, reversed_offset: float = WATER) -> bool:
    """Paper rule: tag (or its reverse) is a substring of the peptide (I=L) AND at least one
    flanking mass agrees within tol at that position (see module docstring for the convention).
    residues, pref and total come from peptide_masses(). reversed_offset is the tag's series'
    REVERSED_OFFSET (default b/y, one water)."""
    t = normalize_tag(tag)
    if not t or not pref:
        return False
    L = len(t)
    for i in _find_all(residues, t):
        if abs(nterm_mass - pref[i]) <= tol or abs(cterm_mass - (total - pref[i + L])) <= tol:
            return True
    rt = t[::-1]
    for j in _find_all(residues, rt):
        if (abs(cterm_mass - (pref[j] - reversed_offset)) <= tol
                or abs(nterm_mass - (total - pref[j + L] + reversed_offset)) <= tol):
            return True
    return False


def tag_correct_precursor_flank(tag: str, nterm_mass: float, residues: str, pref: list[float],
                                tol: float = FLANK_TOL) -> bool:
    """#6: the precursor-derived flank alone. FASTag derives a forward (y-ion) read's nterm_mass
    from the precursor mass, so a wrong precursor charge or isotope shows there first: true when
    the tag as written (not reversed) occurs in the peptide (I=L) with nterm_mass equal to the
    residue mass before it within tol. residues and pref come from peptide_masses()."""
    t = normalize_tag(tag)
    if not t or not pref:
        return False
    return any(abs(nterm_mass - pref[i]) <= tol for i in _find_all(residues, t))


def _mark(tags: pd.DataFrame, psms: pd.DataFrame, rule: str = "flank") -> pd.DataFrame:
    """Join tags with ground-truth peptides; add correct_seq, correct_flank (when the tags carry
    nterm_mass/cterm_mass) and 'correct' = the column of the chosen rule."""
    if rule not in RULES:
        raise ValueError(f"rule must be one of {RULES}")
    gt = psms[["key", "peptide"]].drop_duplicates("key")
    m = tags.merge(gt, on="key", how="inner")
    m["correct_seq"] = [tag_matches(t, p) for t, p in zip(m["tag"], m["peptide"])]
    if {"nterm_mass", "cterm_mass"} <= set(m.columns):
        cache: dict[str, tuple[str, list[float], float]] = {}
        out = []
        series = m["ion_series"].fillna("by") if "ion_series" in m.columns else ["by"] * len(m)
        for t, p, n, c, ok, sr in zip(m["tag"], m["peptide"], pd.to_numeric(m["nterm_mass"], errors="coerce"),
                                      pd.to_numeric(m["cterm_mass"], errors="coerce"), m["correct_seq"], series):
            if not ok:  # the flank rule implies the sequence rule
                out.append(False)
                continue
            if p not in cache:
                cache[p] = peptide_masses(p)
            if sr not in REVERSED_OFFSET:
                raise ValueError(f"unknown ion_series {sr!r}")
            out.append(tag_correct_flank(t, n, c, *cache[p], reversed_offset=REVERSED_OFFSET[sr]))
        m["correct_flank"] = out
    elif rule == "flank":
        raise ValueError("rule 'flank' needs nterm_mass and cterm_mass columns")
    m["correct"] = m["correct_flank"] if rule == "flank" else m["correct_seq"]
    return m


def shuffled_psms(psms: pd.DataFrame, seed: int = 0) -> pd.DataFrame:
    """Chance control: give every spectrum the peptide of a different, randomly chosen spectrum."""
    gt = psms[["key", "peptide"]].drop_duplicates("key").reset_index(drop=True)
    n = len(gt)
    if n < 2:
        return gt
    rng = np.random.default_rng(seed)
    order = rng.permutation(n)
    src = np.empty(n, dtype=int)
    src[order] = np.roll(order, -1)  # one random cycle: a derangement, no spectrum keeps its peptide
    return pd.DataFrame({"key": gt["key"], "peptide": gt["peptide"].to_numpy()[src]})


def shuffled_peptides(psms: pd.DataFrame, seed: int = 0) -> pd.DataFrame:
    """Chance control of the #4 path: a derangement over I/L-normalized peptide identities.

    Unlike shuffled_psms (a row derangement, kept unchanged for the v1.9.0 tables), no spectrum can
    receive a peptide equal to its own normalized identity, even when several spectra share a peptide
    or differ only by I/L or modifications. Identities are permuted by one random cycle; every spectrum
    of identity u gets the same representative peptide string of identity pi(u) (its first occurrence
    in key order, modifications kept so the flank rule still applies). With fewer than two identities
    there is no derangement and the result is empty."""
    gt = psms[["key", "peptide"]].drop_duplicates("key").reset_index(drop=True)
    ident = [normalize_peptide(p) for p in gt["peptide"]]
    uniq = sorted(set(ident))
    if len(uniq) < 2:
        return gt.iloc[:0].copy()
    rep: dict[str, str] = {}
    for u, p in zip(ident, gt["peptide"]):
        rep.setdefault(u, p)
    n = len(uniq)
    rng = np.random.default_rng(seed)
    order = rng.permutation(n)
    src = np.empty(n, dtype=int)
    src[order] = np.roll(order, -1)  # one random cycle over identities: no identity maps to itself
    target = {uniq[i]: rep[uniq[src[i]]] for i in range(n)}
    return pd.DataFrame({"key": gt["key"], "peptide": [target[u] for u in ident]})


def correct_candidates(tag: str, flanks: tuple[float, float], candidates, tol: float = FLANK_TOL) -> list[str]:
    """Candidates (peptide strings in Sage notation) for which the tag is correct under the paper rule,
    in input order, each once."""
    n, c = flanks
    out, seen = [], set()
    for p in candidates:
        if p in seen:
            continue
        seen.add(p)
        if tag_matches(tag, p) and tag_correct_flank(tag, n, c, *peptide_masses(p), tol=tol):
            out.append(p)
    return out


def tag_correct_any(tag: str, flanks: tuple[float, float], candidates, tol: float = FLANK_TOL) -> bool:
    """#4 rule for candidate sets: the paper rule (tag_correct_flank) holds for at least one candidate.
    With a single candidate it is the paper rule itself."""
    n, c = flanks
    return any(tag_matches(tag, p) and tag_correct_flank(tag, n, c, *peptide_masses(p), tol=tol) for p in candidates)


def score_tags(tags: pd.DataFrame, psms: pd.DataFrame, ks=(1, 5, 10, 50), rule: str = "flank") -> dict:
    """Tag precision and recall against ground-truth PSMs.

    tags: columns key, tag, rank (1 = best). psms: columns key, peptide.
    Returns a flat dict of counts and fractions.
    """
    gt_keys = set(psms["key"])
    m = _mark(tags, psms, rule)
    n_gt = len(gt_keys)
    tagged = m["key"].nunique()
    top = m[m["rank"] == 1]
    res = {
        "psm_spectra": n_gt,
        "psm_spectra_tagged": int(tagged),
        "tags_on_psm_spectra": int(len(m)),
        "top1_correct": int(top["correct"].sum()),
        "top1_precision": _frac(top["correct"].sum(), len(top)),
        "top1_recall": _frac(top["correct"].sum(), n_gt),
        "all_tags_correct": int(m["correct"].sum()),
        "all_tags_precision": _frac(m["correct"].sum(), len(m)),
        "any_tag_recall": _frac(m.groupby("key")["correct"].any().sum(), n_gt),
        "any_tag_rate": _frac(m.groupby("key")["correct"].any().sum(), tagged),
    }
    for k in ks:
        hit = m[m["rank"] <= k].groupby("key")["correct"].any()
        res[f"top{k}_any_correct"] = int(hit.sum())
        res[f"top{k}_any_rate"] = _frac(hit.sum(), tagged)
        res[f"top{k}_any_recall"] = _frac(hit.sum(), n_gt)
    return res


def precision_by(tags: pd.DataFrame, psms: pd.DataFrame, column: str, bins=None, rule: str = "flank") -> pd.DataFrame:
    """Precision of all tags on PSM spectra grouped by a column (e.g. length) or by bins of it."""
    m = _mark(tags, psms, rule)
    if column not in m.columns:
        return pd.DataFrame(columns=[column, "tags", "correct", "precision"])
    g = pd.cut(pd.to_numeric(m[column], errors="coerce"), bins) if bins is not None else m[column]
    out = m.groupby(g, observed=True)["correct"].agg(tags="size", correct="sum").reset_index()
    out["precision"] = out["correct"] / out["tags"]
    out[column] = out[column].astype(str)
    return out


def rank_curve(tags: pd.DataFrame, psms: pd.DataFrame, max_k: int = 50, rule: str = "flank") -> pd.DataFrame:
    """Share of tagged PSM spectra (rate) and of all PSM spectra (recall) with a correct tag
    within the top k, k = 1..max_k."""
    m = _mark(tags, psms, rule)
    tagged = m["key"].nunique()
    n_gt = psms["key"].nunique()
    first = m[m["correct"]].groupby("key")["rank"].min()
    rows = [{"k": k, "spectra": int((first <= k).sum()), "rate": _frac((first <= k).sum(), tagged),
             "recall": _frac((first <= k).sum(), n_gt)} for k in range(1, max_k + 1)]
    return pd.DataFrame(rows)


def score_peptides(pred: pd.DataFrame, psms: pd.DataFrame) -> dict:
    """Exact peptide agreement (I=L, modifications ignored) for full de novo tools."""
    gt = psms[["key", "peptide"]].drop_duplicates("key")
    m = pred.merge(gt, on="key", suffixes=("_pred", "_gt"))
    ok = [normalize_peptide(a) == normalize_peptide(b) for a, b in zip(m["peptide_pred"], m["peptide_gt"])]
    return {"psm_spectra_predicted": int(len(m)), "exact_correct": int(sum(ok)),
            "exact_precision": _frac(sum(ok), len(m))}


def _frac(a, b) -> float:
    return round(float(a) / float(b), 6) if b else float("nan")


# ---------------------------------------------------------------- species

def score_species(species: pd.DataFrame, expected: str) -> dict:
    """Rank of the expected taxon name in a FASTag species TSV (file order = rank)."""
    names = [str(n) for n in species["name"]]
    exp = expected.strip().lower()
    rank = next((i + 1 for i, n in enumerate(names) if n.lower() == exp), None)
    top = names[0] if names else None
    obs = species["observed"].tolist() if "observed" in species else []
    ratio = round(obs[0] / obs[1], 4) if len(obs) > 1 and obs[1] else float("nan")
    return {"expected": expected, "top": top, "expected_rank": rank,
            "top1_correct": rank == 1, "top_vs_second_observed": ratio, "taxa": len(names)}


# ---------------------------------------------------------------- digest and label

_ENZ = {
    "trypsin": "Trypsin", "trypsin/p": "Trypsin", "lys-c": "Lys-C", "lysc": "Lys-C", "lys-c/p": "Lys-C",
    "arg-c": "Arg-C", "glu-c": "Glu-C", "asp-n": "Asp-N", "chymotrypsin": "Chymotrypsin",
    "lys-n": "Lys-N", "unspecific cleavage": "unspecific", "no cleavage": "unspecific",
    "unspecific": "unspecific", "none": "unspecific",
}


def expected_protease(agents: list[str]) -> str | None:
    """Map SDRF cleavage agents to the class FASTag's digest report can call.

    Trypsin with Lys-C (common double digest) has trypsin specificity and maps to Trypsin.
    Other combinations return 'mixed', which no single call can match.
    """
    names = {_ENZ.get(a.strip().lower(), a.strip()) for a in agents if a.strip()}
    if not names:
        return None
    if "Trypsin" in names and names <= {"Trypsin", "Lys-C"}:
        return "Trypsin"
    if len(names) == 1:
        return names.pop()
    return "mixed"


def expected_label(labels: list[str], mods: list[str]) -> str:
    text = " ".join(labels + mods).lower()
    if "tmtpro" in text or "tmt16" in text or "tmt 16" in text or "tmt 18" in text:
        return "TMTpro"
    if "tmt" in text:
        return "TMT"
    if "itraq4" in text or "itraq 4" in text:
        return "iTRAQ4"
    if "itraq" in text:
        return "iTRAQ8"
    if "silac" in text or "label:13c" in text or "label:2h" in text:
        return "SILAC"
    return "label-free"


def digest_call(report: dict[tuple[str, str], str]) -> dict:
    status = report.get(("call", "status"), "missing")
    return {"status": status,
            "call": report.get(("call", "class")) if status == "call" else None,
            "model": report.get(("call", "model")),
            "runner_up": report.get(("call", "runner_up_class")),
            "margin": _num(report.get(("call", "margin")))}


def label_call(report: dict[tuple[str, str], str], share_min: float = 0.01) -> dict:
    """Harness rule (not a FASTag call): the isobaric label with the largest tag-end share,
    when that share reaches share_min and exceeds its +0.5 Da background count; else label-free."""
    best, best_share = "label-free", 0.0
    for lab in ("TMT", "TMTpro", "iTRAQ4"):
        share = _num(report.get(("nlabel", f"{lab}.share"))) or 0.0
        cnt = _num(report.get(("nlabel", f"{lab}.count"))) or 0.0
        bg = _num(report.get(("nlabel", f"{lab}.background"))) or 0.0
        if share >= share_min and cnt > bg and share > best_share:
            best, best_share = lab, share
    return {"label": best, "share": best_share,
            "K8_share": _num(report.get(("heavy", "K8.share"))),
            "R10_share": _num(report.get(("heavy", "R10.share")))}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
