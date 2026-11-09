#!/usr/bin/env python3
"""E15B-04 DEV z definition check (PXD060724), independent of MSFragger's annotation.
For each run: the 1% FDR target PSMs of msfragger_<search>.tsv (score_item15B.fragger_psms: rank 1, target-decoy
q on expectscore, rev_), their spectra from the staged mzML (stdlib reader), and the theoretical z ions under three
definitions (pyteomics std_aa_mass + modification_info deltas):
  z (even-electron, y - NH3)  = sum + 1.991292 (1+);  z-dot (z+1, OpenMS Zp1) = sum + 2.999117;  z' (z+2) = sum + 4.006942
(fragment charges 1 and, for precursor charge >= 3, 2). Reported per definition: fraction of theoretical ions with
a peak within 20 ppm; and, for z-dot, the error (observed - theoretical, Da) of the most intense peak within
+-0.6 Da of each theoretical ion whose window holds a peak, median over ions, and the median over ions matched at
20 ppm. Also c ions (sum + NH3 + H+, 18.033826) as a positive control.
FASTag: the DEV-cz arm's rank-1 tags on the same PSMs, placed by acclib.rank1_correct (score.py flank rule,
REVERSED_OFFSET per ion_series) with REVERSED_OFFSET cz as shipped, and (contrast) with the z-even offset.
Usage: zcheck.py <repo mirror> <staged mzML dir> <truth run root> <runs root> <out tsv> <search> [<search> ...]"""
import sys, re, json
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(sys.argv[1]) / "acceptance/1.12/scorers"))
import acclib as A
import score_item15B as Z
from pyteomics import mass
import base64, zlib
import xml.etree.ElementTree as ET

def spectra(path):
    """Minimal mzML reader (stdlib): yields dict(id, m/z array, intensity array) per spectrum."""
    ns = "{http://psi.hupo.org/ms/mzml}"
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag != ns + "spectrum":
            continue
        arr = {}
        for b in el.iter(ns + "binaryDataArray"):
            acc = {c.get("accession") for c in b.iter(ns + "cvParam")}
            raw = base64.b64decode(b.find(ns + "binary").text or "")
            if "MS:1000574" in acc: raw = zlib.decompress(raw)
            a = np.frombuffer(raw, dtype=np.float64 if "MS:1000523" in acc else np.float32).astype(float)
            arr["m/z array" if "MS:1000514" in acc else "intensity array" if "MS:1000515" in acc else "other"] = a
        yield {"id": el.get("id"), **arr}
        el.clear()

repo, staged, troot, rroot, out = map(Path, sys.argv[1:6]); searches = sys.argv[6:]
P = 1.007276467; H = 1.00782503; NH3 = 17.02654910; H2O = 18.01056468
DEF = {"z": H2O - NH3 + P, "zdot": H2O - NH3 + H + P, "zprime": H2O - NH3 + 2 * H + P}
CION = NH3 + P
AA = mass.std_aa_mass
MOD = Z.MOD

def residues(pep, mods):
    r = [AA[a] for a in pep]
    for pos, _aa, m in MOD.findall(mods or ""):
        if pos == "N-term": r[0] += float(m)
        elif pos == "C-term": r[-1] += float(m)
        else: r[int(pos) - 1] += float(m)
    return np.array(r)

