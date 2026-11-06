#!/usr/bin/env python3
"""Write the acquisition-check fixtures of acquisition_test and acquisition_cli_test (1.12 item #7).

    make_acquisition_fixtures.py Ecoli_MS2_small.mzML out_dir

The peaks are those of the vendored Ecoli_MS2_small.mzML (its 25 most intense
peaks per spectrum, cycled), so FASTag finds tags in them; only the
acquisition layout around them is synthetic, after real files:

dia_like.mzML            raw Orbitrap DIA (msconvert-style, PXD006096-like): 20 windows of
                         25 Th over 400-900, the selected ion at the window target, no
                         charge, 6 cycles, one MS1 per cycle
astral_dia_like.mzML     Astral narrow-window DIA: 300 windows of 2 Th over 380-980, one
                         cycle and the first 30 windows of the next
diapasef_split_like.mzML diaPASEF converted frame by frame: 10 windows of 25 Th over
                         400-650, 4 consecutive MS2 per window (one per IM slice, 1/K0 on
                         the scan), 4 cycles
dia_shifted_target.mzML  raw DIA whose selected ion sits away from the window target
                         (every other window +8 Th) with asymmetric offsets (-3/+13):
                         the windows tile 400-720 only when read from the target
dia_pseudo_like.mzML     DIAspeXtract 1.7.0 output (PXD006096 pseudo.mzML-like): its
                         software entry, spx: run userParams and spx_* spectrum
                         userParams, a mono m/z with charge inside the DIA window
dia_pseudo_repeat_like.mzML  the same provenance on spectra whose m/z repeats with the
                         DIA cycle and carry no charge (raw DIA without the provenance)
prm_like.mzML            PRM: 8 scattered charged targets of 2 Th, 15 cycles
wwa_dda_like.mzML        wide-window DDA: 12 Th windows centred near (not on) a charged
                         mono m/z, MS1 every 10 MS2
dia_nowin_like.mgf       raw DIA as MGF: PEPMASS cycles through 20 window centres, no
                         CHARGE

Every mzML is an indexedmzML with an exact index. Needs pyteomics and numpy
(to read the source); deterministic (no randomness beyond a fixed seed).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from pyteomics import mzml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_converter_fixtures import CV, arrays, indexed  # noqa: E402

PEAKS = 25


def source_peaks(path: str):
    out = []
    with mzml.read(path, use_index=False) as r:
        for s in r:
            ion = s["precursorList"]["precursor"][0]["selectedIonList"]["selectedIon"][0]
            mz, it = np.asarray(s["m/z array"], float), np.asarray(s["intensity array"], float)
            keep = np.sort(np.argsort(-it, kind="stable")[:PEAKS])
            out.append((float(ion["selected ion m/z"]), int(ion["charge state"]), mz[keep], it[keep]))
    return out


def header(run: str, software: str = "", run_user: str = "", count: int = 0) -> str:
    sw = software or ('<softwareList count="1">\n<software id="pwiz" version="3.0.0">\n'
                      '<cvParam cvRef="MS" accession="MS:1000615" name="ProteoWizard software" value=""/>\n'
                      '</software>\n</softwareList>\n')
    swref = 'so_dp_sp_0_pm_0' if software else 'pwiz'
    return ('<mzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd" '
            f'id="{run}" version="1.1.0">\n' + CV +
            '<fileDescription>\n<fileContent>\n'
            '<cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>\n'
            '<cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n'
            '</fileContent>\n</fileDescription>\n' + sw +
            '<instrumentConfigurationList count="1">\n<instrumentConfiguration id="IC1">\n'
            '<cvParam cvRef="MS" accession="MS:1001911" name="Q Exactive" value=""/>\n'
            '</instrumentConfiguration>\n</instrumentConfigurationList>\n'
            '<dataProcessingList count="1">\n<dataProcessing id="dp">\n'
            f'<processingMethod order="0" softwareRef="{swref}">\n'
            '<cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" value=""/>\n'
            '</processingMethod>\n</dataProcessing>\n</dataProcessingList>\n'
            f'<run id="{run}" defaultInstrumentConfigurationRef="IC1">\n' + run_user +
            f'<spectrumList count="{count}" defaultDataProcessingRef="dp">\n')


def cvp(acc: str, name: str, value="", unit: str = "") -> str:
    u = {"mz": ' unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"',
         "min": ' unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"',
         "im": ' unitCvRef="MS" unitAccession="MS:1002814" unitName="volt-second per square centimeter"'}.get(unit, "")
    return f'<cvParam cvRef="MS" accession="{acc}" name="{name}" value="{value}"{u}/>\n'


def num(v: float) -> str:
    return repr(float(v))


def spectrum(index: int, level: int, rt_min: float, mz, it, prec=None, im=None, user: str = "") -> tuple[str, str]:
    sid = f"controllerType=0 controllerNumber=1 scan={index + 1}"
    xml = (f'<spectrum index="{index}" id="{sid}" defaultArrayLength="{len(mz)}">\n'
           + cvp("MS:1000511", "ms level", level) + cvp("MS:1000127", "centroid spectrum") + user
           + '<scanList count="1">\n<scan>\n'
           + cvp("MS:1000016", "scan start time", num(rt_min), "min")
           + (cvp("MS:1002815", "inverse reduced ion mobility", num(im), "im") if im is not None else "")
           + '</scan>\n</scanList>\n')
    if prec is not None:
        xml += ('<precursorList count="1">\n<precursor>\n<isolationWindow>\n'
                + cvp("MS:1000827", "isolation window target m/z", num(prec["target"]), "mz")
                + cvp("MS:1000828", "isolation window lower offset", num(prec["lower"]), "mz")
                + cvp("MS:1000829", "isolation window upper offset", num(prec["upper"]), "mz")
                + '</isolationWindow>\n<selectedIonList count="1">\n<selectedIon>\n'
                + cvp("MS:1000744", "selected ion m/z", num(prec["mz"]), "mz")
                + (cvp("MS:1000041", "charge state", prec["charge"]) if prec.get("charge") else "")
                + '</selectedIon>\n</selectedIonList>\n<activation>\n'
                + cvp("MS:1000422", "beam-type collision-induced dissociation")
                + '</activation>\n</precursor>\n</precursorList>\n')
    xml += arrays(mz, it, "<f4") + '</spectrum>\n'
    return sid, xml


class Run:
    def __init__(self, src):
        self.src, self.k, self.spectra, self.rt = src, 0, [], 0.0

    def peaks(self):
        s = self.src[self.k % len(self.src)]
        self.k += 1
        return s

    def ms1(self):
        _, _, mz, it = self.peaks()
        self.rt += 0.01
        self.spectra.append(spectrum(len(self.spectra), 1, self.rt, mz, np.full(len(mz), 1e5)))

    def ms2(self, prec, im=None, user=""):
        _, _, mz, it = self.peaks()
        self.rt += 0.01
        self.spectra.append(spectrum(len(self.spectra), 2, self.rt, mz, it, prec, im, user))

    def write(self, path: Path, run: str, software: str = "", run_user: str = ""):
        path.write_bytes(indexed(header(run, software, run_user, len(self.spectra)), self.spectra,
                                 '</spectrumList>\n</run>\n</mzML>\n'))


def window(lo, hi, mz=None, charge=None, target=None):
    t = 0.5 * (lo + hi) if target is None else target
    return {"target": t, "lower": t - lo, "upper": hi - t, "mz": t if mz is None else mz, "charge": charge}


W20 = [(400 + 25 * k, 425 + 25 * k) for k in range(20)]

SPX_SOFTWARE = ('<softwareList count="1">\n<software id="so_dp_sp_0_pm_0" version="1.7.0">\n'
                '<cvParam cvRef="MS" accession="MS:1000799" name="custom unreleased software tool" value="DIAspeXtract"/>\n'
                '</software>\n</softwareList>\n')
SPX_RUN = ('<userParam name="spx:twin_merge" type="xsd:string" value="off"/>\n'
           '<userParam name="spx:require_isotope_support" type="xsd:integer" value="1"/>\n')
SPX_SPEC = ('<userParam name="spx_guessed" type="xsd:integer" value="0"/>\n'
            '<userParam name="spx_n_isotopes" type="xsd:integer" value="2"/>\n')


def dia_like(src, out):
    r = Run(src)
    for _ in range(6):
        r.ms1()
        for lo, hi in W20:
            r.ms2(window(lo, hi))
    r.write(out / "dia_like.mzML", "dia_like")


def astral(src, out):
    # One full cycle and the first 30 windows of the next: 30 repeat gaps of
    # one cycle each, enough to judge, at half the size of two cycles.
    r = Run(src)
    for c in range(2):
        r.ms1()
        for k in range(300 if c == 0 else 30):
            r.ms2(window(380 + 2 * k, 382 + 2 * k))
    r.write(out / "astral_dia_like.mzML", "astral_dia_like")


def diapasef_split(src, out):
    r = Run(src)
    for _ in range(4):
        r.ms1()
        for k in range(10):
            for j in range(4):
                r.ms2(window(400 + 25 * k, 425 + 25 * k), im=0.7 + 0.05 * k + 0.01 * j)
    r.write(out / "diapasef_split_like.mzML", "diapasef_split_like")


def shifted(src, out):
    r = Run(src)
    for _ in range(6):
        r.ms1()
        for k in range(20):
            t = 403 + 16 * k
            r.ms2({"target": t, "lower": 3.0, "upper": 13.0, "mz": t + (8 if k % 2 else 0), "charge": None})
    r.write(out / "dia_shifted_target.mzML", "dia_shifted_target")


def pseudo(src, out):
    r = Run(src)
    for k in range(120):
        pmz, z, _, _ = src[k % len(src)]
        lo = 400 + 25 * int((pmz - 400) // 25) if pmz >= 400 else pmz - 12.5
        r.ms2(window(lo, lo + 25, mz=pmz, charge=z, target=pmz), user=SPX_SPEC)
    r.write(out / "dia_pseudo_like.mzML", "dia_pseudo_like", SPX_SOFTWARE, SPX_RUN)
    r = Run(src)
    for _ in range(6):
        for lo, hi in W20:
            r.ms2(window(lo, hi), user=SPX_SPEC)
    r.write(out / "dia_pseudo_repeat_like.mzML", "dia_pseudo_repeat_like", SPX_SOFTWARE, SPX_RUN)


def prm(src, out):
    r = Run(src)
    targets = [432.2, 518.7, 603.3, 677.8, 745.4, 812.9, 901.5, 1022.1]
    for _ in range(15):
        r.ms1()
        for k, t in enumerate(targets):
            r.ms2(window(t - 1, t + 1, charge=2 + k % 2))
    r.write(out / "prm_like.mzML", "prm_like")


def wwa(src, out):
    r = Run(src)
    rng = np.random.default_rng(16)
    for k in range(120):
        if k % 10 == 0:
            r.ms1()
        pmz, z, _, _ = src[k % len(src)]
        t = pmz + float(rng.uniform(-3, 3))
        r.ms2(window(t - 6, t + 6, mz=pmz, charge=z, target=t))
    r.write(out / "wwa_dda_like.mzML", "wwa_dda_like")


def mgf(src, out):
    lines = []
    k = 0
    for c in range(6):
        for lo, hi in W20:
            _, _, mz, it = src[k % len(src)]
            k += 1
            lines += ["BEGIN IONS", f"TITLE=dia_nowin.{k}.{k}.", f"RTINSECONDS={0.6 * k!r}",
                      f"PEPMASS={0.5 * (lo + hi)!r}"]
            lines += [f"{float(m)!r} {float(i)!r}" for m, i in zip(mz, it)]
            lines += ["END IONS", ""]
    (out / "dia_nowin_like.mgf").write_text("\n".join(lines))


def main() -> None:
    src_path, out = sys.argv[1], Path(sys.argv[2])
    src = source_peaks(src_path)
    for f in (dia_like, astral, diapasef_split, shifted, pseudo, prm, wwa, mgf):
        f(src, out)


if __name__ == "__main__":
    main()
