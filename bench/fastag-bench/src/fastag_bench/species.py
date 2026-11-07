"""Species benchmark: FASTag -species vs Unipept pept2lca on Sage 1% FDR peptides.

Inputs are listed in config/species_runs.tsv (one public run per row, with the known genera).
For every run the driver writes, under <work>/<run_id>/:

  fastag_<arm>/species.tsv, run.log, time.json   FASTag 1.8.0 -species, arms 'default', 'deconv'
                                                 (-species_deconvolve) and 'gapped' (-species_use_gapped)
  sage/results.sage.tsv, sage.json, time.json    Sage search against the FASTag reference proteomes
  unipept/peptides.txt, pept2lca.csv, time.json  Unipept pept2lca (-e, -a) on the Sage 1% FDR peptides

Scoring is done at NCBI genus level over the 50 genera of the bundled index ('universe'). Decision
rules (fixed before the runs were scored):

  fastag_q      FASTag's own background test: q-value <= 0.01 (binomial test, Benjamini-Hochberg)
  fastag_dec    -species_deconvolve share: adjusted / sum(adjusted over genera) >= 0.01
  unipept       share of genus-resolved peptides >= 0.01 and at least 3 peptides

Negatives exclude the reagent/contaminant genera of the index (Bos, Sus, Oryctolagus, Ovis, Equus)
and Homo in non-human samples (keratin), because these are present in most runs whatever the
sample. Truth genera that are not in the index cannot be called by FASTag; they are reported as
'out_of_index' and kept out of sensitivity.
"""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from .timing import run_timed

CONTAMINANT_GENERA = {"Bos", "Sus", "Oryctolagus", "Ovis", "Equus"}
ARMS = {
    "default": [],
    "deconv": ["-species_deconvolve"],
    "gapped": ["-species_use_gapped"],
}
LABEL_MODS = {
    # FASTag fixed modifications and Sage static/variable mods per label class
    "LF": (None, {"C": 57.021464}, {"M": [15.994915]}),
    "LF_phospho": (None, {"C": 57.021464}, {"M": [15.994915]}),
    "SILAC": (None, {"C": 57.021464}, {"M": [15.994915], "K": [6.020129]}),
    "TMT6": (["Carbamidomethyl (C)", "TMT6plex (K)", "TMT6plex (N-term)"],
             {"C": 57.021464, "K": 229.162932, "^": 229.162932}, {"M": [15.994915]}),
    "TMT6_MMTS": (["Methylthio (C)", "TMT6plex (K)", "TMT6plex (N-term)"],
                  {"C": 45.987721, "K": 229.162932, "^": 229.162932}, {"M": [15.994915]}),
    "TMTpro": (["Carbamidomethyl (C)", "TMTpro (K)", "TMTpro (N-term)"],
               {"C": 57.021464, "K": 304.207146, "^": 304.207146}, {"M": [15.994915]}),
}
RULE_SHARE = 0.01
RULE_Q = 0.01
RULE_MIN_PEPTIDES = 3


# ---------------------------------------------------------------- manifest

def parse_truth(s: str) -> dict[str, float | None]:
    """'Homo=0.65;Escherichia=0.05' -> {'Homo': 0.65, 'Escherichia': 0.05}; no '=' -> None."""
    out: dict[str, float | None] = {}
    for part in str(s).split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            g, v = part.split("=", 1)
            out[g.strip()] = float(v)
        else:
            out[part] = None
    return out


def load_manifest(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", comment="#", dtype={"level": "float64"}, keep_default_na=False,
                     na_values=[""])
    need = {"run_id", "pxd", "set", "mzml", "truth", "label"}
    missing = need - set(df.columns)
    if missing:
        raise ValueError(f"{path}: missing columns {sorted(missing)}")
    if df["run_id"].duplicated().any():
        raise ValueError(f"{path}: duplicate run_id")
    bad = sorted(set(df["label"]) - set(LABEL_MODS))
    if bad:
        raise ValueError(f"{path}: unknown label classes {bad}")
    return df


# ---------------------------------------------------------------- spectra

_FILTER = re.compile(r'<cvParam[^>]*(?:MS:1000512|name="filter string")[^>]*>')
_VALUE = re.compile(r'value="([^"]*)"')


