"""Held-out run list for PREREG-silac-v2 from PRIDE file metadata only (names, sizes, categories, MD5).

Usage: python3 -I select_runs.py FILES_DIR OUT_TSV
FILES_DIR holds <PXD>.json = https://www.ebi.ac.uk/pride/ws/archive/v3/projects/<PXD>/files/all (fetched 2026-11-26).
Rule (PREREG section 3.2, as frozen): per PXD and instrument class, the RAW-category files of the class's format
(.raw for Orbitrap; .d.zip for timsTOF: PXD046777, deposited as plain .zip that FASTag does not read, is out), minus names with a DIA token, minus the
project restriction below; sorted by name; up to 6 taken at indices round(i*(n-1)/5), i = 0..5 (all when n <= 6).
Search files: the deposited files that hold the per-run search (listed per PXD below), for the truth step.
"""
import json, os, re, sys

SILAC = {  # PXD: (class, format regex, extra name filter or None, search-file regex)
    # Orbitrap HCD
    "PXD042191": ("orbitrap", r"\.raw$", None, r"^search\.tar$"),
    "PXD046238": ("orbitrap", r"\.raw$", None, r"\.zip$"),
    "PXD047063": ("orbitrap", r"\.raw$", None, r"^(txt\.zip|experimentalDesign_details\.txt)$"),
    "PXD054505": ("orbitrap", r"\.raw$", None, r"^MQSearch_.*\.zip$"),
    "PXD061306": ("orbitrap", r"\.raw$", None, r"^(evidence\.txt|mqpar\.xml|parameters\.txt|summary\.txt)$"),
    "PXD061384": ("orbitrap", r"\.raw$", None, r"^(evidence\.txt|mqpar\.xml|parameters\.txt|summary\.txt)$"),
    "PXD064721": ("orbitrap", r"\.raw$", None, r"-pSILAC\.7z$"),
    "PXD065282": ("orbitrap", r"\.raw$", None, r"^MaxQuant_Output_DDA_inVitro_Cells\.zip$"),
    "PXD065290": ("orbitrap", r"\.raw$", None, r"(evidence|parameters)\.txt$"),
    "PXD066221": ("orbitrap", r"\.raw$", r"^SILAC_", r"^SILAC_(TP|ssABE)\.zip$"),
    "PXD066863": ("orbitrap", r"\.raw$", None, r"^txt\.zip$"),
    # timsTOF
    "PXD031924": ("timstof", r"\.d\.zip$", None, r"\.mzid\.gz$"),
    "PXD039806": ("timstof", r"\.d\.zip$", None, r"(_peptide\.tsv|_psm\.tsv|label_quant\.tsv|fragger\.params|\.config)$"),
    "PXD048421": ("timstof", r"\.d\.zip$", None, r"(\.pep\.xml|\.xlsx)$"),
    "PXD056725": ("timstof", r"\.d\.zip$", None, r"^txt_exp\d+\.zip$"),
    "PXD079824": ("timstof", r"_DDA_.*\.d\.zip$", None, r"^(FragPipe_Proteome|MaxQuant_PM)\.zip$"),
}
LABEL_FREE = {  # light-only by design (T2): first three eligible label-free DDA projects per class, newest first
    "PXD079678": ("timstof", r"\.d\.zip$", None, None),
    "PXD079349": ("timstof", r"\.d\.zip$", None, None),
    "PXD079138": ("timstof", r"\.d\.zip$", None, None),
    "PXD087114": ("orbitrap", r"\.raw$", None, None),
    "PXD087065": ("orbitrap", r"\.raw$", None, None),
    "PXD086085": ("orbitrap", r"\.raw$", None, None),
}


def pick(names):
    n = len(names)
    if n <= 6: return list(names)
    idx = sorted({round(i * (n - 1) / 5) for i in range(6)})
    return [names[i] for i in idx]


def main():
    fd, out = sys.argv[1:3]
    rows = []
    for group, table in (("silac", SILAC), ("label-free", LABEL_FREE)):
        for pxd, (cls, fmt, extra, srch) in table.items():
            files = json.load(open(os.path.join(fd, pxd + ".json")))
            cat = lambda x: (x.get("fileCategory") or {}).get("value", "")
            md5 = lambda x: x.get("checksum") or ""
            raw = sorted((x for x in files if cat(x) == "RAW" and re.search(fmt, x["fileName"])
                          and not re.search(r"(^|[_\-.])DIA([_\-.]|$)", x["fileName"])
                          and (extra is None or re.search(extra, x["fileName"]))), key=lambda x: x["fileName"])
            by = {x["fileName"]: x for x in raw}
            for nm in pick([x["fileName"] for x in raw]):
                x = by[nm]
                rows.append(dict(pxd=pxd, group=group, instrument_class=cls, role="run", file=nm,
                                 size=x.get("fileSizeBytes", 0), md5=md5(x), eligible=len(raw)))
            if srch:
                for x in sorted(files, key=lambda x: x["fileName"]):
                    if cat(x) != "RAW" and re.search(srch, x["fileName"]):
                        rows.append(dict(pxd=pxd, group=group, instrument_class=cls, role="search", file=x["fileName"],
                                         size=x.get("fileSizeBytes", 0), md5=md5(x), eligible=""))
    keys = ["pxd", "group", "instrument_class", "role", "file", "size", "md5", "eligible"]
    with open(out, "w") as f:
        f.write("\t".join(keys) + "\n")
        for r in rows: f.write("\t".join(str(r[k]) for k in keys) + "\n")
    runs = [r for r in rows if r["role"] == "run"]
    print(f"{len(runs)} runs, {sum(r['size'] for r in runs)/1e9:.1f} GB; "
          f"{len(rows)-len(runs)} search files, {sum(r['size'] for r in rows if r['role']=='search')/1e9:.1f} GB")
    for c in ("orbitrap", "timstof"):
        for g in ("silac", "label-free"):
            print(c, g, sum(1 for r in runs if r["instrument_class"] == c and r["group"] == g))


if __name__ == "__main__":
    main()
