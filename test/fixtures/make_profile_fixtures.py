#!/usr/bin/env python3
"""Write the profile-MS2 fixtures of FASTag 1.12 #9 (-pick_profile).

    make_profile_fixtures.py Ecoli_MS2_small.mzML out_dir

Each fixture turns spectra of the vendored Ecoli_MS2_small.mzML into PROFILE
data: every centroid (m/z, intensity) becomes a Gaussian whose apex is that
intensity at that m/z, sampled on a fixed lattice, with a zero-intensity point
either side of every run of samples, as Thermo profile spectra look. Picking
the profile with PeakPickerHiRes gives the source centroids back (within
about 1 ppm), so FASTag's tags on the picked spectra can be compared with its
tags on the source spectra (profile_cli_test).

profile_ms2_small.mzML      spectra 0-9 (10 MS2), resolving power 60,000
                            (FWHM = m/z / 60000), 6 samples per FWHM on a
                            log-m/z lattice; typed MS:1000128 in each
                            spectrum's own cvParams; orbitrap analyser.
profile_ms2_untyped.mzML    spectra 0-3 as above, with NEITHER MS:1000127 nor
                            MS:1000128 (FASTag reads them as type UNKNOWN).
profile_ms2_paramgroup.mzML spectra 0-3 as above, the type ONLY in a
                            referenceableParamGroup each spectrum references
                            (its MS level stays an own cvParam, which is how
                            FASTag's fast reader reads it).
profile_ms2_lowres.mzML     spectra 10-13, ion-trap-like: FWHM 0.3 Th, samples
                            every 0.05 Th; centroids closer than the FWHM merge
                            as they would on the instrument; linear ion trap
                            analyser in the instrumentConfiguration.

Every spectrum keeps the source's native ID, retention time, precursor (the
source's <precursorList> verbatim) and scan window. m/z is 64-bit, intensity
32-bit, both zlib-compressed (zlib level 9). indexedmzML with an exact offset
index and the SHA-1 fileChecksum.

Python standard library only. The committed bytes were written with the
Python and zlib versions recorded in fixtures/README.md; another zlib can
compress differently (same arrays, different bytes).
"""
from __future__ import annotations

import base64
import hashlib
import math
import re
import struct
import sys
import zlib
from pathlib import Path

CV = ('<cvList count="2">\n'
      '<cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" version="4.1.192" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>\n'
      '<cv id="UO" fullName="Unit Ontology" version="releases/2023-05-25" URI="https://raw.githubusercontent.com/bio-ontology-research-group/unit-ontology/master/uo.obo"/>\n'
      '</cvList>\n')

ORBITRAP = '<cvParam cvRef="MS" accession="MS:1000484" name="orbitrap" value=""/>'
LINEAR_TRAP = '<cvParam cvRef="MS" accession="MS:1000291" name="linear ion trap" value=""/>'
PROFILE = '<cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/>'


def cv(acc: str, name: str, value: str = "") -> str:
    return f'<cvParam cvRef="MS" accession="{acc}" name="{name}" value="{value}"/>\n'