def ms2_analyzer(mzml: str | Path, max_bytes: int = 64 << 20) -> str:
    """'ITMS' when the first MS2 filter strings are ion-trap scans, else 'FTMS' (default)."""
    seen = {"ITMS": 0, "FTMS": 0}
    with open(mzml, "rb") as fh:
        buf = fh.read(max_bytes).decode("utf-8", "replace")
    for m in _FILTER.finditer(buf):
        v = _VALUE.search(m.group(0))
        f = v.group(1) if v else ""
        if " ms2 " in f:
            seen["ITMS" if f.startswith("ITMS") else "FTMS"] += 1
            if sum(seen.values()) >= 200:
                break
    return "ITMS" if seen["ITMS"] > seen["FTMS"] else "FTMS"


# ---------------------------------------------------------------- commands

def fastag_cmd(fastag: str, mzml: str | Path, out_dir: Path, arm: str, label: str, analyzer: str,
               threads: int) -> list[str]:
    fixed = LABEL_MODS[label][0]
    cmd = [fastag, "-in", str(mzml), "-out", str(out_dir / "tags.tsv"), "-extension", "2", "-species",
           "-species_out", str(out_dir / "species.tsv"), "-threads", str(threads), *ARMS[arm]]
    if fixed:
        cmd += ["-fixed_modifications", *fixed]
    if analyzer == "ITMS":
        cmd += ["-fragment_tolerance", "0.3", "-fragment_tolerance_unit", "Da"]  # FASTag's own advice for IT MS2
    return cmd


def sage_species_config(fasta: str | Path, mzml: str | Path, label: str, analyzer: str) -> dict:
    _, static, variable = LABEL_MODS[label]
    frag = {"da": [-0.5, 0.5]} if analyzer == "ITMS" else {"ppm": [-20.0, 20.0]}
    return {
        "database": {
            "bucket_size": 32768,
            "enzyme": {"missed_cleavages": 2, "min_len": 7, "max_len": 50, "cleave_at": "KR", "restrict": "P"},
            "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
            "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0,
            "ion_kinds": ["b", "y"], "min_ion_index": 2,
            "static_mods": static, "variable_mods": variable, "max_variable_mods": 2,
            "decoy_tag": "rev_", "generate_decoys": True, "fasta": str(fasta),
        },
        "precursor_tol": {"ppm": [-10.0, 10.0]},
        "fragment_tol": frag,
        "isotope_errors": [0, 1], "deisotope": analyzer != "ITMS", "chimera": False, "wide_window": False,
        "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1,
        "mzml_paths": [str(mzml)],
    }


# ---------------------------------------------------------------- parsers

