"""De novo reference points: tags derived from full-peptide de novo predictions.

Casanovo, InstaNovo, Novor and PepNovo+ predict whole peptides. To compare them with a tagger, every
length-k substring of a spectrum's top peptide becomes a tag, with its N-terminal (prefix) and
C-terminal (suffix) residue-mass sums taken from the predicted peptide, modifications included.

Correctness rules (the same two rules the tag-accuracy task uses):

* sequence: the tag, or its reverse, is a substring of the Sage PSM peptide (I = L, modifications
  stripped). Same as ``score.tag_matches``.
* flank: sequence, and at one occurrence the predicted prefix or suffix mass agrees with the Sage
  peptide's prefix or suffix mass at that position within ``tol`` Da (0.05). For a reversed match the
  predicted prefix is compared with the Sage suffix and vice versa. Masses are residue sums
  (N-terminal modification counted in the prefix, no water, no proton), so both sides use the same
  convention and no ion-type offset enters.

Derived tags are ranked within a spectrum by the mean per-residue score of the window when the tool
reports per-residue scores (Casanovo, InstaNovo), otherwise by the peptide score of their source
peptide and then by position (all windows of one peptide then tie; the order is N to C).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

from .parsers import mgf_index_keys, spectrum_key
from .score import normalize_peptide

# Monoisotopic residue masses (Unimod / NIST).
RESIDUE = {
    "G": 57.021464, "A": 71.037114, "S": 87.032028, "P": 97.052764, "V": 99.068414, "T": 101.047679,
    "C": 103.009185, "L": 113.084064, "I": 113.084064, "N": 114.042927, "D": 115.026943, "Q": 128.058578,
    "K": 128.094963, "E": 129.042593, "M": 131.040485, "H": 137.058912, "F": 147.068414, "R": 156.101111,
    "Y": 163.063329, "W": 186.079313, "U": 150.953636, "O": 237.147727,
}

# Modification names and Unimod accessions seen in de novo and search-engine output.
MOD_MASS = {
    "carbamidomethyl": 57.021464, "cam": 57.021464, "unimod:4": 57.021464,
    "oxidation": 15.994915, "o": 15.994915, "ox": 15.994915, "unimod:35": 15.994915,
    "deamidated": 0.984016, "deamidation": 0.984016, "unimod:7": 0.984016,
    "acetyl": 42.010565, "unimod:1": 42.010565,
    "carbamyl": 43.005814, "unimod:5": 43.005814,
    "ammonia-loss": -17.026549, "unimod:385": -17.026549,
    "phospho": 79.966331, "unimod:21": 79.966331,
    "tmt6plex": 229.162932, "tmt": 229.162932, "tmt6": 229.162932, "unimod:737": 229.162932,
    "methylthio": 45.987721, "mth": 45.987721, "unimod:39": 45.987721,
    "gln->pyro-glu": -17.026549, "unimod:28": -17.026549,
    "glu->pyro-glu": -18.010565, "unimod:27": -18.010565,
}
_NUM = re.compile(r"[+-]?\d+(?:\.\d+)?")
# PepNovo+ writes nominal masses ('C+57', 'M+16'); map them to the monoisotopic modification mass.
NOMINAL = {57: 57.021464, 16: 15.994915, 1: 0.984016, 42: 42.010565, 43: 43.005814, -17: -17.026549,
           80: 79.966331, 229: 229.162932, 46: 45.987721, -18: -18.010565}


def _signed(txt: str) -> float:
    v = float(txt)
    if "." not in txt and int(v) in NOMINAL:
        return NOMINAL[int(v)]
    return v


def mod_mass(text: str) -> float:
    """Mass of a modification annotation: '+57.021', '-17.027+43.006', 'Oxidation', 'UNIMOD:35',
    'Oxidation of M', 'Cam'. Unknown names raise ValueError (so a parser gap is never silent)."""
    t = text.strip().split("|")[-1].strip()       # Novor '(N-term|TMT6)'
    if _NUM.fullmatch(t.replace(" ", "")) or re.fullmatch(r"(?:[+-]\d+(?:\.\d+)?)+", t.replace(" ", "")):
        return sum(float(x) for x in _NUM.findall(t))
    key = t.lower()
    key = re.sub(r"\s+of\s+.*$", "", key)          # Novor/DeNovoGUI 'Oxidation of M'
    key = re.sub(r"\s*\(.*\)$", "", key).strip()     # 'Carbamidomethyl (C)'
    if key in MOD_MASS:
        return MOD_MASS[key]
    raise ValueError(f"unknown modification '{text}'")


@dataclass
class Peptide:
    residues: list[str]
    masses: list[float]                 # per residue, modification included
    nterm: float = 0.0                  # N-terminal modification or unexplained N-terminal gap
    cterm: float = 0.0                  # unexplained C-terminal gap (PepNovo+ partial peptides)
    plain: str = field(init=False)

    def __post_init__(self):
        self.plain = "".join(self.residues)


def parse_peptide(seq: str, ngap: float = 0.0, cgap: float = 0.0) -> Peptide:
    """Parse a modified peptide string in the notations of Sage ('C[+57.0215]', '[+42.0106]-PEP'),
    Casanovo/InstaNovo ProForma ('M[Oxidation]', 'C[UNIMOD:4]', '[Acetyl]-'), Novor ('M(O)', 'C(Cam)')
    and PepNovo+ ('M+16', 'C+57'). Lower-case letters and terminal dashes are ignored."""
    s = str(seq).strip()
    res: list[str] = []
    mas: list[float] = []
    nterm = 0.0
    i = 0
    to_nterm = False                      # PepNovo+ writes an N-terminal modification as '^+229'
    while i < len(s):
        ch = s[i]
        if ch == "^":
            to_nterm = True
            i += 1
        elif ch in "[(":
            close = "]" if ch == "[" else ")"
            j = s.index(close, i)
            m = mod_mass(s[i + 1:j])
            if res:
                mas[-1] += m
            else:
                nterm += m
            i = j + 1
        elif ch in "+-" and i + 1 < len(s) and (s[i + 1].isdigit()):
            m = _NUM.match(s, i)
            if res and not to_nterm:
                mas[-1] += _signed(m.group(0))
            else:
                nterm += _signed(m.group(0))
            to_nterm = False
            i = m.end()
        elif ch.isupper() and ch in RESIDUE:
            res.append(ch)
            mas.append(RESIDUE[ch])
            i += 1
        else:
            i += 1
    return Peptide(res, mas, nterm + ngap, cgap)


def derive_tags(pep: Peptide, k: int, aa_scores: list[float] | None = None) -> list[dict]:
    """All length-k windows of a peptide with prefix/suffix residue-mass sums and a window score."""
    out = []
    n = len(pep.residues)
    if n < k:
        return out
    pre = [pep.nterm]
    for m in pep.masses:
        pre.append(pre[-1] + m)
    total = pre[-1] + pep.cterm
    use_aa = aa_scores is not None and len(aa_scores) == n
    for i in range(n - k + 1):
        out.append({
            "tag": "".join(pep.residues[i:i + k]),
            "start": i,
            "nterm_mass": round(pre[i], 5),
            "cterm_mass": round(total - pre[i + k], 5),
            "window_score": (sum(aa_scores[i:i + k]) / k) if use_aa else float("nan"),
        })
    return out


def _flanks(pep: Peptide) -> list[float]:
    pre = [pep.nterm]
    for m in pep.masses:
        pre.append(pre[-1] + m)
    return pre


def flank_correct(tag: str, nterm_mass: float, cterm_mass: float, truth: Peptide, tol: float = 0.05,
                  reverse: bool = True) -> tuple[bool, bool]:
    """(sequence, flank) correctness of one tag against a ground-truth peptide."""
    t = tag.upper().replace("I", "L")
    p = truth.plain.replace("I", "L")
    k = len(t)
    if not k or not p:
        return False, False
    lenient = t in p or t[::-1] in p
    if not lenient:
        return False, False
    pre = _flanks(truth)
    total = pre[-1] + truth.cterm
    for rev, pat in ((False, t), (True, t[::-1])) if reverse else ((False, t),):
        start = p.find(pat)
        while start >= 0:
            tp, ts = pre[start], total - pre[start + k]
            if not rev and (abs(nterm_mass - tp) <= tol or abs(cterm_mass - ts) <= tol):
                return True, True
            if rev and (abs(nterm_mass - (ts + WATER)) <= tol or abs(cterm_mass - (tp - WATER)) <= tol):
                return True, True
            start = p.find(pat, start + 1)
    return True, False


# ------------------------------------------------------------------ readers


def _scores(text) -> list[float] | None:
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return None
    vals = [v for v in re.split(r"[,\s;]+", str(text).strip("[] ")) if v]
    try:
        return [float(v) for v in vals]
    except ValueError:
        return None


def read_casanovo(path, mgf=None) -> pd.DataFrame:
    """Casanovo mzTab -> key, peptide, score, aa_scores (one row per spectrum, top prediction)."""
    header, rows = None, []
    with open(path) as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if parts[0] == "PSH":
                header = parts[1:]
            elif parts[0] == "PSM" and header:
                rows.append(dict(zip(header, parts[1:])))
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["key", "peptide", "score", "aa_scores"])
    ref = "spectra_ref"
    idx = mgf_index_keys(mgf) if mgf else {}

    def key(r):
        m = re.search(r"index=(\d+)", str(r))
        if m and idx:
            return idx.get(int(m.group(1)), f"index={m.group(1)}")
        return spectrum_key(r)

    df["key"] = df[ref].map(key)
    aa = next((c for c in df.columns if c.endswith("aa_scores")), None)
    out = pd.DataFrame({"key": df["key"], "peptide": df["sequence"],
                        "score": pd.to_numeric(df["search_engine_score[1]"], errors="coerce"),
                        "aa_scores": df[aa].map(_scores) if aa else None})
    if "opt_ms_run[1]_rank" in df.columns or "rank" in df.columns:
        pass
    return out.sort_values("score", ascending=False, kind="stable").drop_duplicates("key")


def read_instanovo(path, mgf=None) -> pd.DataFrame:
    """InstaNovo 1.2 prediction CSV -> key, peptide, score, aa_scores.

    InstaNovo names spectra '<experiment>:<0-based index>' and writes that index into 'scan_number'
    for MGF input, so with the MGF the index is mapped to the MGF's SCANS/TITLE key."""
    df = pd.read_csv(path)
    pred = next(c for c in ("predictions", "preds", "prediction") if c in df.columns)
    sc = next((c for c in ("log_probs", "log_probabilities", "score") if c in df.columns), None)
    tok = next((c for c in ("token_log_probs", "token_log_probabilities") if c in df.columns), None)
    if mgf:
        idx = mgf_index_keys(mgf)
        sid = "spectrum_id" if "spectrum_id" in df.columns else None
        if sid:
            ix = df[sid].astype(str).str.extract(r":(\d+)$")[0]
        else:
            ix = df["scan_number"].astype(str)
        keys = ix.map(lambda v: idx.get(int(v)) if isinstance(v, str) and v.isdigit() else None)
    else:
        keys = df["scan_number"].map(lambda v: f"scan={int(v)}" if pd.notna(v) else None)
    out = pd.DataFrame({"key": keys, "peptide": df[pred].fillna("").astype(str),
                        "score": pd.to_numeric(df[sc], errors="coerce") if sc else float("nan"),
                        "aa_scores": df[tok].map(_scores) if tok else None})
    return out[out["peptide"] != ""].dropna(subset=["key"]).drop_duplicates("key")


