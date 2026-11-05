#!/usr/bin/env python3
"""Write the two timsTOF-shaped mzML fixtures of mzml_to_mgf_test.

    make_converter_fixtures.py Ecoli_MS2_small.mzML out_dir

The peaks are those of the vendored Ecoli_MS2_small.mzML (so FASTag finds
tags in them); only the mzML around them is reshaped, after real files:

diatracer_like.mzML, after diaTracer 2.2.1 output (PXD047793 runs):
  - every spectrum MS2, native ID frame=<n> while the source file claims the
    Thermo nativeID format; a detector cvParam with accession="UNKNOWN"
  - the precursor m/z ONLY as `isolation window target m/z` (MS:1000827),
    with offsets; the selectedIon holds charge state and peak intensity but
    no `selected ion m/z`; an empty <activation/>
  - `spectrum title`, scan start time in minutes, `inverse reduced ion
    mobility` on the scan, a scan window, 64-bit zlib m/z and intensity
  - indexedmzML with an exact index

ddapasef_empty.mzML, after msconvert-style ddaPASEF output (PXD054073-like):
  - MS1 frames between the MS2, native IDs merged=<k> frame=<f> scanStart=..
    scanEnd=..; selected ion m/z, charge and ion mobility on the precursor
  - MS2 without peaks written three ways: zlib arrays of length 0 with an
    empty <binary/>, uncompressed arrays of length 0, and
    <binaryDataArrayList count="0"/>
  - one MS2 whose precursor has no m/z at all, one MS2 with no precursorList
  - precursors FASTag's mzML reader does not count as one: one MS2 whose
    <precursor> has only isolation window offsets and an empty <activation/>
    (no selectedIonList), one whose only target is 0, and one whose first
    <precursor> is such and whose second carries the selected ion
  - 64-bit m/z and 32-bit intensity, zlib; indexedmzML with an exact index

Needs pyteomics and numpy (to read the source).
"""
from __future__ import annotations

import base64
import sys
import zlib
from pathlib import Path

import numpy as np
from pyteomics import mzml

CV = ('<cvList count="2">\n'
      '<cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" version="4.1.192" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>\n'
      '<cv id="UO" fullName="Unit Ontology" version="releases/2023-05-25" URI="https://raw.githubusercontent.com/bio-ontology-research-group/unit-ontology/master/uo.obo"/>\n'
      '</cvList>\n')


def b64(a: np.ndarray, dtype: str, compress: bool = True) -> str:
    raw = np.asarray(a, dtype=dtype).tobytes()
    return base64.b64encode(zlib.compress(raw) if compress else raw).decode("ascii")


def array(kind: str, values, dtype: str, compress: bool = True) -> str:
    acc, name = {"mz": ("MS:1000514", "m/z array"), "int": ("MS:1000515", "intensity array")}[kind]
    unit = ('unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"' if kind == "mz" else
            'unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"')
    bits = ('<cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>' if dtype == "<f8" else
            '<cvParam cvRef="MS" accession="MS:1000521" name="32-bit float" value=""/>')
    comp = ('<cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>' if compress else
            '<cvParam cvRef="MS" accession="MS:1000576" name="no compression" value=""/>')
    enc = b64(values, dtype, compress) if len(values) else ""
    binary = f"<binary>{enc}</binary>" if enc else "<binary/>"
    return (f'<binaryDataArray encodedLength="{len(enc)}">\n{bits}\n{comp}\n'
            f'<cvParam cvRef="MS" accession="{acc}" name="{name}" value="" {unit}/>\n{binary}\n</binaryDataArray>\n')


def arrays(mz, it, int_dtype: str, compress: bool = True) -> str:
    return ('<binaryDataArrayList count="2">\n' + array("mz", mz, "<f8", compress)
            + array("int", it, int_dtype, compress) + '</binaryDataArrayList>\n')


def indexed(head: str, spectra: list[tuple[str, str]], tail: str) -> bytes:
    """indexedmzML around head + spectra + tail, with an exact offset index."""
    pre = ("<?xml version='1.0' encoding='UTF-8'?>\n"
           '<indexedmzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.2_idx.xsd">\n')
    out = bytearray((pre + head).encode())
    offsets = []
    for sid, xml in spectra:
        offsets.append((sid, len(out)))
        out += xml.encode()
    out += tail.encode()
    index_at = len(out)
    out += b'<indexList count="1">\n<index name="spectrum">\n'
    for sid, off in offsets:
        out += f'<offset idRef="{sid}">{off}</offset>\n'.encode()
    out += f'</index>\n</indexList>\n<indexListOffset>{index_at}</indexListOffset>\n</indexedmzML>\n'.encode()
    return bytes(out)


