"""Download dataset files from PRIDE and verify them."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import requests

from .config import DataFile, Dataset

CHUNK = 1 << 22


def https_url(url: str) -> str:
    """PRIDE serves the same tree over HTTPS; ftp:// often fails behind firewalls."""
    if url.startswith("ftp://ftp.pride.ebi.ac.uk/"):
        return "https://" + url[len("ftp://"):]
    return url


def file_digest(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def verify(path: Path, f: DataFile) -> tuple[bool, str]:
    """Check sha256, else PRIDE's sha1, else size. Returns (ok, what was checked)."""
    if f.sha256:
        got = file_digest(path, "sha256")
        return got == f.sha256, f"sha256 {got[:12]}"
    if f.sha1:
        got = file_digest(path, "sha1")
        return got == f.sha1, f"sha1 {got[:12]}"
    if f.size:
        got = path.stat().st_size
        return got == int(f.size), f"size {got}"
    return True, "no checksum recorded"


def find_in_mirrors(ds: Dataset, f: DataFile, mirrors: list[str]) -> Path | None:
    for m in mirrors:
        for cand in (Path(m) / ds.pxd / f.name, Path(m) / f.name):
            if cand.is_file():
                return cand
    return None


def download(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(https_url(url), stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for block in r.iter_content(CHUNK):
                fh.write(block)
    os.replace(tmp, dest)


def fetch_dataset(ds: Dataset, data_dir: str | Path, roles: set[str] | None = None,
                  mirrors: list[str] | None = None, max_bytes: int | None = 5 * 10**9,
                  dry_run: bool = False, log=print) -> list[dict]:
    """Fetch every file of a dataset that has a URL (or is found in a mirror). Returns status rows."""
    out_dir = Path(data_dir) / ds.pxd
    rows = []
    for f in ds.files:
        if roles and f.role not in roles:
            continue
        dest = out_dir / f.name
        row = {"dataset": ds.id, "pxd": ds.pxd, "file": f.name, "role": f.role, "path": str(dest)}
        if dest.exists():
            ok, what = verify(dest, f)
            row.update(status="present" if ok else "CHECKSUM MISMATCH", check=what)
            rows.append(row)
            log(f"{ds.pxd} {f.name}: {row['status']} ({what})")
            continue
        mirror = find_in_mirrors(ds, f, mirrors or [])
        if mirror is not None:
            if not dry_run:
                out_dir.mkdir(parents=True, exist_ok=True)
                dest.symlink_to(mirror.resolve())
                ok, what = verify(dest, f)
            else:
                ok, what = True, "dry run"
            row.update(status=("linked" if ok else "CHECKSUM MISMATCH"), check=what, source=str(mirror))
        elif f.url is None:
            row.update(status="derived" if f.derived_from else "no url", check="",
                       source=f.derived_from or "")
        elif max_bytes and f.size and int(f.size) > max_bytes:
            row.update(status=f"skipped: {int(f.size) / 1e9:.1f} GB > limit (use --max-gb)", check="")
        elif dry_run:
            row.update(status="would download", check="", source=https_url(f.url))
        else:
            out_dir.mkdir(parents=True, exist_ok=True)
            log(f"{ds.pxd} {f.name}: downloading {https_url(f.url)}")
            download(f.url, dest)
            ok, what = verify(dest, f)
            row.update(status="downloaded" if ok else "CHECKSUM MISMATCH", check=what, source=https_url(f.url))
        rows.append(row)
        log(f"{ds.pxd} {f.name}: {row['status']} {row.get('check', '')}")
    return rows