PROTON = 1.007276
WATER = 18.010565


def _pepnovo_gaps(ngap: float, cgap: float) -> tuple[float, float]:
    """PepNovo+ N-Gap is a residue-mass sum; C-Gap is a y-type ion mass (residues + water + proton);
    0 means no gap. Return residue-mass gaps. Measured on the sequence-matching top predictions:
    raw N-Gap minus the Sage prefix mass is 0.00 Da (PXD003531 mode 673 of top cases, PXD000001 103),
    raw C-Gap minus the Sage suffix mass is +19.02 Da (1,257 and 75)."""
    return ngap, (cgap - WATER - PROTON if cgap > 0 else 0.0)


def read_pepnovo(path) -> pd.DataFrame:
    """PepNovo+ de novo output (top solution per spectrum) -> key, peptide, score, ngap, cgap.

    Blocks start with '>> <file index> <spectrum index> <title>'; the first data row after the
    '#Index RnkScr PnvScr N-Gap C-Gap [M+H] Charge Sequence' header is the best solution."""
    rows, title, cols, taken = [], None, None, True
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith(">>"):
                parts = line.split(None, 3)
                title, cols, taken = (parts[3] if len(parts) > 3 else line), None, False
            elif line.startswith("#Index"):
                cols = line[1:].split("\t")
            elif cols and not taken and line.strip() and title is not None:
                vals = line.split("\t")
                rec = dict(zip(cols, vals))
                ng, cg = _pepnovo_gaps(float(rec.get("N-Gap", 0) or 0), float(rec.get("C-Gap", 0) or 0))
                rows.append({"key": spectrum_key(title), "peptide": rec.get("Sequence", ""),
                             "score": float(rec.get("PnvScr", "nan") or "nan"), "ngap": ng, "cgap": cg})
                taken = True
    return pd.DataFrame(rows, columns=["key", "peptide", "score", "ngap", "cgap"])


