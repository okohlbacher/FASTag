"""Score finished runs and write result TSVs (with provenance) under results_dir/benchmark/."""
from __future__ import annotations

import datetime as _dt
import platform
from pathlib import Path

import pandas as pd

from . import __version__
from . import parsers as P
from . import score as S
from .config import Dataset
from .tsv import write_tsv

EVALUE_BINS = [0, 0.01, 0.1, 1, 10, 1e9]


def _prov(ds: Dataset, what: str, extra: str = "") -> list[str]:
    now = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
    lines = [f"fastag-bench {__version__} score: {what}; {ds.pxd} ({ds.id}); host {platform.node()}; {now}"]
    if extra:
        lines.append(extra)
    return lines


def _runs(cfg: dict, ds: Dataset, tool: str) -> Path:
    return Path(cfg["work_dir"]) / "runs" / ds.id / tool


def _fastag_tags(cfg: dict, ds: Dataset) -> Path | None:
    base = _runs(cfg, ds, "fastag")
    for cand in [base / "reports" / "tags.tsv", *sorted(base.glob("mzml_t*_r1/tags.tsv"))]:
        if cand.exists():
            return cand
    return None


def _version(d: Path) -> str:
    v = d / "version.txt"
    return v.read_text().strip() if v.exists() else "unknown"


def score_dataset(cfg: dict, ds: Dataset, log=print) -> dict:
    out_dir = Path(cfg["results_dir"]) / "benchmark" / ds.id
    ks = cfg["score"]["ks"]
    summary: dict = {"dataset": ds.id, "pxd": ds.pxd}
    sage_tsv = _runs(cfg, ds, "sage") / "default" / "results.sage.tsv"
    psms = None
    if sage_tsv.exists():
        psms = P.read_sage_psms(sage_tsv, cfg["sage"]["fdr"])
        log(f"{ds.id}: {len(psms)} Sage target PSMs at spectrum q <= {cfg['sage']['fdr']}")
    else:
        log(f"{ds.id}: no Sage results ({sage_tsv}); tag precision skipped")

    rows = []
    prov = _prov(ds, "tag precision vs Sage")
    tags_path = _fastag_tags(cfg, ds)
    if psms is not None and tags_path is not None:
        tags = P.read_fastag_tags(tags_path)
        fver = _version(tags_path.parent)
        sver = _version(sage_tsv.parent)
        prov = _prov(ds, "tag precision vs Sage", f"FASTag {fver} ({tags_path}); Sage {sver}; "
                     f"rule: tag or reverse is a substring of the PSM peptide (I=L) and one flanking mass agrees within 0.05 Da")
        rows.append({"tool": "FASTag", "control": "none", **S.score_tags(tags, psms, ks)})
        rows.append({"tool": "FASTag", "control": "shuffled peptides",
                     **S.score_tags(tags, S.shuffled_psms(psms), ks)})
        write_tsv(S.rank_curve(tags, psms, max(ks)), out_dir / "rank_curve_fastag.tsv", prov)
        if "length" in tags.columns:
            write_tsv(S.precision_by(tags, psms, "length"), out_dir / "precision_by_length_fastag.tsv", prov)
        if "evalue" in tags.columns:
            write_tsv(S.precision_by(tags, psms, "evalue", EVALUE_BINS), out_dir / "precision_by_evalue_fastag.tsv", prov)
        if "gapped" in tags.columns:
            write_tsv(S.precision_by(tags, psms, "gapped"), out_dir / "precision_by_gapped_fastag.tsv", prov)
    dt_files = sorted((_runs(cfg, ds, "directag") / "default").glob("*.tags"))
    if psms is not None and dt_files:
        dt = P.read_directag_tags(dt_files[0])
        rows.append({"tool": "DirecTag", "control": "none", **S.score_tags(dt, psms, ks)})
        write_tsv(S.rank_curve(dt, psms, max(ks)), out_dir / "rank_curve_directag.tsv",
                  _prov(ds, "DirecTag rank curve vs Sage", str(dt_files[0])))
    if rows:
        write_tsv(pd.DataFrame(rows), out_dir / "tag_precision.tsv", prov)
        summary["tag_precision"] = rows

    mz = sorted((_runs(cfg, ds, "casanovo") / "default").glob("*.mztab"))
    if psms is not None and mz:
        mgfs = sorted((_runs(cfg, ds, "casanovo") / "default").glob("*.mgf"))
        res = S.score_peptides(P.read_casanovo_mztab(mz[0], mgfs[0] if mgfs else None), psms)
        write_tsv(pd.DataFrame([{"tool": "Casanovo", **res}]), out_dir / "peptide_exact_casanovo.tsv",
                  _prov(ds, "Casanovo exact peptide vs Sage", str(mz[0])))
        summary["casanovo"] = res

    sp = _runs(cfg, ds, "fastag") / "species" / "species.tsv"
    if sp.exists() and ds.expected_genus:
        res = S.score_species(P.read_species(sp), ds.expected_genus)
        write_tsv(pd.DataFrame([res]), out_dir / "species_call.tsv", _prov(ds, "species call", str(sp)))
        summary["species"] = res

    rep = _runs(cfg, ds, "fastag") / "reports"
    sdrf = Path(cfg["data_dir"]) / ds.pxd / ds.sdrf if ds.sdrf else None
    if (rep / "digest.tsv").exists():
        mz_name = next((f.name for f in ds.files if f.role == "mzml"), "")
        exp_enz, exp_lab = S.expected_protease(ds.enzyme), S.expected_label(ds.labels, [])
        source = "datasets.yaml"
        if sdrf and sdrf.exists():
            try:
                meta = P.sdrf_run(sdrf, Path(mz_name).stem)
                exp_enz = S.expected_protease(meta["cleavage"]) or exp_enz
                exp_lab = S.expected_label(meta["label"], meta["mods"])
                source = f"SDRF {sdrf.name}"
            except KeyError as e:
                log(f"{ds.id}: {e}; using datasets.yaml annotations")
        dig = S.digest_call(P.read_long_report(rep / "digest.tsv"))
        lab = S.label_call(P.read_long_report(rep / "label.tsv"), cfg["score"]["label_share_min"]) \
            if (rep / "label.tsv").exists() else {"label": None}
        res = {"expected_protease": exp_enz, "called_protease": dig["call"], "digest_status": dig["status"],
               "runner_up": dig["runner_up"], "margin": dig["margin"],
               "protease_correct": (dig["call"] == exp_enz) if dig["call"] else None,
               "expected_label": exp_lab, "called_label": lab["label"],
               "label_correct": (lab["label"] == exp_lab) if lab["label"] and exp_lab != "SILAC" else None,
               "K8_share": lab.get("K8_share"), "R10_share": lab.get("R10_share"), "annotation_source": source}
        write_tsv(pd.DataFrame([res]), out_dir / "digest_label_call.tsv",
                  _prov(ds, "digest/label call vs annotation", f"FASTag {_version(rep)}; label rule: largest isobaric "
                        f"tag-end share >= {cfg['score']['label_share_min']} above its +0.5 Da background"))
        summary["digest"] = res
    return summary
