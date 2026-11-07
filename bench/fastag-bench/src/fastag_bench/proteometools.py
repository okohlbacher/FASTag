"""#4: ProteomeTools Part I (PXD004732) file list and pool peptide lists.

Every pool (synthesis set + pool number, e.g. TUM_first_pool_30) was measured once per acquisition
method (3xHCD, 2xIT_2xHCD, DDA, ETD) on an Orbitrap Fusion Lumos; some pools have repeat
measurements (_02_01, _03_01). Raw names carry the LC-MS queue (batch) and the plate well:

    01625b_GF4-TUM_first_pool_30_01_01-3xHCD-1h-R1.raw
    <queue>_<well>-<set>_<num>_<repeat>-<method>-<length>-R<rep>.raw

The deposited MaxQuant searches (one zip per raw file, 'tryptic' and some 'unspecific') searched each
pool against its own pool sequence. PRIDE does not hold the synthesis peptide lists themselves, so the
pool list used here is the union of the MaxQuant-identified peptides (peptides.txt, 1% FDR) assigned to
the pool over its four tryptic searches; contaminants, reversed hits and peptides of other pools are
dropped. Synthesised peptides that MaxQuant never identified are missing from the list (they can only
turn a true candidate into no_pool_candidate, never into a wrong size-1 label unless a mass coincidence
with another pool peptide exists; reported as a limitation).
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

RAW_RE = re.compile(r"^(?P<batch>\d+[a-z]?)_(?P<well>[A-Z]+\d+)-(?P<set>TUM_(?:first|second|third)_pool|Thermo_SRM_Pool)_"
                    r"(?P<num>\d+)_(?P<repeat>\d+_\d+)-(?P<method>3xHCD|2xIT_2xHCD|DDA|ETD)-(?P<length>\d+h)-R(?P<rep>\d+)\.raw$")
ZIP_RE = re.compile(r"^(?P<set>TUM_(?:first|second|third)_pool|Thermo_SRM_Pool)_(?P<num>\d+)_(?P<repeat>\d+_\d+)_"
                    r"(?P<method>3xHCD|2xIT_2xHCD|DDA|ETD)-(?P<length>\d+h)(?:-R(?P<rep>\d+))?-(?P<search>tryptic|unspecific)\.zip$")
# one deposited search has no replicate tag: TUM_second_pool_129_01_01_2xIT_2xHCD-1h-tryptic.zip (rep 0)

# All splits are drawn at once (PLAN-qc.md item #4, PLAN-INTEGRATION.md 2.3(7)); n in pools.
DEFAULT_PLAN = [
    {"split": "dev", "seed": 1, "n": 3},
    {"split": "test", "seed": 2, "n": 10},
    {"split": "f7train", "seed": 3, "n": 20, "exclude_batches_of": ["dev", "test"]},
    {"split": "f7test", "seed": 4, "n": 10, "exclude_batches_of": ["dev", "test"]},
    {"split": "final", "seed": 5, "n": 10, "exclude_batches_of": ["dev", "test"]},
    {"split": "reserved_2", "seed": 6, "n": 10},
    {"split": "reserved_15", "seed": 7, "n": 10},
    {"split": "reserved_16", "seed": 8, "n": 10},
]


def _https(f: dict) -> str:
    for loc in f.get("publicFileLocations") or []:
        v = str(loc.get("value", ""))
        if v.startswith("ftp://ftp.pride.ebi.ac.uk/"):
            return "https://" + v[len("ftp://"):]
    return ""


def parse_files(files: list[dict]) -> pd.DataFrame:
    """PRIDE API v3 file records -> one row per raw or search file with the parsed name fields.
    Unknown raw or search names raise ValueError; other categories are dropped."""
    rows = []
    for f in files:
        cat = (f.get("fileCategory") or {}).get("value")
        name = f["fileName"]
        if cat == "RAW":
            m = RAW_RE.match(name)
            kind = "raw"
        elif cat == "SEARCH":
            m = ZIP_RE.match(name)
            kind = "search"
        else:
            continue
        if not m:
            raise ValueError(f"unrecognised PXD004732 {cat} file name: {name}")
        g = m.groupdict()
        rows.append({"file": name, "kind": kind, "set": g["set"], "num": int(g["num"]),
                     "pool": f"{g['set']}_{int(g['num'])}", "repeat": g["repeat"], "batch": g.get("batch") or "",
                     "well": g.get("well") or "", "method": g["method"], "rep": int(g["rep"] or 0),
                     "search": g.get("search") or "", "size": int(f.get("fileSizeBytes") or 0),
                     "sha1": f.get("checksum") or "", "url": _https(f)})
    return pd.DataFrame(rows)


def pool_table(files: pd.DataFrame) -> pd.DataFrame:
    """One row per pool: batch, well and file of the first-repeat 3xHCD raw, its size, sha1 and URL, the
    repeats, the number of raw files and the tryptic search zips (';'-joined)."""
    raw = files[files["kind"] == "raw"]
    zips = files[(files["kind"] == "search") & (files["search"] == "tryptic")]
    rows = []
    for pool, g in raw.groupby("pool", sort=True):
        h = g[g["method"] == "3xHCD"].sort_values(["repeat", "rep"])
        first = h.iloc[0] if len(h) else g.sort_values(["repeat", "rep"]).iloc[0]
        z = zips[zips["pool"] == pool]
        rows.append({"pool": pool, "set": first["set"], "num": int(first["num"]), "batch": first["batch"],
                     "well": first["well"], "raw_3xhcd": first["file"] if len(h) else "",
                     "raw_size": int(first["size"]), "raw_sha1": first["sha1"], "raw_url": first["url"],
                     "repeats": ";".join(sorted(set(g["repeat"]))), "n_raw": len(g),
                     "zips": ";".join(sorted(z["file"])), "zip_urls": ";".join(z.sort_values("file")["url"])})
    return pd.DataFrame(rows)


def maxquant_pool_peptides(peptides_txt: str | Path, pool: str) -> set[str]:
    """Peptides of one pool in a MaxQuant peptides.txt: rows whose 'Proteins' list names the pool exactly
    (shared with RT standards allowed), not reversed and not contaminants."""
    df = pd.read_csv(peptides_txt, sep="\t", dtype=str, keep_default_na=False, usecols=lambda c: c in {
        "Sequence", "Proteins", "Reverse", "Potential contaminant"})
    out = set()
    blank = [""] * len(df)
    rev_col = df["Reverse"] if "Reverse" in df.columns else blank
    con_col = df["Potential contaminant"] if "Potential contaminant" in df.columns else blank
    for seq, prots, rev, con in zip(df["Sequence"], df["Proteins"], rev_col, con_col):
        if str(rev).strip() == "+" or str(con).strip() == "+":
            continue
        if pool in [p.strip() for p in str(prots).split(";")]:
            out.add(str(seq).strip().upper())
    return out