def read_novor_csv(path) -> pd.DataFrame:
    """Novor CSV (native novor.jar output; comment lines start with '#') -> key, peptide, score, aa_scores.

    Columns: id, scanNum, RT, mz(data), z, pepMass(denovo), err(data-denovo), ppm, score, peptide, aaScore."""
    lines = [l for l in open(path, errors="replace") if l.strip() and not l.startswith("#")]
    hdr_line = next((l for l in open(path, errors="replace") if l.startswith("# id")), None)
    cols = [c.strip() for c in hdr_line.lstrip("#").split(",")] if hdr_line else None
    rows = []
    for l in lines:
        v = [x.strip() for x in l.rstrip("\n").split(",")]
        rec = dict(zip(cols, v)) if cols else {}
        scan = rec.get("scanNum") or (v[1] if len(v) > 1 else "")
        rows.append({"key": f"scan={scan}", "peptide": rec.get("peptide", v[9] if len(v) > 9 else ""),
                     "score": float(rec.get("score", "nan") or "nan"),
                     "aa_scores": _scores(rec.get("aaScore", "").replace("-", " "))})
    return pd.DataFrame(rows, columns=["key", "peptide", "score", "aa_scores"])


# ------------------------------------------------------------------ scoring


def tags_from_predictions(pred: pd.DataFrame, k: int) -> pd.DataFrame:
    """One row per derived tag: key, tag, rank, nterm_mass, cterm_mass, window_score, pep_score."""
    rows = []
    for r in pred.itertuples(index=False):
        d = r._asdict()
        pep = parse_peptide(d["peptide"], d.get("ngap", 0.0) or 0.0, d.get("cgap", 0.0) or 0.0)
        aa = d.get("aa_scores")
        aa = aa if isinstance(aa, list) else None
        ts = derive_tags(pep, k, aa)
        for t in ts:
            t["key"] = d["key"]
            t["pep_score"] = d.get("score")
        if aa is not None and len(aa) == len(pep.residues):
            ts.sort(key=lambda t: -t["window_score"])
        for i, t in enumerate(ts):
            t["rank"] = i + 1
        rows += ts
    cols = ["key", "tag", "rank", "start", "nterm_mass", "cterm_mass", "window_score", "pep_score"]
    return pd.DataFrame(rows, columns=cols)