def read_source(path: Path) -> list[dict]:
    """The source's spectra: native ID, RT (s), precursorList XML, scan window, peaks."""
    text = path.read_text(encoding="latin-1")
    out = []
    for m in re.finditer(r"<spectrum [^>]*>.*?</spectrum>", text, re.S):
        s = m.group(0)
        nid = re.search(r'<spectrum id="([^"]*)"', s).group(1)
        rt = float(re.search(r'name="scan start time" value="([^"]*)"', s).group(1))
        if 'unitName="minute"' in re.search(r'<cvParam[^>]*name="scan start time"[^>]*>', s).group(0):
            rt *= 60.0
        prec = re.search(r"<precursorList.*?</precursorList>", s, re.S).group(0)
        lo = re.search(r'name="scan window lower limit" value="([^"]*)"', s)
        hi = re.search(r'name="scan window upper limit" value="([^"]*)"', s)
        arrays = []
        for a in re.finditer(r"<binaryDataArray .*?</binaryDataArray>", s, re.S):
            body = a.group(0)
            raw = base64.b64decode(re.search(r"<binary>(.*?)</binary>", body, re.S).group(1))
            if "MS:1000574" in body:
                raw = zlib.decompress(raw)
            fmt = "d" if "MS:1000523" in body else "f"
            vals = list(struct.unpack("<%d%s" % (len(raw) // struct.calcsize(fmt), fmt), raw))
            arrays.append(("mz" if "MS:1000514" in body else "int", vals))
        mz = next(v for k, v in arrays if k == "mz")
        it = next(v for k, v in arrays if k == "int")
        out.append({"id": nid, "rt": rt, "prec": prec, "window": (lo.group(1), hi.group(1)) if lo and hi else None,
                    "mz": mz, "int": it})
    return out


def profile_log(mz: list[float], it: list[float], resolution: float, per_fwhm: int) -> tuple[list, list]:
    """Gaussians at constant resolving power on a log-m/z lattice."""
    step = 1.0 / (resolution * per_fwhm)  # ln(m/z) step: FWHM/per_fwhm
    sigma = (1.0 / resolution) / (2.0 * math.sqrt(2.0 * math.log(2.0)))  # in ln(m/z)
    span = int(math.ceil(1.5 * per_fwhm))  # +-1.5 FWHM
    acc: dict[int, float] = {}
    for x, h in zip(mz, it):
        if h <= 0:
            continue
        lx = math.log(x)
        k0 = int(round(lx / step))
        for k in range(k0 - span, k0 + span + 1):
            d = k * step - lx
            acc[k] = acc.get(k, 0.0) + h * math.exp(-0.5 * (d / sigma) ** 2)
    return lattice_out(acc, lambda k: math.exp(k * step))


def profile_lin(mz: list[float], it: list[float], fwhm: float, step: float) -> tuple[list, list]:
    """Gaussians of constant width on a linear lattice (ion trap)."""
    sigma = fwhm / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    span = int(math.ceil(1.5 * fwhm / step))
    acc: dict[int, float] = {}
    for x, h in zip(mz, it):
        if h <= 0:
            continue
        k0 = int(round(x / step))
        for k in range(k0 - span, k0 + span + 1):
            d = k * step - x
            acc[k] = acc.get(k, 0.0) + h * math.exp(-0.5 * (d / sigma) ** 2)
    return lattice_out(acc, lambda k: k * step)


def lattice_out(acc: dict[int, float], pos) -> tuple[list, list]:
    """Sorted samples with a zero either side of every contiguous run."""
    keys = set(acc)
    for k in list(acc):
        for n in (k - 1, k + 1):
            if n not in keys:
                acc[n] = 0.0
    ks = sorted(acc)
    return [pos(k) for k in ks], [acc[k] for k in ks]


def b64(vals: list[float], fmt: str) -> str:
    raw = struct.pack("<%d%s" % (len(vals), fmt), *vals)
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def arrays_xml(mz: list[float], it: list[float]) -> str:
    out = '<binaryDataArrayList count="2">\n'
    for kind, vals, fmt in (("mz", mz, "d"), ("int", it, "f")):
        enc = b64(vals, fmt)
        bits = cv("MS:1000523", "64-bit float") if fmt == "d" else cv("MS:1000521", "32-bit float")
        name = (cv("MS:1000514", "m/z array").replace('value=""/>', 'value="" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>')
                if kind == "mz" else
                cv("MS:1000515", "intensity array").replace('value=""/>', 'value="" unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"/>'))
        out += (f'<binaryDataArray encodedLength="{len(enc)}">\n{bits}{cv("MS:1000574", "zlib compression")}{name}'
                f"<binary>{enc}</binary>\n</binaryDataArray>\n")
    return out + "</binaryDataArrayList>\n"


def spectrum_xml(index: int, src: dict, mz: list, it: list, typing: str) -> str:
    """typing: 'own' (MS:1000128 own cvParam), 'none', or 'group'."""
    own = cv("MS:1000511", "ms level", "2") + cv("MS:1000580", "MSn spectrum")
    if typing == "own":
        own += PROFILE + "\n"
    elif typing == "group":
        own = '<referenceableParamGroupRef ref="pg_profile_ms2"/>\n' + own
    own += cv("MS:1000130", "positive scan")
    win = ""
    if src["window"]:
        win = ('<scanWindowList count="1">\n<scanWindow>\n'
               f'<cvParam cvRef="MS" accession="MS:1000501" name="scan window lower limit" value="{src["window"][0]}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               f'<cvParam cvRef="MS" accession="MS:1000500" name="scan window upper limit" value="{src["window"][1]}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               "</scanWindow>\n</scanWindowList>\n")
    scan = ('<scanList count="1">\n' + cv("MS:1000795", "no combination") + '<scan>\n'
            f'<cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{src["rt"]!r}" unitCvRef="UO" unitAccession="UO:0000010" unitName="second"/>\n'
            + win + "</scan>\n</scanList>\n")
    prec = "\n".join(line.strip() for line in src["prec"].splitlines()) + "\n"
    return (f'<spectrum index="{index}" id="{src["id"]}" defaultArrayLength="{len(mz)}">\n'
            + own + scan + prec + arrays_xml(mz, it) + "</spectrum>\n")


def write_indexed(path: Path, analyzer: str, typing: str, spectra: list[tuple[dict, list, list]]) -> None:
    groups = ""
    if typing == "group":
        groups = ('<referenceableParamGroupList count="1">\n<referenceableParamGroup id="pg_profile_ms2">\n'
                  + PROFILE + "\n</referenceableParamGroup>\n</referenceableParamGroupList>\n")
    content = cv("MS:1000580", "MSn spectrum")
    if typing != "none":
        content += PROFILE + "\n"
    head = ('<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">\n' + CV
            + "<fileDescription>\n<fileContent>\n" + content + "</fileContent>\n</fileDescription>\n" + groups
            + '<softwareList count="1">\n<software id="make_profile_fixtures" version="1">\n'
            + cv("MS:1000799", "custom unreleased software tool", "make_profile_fixtures.py")
            + "</software>\n</softwareList>\n"
            + '<instrumentConfigurationList count="1">\n<instrumentConfiguration id="ic_0">\n<componentList count="3">\n'
            + '<source order="1">\n' + cv("MS:1000398", "nanoelectrospray") + "</source>\n"
            + '<analyzer order="2">\n' + analyzer + "\n</analyzer>\n"
            + '<detector order="3">\n' + cv("MS:1000624", "inductive detector") + "</detector>\n"
            + "</componentList>\n</instrumentConfiguration>\n</instrumentConfigurationList>\n"
            + '<dataProcessingList count="1">\n<dataProcessing id="dp_0">\n'
            + '<processingMethod order="0" softwareRef="make_profile_fixtures">\n'
            + cv("MS:1000544", "Conversion to mzML") + "</processingMethod>\n</dataProcessing>\n</dataProcessingList>\n"
            + '<run id="run_0" defaultInstrumentConfigurationRef="ic_0">\n'
            + f'<spectrumList count="{len(spectra)}" defaultDataProcessingRef="dp_0">\n')
    pre = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<indexedmzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.2_idx.xsd">\n')
    out = bytearray((pre + head).encode())
    offsets = []
    for i, (src, mz, it) in enumerate(spectra):
        offsets.append((src["id"], len(out)))
        out += spectrum_xml(i, src, mz, it, typing).encode()
    out += b"</spectrumList>\n</run>\n</mzML>\n"
    index_offset = len(out)
    out += b'<indexList count="1">\n<index name="spectrum">\n'
    for nid, off in offsets:
        out += f'<offset idRef="{nid}">{off}</offset>\n'.encode()
    out += f"</index>\n</indexList>\n<indexListOffset>{index_offset}</indexListOffset>\n<fileChecksum>".encode()
    out += hashlib.sha1(bytes(out)).hexdigest().encode() + b"</fileChecksum>\n</indexedmzML>\n"
    path.write_bytes(bytes(out))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src = read_source(Path(sys.argv[1]))
    out = Path(sys.argv[2])
    hi = [(s, *profile_log(s["mz"], s["int"], 60000.0, 6)) for s in src[:10]]
    write_indexed(out / "profile_ms2_small.mzML", ORBITRAP, "own", hi)
    write_indexed(out / "profile_ms2_untyped.mzML", ORBITRAP, "none", hi[:4])
    write_indexed(out / "profile_ms2_paramgroup.mzML", ORBITRAP, "group", hi[:4])
    lo = [(s, *profile_lin(s["mz"], s["int"], 0.3, 0.05)) for s in src[10:14]]
    write_indexed(out / "profile_ms2_lowres.mzML", LINEAR_TRAP, "own", lo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
