"""Run FASTag, Sage (ground truth) and the optional comparators DirecTag and Casanovo."""
from __future__ import annotations

import csv
import os
import re
import shutil
from pathlib import Path

from .config import Dataset
from .sage import sage_config, write_sage_config
from .timing import TIME_FIELDS, run_timed

ROW_FIELDS = ["dataset", "pxd", "tool", "input", "format", "threads", "rep", "label"] + TIME_FIELDS + ["summary", "out_dir"]
SUMMARY_RE = re.compile(r"(\d+) MS2 spectra, (\d+) tags(?: -> (\d+) after filtering)?")


def tool_path(cfg: dict, name: str) -> str | None:
    val = cfg["tools"].get(name)
    if not val:
        return None
    if os.path.sep in val:
        return val if os.access(val, os.X_OK) else None
    return shutil.which(val)


_VERSIONS: dict[str, str] = {}


def tool_version(exe: str, args=("--help",), pattern=r"Version: ?([^\n]+)") -> str:
    """First 'Version:' line of a tool's help/version output (cached)."""
    if exe not in _VERSIONS:
        import subprocess
        try:
            p = subprocess.run([exe, *args], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
            m = re.search(pattern, p.stdout + p.stderr)
            _VERSIONS[exe] = m.group(1).strip() if m else "unknown"
        except (OSError, subprocess.TimeoutExpired):
            _VERSIONS[exe] = "unknown"
    return _VERSIONS[exe]


def run_dir(cfg: dict, ds: Dataset, tool: str, label: str) -> Path:
    d = Path(cfg["work_dir"]) / "runs" / ds.id / tool / label
    d.mkdir(parents=True, exist_ok=True)
    return d


def append_timing(cfg: dict, row: dict) -> None:
    path = Path(cfg["work_dir"]) / "timing.tsv"
    new = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=ROW_FIELDS, delimiter="\t", extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerow(row)


def inputs(cfg: dict, ds: Dataset, formats=("mzml",)) -> list[tuple[str, Path]]:
    base = Path(cfg["data_dir"]) / ds.pxd
    out = []
    for f in ds.files:
        if f.role in formats and (base / f.name).exists():
            fmt = f.role if f.role != "mzpeak" else ("mzpeak_point" if ".point." in f.name else "mzpeak_chunked")
            out.append((fmt, base / f.name))
    return out


def _fastag_env(cfg: dict) -> dict:
    env = dict(cfg.get("env") or {})
    if cfg["fastag"].get("digest_dir"):
        env["FASTAG_DIGEST_DIR"] = cfg["fastag"]["digest_dir"]
    return env


def fastag_once(cfg: dict, ds: Dataset, fmt: str, inp: Path, threads: int, rep: int,
                label: str, extra: list[str] | None = None, outputs: dict | None = None) -> dict:
    exe = tool_path(cfg, "fastag")
    if exe is None:
        raise FileNotFoundError(f"FASTag not found ({cfg['tools']['fastag']}); set tools.fastag")
    d = run_dir(cfg, ds, "fastag", label)
    cmd = [exe, "-in", str(inp), "-out", str(d / "tags.tsv"), "-threads", str(threads)]
    cmd += [str(a) for a in ds.fastag_args] + [str(a) for a in cfg["fastag"]["args"]] + [str(a) for a in (extra or [])]
    for opt, name in (outputs or {}).items():
        cmd += [opt, str(d / name)]
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    (d / "version.txt").write_text(tool_version(exe) + "\n")
    t = run_timed(cmd, log=d / "run.log", env=_fastag_env(cfg))
    m = SUMMARY_RE.search((d / "run.log").read_text(errors="replace"))
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": "fastag", "input": inp.name, "format": fmt,
           "threads": threads, "rep": rep, "label": label, **t,
           "summary": m.group(0) if m else "", "out_dir": str(d)}
    append_timing(cfg, row)
    return row