rows = []
orig = dict(A.S.REVERSED_OFFSET)
for run in sorted(p for p in troot.iterdir() if p.is_dir()):
    stem = run.name
    for s in searches:
        f = run / f"msfragger_{s}.tsv"
        if not f.exists(): continue
        raw = A.pd.read_csv(f, sep="\t", dtype={"peptide": str, "modification_info": str, "protein": str}, keep_default_na=False)
        if "protein" not in raw.columns and "proteins" in raw.columns:  # MSFragger 4.4.1 writes 'proteins'
            tmp = out.parent / f"tmp.{stem}.{s}.tsv"; raw.rename(columns={"proteins": "protein"}).to_csv(tmp, sep="\t", index=False)
            psm = Z.fragger_psms(tmp); tmp.unlink()
        else:
            psm = Z.fragger_psms(f)
        keep = set(psm["key"])
        raw = raw[raw["scannum"].map(lambda x: f"scan={int(x)}").isin(keep)].drop_duplicates("scannum")
        fr = raw["fragments"] if "fragments" in raw.columns else [""] * len(raw)
        want = {int(x): (p, m, int(c), g) for x, p, m, c, g in zip(raw["scannum"], raw["peptide"], raw["modification_info"], raw["charge"], fr)}
        hit = {k: [0, 0] for k in list(DEF) + ["c"]}; err_w, err_m, err_c, ppm_z = [], [], [], []
        fhit = {k: [0, 0] for k in DEF}
        if True:
            for sp in spectra(str(staged / f"{stem}.mzML")):
                m = re.search(r"scan=(\d+)", sp["id"]); sc = int(m.group(1))
                if sc not in want: continue
                pep, mods, ch, frag = want[sc]
                mz, it = sp["m/z array"], sp["intensity array"]
                o = np.argsort(mz); mz, it = mz[o], it[o]
                r = residues(pep, mods)
                suf = np.cumsum(r[::-1])[:-1]; pre = np.cumsum(r)[:-1]
                def near(t):
                    j = np.searchsorted(mz, t)
                    return min((mz[k] - t for k in (j - 1, j) if 0 <= k < len(mz)), key=abs, default=9.0)
                # MSFragger's own matched C-terminal fragments (cterm<n>^<z>): which z definition has a peak there
                for tok in (frag or "").split(";"):
                    mm = re.fullmatch(r"cterm(\d+)\^(\d+)", tok.strip())
                    if not mm: continue
                    n_, fz_ = int(mm.group(1)), int(mm.group(2))
                    for name, off in DEF.items():
                        t = (suf[n_ - 1] + off + (fz_ - 1) * P) / fz_
                        fhit[name][1] += 1; fhit[name][0] += abs(near(t)) <= t * 20e-6
                for fz in ([1, 2] if ch >= 3 else [1]):
                    for name, off in list(DEF.items()) + [("c", CION)]:
                        base = pre if name == "c" else suf
                        th = (base + off + (fz - 1) * P) / fz
                        i = np.searchsorted(mz, th)
                        for t, j in zip(th, i):
                            best = min((abs(mz[k] - t) for k in (j - 1, j) if 0 <= k < len(mz)), default=9)
                            hit[name][1] += 1; hit[name][0] += best <= t * 20e-6
                            if name == "c" and best <= t * 20e-6: err_c.append(near(t))
                            if name == "zdot":
                                lo, hi = np.searchsorted(mz, t - 0.6), np.searchsorted(mz, t + 0.6)
                                if hi > lo:
                                    k = lo + int(np.argmax(it[lo:hi])); err_w.append(mz[k] - t)
                                if best <= t * 20e-6:
                                    e = near(t); err_m.append(e); ppm_z.append(e / t * 1e6)
        tags = rroot / "DEV-15B-cz" / "dev15B-PXD060724" / "dev/PXD060724" / stem / "RC" / "tags.tsv"
        base = rroot / "CFG-15B-base" / "dev15B-PXD060724" / "dev/PXD060724" / stem / "RC" / "tags.tsv"
        A.S.REVERSED_OFFSET.update(orig); ok_cz = A.rank1_correct(tags, psm)
        A.S.REVERSED_OFFSET["cz"] = orig["cz"] - H; ok_even = A.rank1_correct(tags, psm)
        A.S.REVERSED_OFFSET.update(orig); ok_by = A.rank1_correct(base, psm)
        t = A.P.read_fastag_tags(tags); t1 = t[t["rank"] == 1]
        ser = t1[t1["key"].isin(keep)]["ion_series"].value_counts().to_dict() if "ion_series" in t1.columns else {}
        n = len(psm)
        rows.append({"run": stem, "search": s, "psms_1pct": n,
                     **{f"frac20ppm_{k}": round(v[0] / max(v[1], 1), 4) for k, v in hit.items()},
                     "zdot_median_err_window0.6": round(float(np.median(err_w)), 5) if err_w else "",
                     "zdot_median_err_matched": round(float(np.median(err_m)), 5) if err_m else "", "zdot_matched": len(err_m),
                     "zdot_median_ppm_matched": round(float(np.median(ppm_z)), 2) if ppm_z else "",
                     "c_median_err_matched": round(float(np.median(err_c)), 5) if err_c else "",
                     **{f"fragger_cterm_frac20ppm_{k}": (round(v[0] / v[1], 4) if v[1] else "") for k, v in fhit.items()},
                     "fragger_cterm_n": fhit["zdot"][1],
                     "zdot_frac_window_within0.01": round(float(np.mean(np.abs(err_w) <= 0.01)), 4) if err_w else "",
                     "fastag_cz_rank1_series": json.dumps(ser),
                     "fastag_cz_correct": sum(ok_cz.values()), "fastag_cz_frac": round(sum(ok_cz.values()) / max(n, 1), 4),
                     "fastag_cz_correct_zeven_offset": sum(ok_even.values()),
                     "fastag_by_correct": sum(ok_by.values()), "fastag_by_frac": round(sum(ok_by.values()) / max(n, 1), 4)})
        print(json.dumps(rows[-1]), flush=True)
        np.savez(out.parent / f"err.{stem}.{s}.npz", window=np.array(err_w), matched=np.array(err_m), c=np.array(err_c), ppm=np.array(ppm_z),
                 fhit=np.array([[fhit[k][0], fhit[k][1]] for k in DEF]), hit=np.array([[hit[k][0], hit[k][1]] for k in list(DEF) + ["c"]]),
                 fastag=np.array([n, sum(ok_cz.values()), sum(ok_even.values()), sum(ok_by.values())]))
A.write_rows(out, rows, list(rows[0]))
