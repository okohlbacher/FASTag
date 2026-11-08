#!/usr/bin/env python3
"""#2 truth-input preparation for the timsTOF runs PXD033741 and PXD076520 (PREREG-item02.md, amendment 2).

Sage 0.14.7 keeps an MS2 spectrum whose precursors list is empty and then panics in scoring.rs
("missing MS1 precursor for <id>"). Its mzML reader (crates/sage-cloudpath/src/mzml.rs) pushes a <precursor> only when
the precursor's 'selected ion m/z' (MS:1000744) is not 0.0. The OpenMS-converted timsTOF mzMLs of these two runs carry
MS2 spectra (Bruker precursors without a monoisotopic m/z) whose only selected ion m/z is "0" and that have no
isolation window. No search engine can assign a precursor mass to them.

This script copies an mzML and drops exactly the MS2 spectra that Sage would keep with an empty precursor list: an
<spectrum> block with ms level 2 in which no <precursor> carries a selected ion m/z other than 0 (Sage's rule: per
<precursor>, the last MS:1000744 value; a precursor without one counts as 0). Every other line is copied byte for
byte, as strip_charge.py does: the spectrumList count and the index go stale (Sage reads neither). The native IDs of
the kept spectra are unchanged, so the truth keys match the FASTag runs on the staged input.
Parsing is line based and checks the layout it relies on (one <spectrum ...> start tag and one </spectrum> end tag
per line, as OpenMS writes them); anything else aborts with exit 2.
Prints the counts and the output sha256; --count-only reads without writing; --ids <file> writes the dropped IDs.
Usage: drop_noprecursor_ms2.py <in.mzML> <out.mzML|-> [--count-only] [--ids <file>]"""
import argparse
import hashlib
import re
import sys

SPEC_START = re.compile(rb'^\s*<spectrum\s[^>]*\bid="([^"]*)"')
SPEC_END = re.compile(rb"^\s*</spectrum>\s*$")
MSLEVEL = re.compile(rb'accession="MS:1000511"[^>]*value="(\d+)"')
SEL_MZ = re.compile(rb'accession="MS:1000744"[^>]*value="([^"]*)"')


def keep_block(block):
    """False for an MS2 block whose every <precursor> has selected ion m/z 0 (or none)."""
    level, in_prec, prec_mz, any_nonzero = None, False, 0.0, False
    for line in block:
        m = MSLEVEL.search(line)
        if m and level is None:
            level = int(m.group(1))
        if b"<precursor>" in line or b"<precursor " in line:
            in_prec, prec_mz = True, 0.0
        if in_prec:
            m = SEL_MZ.search(line)
            if m:
                prec_mz = float(m.group(1))
        if b"</precursor>" in line:
            in_prec = False
            any_nonzero |= prec_mz != 0.0
    return not (level == 2 and not any_nonzero)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--count-only", action="store_true")
    ap.add_argument("--ids")
    a = ap.parse_args()
    h = hashlib.sha256()
    out = None if a.count_only or a.dst == "-" else open(a.dst, "wb")
    ids = open(a.ids, "wb") if a.ids else None
    n_spec = n_ms2 = n_drop = 0
    block, sid = None, None
    with open(a.src, "rb") as f:
        for line in f:
            if block is None:
                m = SPEC_START.match(line)
                if m:
                    if SPEC_END.match(line) or b"/>" in line.split(b">", 1)[0] + b">":
                        print("ABORT: spectrum start and end on one line", file=sys.stderr)
                        sys.exit(2)
                    block, sid = [line], m.group(1)
                    continue
                if out:
                    out.write(line)
                h.update(line)
                continue
            if SPEC_START.match(line):
                print(f"ABORT: nested <spectrum> after {sid!r}", file=sys.stderr)
                sys.exit(2)
            block.append(line)
            if SPEC_END.match(line):
                n_spec += 1
                lv = MSLEVEL.search(b"".join(block[:8]))
                n_ms2 += bool(lv and lv.group(1) == b"2")
                if keep_block(block):
                    for x in block:
                        if out:
                            out.write(x)
                        h.update(x)
                else:
                    n_drop += 1
                    if ids:
                        ids.write(sid + b"\n")
                block, sid = None, None
    if block is not None:
        print(f"ABORT: unterminated <spectrum> {sid!r}", file=sys.stderr)
        sys.exit(2)
    if out:
        out.close()
    print(f"spectra {n_spec}; ms2 {n_ms2}; dropped_ms2_without_precursor_mz {n_drop}; kept {n_spec - n_drop}; "
          f"sha256 {h.hexdigest() if not a.count_only else 'n/a (count only)'}  {a.dst}")


if __name__ == "__main__":
    main()
