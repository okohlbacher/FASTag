"""TSV files with provenance lines.

Every result table starts with one or more lines beginning with '# ' that say where the numbers
come from (source file, FASTag version, node, date). The table header follows.
"""
from __future__ import annotations

import io
from pathlib import Path

import pandas as pd


def read_tsv(path: str | Path) -> tuple[pd.DataFrame, list[str]]:
    """Return (table, provenance lines without the leading '# ')."""
    text = Path(path).read_text()
    prov, body = [], []
    in_header = True
    for line in text.splitlines(keepends=True):
        if in_header and line.startswith("#"):
            prov.append(line[1:].strip())
            continue
        in_header = False
        body.append(line)
    df = pd.read_csv(io.StringIO("".join(body)), sep="\t", keep_default_na=False, na_values=[""])
    return df, prov


def write_tsv(df: pd.DataFrame, path: str | Path, provenance: list[str] | str) -> Path:
    if isinstance(provenance, str):
        provenance = [provenance]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for line in provenance:
            fh.write(f"# {line}\n")
        df.to_csv(fh, sep="\t", index=False)
    return path
