#!/usr/bin/env python3
"""Build config/public_runs.tsv: the PRIDE file (URL, size, checksum) behind every run of the per-run collections
that are not spelled out in datasets.yaml (species benchmark, digest/label/alkylation validation, added
non-tryptic runs). File lists come from the PRIDE Archive API v3 (/projects/<PXD>/files/all), cached as JSON.

    python3 scripts/public_runs_manifest.py --cache /tmp/pride-cache [--offline]

A run matches a PRIDE file when the file name without its vendor/container extension equals the run name
(case-sensitive first, then case-insensitive). Unmatched runs are written with match = 'none' and listed on stderr.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
API = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{}/files/all"
EXTS = [".d.tar.gz", ".d.tar", ".d.zip", ".d.7z", ".wiff.scan", ".mzML.gz", ".mzml.gz", ".raw.zip", ".raw", ".RAW",
        ".wiff", ".zip", ".mzML", ".mzml", ".mzXML", ".mgf", ".7z", ".tar.gz", ".tar"]
RAW_FIRST = {"RAW": 0, "PEAK": 1}
# Bruker runs whose acquisition name (inside the .d) differs from the deposited archive name; mapped by sample
# number, condition and replicate (R<n> = Replicate<n>)
MANUAL = {("PXD061541", "209_4_Lenti_TID_eGFP_Sorted1_R1_Slot1-13_1_6861"): "4_Lenti_TID_eGFP_Sorted1_Replicate1.d.zip",
          ("PXD061563", "243_23_HAP1_WT_NoTID_R2_Slot2-23_1_8198"): "23_HAP1_WT_NoTID_Replicate2.d.zip",
          # the mzML used is on the PRIDE FTP but not in the API listing (see datasets.yaml); the raw file is listed
          ("PXD000001", "TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210"):
              "TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01.raw"}


def read_tsv(p: Path) -> pd.DataFrame:
    return pd.read_csv(p, sep="\t", comment="#", dtype=str).fillna("")


def stem(name: str) -> str:
    for e in EXTS:
        if name.endswith(e):
            return name[: -len(e)]
    return name


def fetch(pxd: str, cache: Path, offline: bool) -> list[dict]:
    f = cache / f"{pxd}.json"
    if not f.exists():
        if offline:
            raise FileNotFoundError(f)
        with urllib.request.urlopen(API.format(pxd), timeout=120) as r:
            f.write_bytes(r.read())
    return json.loads(f.read_text())


def https(rec: dict) -> str:
    for loc in rec.get("publicFileLocations", []):
        v = loc.get("value", "")
        if v.startswith("ftp://ftp.pride.ebi.ac.uk/"):
            return "https://" + v[len("ftp://"):]
    return ""


def runs() -> pd.DataFrame:
    sp = read_tsv(ROOT / "config" / "species_runs.tsv")
    sp = pd.DataFrame({"collection": "species", "pxd": sp["pxd"], "run_id": sp["run_id"],
                       "run": [Path(m).name.removesuffix(".mzML") for m in sp["mzml"]]})
    dg = read_tsv(ROOT / "results" / "sdrf_truth_runs.tsv")
    dg = pd.DataFrame({"collection": "digest_" + dg["set"], "pxd": dg["acc"].str.split("-").str[0], "run_id": dg["acc"] + "_" + dg["run"],
                       "run": dg["run"]})
    return pd.concat([sp, dg], ignore_index=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="directory for the PRIDE JSON file lists")
    ap.add_argument("--offline", action="store_true", help="use the cache only")
    ap.add_argument("--out", default=str(ROOT / "config" / "public_runs.tsv"))
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    df = runs()
    pxds = sorted(set(df["pxd"]))
    with ThreadPoolExecutor(8) as ex:
        lists = dict(zip(pxds, ex.map(lambda p: fetch(p, cache, a.offline), pxds)))
    rows, missing = [], []
    for r in df.itertuples():
        files = lists[r.pxd]
        if (r.pxd, r.run) in MANUAL:
            hit, how = [f for f in files if f["fileName"] == MANUAL[(r.pxd, r.run)]], "manual"
        else:
            hit, how = [f for f in files if stem(f["fileName"]) == r.run], "exact"
        if not hit:
            hit, how = [f for f in files if stem(f["fileName"]).lower() == r.run.lower()], "case-insensitive"
        if not hit:
            # pseudo-spectra and renamed runs: a raw file whose stem is a prefix of the run name
            pre = [f for f in files if r.run.startswith(stem(f["fileName"])) and len(stem(f["fileName"])) >= 8]
            hit, how = sorted(pre, key=lambda f: -len(f["fileName"]))[:1], "prefix"
        if not hit:
            missing.append(f"{r.collection}\t{r.pxd}\t{r.run}")
            rows.append({**r._asdict(), "file": "", "url": "", "size": "", "checksum": "", "match": "none"})
            continue
        f = sorted(hit, key=lambda f: RAW_FIRST.get(f.get("fileCategory", {}).get("value", ""), 9))[0]
        rows.append({**r._asdict(), "file": f["fileName"], "url": https(f), "size": f.get("fileSizeBytes", ""),
                     "checksum": f.get("checksum", "") or "", "match": how})
    out = pd.DataFrame(rows).drop(columns=["Index"])
    hdr = [f"# source: PRIDE Archive API v3 {API.format('<PXD>')}, resolved {date.today().isoformat()} "
           f"(scripts/public_runs_manifest.py)",
           "# runs: config/species_runs.tsv (species benchmark, collection 'species') and results/sdrf_truth_runs.tsv "
           "(digest/label/alkylation validation, collection 'digest_<set>': the 244 validation runs in the prose-auto sets "
           "valset, borg_ho, hla, mixset, nontryptic, nontryptic_dia, and the 10 added runs nontryptic_new); "
           "public ProteomeXchange data only",
           "# checksum = the PRIDE 'checksum' field (sha1 where PRIDE has one, else empty); match = how the run name "
           "was matched to the PRIDE file name (exact, case-insensitive, prefix, none)"]
    with open(a.out, "w") as fh:
        fh.write("\n".join(hdr) + "\n")
        out.to_csv(fh, sep="\t", index=False)
    print(f"{a.out}: {len(out)} runs, {len(pxds)} PXDs, {len(missing)} unmatched", file=sys.stderr)
    for m in missing:
        print("unmatched\t" + m, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