def fastag_ladder(cfg: dict, ds: Dataset, formats=("mzml",), threads=None, reps=None, log=print) -> list[dict]:
    """Thread ladder. Odd reps run threads ascending, even reps descending, to spread load drift."""
    threads = threads or cfg["fastag"]["threads"]
    reps = reps or cfg["fastag"]["reps"]
    rows = []
    for fmt, inp in inputs(cfg, ds, formats):
        for rep in range(1, reps + 1):
            order = threads if rep % 2 else list(reversed(threads))
            for t in order:
                r = fastag_once(cfg, ds, fmt, inp, t, rep, f"{fmt}_t{t}_r{rep}")
                log(f"{ds.id} fastag {fmt} t={t} rep={rep}: {r['wall_s']} s, {r['maxrss_kb'] // 1024} MB, "
                    f"load {r['load1_before']}, rc {r['returncode']}, {r['summary']}")
                rows.append(r)
    return rows


def fastag_reports(cfg: dict, ds: Dataset, threads: int, log=print) -> list[dict]:
    """Digest/label reports, and the species report when the dataset is a species case."""
    rows = []
    ins = inputs(cfg, ds, ("mzml",))
    if not ins:
        log(f"{ds.id}: no mzML input present, run fetch/convert first")
        return rows
    fmt, inp = ins[0]
    r = fastag_once(cfg, ds, fmt, inp, threads, 1, "reports", outputs={"-digest_out": "digest.tsv", "-label_out": "label.tsv"})
    log(f"{ds.id} fastag reports: {r['wall_s']} s, rc {r['returncode']}")
    rows.append(r)
    sp = cfg["fastag"]["species"]
    if "species" in ds.experiments:
        if all(sp.get(k) for k in ("taxdb", "nodes", "names")):
            extra = list(sp.get("args") or []) + ["-species", "-taxdb", sp["taxdb"], "-taxonomy_nodes", sp["nodes"],
                                                  "-taxonomy_names", sp["names"]]
            r = fastag_once(cfg, ds, fmt, inp, threads, 1, "species", extra=extra, outputs={"-species_out": "species.tsv"})
            log(f"{ds.id} fastag species: {r['wall_s']} s, rc {r['returncode']}")
            rows.append(r)
        else:
            log(f"{ds.id}: species case skipped: set fastag.species.taxdb/nodes/names in the config")
    return rows


def sage_run(cfg: dict, ds: Dataset, threads: int | None = None, log=print) -> dict | None:
    exe = tool_path(cfg, "sage")
    if exe is None:
        log(f"{ds.id}: Sage not found ({cfg['tools']['sage']}); skipping ground truth "
            "(install: micromamba create -p envs/sage -c conda-forge -c bioconda sage-proteomics=0.14.7)")
        return None
    fasta = (ds.search or {}).get("fasta") or cfg["sage"].get("fasta")
    if fasta and not Path(fasta).is_absolute():
        fasta = str(Path(cfg["data_dir"]) / ds.pxd / fasta)
    if not fasta:
        f = ds.file("fasta")
        fasta = str(Path(cfg["data_dir"]) / ds.pxd / f.name) if f else None
    if not fasta or not Path(fasta).exists():
        log(f"{ds.id}: no FASTA for Sage (set sage.fasta or fetch the dataset's fasta file); skipping")
        return None
    ins = inputs(cfg, ds, ("mzml",))
    if not ins:
        log(f"{ds.id}: no mzML input for Sage")
        return None
    d = run_dir(cfg, ds, "sage", "default")
    conf = write_sage_config(d / "sage.json", sage_config(ds, Path(fasta).resolve(), [p.resolve() for _, p in ins], cfg["sage"]))
    cmd = [exe, *map(str, cfg["sage"].get("args") or []), "-o", str(d), str(conf)]
    ver = tool_version(exe, ("--version",), r"sage ?([^\n]+)")
    note = cfg["sage"].get("version_note")
    (d / "version.txt").write_text(ver + (f" ({note})" if note else "") + "\n")
    env = dict(cfg.get("env") or {})
    threads = threads or cfg["sage"].get("threads")
    if threads:
        env["RAYON_NUM_THREADS"] = str(threads)
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    t = run_timed(cmd, log=d / "run.log", env=env)
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": "sage", "input": ins[0][1].name, "format": "mzml",
           "threads": threads or "", "rep": 1, "label": "default", **t, "summary": "", "out_dir": str(d)}
    append_timing(cfg, row)
    log(f"{ds.id} sage: {t['wall_s']} s, {t['maxrss_kb'] // 1024} MB, rc {t['returncode']}")
    return row