def mark(tags: pd.DataFrame, psms: pd.DataFrame, tol: float = 0.05) -> pd.DataFrame:
    """Add 'sequence' and 'flank' correctness columns for tags on ground-truth spectra.

    Tags without nterm_mass/cterm_mass (NaN) get flank = False; report the sequence rule for them."""
    gt = psms[["key", "peptide"]].drop_duplicates("key")
    parsed = {p: parse_peptide(p) for p in gt["peptide"].unique()}
    m = tags.merge(gt, on="key", how="inner")
    res = [flank_correct(t, nm, cm, parsed[p], tol) for t, nm, cm, p in
           zip(m["tag"], m["nterm_mass"], m["cterm_mass"], m["peptide"])]
    m["sequence"] = [a for a, _ in res]
    m["flank"] = [b for _, b in res]
    # forward-only variant (no reversed-ladder reading), reported as a diagnostic column
    m["flank_forward"] = [b and flank_correct(t, nm, cm, parsed[p], tol, reverse=False)[1] for b, t, nm, cm, p in
                          zip(m["flank"], m["tag"], m["nterm_mass"], m["cterm_mass"], m["peptide"])]
    return m


def tag_metrics(m: pd.DataFrame, n_gt: int, rule: str, ks=(1, 5, 10, 50)) -> dict:
    """Metrics of score.score_tags, computed on a frame marked by mark() with the given rule column."""
    tagged = m["key"].nunique()
    top = m[m["rank"] == 1]
    c = m[rule]
    res = {
        "rule": rule,
        "psm_spectra": n_gt,
        "psm_spectra_tagged": int(tagged),
        "tags_on_psm_spectra": int(len(m)),
        "top1_correct": int(top[rule].sum()),
        "top1_precision": _frac(top[rule].sum(), len(top)),
        "top1_recall": _frac(top[rule].sum(), n_gt),
        "top1_precision_forward_only": _frac(top["flank_forward"].sum(), len(top)) if rule == "flank" and "flank_forward" in m else float("nan"),
        "all_tags_correct": int(c.sum()),
        "all_tags_precision": _frac(c.sum(), len(m)),
        "any_tag_recall": _frac(m.groupby("key")[rule].any().sum(), n_gt),
        "any_tag_rate": _frac(m.groupby("key")[rule].any().sum(), tagged),
    }
    for k in ks:
        hit = m[m["rank"] <= k].groupby("key")[rule].any()
        res[f"top{k}_any_correct"] = int(hit.sum())
        res[f"top{k}_any_rate"] = _frac(hit.sum(), tagged)
        res[f"top{k}_any_recall"] = _frac(hit.sum(), n_gt)
    return res