def read_fastag_species(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t")
    df = df[df["rank"] == "genus"].copy() if "rank" in df else df
    df["fastag_rank"] = range(1, len(df) + 1)  # file order = rank (by adjusted)
    return df


def sage_peptides(results: str | Path, q: float = 0.01) -> list[str]:
    """Unique unmodified target peptides at spectrum q <= q and peptide q <= q."""
    df = pd.read_csv(results, sep="\t", usecols=["peptide", "label", "spectrum_q", "peptide_q"])
    df = df[(df["label"] == 1) & (df["spectrum_q"] <= q) & (df["peptide_q"] <= q)]
    peps = {re.sub(r"\[[^\]]*\]|[^A-Z]", "", p) for p in df["peptide"]}
    return sorted(p for p in peps if len(p) >= 5)


def read_pept2lca(path: str | Path) -> pd.DataFrame:
    """Unipept pept2lca CSV (with -a) -> peptide, taxon_rank, genus_name ('' when above genus)."""
    if Path(path).stat().st_size == 0:  # no peptide matched (or none were sent)
        return pd.DataFrame(columns=["peptide", "taxon_rank", "genus_name"])
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    if df.empty:
        return pd.DataFrame(columns=["peptide", "taxon_rank", "genus_name"])
    pep_col = "peptide" if "peptide" in df else df.columns[0]
    if "genus_name" not in df:
        df["genus_name"] = ""
    if "taxon_rank" in df:  # an LCA at genus rank carries its own name
        at_genus = (df["taxon_rank"] == "genus") & (df["genus_name"] == "")
        df.loc[at_genus, "genus_name"] = df.loc[at_genus, "taxon_name"]
    else:
        df["taxon_rank"] = ""
    return df.rename(columns={pep_col: "peptide"})[["peptide", "taxon_rank", "genus_name"]]


def unipept_genus_counts(lca: pd.DataFrame) -> pd.DataFrame:
    g = lca[lca["genus_name"] != ""]
    c = g.groupby("genus_name").size().rename("unipept_peptides").reset_index()
    c = c.rename(columns={"genus_name": "genus"})
    total = int(c["unipept_peptides"].sum())
    c["unipept_share"] = c["unipept_peptides"] / total if total else 0.0
    c = c.sort_values(["unipept_peptides", "genus"], ascending=[False, True]).reset_index(drop=True)
    c["unipept_rank"] = range(1, len(c) + 1)
    return c


# ---------------------------------------------------------------- scoring

def genus_table(universe: list[str], truth: dict[str, float | None], fastag: dict[str, pd.DataFrame],
                unipept: pd.DataFrame | None) -> pd.DataFrame:
    """One row per genus of the universe (plus Unipept genera outside it), with evidence and calls."""
    genera = list(universe)
    if unipept is not None:
        genera += [g for g in unipept["genus"] if g not in genera]
    rows = []
    human = "Homo" in truth
    for g in genera:
        r = {"genus": g, "in_index": g in universe, "truth": g in truth,
             "truth_fraction": truth.get(g) if g in truth else None}
        if g in truth:
            r["status"] = "positive" if g in universe else "out_of_index"
        elif g in CONTAMINANT_GENERA or (g == "Homo" and not human):
            r["status"] = "excluded"
        else:
            r["status"] = "negative"
        for arm, df in fastag.items():
            hit = df[df["name"] == g]
            if arm == "default":
                r["observed"] = int(hit["observed"].iloc[0]) if len(hit) else 0
                r["qvalue"] = float(hit["qvalue"].iloc[0]) if len(hit) else 1.0
                r["rank_default"] = int(hit["fastag_rank"].iloc[0]) if len(hit) else None
            elif arm == "deconv":
                tot = float(df["adjusted"].clip(lower=0).sum())
                adj = float(hit["adjusted"].iloc[0]) if len(hit) else 0.0
                r["adjusted"] = adj
                r["dec_share"] = adj / tot if tot else 0.0
                r["rank_deconv"] = int(hit["fastag_rank"].iloc[0]) if len(hit) else None
            elif arm == "gapped":
                r["rank_gapped"] = int(hit["fastag_rank"].iloc[0]) if len(hit) else None
        if unipept is not None:
            hit = unipept[unipept["genus"] == g]
            r["unipept_peptides"] = int(hit["unipept_peptides"].iloc[0]) if len(hit) else 0
            r["unipept_share"] = float(hit["unipept_share"].iloc[0]) if len(hit) else 0.0
            r["unipept_rank"] = int(hit["unipept_rank"].iloc[0]) if len(hit) else None
        rows.append(r)
    t = pd.DataFrame(rows)
    if "qvalue" in t:
        t["call_fastag_q"] = t["in_index"] & (t["qvalue"] <= RULE_Q)
    if "dec_share" in t:
        t["call_fastag_dec"] = t["in_index"] & (t["dec_share"] >= RULE_SHARE)
    if "unipept_share" in t and unipept is not None:
        t["call_unipept"] = (t["unipept_share"] >= RULE_SHARE) & (t["unipept_peptides"] >= RULE_MIN_PEPTIDES)
    return t


def confusion(t: pd.DataFrame, call: str) -> dict:
    """TP/FN over 'positive' rows, FP/TN over 'negative' rows (in the index universe only)."""
    t = t[t[call].notna()] if call in t else t.iloc[0:0]
    u = t[t["in_index"].astype(bool)]
    pos, neg = u[u["status"] == "positive"], u[u["status"] == "negative"]
    pc, nc = pos[call].astype(bool), neg[call].astype(bool)
    tp, fn = int(pc.sum()), int((~pc).sum())
    fp, tn = int(nc.sum()), int((~nc).sum())
    extra = int(t[(~t["in_index"].astype(bool)) & (t["status"] == "negative")][call].astype(bool).sum())
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "fp_outside_index": extra}


