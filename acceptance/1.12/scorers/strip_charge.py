#!/usr/bin/env python3
"""#6 input preparation (PREREG-item06.md, registry E6-01): copy an mzML without its precursor charges.

The same derivation as the RC's own gate case charge_infer (tools/gate_new_cases.sh --stage, source
'strip_charge:'): every line that contains accession="MS:1000041" (selected ion 'charge state') is dropped, i.e.
`grep -v 'accession="MS:1000041"'` (which also ends an unterminated last line with a newline). The mzML
index goes stale; FASTag's fast reader then scans the file, as for the gate input. 'possible charge state' (MS:1000633) is kept, as E6-01 specifies. Checked on DEV: PXD003531
20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML gives the gate input's sha256 19d8ee3f...cbccbd
(scorers/tests/dev_results/strip_charge_PXD003531.txt). Prints the counts and the output sha256.
Usage: strip_charge.py <in.mzML> <out.mzML>"""
import hashlib
import sys

KEY = b'accession="MS:1000041"'


def main():
    src, dst = sys.argv[1:3]
    n = n633 = 0
    h = hashlib.sha256()
    last = b"\n"
    with open(src, "rb") as f, open(dst, "wb") as o:
        for line in f:
            if KEY in line:
                n += 1
                continue
            n633 += line.count(b"MS:1000633")
            o.write(line)
            h.update(line)
            last = line[-1:]
        if last != b"\n":       # grep terminates the last line (the gate's derivation)
            o.write(b"\n")
            h.update(b"\n")
    print(f"dropped MS:1000041 lines {n}; MS:1000633 kept {n633}; sha256 {h.hexdigest()}  {dst}")


if __name__ == "__main__":
    main()