def source_spectra(path: str):
    with mzml.read(path, use_index=False) as r:
        for s in r:
            ion = s["precursorList"]["precursor"][0]["selectedIonList"]["selectedIon"][0]
            yield (float(ion["selected ion m/z"]), int(ion["charge state"]),
                   float(s["scanList"]["scan"][0]["scan start time"]),  # seconds in the source
                   s["m/z array"], s["intensity array"])


def diatracer(src: list) -> bytes:
    run = "4223_TIMS2_000_synthetic.d"
    head = ('<mzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            f'id="{run}" xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd">\n'
            + CV +
            '<fileDescription>\n<fileContent>\n'
            '<cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>\n'
            '<cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n'
            '</fileContent>\n<sourceFileList count="1">\n'
            f'<sourceFile id="{run}" name="{run}" location="/data/synthetic">\n'
            '<cvParam cvRef="MS" accession="MS:1000768" name="Thermo nativeID format" value=""/>\n'
            '</sourceFile>\n</sourceFileList>\n</fileDescription>\n'
            '<referenceableParamGroupList count="1">\n<referenceableParamGroup id="CommonInstrumentParams">\n'
            '<cvParam cvRef="MS" accession="MS:1003123" name="Bruker Daltonics timsTOF series" value=""/>\n'
            '<cvParam cvRef="MS" accession="MS:1000529" name="instrument serial number" value="Serial Number N/A"/>\n'
            '</referenceableParamGroup>\n</referenceableParamGroupList>\n'
            '<softwareList count="1">\n<software id="diaTracer" version="2.2.1"/>\n</softwareList>\n'
            '<instrumentConfigurationList count="1">\n<instrumentConfiguration id="IC1">\n'
            '<referenceableParamGroupRef ref="CommonInstrumentParams"/>\n<componentList count="4">\n'
            '<analyzer order="1">\n<cvParam cvRef="MS" accession="MS:1000081" name="quadrupole" value=""/>\n</analyzer>\n'
            '<analyzer order="2">\n<cvParam cvRef="MS" accession="MS:1000084" name="time-of-flight" value=""/>\n</analyzer>\n'
            '<detector order="3">\n<cvParam cvRef="MS" accession="UNKNOWN" name="microchannel plate detector" value=""/>\n</detector>\n'
            '<detector order="4">\n<cvParam cvRef="MS" accession="UNKNOWN" name="photomultiplier" value=""/>\n</detector>\n'
            '</componentList>\n</instrumentConfiguration>\n</instrumentConfigurationList>\n'
            '<dataProcessingList count="1">\n<dataProcessing id="diaTracer">\n'
            '<processingMethod order="0" softwareRef="diaTracer">\n<userParam name="diaTracer" value="features detection"/>\n'
            '</processingMethod>\n</dataProcessing>\n</dataProcessingList>\n'
            f'<run id="{run}" defaultInstrumentConfigurationRef="IC1" defaultSourceFileRef="{run}">\n'
            f'<spectrumList count="{len(src)}" defaultDataProcessingRef="diaTracer">\n')
    spectra = []
    for k, (pmz, z, rt, mz, it) in enumerate(src):
        sid = f"frame={k + 1}"
        mz64, it64 = np.asarray(mz, "<f8"), np.asarray(it, "<f8")
        im = 0.7 + 0.004 * k
        xml = (f'<spectrum index="{k}" id="{sid}" defaultArrayLength="{len(mz64)}" dataProcessingRef="diaTracer">\n'
               '<cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n'
               '<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="2"/>\n'
               '<cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/>\n'
               '<cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>\n'
               f'<cvParam cvRef="MS" accession="MS:1000796" name="spectrum title" value="{run}.{k + 1}.{k + 1}.{z}"/>\n'
               f'<scanList count="1">\n<scan spectrumRef="{sid}" sourceFileRef="{run}">\n'
               f'<cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{rt / 60.0!r}" '
               'unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"/>\n'
               f'<cvParam cvRef="MS" accession="MS:1002815" name="inverse reduced ion mobility" value="{im!r}"/>\n'
               '<scanWindowList count="1">\n<scanWindow>\n'
               f'<cvParam cvRef="MS" accession="MS:1000501" name="scan window lower limit" value="{float(mz64.min())!r}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               f'<cvParam cvRef="MS" accession="MS:1000500" name="scan window upper limit" value="{float(mz64.max())!r}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               '</scanWindow>\n</scanWindowList>\n</scan>\n</scanList>\n'
               f'<precursorList count="1">\n<precursor sourceFileRef="{run}">\n<isolationWindow>\n'
               f'<cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="{pmz!r}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               '<cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="0.011089742640137956" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               '<cvParam cvRef="MS" accession="MS:1000829" name="isolation window upper offset" value="0.011073625719745905" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
               '</isolationWindow>\n<selectedIonList count="1">\n<selectedIon>\n'
               f'<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="{z}"/>\n'
               '<cvParam cvRef="MS" accession="MS:1000042" name="peak intensity" value="2109.0" unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"/>\n'
               '</selectedIon>\n</selectedIonList>\n<activation/>\n</precursor>\n</precursorList>\n'
               + arrays(mz64, it64, "<f8") + '</spectrum>\n')
        spectra.append((sid, xml))
    return indexed(head, spectra, '</spectrumList>\n</run>\n</mzML>\n')


