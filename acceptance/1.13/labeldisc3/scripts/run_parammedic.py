#!/usr/bin/env python3
"""Param-Medic baseline: one default run per audited mzML, mapped to a class.
usage: run_parammedic.py <audited manifest> <param-medic executable> <out dir> <jobs>
writes <out dir>/<id>.out|.err and <out dir>/pm.tsv (id, pm_class, flags)."""
import csv, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def pm_class(row):
    """row: dict of the Param-Medic stdout table. Families with a *_present == T column."""
    on = {k[:-8] for k, v in row.items() if k.endswith("_present") and v == "T"}
    fam = set()
    if any(k.startswith("SILAC") for k in on): fam.add("SILAC")
    if any(k.startswith("TMT") for k in on): fam.add("TMT")
    if "iTRAQ_8plex" in on: fam.add("iTRAQ8")
    elif "iTRAQ_4plex" in on: fam.add("iTRAQ4")
    return "label-free" if not fam else fam.pop() if len(fam) == 1 else "mixed"


def parse(text):
    lines = [l for l in text.splitlines() if "\t" in l]
    i = next((n for n, l in enumerate(lines) if l.startswith("file\t")), None)
    if i is None or i + 1 >= len(lines): return None
    return dict(zip(lines[i].split("\t"), lines[i + 1].split("\t")))


def main():
    man, exe, out, jobs = sys.argv[1], sys.argv[2], Path(sys.argv[3]), int(sys.argv[4])
    out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("#")), delimiter="\t")
            if r["include"] == "yes"]

    def one(r):
        o = out / (r["id"] + ".out")
        if not o.exists() or not o.stat().st_size:
            with open(o, "w") as fo, open(out / (r["id"] + ".err"), "w") as fe:
                try:
                    subprocess.run([exe, str(Path(r["root"]) / r["fastag_input"])], stdout=fo, stderr=fe, timeout=7200)
                except subprocess.TimeoutExpired:
                    pass
        row = parse(o.read_text())
        if row is None: return r["id"], "failed", ""
        return r["id"], pm_class(row), ",".join(sorted(k[:-8] for k, v in row.items() if k.endswith("_present") and v == "T"))

    with ThreadPoolExecutor(jobs) as ex, open(out / "pm.tsv", "w") as f:
        f.write("id\tpm_class\tflags\n")
        for t in ex.map(one, rows): f.write("\t".join(t) + "\n")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        h = "file\tSILAC_4Da_present\tiTRAQ_8plex_present\tiTRAQ_4plex_present\tTMT_6plex_present\tphospho_present"
        t = lambda v: pm_class(parse("x\n" + h + "\nf\t" + "\t".join(v)))
        assert t("FFFFT") == "label-free" and t("FFFTF") == "TMT" and t("FTTFF") == "iTRAQ8"
        assert t("FFTFF") == "iTRAQ4" and t("TFFFF") == "SILAC" and t("TFFTF") == "mixed"
        assert parse("no table") is None
        print("selftest ok")
    else:
        main()