def rank_curve(m: pd.DataFrame, rule: str, n_gt: int, max_k: int = 50) -> pd.DataFrame:
    """Share of tagged PSM spectra (rate) and of all PSM spectra (recall) with a correct tag in the top k."""
    tagged = m["key"].nunique()
    first = m[m[rule]].groupby("key")["rank"].min()
    return pd.DataFrame([{"k": k, "spectra": int((first <= k).sum()), "rate": _frac((first <= k).sum(), tagged),
                          "recall": _frac((first <= k).sum(), n_gt)} for k in range(1, max_k + 1)])


def peptide_metrics(pred: pd.DataFrame, psms: pd.DataFrame, tol: float = 0.05) -> dict:
    """Full-peptide agreement with Sage on PSM spectra: exact residues (I=L, mods ignored), and exact
    residues with every per-residue mass (modification included) within tol."""
    gt = psms[["key", "peptide"]].drop_duplicates("key")
    m = pred.merge(gt, on="key", suffixes=("_pred", "_gt"))
    seq_ok, mass_ok = 0, 0
    for a, b in zip(m["peptide_pred"], m["peptide_gt"]):
        if normalize_peptide(a) == normalize_peptide(b):
            seq_ok += 1
            pa, pb = parse_peptide(a), parse_peptide(b)
            fa, fb = _flanks(pa), _flanks(pb)
            if all(abs(x - y) <= tol for x, y in zip(fa, fb)):
                mass_ok += 1
    n_gt = gt["key"].nunique()
    return {"psm_spectra": n_gt, "psm_spectra_predicted": int(len(m)),
            "peptide_exact": seq_ok, "peptide_exact_precision": _frac(seq_ok, len(m)),
            "peptide_exact_recall": _frac(seq_ok, n_gt),
            "peptide_exact_mods": mass_ok, "peptide_exact_mods_recall": _frac(mass_ok, n_gt)}


def _frac(a, b) -> float:
    return round(float(a) / float(b), 6) if b else float("nan")