def ddapasef(src: list) -> bytes:
    run = "HeLa_ddaPASEF_synthetic"
    # Layout: an MS1 frame, then up to 6 MS2 of the next frame, repeated.
    # Kinds: "ms2" normal, "e_zlib"/"e_raw"/"e_none" without peaks,
    # "no_mz" a precursor without m/z, "no_prec" no precursorList,
    # "no_ion" a precursor with window offsets only and no selectedIonList,
    # "zero_target" one whose only m/z is a target of 0, "second_prec" a
    # first precursor like "no_ion" and a second, normal one.
    kinds = ["ms2"] * len(src)
    for k, kind in {3: "e_zlib", 9: "e_raw", 14: "e_none", 20: "e_zlib", 25: "no_mz", 31: "no_prec",
                    36: "no_ion", 41: "zero_target", 46: "second_prec"}.items():
        if k < len(kinds):
            kinds[k] = kind
    head = ('<mzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd" '
            f'id="{run}" version="1.1.0">\n' + CV +
            '<fileDescription>\n<fileContent>\n'
            '<cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>\n'
            '<cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n'
            '</fileContent>\n<sourceFileList count="1">\n'
            '<sourceFile id="analysis.tdf" name="analysis.tdf" location="file:///data/synthetic.d">\n'
            '<cvParam cvRef="MS" accession="MS:1002818" name="Bruker TDF nativeID format" value=""/>\n'
            '<cvParam cvRef="MS" accession="MS:1002817" name="Bruker TDF format" value=""/>\n'
            '</sourceFile>\n</sourceFileList>\n</fileDescription>\n'
            '<softwareList count="1">\n<software id="pwiz" version="3.0.0">\n'
            '<cvParam cvRef="MS" accession="MS:1000615" name="ProteoWizard software" value=""/>\n</software>\n</softwareList>\n'
            '<instrumentConfigurationList count="1">\n<instrumentConfiguration id="IC1">\n'
            '<cvParam cvRef="MS" accession="MS:1003005" name="timsTOF Pro" value=""/>\n'
            '<componentList count="3">\n<source order="1">\n<cvParam cvRef="MS" accession="MS:1000073" name="electrospray ionization" value=""/>\n</source>\n'
            '<analyzer order="2">\n<cvParam cvRef="MS" accession="MS:1000084" name="time-of-flight" value=""/>\n</analyzer>\n'
            '<detector order="3">\n<cvParam cvRef="MS" accession="MS:1000114" name="microchannel plate detector" value=""/>\n</detector>\n'
            '</componentList>\n</instrumentConfiguration>\n</instrumentConfigurationList>\n'
            '<dataProcessingList count="1">\n<dataProcessing id="pwiz_Reader_Bruker_conversion">\n'
            '<processingMethod order="0" softwareRef="pwiz">\n<cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" value=""/>\n'
            '</processingMethod>\n</dataProcessing>\n</dataProcessingList>\n'
            f'<run id="{run}" defaultInstrumentConfigurationRef="IC1" defaultSourceFileRef="analysis.tdf">\n'
            '<spectrumList count="@COUNT@" defaultDataProcessingRef="pwiz_Reader_Bruker_conversion">\n')
    spectra = []
    frame, merged = 0, 0

    def common(index, sid, n, level, rt, extra=""):
        return (f'<spectrum index="{index}" id="{sid}" defaultArrayLength="{n}">\n'
                f'<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{level}"/>\n'
                + ('<cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>\n' if level == 1 else
                   '<cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n')
                + '<cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/>\n'
                '<cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>\n'
                '<scanList count="1">\n<cvParam cvRef="MS" accession="MS:1000795" name="no combination" value=""/>\n<scan>\n'
                f'<cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{rt!r}" unitCvRef="UO" unitAccession="UO:0000010" unitName="second"/>\n'
                + extra +
                '<scanWindowList count="1">\n<scanWindow>\n'
                '<cvParam cvRef="MS" accession="MS:1000501" name="scan window lower limit" value="100.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                '<cvParam cvRef="MS" accession="MS:1000500" name="scan window upper limit" value="1700.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                '</scanWindow>\n</scanWindowList>\n</scan>\n</scanList>\n')

    for k, (pmz, z, rt, mz, it) in enumerate(src):
        if k % 6 == 0:
            frame += 1
            sid = f"merged={merged} frame={frame} scanStart=1 scanEnd=927"
            ms1_mz = np.sort(np.concatenate([mz, [pmz]]))
            ms1_it = np.full(len(ms1_mz), 500.0)
            spectra.append((sid, common(len(spectra), sid, len(ms1_mz), 1, rt - 0.05)
                            + arrays(ms1_mz, ms1_it, "<f4") + '</spectrum>\n'))
            merged += 1
            frame += 1
        kind = kinds[k]
        start = 100 + 37 * (k % 6)
        sid = f"merged={merged} frame={frame} scanStart={start} scanEnd={start + 25}"
        merged += 1
        im = f'<cvParam cvRef="MS" accession="MS:1002815" name="inverse reduced ion mobility" value="{0.8 + 0.003 * k!r}" unitCvRef="MS" unitAccession="MS:1002814" unitName="volt-second per square centimeter"/>\n'
        if kind == "no_mz":
            ion = (f'<selectedIon>\n<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="{z}"/>\n</selectedIon>\n')
            window = '<isolationWindow>\n<cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="1.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n</isolationWindow>\n'
        else:
            ion = ('<selectedIon>\n'
                   f'<cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z" value="{pmz!r}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                   f'<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="{z}"/>\n'
                   '<cvParam cvRef="MS" accession="MS:1000042" name="peak intensity" value="1517.0" unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"/>\n'
                   + im + '</selectedIon>\n')
            window = ('<isolationWindow>\n'
                      f'<cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="{round(pmz, 1)!r}" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                      '<cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="1.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                      '<cvParam cvRef="MS" accession="MS:1000829" name="isolation window upper offset" value="1.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                      '</isolationWindow>\n')
        offsets_only = ('<precursor>\n<isolationWindow>\n'
                        '<cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="1.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                        '<cvParam cvRef="MS" accession="MS:1000829" name="isolation window upper offset" value="1.0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                        '</isolationWindow>\n<activation/>\n</precursor>\n')
        normal = ('<precursor>\n' + window + '<selectedIonList count="1">\n' + ion +
                  '</selectedIonList>\n<activation>\n'
                  '<cvParam cvRef="MS" accession="MS:1000133" name="collision-induced dissociation" value=""/>\n'
                  '<cvParam cvRef="MS" accession="MS:1000045" name="collision energy" value="42.0" unitCvRef="UO" unitAccession="UO:0000266" unitName="electronvolt"/>\n'
                  '</activation>\n</precursor>\n')
        if kind == "no_prec":
            prec = ''
        elif kind == "no_ion":
            prec = '<precursorList count="1">\n' + offsets_only + '</precursorList>\n'
        elif kind == "zero_target":
            prec = ('<precursorList count="1">\n<precursor>\n<isolationWindow>\n'
                    '<cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="0" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"/>\n'
                    '</isolationWindow>\n<activation/>\n</precursor>\n</precursorList>\n')
        elif kind == "second_prec":
            prec = '<precursorList count="2">\n' + offsets_only + normal + '</precursorList>\n'
        else:
            prec = '<precursorList count="1">\n' + normal + '</precursorList>\n'

        empty = np.empty(0)
        if kind == "e_zlib":
            body, n = arrays(empty, empty, "<f4"), 0
        elif kind == "e_raw":
            body, n = arrays(empty, empty, "<f4", compress=False), 0
        elif kind == "e_none":
            body, n = '<binaryDataArrayList count="0">\n</binaryDataArrayList>\n', 0
        else:
            body, n = arrays(mz, it, "<f4"), len(mz)
        spectra.append((sid, common(len(spectra), sid, n, 2, rt, im) + prec + body + '</spectrum>\n'))
    head = head.replace("@COUNT@", str(len(spectra)))
    return indexed(head, spectra, '</spectrumList>\n</run>\n</mzML>\n')


def main() -> None:
    src_path, out = sys.argv[1], Path(sys.argv[2])
    src = list(source_spectra(src_path))
    (out / "diatracer_like.mzML").write_bytes(diatracer(src[:60]))
    (out / "ddapasef_empty.mzML").write_bytes(ddapasef(src[60:120]))


if __name__ == "__main__":
    main()
