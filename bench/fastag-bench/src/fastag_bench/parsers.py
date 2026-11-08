"""Readers for FASTag, Sage, DirecTag, Casanovo and SDRF files."""
from __future__ import annotations

import csv
import re
from pathlib import Path

import pandas as pd

SCAN_RE = re.compile(r"scan=(\d+)")


def spectrum_key(native_id: str) -> str:
    """Join key for spectra across tools: 'scan=<n>' when the ID carries a scan number, else the ID."""
    m = SCAN_RE.search(str(native_id))
    return f"scan={m.group(1)}" if m else str(native_id)


def _add_rank(df: pd.DataFrame) -> pd.DataFrame:
    """Rank = order of a spectrum's rows in the file (both FASTag and DirecTag write best first)."""
    df = df.copy()
    df["rank"] = df.groupby("spectrum", sort=False).cumcount() + 1
    df["key"] = df["spectrum"].map(spectrum_key)
    return df


def read_fastag_tags(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", dtype={"spectrum": str, "tag": str}, keep_default_na=False)
    need = {"spectrum", "tag"}
    if not need <= set(df.columns):
        raise ValueError(f"{path}: not a FASTag tag TSV (columns {list(df.columns)[:6]}...)")
    return _add_rank(df)


def read_directag_tags(path: str | Path) -> pd.DataFrame:
    """DirecTag '.tags' output: S lines (spectrum) followed by its T lines (tags)."""
    rows, spec = [], None
    t_cols = None
    with open(path) as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if parts[0] == "H(T)":
                t_cols = parts[1:]
            elif parts[0] == "S":
                spec = parts[1]
            elif parts[0] == "T" and spec is not None:
                rec = {"spectrum": spec, "tag": parts[1]}
                if t_cols:
                    rec.update({c: v for c, v in zip(t_cols[1:], parts[2:])})
                rows.append(rec)
    df = pd.DataFrame(rows, columns=["spectrum", "tag"] + (t_cols[1:] if t_cols else []))
    # common names used by the scorer (same flank convention as FASTag, see score.py)
    if "nTerminusMass" in df.columns:
        df["nterm_mass"] = pd.to_numeric(df["nTerminusMass"], errors="coerce")
        df["cterm_mass"] = pd.to_numeric(df["cTerminusMass"], errors="coerce")
    df["length"] = df["tag"].str.len()
    return _add_rank(df)


def read_sage_psms(path: str | Path, fdr: float = 0.01, rank: int | None = None,
                   truth_fields: bool = False) -> pd.DataFrame:
    """Target, rank-1 PSMs at spectrum-level q <= fdr from results.sage.tsv.

    rank=None (default) is the v1.9.0 reader, unchanged: rank 1 where the file has a rank column, and
    columns filename, scannr, peptide, spectrum_q, key. rank=k (Sage with report_psms > 1) keeps the
    target hits of rank k at q <= fdr instead and adds a 'rank' column; it needs the rank column.
    truth_fields=True (#6) also keeps Sage's 'charge' and 'isotope_error' (as int), which label the
    precursor charge and isotope offset of each spectrum (sage_config mode 'charge_truth'); it needs
    both columns."""
    df = pd.read_csv(path, sep="\t")
    if truth_fields:
        missing = [c for c in ("charge", "isotope_error") if c not in df.columns]
        if missing:
            raise ValueError(f"{path}: truth_fields needs Sage's {', '.join(missing)} column(s)")
    keep = (df["label"] == 1) & (df["spectrum_q"] <= fdr)
    if rank is None:
        if "rank" in df.columns:
            keep &= df["rank"] == 1
        out = df.loc[keep, ["filename", "scannr", "peptide", "spectrum_q"]].copy()
    else:
        if "rank" not in df.columns:
            raise ValueError(f"{path}: rank={rank} needs Sage's rank column")
        keep &= df["rank"] == int(rank)
        out = df.loc[keep, ["filename", "scannr", "peptide", "spectrum_q", "rank"]].copy()
    if truth_fields:
        out["charge"] = df.loc[keep, "charge"].astype(int)
        out["isotope_error"] = df.loc[keep, "isotope_error"].round().astype(int)
    out["key"] = out["scannr"].map(spectrum_key)
    return out.drop_duplicates(["filename", "key"])


def read_comet_psms(path: str | Path, fdr: float = 0.01, decoy_prefix: str = "DECOY_",
                    static_mods: dict[str, float] | None = None) -> pd.DataFrame:
    """Comet text output (output_txtfile = 1, concatenated decoys, decoy_search = 1): rank-1 hit
    per scan, target-decoy q-value on the E-value (q = decoys/targets at or above the score,
    made monotone), targets at q <= fdr. The peptide is rewritten in Sage's mass-delta notation,
    static modifications included, so the flank rule scores both engines alike.

    Comet writes variable modifications in 'modifications' as '<pos>_<V|S|N|C>_<delta>[_...]'
    (pos 1-based; N/C terminal markers use position 0 / length+1 or the 'n'/'c' residue letter)."""
    with open(path) as fh:
        first = fh.readline()
        skip = 1 if first.startswith("CometVersion") else 0
    df = pd.read_csv(path, sep="\t", skiprows=skip, dtype={"protein": str})
    df = df[df["num"] == 1] if "num" in df.columns else df
    df = df.sort_values("e-value", kind="stable").drop_duplicates("scan")
    decoy = df["protein"].astype(str).str.split(",").map(lambda ps: all(x.startswith(decoy_prefix) for x in ps))
    df = df.assign(decoy=decoy.to_numpy())
    nd = df["decoy"].cumsum().to_numpy()
    nt = (~df["decoy"]).cumsum().to_numpy()
    q = [d / t if t else 1.0 for d, t in zip(nd, nt)]
    run = 1.0
    for i in range(len(q) - 1, -1, -1):
        run = min(run, q[i])
        q[i] = run
    df["q"] = q
    out = df[(~df["decoy"]) & (df["q"] <= fdr)].copy()
    static = static_mods or {}

    def rewrite(plain: str, mods: str) -> str:
        n_mod, c_mod = 0.0, 0.0
        per = [0.0] * len(plain)
        for aa_i, aa in enumerate(plain):
            per[aa_i] += static.get(aa, 0.0)
        n_mod += static.get("^", 0.0)
        for item in ([] if pd.isna(mods) or str(mods) in ("", "-") else str(mods).split(",")):
            f = item.strip().split("_")
            if len(f) < 3:
                continue
            pos, kind, delta = f[0], f[1], float(f[2])
            pos = int(pos)
            if kind == "N" or pos == 0:
                n_mod += delta
            elif kind == "C" or pos > len(plain):
                c_mod += delta
            elif kind != "S":  # static mods are already folded in above
                per[pos - 1] += delta
        body = "".join(aa + (f"[{d:+.6f}]" if abs(d) > 1e-9 else "") for aa, d in zip(plain, per))
        return (f"[{n_mod:+.6f}]-" if abs(n_mod) > 1e-9 else "") + body + (f"-[{c_mod:+.6f}]" if abs(c_mod) > 1e-9 else "")

    mods_col = out["modifications"] if "modifications" in out.columns else pd.Series([None] * len(out), index=out.index)
    out["peptide"] = [rewrite(p, m) for p, m in zip(out["plain_peptide"], mods_col)]
    out["key"] = out["scan"].map(lambda s: f"scan={int(s)}")
    out["spectrum_q"] = out["q"]
    return out[["key", "peptide", "spectrum_q", "e-value", "xcorr"]].reset_index(drop=True)


def read_mascot_dat(path: str | Path, fdr: float = 0.01, static_mods: dict[str, float] | None = None) -> pd.DataFrame:
    """Deposited Mascot search (.dat with a decoy search): q<N>_p1 target hits competed against the
    decoy_peptides top hits, monotone target-decoy q on the ion score (as FASTag's
    tools/pxd000001_truth.py: PXD000001 gives score >= 16.85, 2,254 PSMs). Scan numbers come from
    the query titles. Peptides carry the static modifications (key '^' = peptide N-term) in Sage
    notation; Mascot's variable modifications are not decoded."""
    import urllib.parse
    targets, decoys, scans = {}, {}, {}
    section = None
    hit_re = re.compile(r"^q(\d+)_p1=(.*)$")
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("Content-Type:"):
                m = re.search(r'name="([^"]+)"', line)
                section = m.group(1) if m else None
                continue
            if section in ("peptides", "decoy_peptides"):
                m = hit_re.match(line)
                if not m or m.group(2).strip() == "-1":
                    continue
                f = m.group(2).split(";")[0].split(",")
                if len(f) < 8:
                    continue
                (targets if section == "peptides" else decoys)[int(m.group(1))] = (f[4], float(f[7]))
            elif section and section.startswith("query") and line.startswith("title="):
                sm = re.search(r"scan[\s=]+(\d+)", urllib.parse.unquote(line[6:]), re.IGNORECASE)
                if sm:
                    scans[int(section[5:])] = int(sm.group(1))
    ts = sorted((sc for _, sc in targets.values()), reverse=True)
    ds = sorted(sc for _, sc in decoys.values())
    import bisect
    qs = [(len(ds) - bisect.bisect_left(ds, sc)) / (i + 1) for i, sc in enumerate(ts)]
    run, thr = 1.0, None
    for i in range(len(qs) - 1, -1, -1):
        run = min(run, qs[i])
        qs[i] = run
    for sc, q in zip(ts, qs):
        if q <= fdr:
            thr = sc
    static = static_mods or {}

    def sage_notation(pep: str) -> str:
        body = "".join(a + (f"[{static[a]:+.6f}]" if a in static else "") for a in pep)
        return (f"[{static['^']:+.6f}]-" if "^" in static else "") + body

    rows = [{"key": f"scan={scans[q]}", "peptide": sage_notation(pep), "score": sc}
            for q, (pep, sc) in sorted(targets.items()) if thr is not None and sc >= thr and q in scans]
    return pd.DataFrame(rows, columns=["key", "peptide", "score"]).drop_duplicates("key")


MGF_INDEX_RE = re.compile(r"index=(\d+)")


def mgf_index_keys(path: str | Path) -> dict[int, str]:
    """0-based spectrum index in an MGF -> join key (SCANS= or TITLE=), for Casanovo runs on MGF,
    whose mzTab names spectra 'ms_run[1]:index=<i>' rather than by native ID."""
    out, i, scans, title = {}, -1, None, None
    with open(path) as fh:
        for line in fh:
            s = line.strip()
            if s == "BEGIN IONS":
                i, scans, title = i + 1, None, None
            elif s.upper().startswith("SCANS="):
                scans = s.split("=", 1)[1]
            elif s.upper().startswith("TITLE="):
                title = s.split("=", 1)[1]
            elif s == "END IONS":
                out[i] = f"scan={scans}" if scans else spectrum_key(title or f"index={i}")
    return out


def read_casanovo_mztab(path: str | Path, mgf: str | Path | None = None) -> pd.DataFrame:
    """Casanovo mzTab PSMs. With the MGF Casanovo read, 'index=<i>' references are mapped to that
    spectrum's scan number so they join with Sage PSMs."""
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
        return pd.DataFrame(columns=["key", "peptide", "score"])
    scan_col = next((c for c in df.columns if c.endswith("scan_number")), "spectra_ref")
    df["key"] = df[scan_col].map(spectrum_key)
    if mgf is not None:
        idx = mgf_index_keys(mgf)

        def _from_index(ref: str, key: str) -> str:
            m = MGF_INDEX_RE.search(str(ref))
            return idx.get(int(m.group(1)), key) if m else key

        df["key"] = [_from_index(r, k) for r, k in zip(df[scan_col], df["key"])]
    df = df.rename(columns={"sequence": "peptide", "search_engine_score[1]": "score"})
    return df[["key", "peptide", "score"]]


def read_long_report(path: str | Path) -> dict[tuple[str, str], str]:
    """FASTag -digest_out / -label_out / -massgap_out: (section, key) -> value."""
    out = {}
    with open(path) as fh:
        rd = csv.DictReader(fh, delimiter="\t")
        for r in rd:
            out[(r["section"], r["key"])] = r["value"]
    return out


def read_species(path: str | Path) -> pd.DataFrame:
    return pd.read_csv(path, sep="\t")


def sdrf_run(path: str | Path, run_stem: str) -> dict[str, list[str]]:
    """Collect the SDRF columns of the row whose data file matches run_stem.

    Returns {'organism': [...], 'cleavage': [...], 'label': [...], 'mods': [...], 'instrument': [...]}.
    Values are the NT= names when the cell is key=value encoded.
    """
    with open(path, newline="") as fh:
        rows = list(csv.reader(fh, delimiter="\t"))
    head = [h.strip().lower() for h in rows[0]]
    files = [i for i, h in enumerate(head) if h == "comment[data file]"]
    hit = None
    for r in rows[1:]:
        if any(i < len(r) and Path(r[i]).stem == run_stem for i in files):
            hit = r
            break
    if hit is None:
        raise KeyError(f"{run_stem} not found in {path}")

    def nt(cell: str) -> str:
        m = re.search(r"NT=([^;]+)", cell)
        return (m.group(1) if m else cell).strip()

    def col(name: str) -> list[str]:
        vals = [hit[i] for i, h in enumerate(head) if h == name and i < len(hit)]
        return [nt(v) for v in vals if v and v.lower() not in ("not available", "not applicable", "")]

    return {
        "organism": col("characteristics[organism]"),
        "cleavage": col("comment[cleavage agent details]"),
        "label": col("comment[label]"),
        "mods": col("comment[modification parameters]"),
        "instrument": col("comment[instrument]"),
    }