def rates(c: dict) -> dict:
    sens = c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else float("nan")
    spec = c["tn"] / (c["tn"] + c["fp"]) if c["tn"] + c["fp"] else float("nan")
    return {"sensitivity": round(sens, 4), "specificity": round(spec, 4)}


def cohen_kappa(a: list[bool], b: list[bool]) -> float:
    n = len(a)
    if n == 0:
        return float("nan")
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return round((po - pe) / (1 - pe), 4) if pe < 1 else float("nan")


def sweep(tables: pd.DataFrame, score: str, thresholds: list[float]) -> pd.DataFrame:
    """Sensitivity/specificity of 'score >= threshold' over all runs (index universe)."""
    u = tables[tables["in_index"].astype(bool) & tables["status"].isin(["positive", "negative"])]
    if score not in u:
        return pd.DataFrame()
    u = u[u[score].notna()]
    rows = []
    for th in thresholds:
        call = u[score] >= th
        pos = u["status"] == "positive"
        tp, fn = int((call & pos).sum()), int((~call & pos).sum())
        fp, tn = int((call & ~pos).sum()), int((~call & ~pos).sum())
        rows.append({"score": score, "threshold": th, "tp": tp, "fn": fn, "fp": fp, "tn": tn,
                     **rates({"tp": tp, "fn": fn, "fp": fp, "tn": tn})})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- driver (runs on the cluster node)

def _timed_json(cmd, d: Path, env=None, cwd=None) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "command.txt").write_text(" ".join(f"'{c}'" if " " in str(c) else str(c) for c in cmd) + "\n")
    t = run_timed(cmd, log=d / "run.log", env=env, cwd=cwd)
    (d / "time.json").write_text(json.dumps(t) + "\n")
    return t


def run_one(row: dict, work: Path, tools: dict, threads: int, arms: list[str], steps: set[str],
            scratch: Path | None, log=print) -> None:
    rd = work / row["run_id"]
    rd.mkdir(parents=True, exist_ok=True)
    src = Path(row["mzml"])
    import time as _time
    if not src.exists() or _time.time() - src.stat().st_mtime < 300:
        log(f"{row['run_id']}: input missing or still being written, skipped ({src})")
        return
    mzml = src
    if scratch is not None:
        mzml = scratch / src.name
        if not mzml.exists() or mzml.stat().st_size != src.stat().st_size:
            shutil.copyfile(src, mzml)
    meta = rd / "meta.json"
    m = json.loads(meta.read_text()) if meta.exists() else {}
    if "analyzer" not in m:
        m.update({"analyzer": ms2_analyzer(mzml), "mzml": str(src), "size": src.stat().st_size})
        meta.write_text(json.dumps(m) + "\n")
    an = m["analyzer"]
    if "fastag" in steps:
        for arm in arms:
            d = rd / f"fastag_{arm}"
            if (d / "species.tsv").exists():
                continue
            t = _timed_json(fastag_cmd(tools["fastag"], mzml, d, arm, row["label"], an, threads), d)
            (d / "tags.tsv").unlink(missing_ok=True)  # tags are not needed for the species benchmark
            log(f"{row['run_id']} fastag {arm}: {t['wall_s']} s, {t['maxrss_kb'] // 1024} MB, "
                f"load {t['load1_before']}->{t['load1_after']}, rc {t['returncode']}")
    if "sage" in steps:
        d = rd / "sage"
        if not (d / "results.sage.tsv").exists():
            d.mkdir(parents=True, exist_ok=True)
            cfg = sage_species_config(tools["sage_fasta"], mzml, row["label"], an)
            (d / "sage.json").write_text(json.dumps(cfg, indent=2) + "\n")
            t = _timed_json([tools["sage"], "-o", str(d), str(d / "sage.json")], d,
                            env={"RAYON_NUM_THREADS": str(threads), "RUST_MIN_STACK": str(256 << 20)})
            log(f"{row['run_id']} sage: {t['wall_s']} s, {t['maxrss_kb'] // 1024} MB, rc {t['returncode']}")
    if "unipept" in steps and (rd / "sage" / "results.sage.tsv").exists():
        d = rd / "unipept"
        if not (d / "pept2lca.csv").exists() or not (d / "pept2lca.csv").stat().st_size:
            d.mkdir(parents=True, exist_ok=True)
            peps = sage_peptides(rd / "sage" / "results.sage.tsv")
            (d / "peptides.txt").write_text("\n".join(peps) + "\n")
            t = _timed_json([tools["unipept"], "pept2lca", "-e", "-a", "-i", str(d / "peptides.txt"),
                             "-o", str(d / "pept2lca.csv")], d,
                            env={"PATH": f"{Path(tools['unipept']).parent}:{os.environ.get('PATH', '')}"})
            log(f"{row['run_id']} unipept: {len(peps)} peptides, {t['wall_s']} s, rc {t['returncode']}")
    if scratch is not None and steps >= {"fastag", "sage"}:
        mzml.unlink(missing_ok=True)


