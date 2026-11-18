#!/usr/bin/env python3
"""Build and package a FASTag taxonomy index with its provenance manifest.

    package_taxonomy.py --proteomes <dir> --taxdump <taxdmp.zip> --buildtaxdb <bin>
                        --tarball <FASTag-taxonomy-k7.tar.gz> [--k 7]
                        [--taxdump-url URL] [--source-commit SHA]

<dir> is the output of tools/fetch_reference_set.py: <taxid>.fasta files and
fetch-manifest.json. The script

  1. prunes the NCBI taxdump (taxdmp.zip, as downloaded from
     https://ftp.ncbi.nih.gov/pub/taxonomy/taxdmp.zip) to the lineages of the
     proteomes (tools/prune_taxdump.py),
  2. builds tax_k7.taxdb with buildtaxdb (deterministic: the same proteomes
     give a byte-identical index),
  3. writes share-FASTag-taxonomy/MANIFEST.json: the UniProt release, every
     proteome with its URL, sha256 and entry count (from fetch-manifest.json),
     the taxdump's URL, sha256 and file dates, the buildtaxdb binary's sha256,
     the FASTag commit it was built from, both command lines, and the sha256
     of every file in the tarball,
  4. packs share-FASTag-taxonomy/ (index, pruned dumps, MANIFEST.json) into
     the tarball, reproducibly (sorted, mtime 0, owner 0, gzip without a
     name or time), and writes <tarball>.sha256.

The tarball is what a taxonomy-k7-YYYYMMDD data release carries (see the
TAXDB_TAG comment in .github/workflows/ci.yml).
"""
import argparse
import datetime
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOP = "share-FASTag-taxonomy"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str]) -> str:
    print("+ " + " ".join(cmd), file=sys.stderr)
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def reproducible_tar(src: Path, tarball: Path) -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
        for p in [src] + sorted(src.rglob("*")):
            ti = tf.gettarinfo(str(p), arcname=str(p.relative_to(src.parent)))
            ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = 0, 0, 0, "", ""
            ti.mode = 0o755 if p.is_dir() else 0o644
            if p.is_file():
                with open(p, "rb") as f:
                    tf.addfile(ti, f)
            else:
                tf.addfile(ti)
    with open(tarball, "wb") as out, gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0, compresslevel=9) as gz:
        gz.write(buf.getvalue())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--proteomes", required=True, type=Path)
    ap.add_argument("--taxdump", required=True, type=Path)
    ap.add_argument("--taxdump-url", default="https://ftp.ncbi.nih.gov/pub/taxonomy/taxdmp.zip")
    ap.add_argument("--buildtaxdb", required=True, type=Path)
    ap.add_argument("--k", type=int, default=7)
    ap.add_argument("--tarball", required=True, type=Path)
    ap.add_argument("--source-commit", default="")
    a = ap.parse_args()

    fetch = json.loads((a.proteomes / "fetch-manifest.json").read_text(encoding="utf-8"))
    fastas = sorted(a.proteomes.glob("*.fasta"))
    listed = {t["file"] for t in fetch["taxa"]}
    if {p.name for p in fastas} != listed:
        print(f"the proteome files and fetch-manifest.json disagree: {sorted({p.name for p in fastas} ^ listed)}",
              file=sys.stderr)
        return 1
    for t in fetch["taxa"]:
        got = sha256(a.proteomes / t["file"])
        if got != t["fasta_sha256"]:
            print(f"{t['file']}: sha256 {got}, the manifest says {t['fasta_sha256']}", file=sys.stderr)
            return 1

    commit = a.source_commit
    if not commit:
        try:
            commit = run(["git", "-C", str(HERE.parent), "rev-parse", "HEAD"]).strip()
        except (OSError, subprocess.CalledProcessError):
            commit = "unknown"

    with tempfile.TemporaryDirectory(prefix="fastag-taxonomy-") as tmp:
        tmp = Path(tmp)
        out = tmp / TOP
        out.mkdir()
        dump = tmp / "taxdump"
        dump.mkdir()
        with zipfile.ZipFile(a.taxdump) as z:
            dates = {i.filename: "%04d-%02d-%02d %02d:%02d:%02d" % i.date_time for i in z.infolist()}
            z.extract("nodes.dmp", dump)
            z.extract("names.dmp", dump)
        prune_cmd = [sys.executable, str(HERE / "prune_taxdump.py"), str(dump / "nodes.dmp"), str(dump / "names.dmp"),
                     str(out), "--from-proteomes", str(a.proteomes)]
        run(prune_cmd)
        build_cmd = [str(a.buildtaxdb), str(a.proteomes), str(out / f"tax_k{a.k}.taxdb"), str(a.k)]
        build_log = run(build_cmd)

        files = {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size} for p in sorted(out.iterdir())}
        manifest = {
            "manifest_version": 1,
            "created": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "index": {"file": f"tax_k{a.k}.taxdb", "format": "FTX2", "k": a.k, "taxa": len(fetch["taxa"])},
            "files": files,
            "uniprot": {k: fetch.get(k) for k in ("uniprot_release", "uniprot_release_date", "uniprot_archive",
                                                   "source", "licence", "reference_set", "reference_set_sha256")},
            "proteomes": fetch["taxa"],
            "ncbi_taxonomy": {
                "url": a.taxdump_url,
                "file": a.taxdump.name,
                "sha256": sha256(a.taxdump),
                "bytes": a.taxdump.stat().st_size,
                "nodes.dmp_date": dates.get("nodes.dmp"),
                "names.dmp_date": dates.get("names.dmp"),
                "pruned_by": "tools/prune_taxdump.py --from-proteomes",
                "licence": "NCBI Taxonomy, public domain (US government work); "
                           "https://www.ncbi.nlm.nih.gov/home/about/policies/",
            },
            "build": {
                "fastag_commit": commit,
                "buildtaxdb_sha256": sha256(a.buildtaxdb),
                "commands": [
                    "python3 tools/fetch_reference_set.py data/taxonomy/reference-set.tsv proteomes",
                    "python3 tools/prune_taxdump.py nodes.dmp names.dmp share-FASTag-taxonomy --from-proteomes proteomes",
                    f"buildtaxdb proteomes share-FASTag-taxonomy/tax_k{a.k}.taxdb {a.k}",
                    "python3 tools/package_taxonomy.py ...",
                ],
                "buildtaxdb_output": build_log.splitlines()[-60:],
            },
        }
        (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
        a.tarball.parent.mkdir(parents=True, exist_ok=True)
        reproducible_tar(out, a.tarball)
    digest = sha256(a.tarball)
    Path(str(a.tarball) + ".sha256").write_text(f"{digest}  {a.tarball.name}\n", encoding="utf-8")
    print(f"{a.tarball}: sha256 {digest}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