def read_pepnovo_tags(path) -> pd.DataFrame:
    """PepNovo+ tag mode (-tag_length k): key, tag, rank, nterm_mass, cterm_mass.

    PepNovo+ writes each tag with its N-Gap and C-Gap (ion masses before and after the tag); they are
    converted to residue-mass sums (_pepnovo_gaps), the convention of derive_tags(). Modifications
    inside a tag are not added to the flanks (they sit inside the tag)."""
    rows, title, cols = [], None, None
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith(">>"):
                parts = line.split(None, 3)
                title, cols, rank = (parts[3] if len(parts) > 3 else line), None, 0
            elif line.startswith("#Index"):
                cols = line[1:].split("\t")
            elif cols and line.strip() and title is not None and not line.startswith("#"):
                rec = dict(zip(cols, line.split("\t")))
                rank += 1
                tag = parse_peptide(rec.get("Sequence", ""))
                ng, cg = _pepnovo_gaps(float(rec.get("N-Gap", 0) or 0), float(rec.get("C-Gap", 0) or 0))
                rows.append({"key": spectrum_key(title), "tag": tag.plain, "rank": rank,
                             "nterm_mass": round(ng + tag.nterm, 5), "cterm_mass": round(cg, 5),
                             "score": float(rec.get("RnkScr", "nan"))})
    return pd.DataFrame(rows, columns=["key", "tag", "rank", "nterm_mass", "cterm_mass", "score"])


# ------------------------------------------------------------------ driver

def fastag_mgf_keys(tags: pd.DataFrame, mgf) -> pd.DataFrame:
    """Re-key FASTag tags from an MGF run: FASTag names MGF spectra 'index=<k>' (0-based record in the
    MGF, the same index Casanovo's mzTab uses), mapped here to that record's SCANS/TITLE join key so the
    tags join with Sage PSMs. Raises if a row is not 'index=<k>' or k is not a record of the MGF."""
    idx = mgf_index_keys(mgf)
    k = tags["spectrum"].astype(str).str.extract(r"^index=(\d+)$")[0]
    keys = k.map(lambda v: idx.get(int(v)) if isinstance(v, str) else None)
    if keys.isna().any():
        bad = tags.loc[keys.isna(), "spectrum"].iloc[0]
        raise ValueError(f"FASTag spectrum {bad!r} is not an index=<k> record of {mgf}")
    out = tags.copy()
    out["key"] = keys.to_numpy()
    return out


READERS = {"casanovo": read_casanovo, "instanovo": read_instanovo, "novor": read_novor_csv, "pepnovo": read_pepnovo}


def _run_info(run_dir, wall_field: str = "denovo_wall_s") -> dict:
    """Wall time, peak RSS and load from a run directory written by the scripts in config/denovo-*.yaml."""
    from pathlib import Path
    d = Path(run_dir) if run_dir else None
    info = {"wall_s": float("nan"), "tool_reported_s": float("nan"), "maxrss_mb": float("nan"),
            "load1_before": float("nan"), "load1_after": float("nan")}
    if d is None or not d.exists():
        return info
    log = d / "run.log"
    if log.exists():
        t = log.read_text(errors="replace")
        m = re.search(r"Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): (?:(\d+):)?(\d+):(\d+(?:\.\d+)?)", t)
        if m:
            info["wall_s"] = round(int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 2)
        m = re.search(r"Time Elapsed: (\d+):(\d+):(\d+(?:\.\d+)?)", t)       # Casanovo run report
        if m:
            info["tool_reported_s"] = round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 2)
        m = re.search(r"Total time = ([\d.]+) seconds", t)                         # Novor
        if m:
            info["tool_reported_s"] = float(m.group(1))
        m = re.search(r"Maximum resident set size \(kbytes\): (\d+)", t)
        if m:
            info["maxrss_mb"] = round(int(m.group(1)) / 1024, 1)
    for key, f in (("load1_before", "load_before.txt"), ("load1_after", "load_after.txt")):
        p = d / f
        if p.exists():
            m = re.search(r"load average: ([\d.]+)", p.read_text())
            if m:
                info[key] = float(m.group(1))
    p = d / "load_after.txt"
    if p.exists():
        m = re.search(wall_field + r" ([\d.]+)", p.read_text())
        if m:
            info["wall_s"] = round(float(m.group(1)), 2)
    return info