def time_default(manifest: pd.DataFrame, work: Path, fastag: str, threads: int, reps: int, scratch: Path,
                 max_load_per_core: float = 0.25, log=print) -> Path:
    """Sequential, load-gated wall time of the default -species arm (tags + species) per run.

    Each run is copied to scratch, read once to warm the page cache, then timed 'reps' times. A
    repetition counts only when the 1-minute load average per logical CPU is below the gate before
    and after it; both values are recorded either way.
    """
    ncpu = os.cpu_count() or 1
    out = work / "timing_default.tsv"
    first = not out.exists()
    scratch.mkdir(parents=True, exist_ok=True)
    with open(out, "a") as fh:
        if first:
            fh.write("run_id\trep\tthreads\tncpu\twall_s\tcpu_s\tmaxrss_kb\tload1_before\tload1_after\tgate_ok\treturncode\n")
        for row in manifest.to_dict("records"):
            meta = work / row["run_id"] / "meta.json"
            if not meta.exists():
                continue
            an = json.loads(meta.read_text())["analyzer"]
            src = Path(row["mzml"])
            mz = scratch / src.name
            shutil.copyfile(src, mz)
            with open(mz, "rb") as f:
                while f.read(1 << 24):
                    pass
            d = scratch / "t"
            d.mkdir(exist_ok=True)
            for rep in range(1, reps + 1):
                t = run_timed(fastag_cmd(fastag, mz, d, "default", row["label"], an, threads), log=d / "run.log")
                ok = max(t["load1_before"], t["load1_after"]) / ncpu < max_load_per_core
                fh.write(f"{row['run_id']}\t{rep}\t{threads}\t{ncpu}\t{t['wall_s']}\t{t['cpu_s']}\t{t['maxrss_kb']}\t"
                         f"{t['load1_before']}\t{t['load1_after']}\t{ok}\t{t['returncode']}\n")
                fh.flush()
                log(f"{row['run_id']} rep {rep}: {t['wall_s']} s, load {t['load1_before']}->{t['load1_after']}")
            mz.unlink()
            shutil.rmtree(d, ignore_errors=True)
    return out


def run_all(manifest: pd.DataFrame, work: Path, tools: dict, threads: int, jobs: int, arms: list[str],
            steps: set[str], scratch: Path | None, log=print) -> None:
    work.mkdir(parents=True, exist_ok=True)
    if scratch:
        scratch.mkdir(parents=True, exist_ok=True)
    rows = manifest.to_dict("records")
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = [ex.submit(run_one, r, work, tools, threads, arms, steps, scratch, log) for r in rows]
        for f in futs:
            try:
                f.result()
            except Exception as e:  # keep going; the score step reports missing outputs
                log(f"ERROR {e}")


# ---------------------------------------------------------------- score (anywhere)

def universe_from_species(path: str | Path) -> list[str]:
    return sorted(read_fastag_species(path)["name"].astype(str))


def universe_from_taxonomy(tax_dir: str | Path, rank: str = "genus") -> list[str]:
    """Names of all taxa of 'rank' in a (pruned) NCBI taxdump: the taxa the index can call."""
    tax_dir = Path(tax_dir)
    ids = set()
    for line in open(tax_dir / "nodes.dmp", encoding="utf-8"):
        f = [x.strip() for x in line.split("|")]
        if len(f) > 2 and f[2] == rank:
            ids.add(f[0])
    names = []
    for line in open(tax_dir / "names.dmp", encoding="utf-8"):
        f = [x.strip() for x in line.split("|")]
        if len(f) > 3 and f[0] in ids and f[3] == "scientific name":
            names.append(f[1])
    return sorted(names)


