"""MGF writer: RTINSECONDS follows the mzML's declared scan start time unit."""
import base64
import struct

import pytest

pytest.importorskip("pyteomics")
from fastag_bench import mgf as M  # noqa: E402

_ARR = base64.b64encode(struct.pack("<2d", 100.0, 200.0)).decode()


def _spectrum(idx: int, level: int, rt: str, unit: tuple[str, str] | None) -> str:
    u = f' unitCvRef="UO" unitAccession="{unit[0]}" unitName="{unit[1]}"' if unit else ""
    prec = ("""<precursorList count="1"><precursor><selectedIonList count="1"><selectedIon>
<cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z" value="500.25"/>
<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="2"/>
</selectedIon></selectedIonList></precursor></precursorList>""" if level == 2 else "")
    arrays = "".join(f"""<binaryDataArray encodedLength="{len(_ARR)}">
<cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
<cvParam cvRef="MS" accession="MS:1000576" name="no compression" value=""/>
<cvParam cvRef="MS" accession="{acc}" name="{name}" value=""/><binary>{_ARR}</binary></binaryDataArray>"""
                     for acc, name in (("MS:1000514", "m/z array"), ("MS:1000515", "intensity array")))
    return f"""<spectrum index="{idx}" id="controllerType=0 controllerNumber=1 scan={idx + 1}" defaultArrayLength="2">
<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{level}"/>
<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{rt}"{u}/></scan></scanList>
{prec}<binaryDataArrayList count="2">{arrays}</binaryDataArrayList></spectrum>"""


def _mzml(path, unit):
    specs = _spectrum(0, 1, "1.5", unit) + _spectrum(1, 2, "1.5", unit) + _spectrum(2, 2, "2.25", unit)
    path.write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">
<cvList count="2"><cv id="MS" fullName="PSI-MS" URI="x"/><cv id="UO" fullName="UO" URI="y"/></cvList>
<run id="r"><spectrumList count="3">{specs}</spectrumList></run></mzML>
""")
    return path


def _rts(mgf_path):
    return [float(l.split("=", 1)[1]) for l in mgf_path.read_text().splitlines() if l.startswith("RTINSECONDS=")]


@pytest.mark.parametrize("unit,factor", [(("UO:0000031", "minute"), 60.0), (("UO:0000010", "second"), 1.0)])
def test_rt_follows_declared_unit(tmp_path, unit, factor):
    src = _mzml(tmp_path / "in.mzML", unit)
    out = M.write_first_ms2(src, tmp_path / "first.mgf", 10)
    assert _rts(out) == pytest.approx([1.5 * factor, 2.25 * factor])
    sub = M.write_ms2_subsample(src, tmp_path / "sub.mgf", 10, seed=1)
    assert _rts(sub) == pytest.approx([1.5 * factor, 2.25 * factor])


def test_rt_without_unit_is_rejected(tmp_path):
    src = _mzml(tmp_path / "in.mzML", None)
    with pytest.raises(ValueError, match="unit"):
        M.write_first_ms2(src, tmp_path / "first.mgf", 10)