def score_manifest(manifest: dict, results_dir, log=print) -> None:
    """Score every run listed in a de novo manifest (config/denovo-data.yaml) and write
    results/denovo_tag_accuracy.tsv, denovo_peptide_accuracy.tsv, denovo_rank_curves.tsv and
    denovo_runtime.tsv, each with '# source/version/conditions' header lines."""
    import datetime as _dt
    import platform
    from pathlib import Path

    from . import parsers as P
    from . import score as S
    from .tsv import write_tsv

    res = Path(results_dir)
    ks = manifest.get("tag_lengths", [3])
    tol = float(manifest.get("flank_tol", 0.05))
    fdr = float(manifest.get("sage_fdr", 0.01))
    tag_rows, pep_rows, curve_rows, time_rows, prov = [], [], [], [], []
    now = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
    for ds in manifest["datasets"]:
        if not Path(ds["sage"]).exists():
            log(f"{ds['id']}: no Sage results ({ds['sage']}); dataset skipped")
            continue
        psms = P.read_sage_psms(ds["sage"], fdr)
        if ds.get("mgf") and Path(ds["mgf"]).exists():
            # ground truth restricted to the spectra every de novo tool saw (matters for subsamples)
            psms = psms[psms["key"].isin(set(mgf_index_keys(ds["mgf"]).values()))]
        n_gt = psms["key"].nunique()
        log(f"{ds['id']}: {n_gt} Sage target PSM spectra at spectrum q <= {fdr}")
        prov.append(f"{ds['pxd']} ({ds['id']}): ground truth {ds['sage']} ({ds.get('sage_version', 'Sage')}), "
                    f"{n_gt} target PSM spectra at spectrum q <= {fdr}; spectra: {ds.get('mgf', '')} "
                    f"({ds.get('spectra', '?')} MS2{', ' + ds['subsample'] if ds.get('subsample') else ', all MS2, no subsampling'})")
        shuffled = S.shuffled_psms(psms)
        for run in ds["runs"]:
            tool, reader = run["tool"], run["reader"]
            if not Path(run["path"]).exists():
                log(f"{ds['id']} {tool}: {run['path']} missing; skipped")
                continue
            base ={"dataset": ds["id"], "pxd": ds["pxd"], "tool": tool, "version": run.get("version", ""),
                    "source": run.get("source", "")}
            info = _run_info(run.get("run_dir"), "tags3_wall_s" if reader == "pepnovo_tags" else "denovo_wall_s")
            n_spec = run.get("spectra", ds.get("spectra"))
            time_rows.append({**base, "hardware": run.get("hardware", ""), "spectra": n_spec, **info,
                              "spectra_per_s": round(n_spec / info["wall_s"], 1) if n_spec and info["wall_s"] == info["wall_s"] else float("nan")})
            if reader in ("fastag", "directag"):
                tags = P.read_fastag_tags(run["path"]) if reader == "fastag" else P.read_directag_tags(run["path"])
                if run.get("input") == "mgf":      # FASTag run on the dataset MGF: 'index=<k>' -> MGF record key
                    tags = fastag_mgf_keys(tags, ds["mgf"])
                for rule in ("flank", "sequence"):
                    tag_rows.append({**base, "tag_length": run.get("tag_length", ""), "tags_from": "native",
                                     "control": "none", **S.score_tags(tags, psms, rule=rule), "rule": rule})
                    tag_rows.append({**base, "tag_length": run.get("tag_length", ""), "tags_from": "native",
                                     "control": "shuffled peptides", **S.score_tags(tags, shuffled, rule=rule), "rule": rule})
                    rc = S.rank_curve(tags, psms, 50, rule=rule)
                    curve_rows += [{**base, "tag_length": run.get("tag_length", ""), "tags_from": "native", "rule": rule, **r}
                                   for r in rc.to_dict("records")]
                log(f"{ds['id']} {tool}: scored native tags")
                continue
            if reader == "pepnovo_tags":
                tags = read_pepnovo_tags(run["path"])
                variants = [(run.get("tag_length", 3), "native", tags)]
            else:
                pred = READERS[reader](run["path"], ds.get("mgf")) if reader in ("casanovo", "instanovo") else READERS[reader](run["path"])
                pred = pred[pred["peptide"].astype(str).str.len() > 0]
                pm = peptide_metrics(pred, psms, tol)
                pep_rows.append({**base, "predicted_spectra": int(pred["key"].nunique()), **pm})
                log(f"{ds['id']} {tool}: {len(pred)} predictions; exact peptide on PSM spectra "
                    f"{pm['peptide_exact']}/{pm['psm_spectra']} ({pm['peptide_exact_recall']:.4f})")
                variants = [(k, "derived from top peptide", tags_from_predictions(pred, k)) for k in ks]
            for k, src, tags in variants:
                m = mark(tags, psms, tol)
                ms = mark(tags, shuffled, tol)
                for rule in ("flank", "sequence"):
                    tag_rows.append({**base, "tag_length": k, "tags_from": src, "control": "none", **tag_metrics(m, n_gt, rule)})
                    tag_rows.append({**base, "tag_length": k, "tags_from": src, "control": "shuffled peptides",
                                     **tag_metrics(ms, n_gt, rule)})
                    curve_rows += [{**base, "tag_length": k, "tags_from": src, "rule": rule, **r}
                                   for r in rank_curve(m, rule, n_gt, 50).to_dict("records")]
                top = m[m["rank"] == 1]
                log(f"{ds['id']} {tool} k={k} ({src}): top-1 flank {top['flank'].mean():.4f}, sequence {top['sequence'].mean():.4f}")
    # optional manifest keys (defaults reproduce the 1.8.0 tables): 'suffix' is appended to every output
    # file name (e.g. "_v190"), 'source' replaces the first provenance line's command/run-location text
    sfx = manifest.get("suffix", "")
    src_txt = manifest.get("source", "python -m fastag_bench.denovo config/denovo-data.yaml); runs under "
                                     "/ceph/ibmi/abi/oliver/jpr-bench/denovo/runs")
    head = [f"source: fastag-bench denovo score ({src_txt}; host {platform.node()}; {now}",
            "rules: 'sequence' = tag or reverse is a substring of the Sage PSM peptide (I=L, mods stripped); 'flank' = "
            f"sequence AND one flanking residue-mass sum agrees within {tol} Da at that position. Native FASTag/DirecTag tags: "
            "score.tag_correct_flank (y-ion convention); derived and PepNovo+ tags: denovo.flank_correct (prefix/suffix residue sums)",
            "derived tags: every length-k window of the top predicted peptide; rank by mean per-residue score "
            "(Casanovo, InstaNovo, Novor aaScore), PepNovo+ windows in N-to-C order",
            *manifest.get("notes", []), *prov]
    write_tsv(pd.DataFrame(tag_rows), res / f"denovo_tag_accuracy{sfx}.tsv", head)
    write_tsv(pd.DataFrame(pep_rows), res / f"denovo_peptide_accuracy{sfx}.tsv",
              head[:1] + ["peptide_exact: residues equal (I=L, mods ignored); peptide_exact_mods: additionally every "
                          f"prefix mass (mods included) within {tol} Da; recall = / Sage PSM spectra"] + manifest.get("notes", []) + prov)
    write_tsv(pd.DataFrame(curve_rows), res / f"denovo_rank_curves{sfx}.tsv", head)
    write_tsv(pd.DataFrame(time_rows), res / f"denovo_runtime{sfx}.tsv",
              head[:1] + ["wall_s and maxrss_mb from /usr/bin/time -v of the whole command (model load included); "
                          "PepNovo+: wall of 32 parallel single-threaded chunks; load1 = 1-min load average of the node "
                          "before/after. GPU runs are not CPU benchmarks; the node was shared."] + manifest.get("notes", []) + prov)


def main(argv=None) -> int:
    import argparse

    import yaml
    ap = argparse.ArgumentParser(description="Score de novo reference runs against Sage (tags derived from peptides).")
    ap.add_argument("manifest", help="YAML manifest, e.g. config/denovo-data.yaml")
    ap.add_argument("--results", default="results")
    a = ap.parse_args(argv)
    with open(a.manifest) as fh:
        score_manifest(yaml.safe_load(fh), a.results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