def directag_run(cfg: dict, ds: Dataset, log=print) -> dict | None:
    exe = tool_path(cfg, "directag")
    if exe is None:
        log(f"{ds.id}: DirecTag not found ({cfg['tools']['directag']}); skipping (optional comparator; "
            "bioconda package 'bumbershoot')")
        return None
    ins = inputs(cfg, ds, ("mzml",))
    if not ins:
        return None
    d = run_dir(cfg, ds, "directag", "default")
    thr = int(cfg["directag"]["threads"])
    cmd = [exe, "-cpus", str(thr), *map(str, cfg["directag"]["args"]), "-OutputFormat", "tags", str(ins[0][1].resolve())]
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    t = run_timed(cmd, log=d / "run.log", env={**(cfg.get("env") or {}), "LC_ALL": "C"}, cwd=d)
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": "directag", "input": ins[0][1].name, "format": "mzml",
           "threads": thr, "rep": 1, "label": "default", **t, "summary": "", "out_dir": str(d)}
    append_timing(cfg, row)
    log(f"{ds.id} directag: {t['wall_s']} s, rc {t['returncode']}")
    return row


def casanovo_run(cfg: dict, ds: Dataset, log=print) -> dict | None:
    exe = tool_path(cfg, "casanovo")
    if exe is None:
        log(f"{ds.id}: Casanovo not found ({cfg['tools']['casanovo']}); skipping (optional comparator)")
        return None
    ins = inputs(cfg, ds, ("mzml",))
    if not ins:
        return None
    d = run_dir(cfg, ds, "casanovo", "default")
    n = cfg["casanovo"].get("max_spectra")
    src = ins[0][1].resolve()
    if n:
        try:
            from .mgf import write_first_ms2
        except ImportError:
            log(f"{ds.id}: casanovo.max_spectra needs pyteomics (pip install 'fastag-bench[mgf]'); skipping")
            return None
        src = write_first_ms2(src, d / f"first{n}.mgf", int(n))
    cmd = [exe, "sequence", str(src), "--output_dir", str(d), "--output_root", "casanovo"]
    if cfg["casanovo"].get("model"):
        cmd += ["-m", cfg["casanovo"]["model"]]
    env = {**(cfg.get("env") or {}), "OMP_NUM_THREADS": str(cfg["casanovo"].get("threads", 16))}
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    t = run_timed(cmd, log=d / "run.log", env=env)
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": "casanovo", "input": src.name, "format": "mgf" if n else "mzml",
           "threads": cfg["casanovo"].get("threads", 16), "rep": 1, "label": "default", **t, "summary": "",
           "out_dir": str(d)}
    append_timing(cfg, row)
    log(f"{ds.id} casanovo: {t['wall_s']} s, rc {t['returncode']}")
    return row


