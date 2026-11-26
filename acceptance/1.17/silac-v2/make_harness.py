"""Bench-harness files for PREREG-silac-v2 from manifest-silac-heldout-v2.tsv (frozen run list).

Usage: python3 -I make_harness.py MANIFEST HARNESS_DIR
Writes HARNESS_DIR/datasets/<PXD>.yaml (fetch = the listed files exactly), HARNESS_DIR/benchmarks/inputs/
silac-heldout-v2-<PXD>.tsv and HARNESS_DIR/benchmarks/silac-heldout-v2-<PXD>.yaml (one arm, the frozen command).
A data set YAML that already exists is left alone (none of these PXDs had one).
"""
import csv, os, re, sys

CMD = ["-in", "{input}", "-out", "{out}/tags.tsv", "-label_out", "{out}/label.tsv", "-label_format", "2",
       "-digest_out", "{out}/digest.tsv", "-qc_out", "{out}/qc.tsv", "-threads", "{threads}", "-no_progress"]
VERSION = "silac-v2-e1557be6"

def q(s): return "'" + s.replace("'", "''") + "'"

def main():
    man, hd = sys.argv[1:3]
    rows = list(csv.DictReader(open(man), delimiter="\t"))
    by = {}
    for r in rows: by.setdefault(r["pxd"], []).append(r)
    os.makedirs(os.path.join(hd, "benchmarks", "inputs"), exist_ok=True)
    for pxd, rs in by.items():
        runs = [r for r in rs if r["role"] == "run"]; srch = [r for r in rs if r["role"] == "search"]
        cls = runs[0]["instrument_class"]
        ds = os.path.join(hd, "datasets", pxd + ".yaml")
        if not os.path.exists(ds):
            fetch = ["^" + re.escape(r["file"]) + "$" for r in runs + srch]
            with open(ds, "w") as f:
                f.write(f"accession: {pxd}\ntitle: PREREG-silac-v2 held-out ({runs[0]['group']}, {cls})\n"
                        f"use_case: held-out test of -label_format 2 (output/silac-067551/PREREG-silac-v2.md); frozen run list\n"
                        f"instrument: {cls}\nfetch: [{', '.join(q(x) for x in fetch)}]\n"
                        "roles: [['\\.d\\.zip$', run], ['\\.raw$', run], ['.', truth]]\n"
                        "runs: '\\.(raw|d\\.zip)$'\n")
        # Deviation D1 (after the freeze): the pinned FileConverter is refused by pxd (its tree sha256 changed), so
        # Orbitrap runs are read as .raw by the frozen binary (OpenMS Thermo bridge, vendor centroiding); on the
        # development control this gives the mzML path's label.tsv and tags.tsv byte for byte (input row aside).
        names = [r["file"] for r in runs]
        with open(os.path.join(hd, "benchmarks", "inputs", f"silac-heldout-v2-{pxd}.tsv"), "w") as f:
            f.write("file\n" + "".join(n + "\n" for n in names))
        role = "run"
        with open(os.path.join(hd, "benchmarks", f"silac-heldout-v2-{pxd}.yaml"), "w") as f:
            f.write(f"# PREREG-silac-v2 held-out run of {pxd} ({cls}): frozen binary {VERSION}, frozen command, run once.\n"
                    f"dataset: {pxd}\ninputs: {{list: inputs/silac-heldout-v2-{pxd}.tsv, column: file, role: {role}}}\n"
                    f"fastag: ['{VERSION}']\nparams:\n  heldout: [{', '.join(q(x) for x in CMD)}]\n")
    print(len(by), "data sets")

if __name__ == "__main__":
    main()