def load_universe(path: str | Path) -> list[str]:
    """A taxonomy directory (nodes.dmp/names.dmp), a FASTag species.tsv, or a text file, one genus per line."""
    path = Path(path)
    if path.is_dir():
        return universe_from_taxonomy(path)
    if path.suffix == ".tsv":
        return universe_from_species(path)
    return sorted(l.strip() for l in open(path) if l.strip() and not l.startswith("#"))


def score_all(manifest: pd.DataFrame, work: Path, universe: list[str]) -> dict[str, pd.DataFrame]:
    per_genus, per_run, timing = [], [], []
    for row in manifest.to_dict("records"):
        rd = work / row["run_id"]
        truth = parse_truth(row["truth"])
        fastag = {}
        for arm in ARMS:
            p = rd / f"fastag_{arm}" / "species.tsv"
            if p.exists():
                fastag[arm] = read_fastag_species(p)
            tj = rd / f"fastag_{arm}" / "time.json"
            if tj.exists():
                timing.append({"run_id": row["run_id"], "step": f"fastag_{arm}", **json.loads(tj.read_text())})
        if "default" not in fastag:
            continue
        up = None
        lca_p = rd / "unipept" / "pept2lca.csv"
        n_pep = None
        if lca_p.exists():
            up = unipept_genus_counts(read_pept2lca(lca_p))
            n_pep = sum(1 for _ in open(rd / "unipept" / "peptides.txt") if _.strip())
        for step in ("sage", "unipept"):
            tj = rd / step / "time.json"
            if tj.exists():
                timing.append({"run_id": row["run_id"], "step": step, **json.loads(tj.read_text())})
        t = genus_table(universe, truth, fastag, up)
        t.insert(0, "run_id", row["run_id"])
        per_genus.append(t)
        meta = json.loads((rd / "meta.json").read_text()) if (rd / "meta.json").exists() else {}
        log_txt = (rd / "fastag_default" / "run.log").read_text() if (rd / "fastag_default" / "run.log").exists() else ""
        m_ev = re.search(r"Species: (\d+) spectra contributed", log_txt)
        m_ms2 = re.search(r"(\d+) MS2 spectra, (\d+) tags", log_txt)
        top = fastag["default"]["name"].iloc[0] if len(fastag["default"]) else ""
        r = {"run_id": row["run_id"], "pxd": row["pxd"], "set": row["set"], "series": row.get("series") or "",
             "level": row.get("level"), "label": row["label"], "analyzer": meta.get("analyzer", ""),
             "ms2_spectra": int(m_ms2.group(1)) if m_ms2 else None,
             "tags": int(m_ms2.group(2)) if m_ms2 else None,
             "spectra_with_taxon_evidence": int(m_ev.group(1)) if m_ev else None,
             "fastag_top1": top, "sage_peptides_1pct": n_pep,
             "unipept_top1": up["genus"].iloc[0] if up is not None and len(up) else "",
             "truth": row["truth"]}
        for g, frac in truth.items():
            hit = t[t["genus"] == g]
            if len(hit):
                h = hit.iloc[0]
                r[f"rank:{g}"] = h.get("rank_default")
        per_run.append(r)
    genus = pd.concat(per_genus, ignore_index=True) if per_genus else pd.DataFrame()
    return {"genus": genus, "runs": pd.DataFrame(per_run), "timing": pd.DataFrame(timing)}


def truth_ranks(genus: pd.DataFrame, runs: pd.DataFrame) -> pd.DataFrame:
    """One row per (run, true genus): its rank under each method (empty = no evidence / not in index)."""
    t = genus[genus["truth"].astype(bool)].merge(runs[["run_id", "set", "analyzer", "label"]], on="run_id", how="left")
    keep = ["run_id", "set", "analyzer", "label", "genus", "status", "truth_fraction", "observed", "rank_default",
            "rank_deconv", "rank_gapped", "dec_share", "unipept_peptides", "unipept_rank", "unipept_share"]
    return t[[c for c in keep if c in t]]