def comet_run(cfg: dict, ds: Dataset, threads: int | None = None, log=print) -> dict | None:
    """Comet cross-check search. Parameters: Comet's own 'comet -p' template with the keys below
    replaced from the dataset's 'search' block (concatenated decoys, txt output, rank 1 only)."""
    import subprocess
    exe = tool_path(cfg, "comet")
    if exe is None:
        log(f"{ds.id}: Comet not found ({cfg['tools'].get('comet')}); skipping")
        return None
    sr = ds.search or {}
    fasta = sr.get("fasta") or cfg["sage"].get("fasta")
    if fasta and not Path(fasta).is_absolute():
        fasta = str(Path(cfg["data_dir"]) / ds.pxd / fasta)
    ins = inputs(cfg, ds, ("mzml",))
    if not fasta or not ins:
        log(f"{ds.id}: Comet needs a FASTA and an mzML")
        return None
    d = run_dir(cfg, ds, "comet", "default")
    subprocess.run([exe, "-p"], cwd=d, capture_output=True)
    tmpl = (d / "comet.params.new").read_text()
    threads = threads or cfg["comet"].get("threads", 32)
    ppm = float(sr.get("precursor_ppm", cfg["sage"]["precursor_ppm"]))
    bin_tol, bin_off, theo = sr.get("comet_fragment", [0.02, 0.0, 0])
    fixed = {k: float(v) for k, v in (ds.fixed_mods or {}).items()}
    keys = {
        "database_name": str(Path(fasta).resolve()), "decoy_search": "1", "decoy_prefix": "DECOY_",
        "num_threads": str(threads), "peptide_mass_tolerance_upper": f"{ppm:g}",
        "peptide_mass_tolerance_lower": f"{-ppm:g}", "peptide_mass_units": "2", "isotope_error": "1",
        "search_enzyme_number": str(sr.get("comet_enzyme_number", 1)), "num_enzyme_termini": "2",
        "allowed_missed_cleavage": str(sr.get("missed_cleavages", cfg["sage"]["missed_cleavages"])),
        "fragment_bin_tol": f"{bin_tol}", "fragment_bin_offset": f"{bin_off}",
        "theoretical_fragment_ions": f"{theo}", "output_txtfile": "1", "output_pepxmlfile": "0",
        "output_mzidentmlfile": "0", "output_percolatorfile": "0", "output_sqtfile": "0",
        "num_output_lines": "1", "clip_nterm_methionine": "0",
        "max_variable_mods_in_peptide": str(sr.get("max_variable_mods", cfg["sage"]["max_variable_mods"])),
        "add_C_cysteine": f"{fixed.get('C', 0.0)}", "add_K_lysine": f"{fixed.get('K', 0.0)}",
        "add_Nterm_peptide": f"{fixed.get('^', 0.0)}",
    }
    vm = list(sr.get("comet_variable_mods") or ["15.994915 M 0 3 -1 0 0 0.0"])
    n_slots = len(re.findall(r"^variable_mod\d\d\s*=", tmpl, re.M))
    if len(vm) > n_slots:
        raise ValueError(f"{ds.id}: {len(vm)} Comet variable mods, template has {n_slots} slots")
    for i in range(1, n_slots + 1):
        keys[f"variable_mod{i:02d}"] = vm[i - 1] if i <= len(vm) else "0.0 X 0 3 -1 0 0 0.0"
    lines, seen = [], set()
    for line in tmpl.splitlines():
        m = re.match(r"^(\w+)\s*=", line)
        if m and m.group(1) in keys:
            lines.append(f"{m.group(1)} = {keys[m.group(1)]}")
            seen.add(m.group(1))
        else:
            lines.append(line)
    missing = sorted(set(keys) - seen)
    if missing:
        log(f"{ds.id}: Comet template lacks keys {missing}; appended")
        lines += [f"{k} = {keys[k]}" for k in missing]
    (d / "comet.params").write_text("\n".join(lines) + "\n")
    base = d / Path(ins[0][1]).stem
    cmd = [exe, f"-P{d / 'comet.params'}", f"-N{base}", str(ins[0][1].resolve())]
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    ver = tool_version(exe, (), r'Comet version "([^"]+)"')
    note = cfg["comet"].get("version_note")
    (d / "version.txt").write_text(ver + (f" ({note})" if note else "") + "\n")
    t = run_timed(cmd, log=d / "run.log", env=dict(cfg.get("env") or {}))
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": "comet", "input": ins[0][1].name, "format": "mzml",
           "threads": threads, "rep": 1, "label": "default", **t, "summary": "", "out_dir": str(d)}
    append_timing(cfg, row)
    log(f"{ds.id} comet: {t['wall_s']} s, {t['maxrss_kb'] // 1024} MB, rc {t['returncode']}")
    return row
