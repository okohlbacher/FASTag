"""Per-run ground truth for the digest, label and alkylation reports, taken from public SDRF files.

Truth comes only from SDRF columns: comment[cleavage agent details] (enzyme), comment[label] and
label modifications in comment[modification parameters] (label), and the fixed cysteine
modification in comment[modification parameters] or comment[alkylation reagent] (alkylation).
File names are never used as truth.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

from .score import expected_protease

RAW_EXT = re.compile(r"\.(raw|mzml|mzxml|mgf|wiff2?|d|zip|gz|tar|tdf|mzpeak|baf|yep|lcd|dia)$", re.I)


def run_stem(name: str) -> str:
    """File name without directories and without (repeated) instrument/archive extensions."""
    s = Path(str(name).replace("\\", "/")).name
    while True:
        t = RAW_EXT.sub("", s)
        if t == s:
            return s
        s = t


def kv(cell: str) -> dict[str, str]:
    """Parse an SDRF key=value cell ('NT=Trypsin;AC=MS:1001251'); a bare value becomes NT."""
    out = {}
    for part in str(cell).split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().upper()] = v.strip()
    if not out and str(cell).strip():
        out["NT"] = str(cell).strip()
    return out


_MISSING = {"", "not available", "not applicable", "na", "n/a", "none", "not specified"}


def read_sdrf(path: str | Path) -> tuple[list[str], list[list[str]]]:
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        rows = [r for r in csv.reader(fh, delimiter="\t") if any(c.strip() for c in r)]
    return [h.strip().lower() for h in rows[0]], rows[1:]


def rows_for_run(head: list[str], rows: list[list[str]], run: str) -> list[list[str]]:
    """Rows whose comment[data file] stem equals the run (exact, then case-insensitive)."""
    files = [i for i, h in enumerate(head) if h == "comment[data file]"]
    stems = [(r, [run_stem(r[i]) for i in files if i < len(r)]) for r in rows]
    hit = [r for r, s in stems if run in s]
    if not hit:
        hit = [r for r, s in stems if run.lower() in (x.lower() for x in s)]
    return hit


def _col(head, rows, name) -> list[str]:
    vals = []
    for r in rows:
        for i, h in enumerate(head):
            if h == name and i < len(r) and r[i].strip().lower() not in _MISSING:
                vals.append(r[i].strip())
    return vals


_ENZ_SYN = {
    "glutamyl endopeptidase": "Glu-C", "glu-c/de": "Glu-C", "v8": "Glu-C", "endoproteinase glu-c": "Glu-C",
    "endoproteinase asp-n": "Asp-N", "endoproteinase lys-c": "Lys-C", "lysyl endopeptidase": "Lys-C",
    "endoproteinase arg-c": "Arg-C", "clostripain": "Arg-C", "arg-c proteinase": "Arg-C",
    "chymotrypsin high specificity": "Chymotrypsin", "chymotrypsin low specificity": "Chymotrypsin",
    "elastase": "unspecific", "leukocyte elastase": "unspecific", "neutrophil elastase": "unspecific",
    "proteinase k": "unspecific", "no enzyme": "unspecific",
    "pepsin": "unspecific", "pepsina": "unspecific",
}


def enzyme_names(cells: list[str]) -> list[str]:
    """NT names of the cleavage agents, split on ',' and mapped to the names expected_protease knows."""
    out = set()
    for c in cells:
        for n in re.split(r",|\band\b|\+", kv(c).get("NT", "")):
            n = n.strip()
            if n:
                out.add(_ENZ_SYN.get(n.lower(), n))
    return sorted(out)


def enzyme_truth(cells: list[str]) -> str | None:
    names = enzyme_names(cells)
    return expected_protease(names) if names else None


def label_truth(labels: list[str], mods: list[str]) -> str | None:
    """Label class: TMTpro, TMT, iTRAQ8, iTRAQ4, SILAC, dimethyl, label-free (None when no label column)."""
    lab = " ".join(kv(c).get("NT", c) for c in labels).lower()
    names = [kv(c).get("NT", "").lower() for c in mods]
    modtext = " ".join(names)
    if ("tmtpro" in lab or "tmtpro" in modtext or re.search(r"tmt ?1[68] ?-?plex", lab)
            or re.search(r"tmt13[2-5]", lab.replace(" ", ""))):
        return "TMTpro"
    if "tmt" in lab or "tmt6plex" in modtext or "tmt10plex" in modtext or re.search(r"\btmt\b", modtext):
        return "TMT"
    if "itraq8" in modtext or re.search(r"itraq11[3-9]|itraq121", lab.replace(" ", "")) and "itraq4" not in modtext:
        return "iTRAQ8"
    if "itraq" in lab or "itraq4" in modtext:
        return "iTRAQ4"
    if "silac" in lab or re.search(r"label:13c|label:2h|label:15n", modtext):
        return "SILAC"
    if "dimethyl" in modtext and ("dimethyl" in lab or "dimethyl:2h" in modtext):
        return "dimethyl"
    if not labels:
        return None
    if "isotope label" in lab:
        return "isotope (unspecified)"
    if "label free" in lab or "label-free" in lab or "unlabeled" in lab:
        return "label-free"
    return "other:" + lab[:40]


_ALK_MOD = {
    "carbamidomethyl": "Carbamidomethyl", "propionamide": "Propionamide", "nethylmaleimide": "Nethylmaleimide",
    "n-ethylmaleimide": "Nethylmaleimide", "methylthio": "Methylthio", "carboxymethyl": "Carboxymethyl",
    "pyridylethyl": "Pyridylethyl", "beta-methylthiolation": "Methylthio",
}
_ALK_REAGENT = {
    "iodoacetamide": "Carbamidomethyl", "iaa": "Carbamidomethyl", "chloroacetamide": "Carbamidomethyl",
    "caa": "Carbamidomethyl", "acrylamide": "Propionamide", "n-ethylmaleimide": "Nethylmaleimide",
    "nem": "Nethylmaleimide", "mmts": "Methylthio", "methyl methanethiosulfonate": "Methylthio",
    "iodoacetic acid": "Carboxymethyl", "4-vinylpyridine": "Pyridylethyl",
}


def alkylation_truth(mods: list[str], reagents: list[str]) -> tuple[str | None, str]:
    """(class, basis). Class from a cysteine modification (fixed preferred), else the reagent column.
    'none' when the SDRF lists modifications but none on C and no reagent; None when nothing is stated."""
    fixed, var = set(), set()
    for c in mods:
        d = kv(c)
        nt = d.get("NT", "").lower().replace(" ", "")
        cls = next((v for k, v in _ALK_MOD.items() if nt.startswith(k.replace(" ", ""))), None)
        if cls and ("C" in d.get("TA", "").upper().split(",") or not d.get("TA")):
            (fixed if d.get("MT", "fixed").lower() == "fixed" else var).add(cls)
    if len(fixed) == 1:
        return fixed.pop(), "fixed mod"
    if len(fixed) > 1:
        return "mixed:" + "+".join(sorted(fixed)), "fixed mod"
    for c in reagents:
        nt = kv(c).get("NT", c).lower()
        for k, v in _ALK_REAGENT.items():
            if re.search(rf"\b{re.escape(k)}\b", nt):
                return v, "reagent"
    if len(var) == 1:
        return var.pop(), "variable mod"
    if mods:
        return "none", "no C mod"
    return None, "no mod columns"


def truth_for_run(path: str | Path, run: str) -> dict:
    head, rows = read_sdrf(path)
    hit = rows_for_run(head, rows, run)
    if not hit:
        return {"matched_rows": 0}
    enz = _col(head, hit, "comment[cleavage agent details]")
    lab = _col(head, hit, "comment[label]")
    mods = _col(head, hit, "comment[modification parameters]")
    reag = _col(head, hit, "comment[alkylation reagent]")
    tool = sorted(set(_col(head, hit, "comment[sdrf annotation tool]")))
    alk, basis = alkylation_truth(mods, reag)
    return {
        "matched_rows": len(hit),
        "enzyme_sdrf": ";".join(sorted({kv(c).get("NT", c) for c in enz})),
        "enzyme_truth": enzyme_truth(enz),
        "label_sdrf": ";".join(sorted({kv(c).get("NT", c) for c in lab})),
        "label_truth": label_truth(lab, mods),
        "mods_sdrf": ";".join(sorted({kv(c).get("NT", "") + "@" + kv(c).get("TA", kv(c).get("PP", "")) + "/"
                                      + kv(c).get("MT", "") for c in mods})),
        "alk_truth": alk, "alk_basis": basis,
        "annotation_tool": ";".join(tool),
    }


FIELDS = ("enzyme_truth", "label_truth", "alk_truth")


def project_truth(path: str | Path) -> dict:
    """Truth shared by every row of an SDRF (a field is None when the rows disagree)."""
    head, rows = read_sdrf(path)
    files = [i for i, h in enumerate(head) if h == "comment[data file]"]
    runs = sorted({run_stem(r[i]) for r in rows for i in files if i < len(r) and r[i].strip()})
    per = [truth_for_run(path, x) for x in runs]
    out = {"matched_rows": 0, "n_runs_in_sdrf": len(runs)}
    for f in FIELDS + ("enzyme_sdrf", "label_sdrf", "mods_sdrf", "alk_basis", "annotation_tool"):
        vals = {p.get(f) for p in per if p.get("matched_rows")}
        out[f] = vals.pop() if len(vals) == 1 else None
    return out


def resolve(run: str, sources: list[tuple[str, str, str]]) -> dict:
    """Pick the truth for one run from candidate SDRFs, in priority order.

    sources: [(kind, local path, public URL)], highest priority first (submitter before community).
    A row match in any source beats a project-uniform value; the result records kind, URL and level.
    """
    for kind, path, url in sources:
        t = truth_for_run(path, run)
        if t["matched_rows"]:
            return dict(t, sdrf_kind=kind, sdrf_url=url, match="run")
    for kind, path, url in sources:
        t = project_truth(path)
        if any(t.get(f) for f in FIELDS):
            return dict(t, sdrf_kind=kind, sdrf_url=url, match="project-uniform")
    return {"matched_rows": 0, "sdrf_kind": "none", "sdrf_url": "", "match": "no SDRF" if not sources else "no row"}