def top1_summary(genus: pd.DataFrame, runs: pd.DataFrame) -> pd.DataFrame:
    """Top-1 genus correct (a true genus) per method, by run class and MS2 analyzer."""
    rows = []
    r = runs.copy()
    truth_sets = genus[genus["truth"].astype(bool)].groupby("run_id")["genus"].apply(set)
    r["n_truth"] = [len(parse_truth(t)) for t in r["truth"]]
    r["class"] = ["single" if n == 1 else "mixture" for n in r["n_truth"]]

    def top(run_id, col):
        sub = genus[(genus["run_id"] == run_id) & genus[col].notna()]
        sub = sub[sub[col] == sub[col].min()] if len(sub) else sub
        return sub["genus"].iloc[0] if len(sub) else None
    for (cls, an), grp in r.groupby(["class", "analyzer"]):
        for method, col in (("fastag_default", "rank_default"), ("fastag_deconv", "rank_deconv"),
                            ("fastag_gapped", "rank_gapped"), ("unipept", "unipept_rank")):
            if col not in genus:
                continue
            ok = n = 0
            for rid in grp["run_id"]:
                tp = top(rid, col)
                if tp is None:
                    continue
                n += 1
                ok += tp in truth_sets.get(rid, set())
            rows.append({"class": cls, "analyzer": an, "method": method, "runs": len(grp), "runs_with_call": n,
                         "top1_true": ok})
    return pd.DataFrame(rows)


def summary_metrics(genus: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for call in ("call_fastag_q", "call_fastag_dec", "call_unipept"):
        if call not in genus:
            continue
        mixed = _mixed_runs(genus)
        hr = genus["run_id"].isin(set(genus.attrs.get("ftms_runs", genus["run_id"])))
        for subset, g in (("all", genus), ("mixture", genus[genus["run_id"].isin(mixed)]),
                          ("single", genus[~genus["run_id"].isin(mixed)]),
                          ("all_FTMS", genus[hr]), ("mixture_FTMS", genus[hr & genus["run_id"].isin(mixed)]),
                          ("single_FTMS", genus[hr & ~genus["run_id"].isin(mixed)])):
            c = confusion(g, call)
            rows.append({"rule": call, "subset": subset, **c, **rates(c), "runs": g["run_id"].nunique()})
    return pd.DataFrame(rows)


def _mixed_runs(genus: pd.DataFrame) -> set[str]:
    """Runs whose sample holds two or more genera (in the index or not)."""
    n = genus[genus["truth"].astype(bool) | (genus["status"] == "out_of_index")].groupby("run_id").size()
    return set(n[n > 1].index) | set(genus.attrs.get("mixed_runs", []))


def agreement(genus: pd.DataFrame, a: str = "call_fastag_dec", b: str = "call_unipept") -> pd.DataFrame:
    u = genus[genus["in_index"].astype(bool) & genus["status"].isin(["positive", "negative"])]
    u = u[u[a].notna() & u[b].notna()]
    x, y = u[a].astype(bool).tolist(), u[b].astype(bool).tolist()
    both = sum(p and q for p, q in zip(x, y))
    only_a = sum(p and not q for p, q in zip(x, y))
    only_b = sum(q and not p for p, q in zip(x, y))
    neither = len(x) - both - only_a - only_b
    return pd.DataFrame([{"a": a, "b": b, "pairs": len(x), "both": both, "only_a": only_a, "only_b": only_b,
                          "neither": neither, "percent_agreement": round((both + neither) / len(x), 4) if x else None,
                          "cohen_kappa": cohen_kappa(x, y)}])


def write_csv(path: Path, rows: list[dict]) -> None:
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]), delimiter="\t")
        w.writeheader()
        w.writerows(rows)


def tool_versions(tools: dict) -> dict:
    out = {}
    for k, args in (("sage", ["--version"]), ("unipept", ["--version"])):
        try:
            p = subprocess.run([tools[k], *args], capture_output=True, text=True, timeout=60)
            out[k] = (p.stdout or p.stderr).strip().splitlines()[0]
        except (OSError, subprocess.SubprocessError, IndexError, KeyError):
            out[k] = "unknown"
    out["fastag"] = tools.get("fastag", "")
    out["host"] = os.uname().nodename
    return out
