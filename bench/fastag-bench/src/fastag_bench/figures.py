"""Run the standalone figure scripts in scripts/ (one script per figure)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def default_scripts_dir() -> Path:
    # src/fastag_bench/figures.py -> <archive root>/scripts (editable install or run from the archive); after a
    # non-editable install the package sits in site-packages, so fall back to ./scripts of the working directory.
    here = Path(__file__).resolve().parents[2] / "scripts"
    return here if here.is_dir() else Path.cwd() / "scripts"


# Releases a versioned script is rendered for. The script reads <table>_<suffix>.tsv and writes
# <figure>_<suffix>.{pdf,png}; its default is v190 (the paper release, FASTag 1.9.0), and '' renders the
# unsuffixed 1.8.0 (or older) tables under the unsuffixed figure name. Only scripts whose tables exist per
# release are listed; the others (history figures) read fixed tables and take no --suffix.
VARIANTS: dict[str, list[str]] = {
    "fig_gap_penalty": ["v180", "v190"],
    "fig_peak_budget": ["v180", "v190"],
    "fig_tag_accuracy": ["v190"],
    "fig_directag_accuracy": ["v190"],
    "fig_3_denovo_reference": ["v190"],
    "fig_6_species": ["v190"],
    "fig_digest_sdrf": ["v190"],
    "fig_digest_overhead": ["v190"],
    "fig_gate_times": ["v190"],
    "fig_species_gate": ["v190"],
    # thread ladder: '' = the 1.8.0 ladder (unsuffixed figure names), v190 = the 1.9.0 ladder
    "fig_4_speed_scaling_memory": ["v190"],
    "fig_5_input_formats": ["v190"],
    # Supporting Information Figures S1-S3 ('' = from the 1.8.0 tables)
    "fig_s1_thread_identity": ["v190"],
    "fig_s2_species_ranks": ["v190"],
    "fig_s3_report_flow": ["v190"],
}


def render_all(results: str | Path, out: str | Path, scripts: str | Path | None = None,
               only: list[str] | None = None, log=print, variants: bool = True) -> list[tuple[str, int]]:
    sdir = Path(scripts) if scripts else default_scripts_dir()
    if not sdir.is_dir():
        raise FileNotFoundError(f"figure scripts not found in {sdir}; pass --scripts")
    status = []
    for s in sorted(sdir.glob("fig_*.py")):
        if only and s.stem not in only:
            continue
        versioned = s.stem in VARIANTS
        suffixes = ([""] + VARIANTS[s.stem] if variants else ["v190"]) if versioned else [""]
        for suffix in suffixes:
            cmd = [sys.executable, str(s), "--results", str(results), "--out", str(out)]
            if versioned:
                cmd += ["--suffix", suffix]  # explicit: the scripts default to v190
            p = subprocess.run(cmd, capture_output=True, text=True)
            name = f"{s.stem}[{suffix}]" if suffix else s.stem
            status.append((name, p.returncode))
            msg = (p.stdout.strip().splitlines() or [""])[-1]
            log(f"{name}: {'ok' if p.returncode == 0 else 'FAILED'} {msg}")
            if p.returncode:
                log(p.stderr.strip())
    return status
