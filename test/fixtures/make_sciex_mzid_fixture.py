#!/usr/bin/env python3
# Writes sciex_mascot.mzid: the deposited Mascot 3.1 mzid of the run that
# sciex_paramgroup.mzML was cut from, cut to the spectrum identification
# results of that fixture's spectra.
#
#   make_sciex_mzid_fixture.py <source.mzid> <fixture.mzML> <out.mzid>
#
# Source: PXD079630 (CC0), 250226_Sterre_P2020.mzid (Mascot Server 3.1,
# searched on an MSConvert MGF; homology threshold p < 0.01, no decoys, no
# q-values). Its references are spectrumID="index=<n>" (the MGF's order) and
# the native id is only in the spectrum title, NativeID:"...". Kept: the
# document up to the SequenceCollection, the DBSequence, Peptide and
# PeptideEvidence elements the kept results reference, the protocols, inputs
# and the results whose NativeID names a spectrum of the fixture mzML; the
# ProteinDetection step and list are dropped. One edit, so that the two
# acceptance rules differ: every hit of the last kept result is set to
# passThreshold="false" (in the deposit every result has a passing hit).
#
# Copyright (c) 2026 Oliver Kohlbacher and contributors
# SPDX-License-Identifier: MIT
import re
import sys

src, mzml, out = sys.argv[1:4]
d = open(src, encoding="utf-8").read()
ids = set(re.findall(r'<spectrum id="([^"]*)"', open(mzml, encoding="latin-1").read()))

sirs = re.findall(r"( *<SpectrumIdentificationResult .*?</SpectrumIdentificationResult>\n)", d, re.S)
kept = [s for s in sirs
        if (m := re.search(r"NativeID:&quot;(.*?)&quot;", s)) and m.group(1) in ids]
kept[-1] = kept[-1].replace('passThreshold="true"', 'passThreshold="false"')
body = "".join(kept)
pe_refs = set(re.findall(r'peptideEvidence_ref="([^"]*)"', body))
pep_refs = set(re.findall(r'peptide_ref="([^"]*)"', body))

seq_b = d.find("<SequenceCollection")
seq_e = d.find("</SequenceCollection>")
seq = d[seq_b:seq_e]
pes = [p for p in re.findall(r"( *<PeptideEvidence [^>]*/>\n)", seq)
       if re.search(r'id="([^"]*)"', p).group(1) in pe_refs]
db_refs = set(re.search(r'dBSequence_ref="([^"]*)"', p).group(1) for p in pes)
dbs = [x for x in re.findall(r"( *<DBSequence .*?</DBSequence>\n)", seq, re.S)
       if re.search(r'id="([^"]*)"', x).group(1) in db_refs]
peps = [x for x in re.findall(r"( *<Peptide id=.*?</Peptide>\n)", seq, re.S)
        if re.search(r'id="([^"]*)"', x).group(1) in pep_refs]

rest = d[seq_e:]
rest = re.sub(r" *<ProteinDetection id=.*?</ProteinDetection>\n", "", rest, flags=re.S)
rest = re.sub(r" *<ProteinDetectionProtocol .*?</ProteinDetectionProtocol>\n", "", rest, flags=re.S)
rest = re.sub(r" *<ProteinDetectionList .*?</ProteinDetectionList>\n", "", rest, flags=re.S)
first = rest.find("<SpectrumIdentificationResult")
last = rest.rfind("</SpectrumIdentificationResult>") + len("</SpectrumIdentificationResult>\n")
rest = rest[:rest.rfind("\n", 0, first) + 1] + body + rest[last:]

open(out, "w", encoding="utf-8").write(
    d[:seq_b] + "<SequenceCollection>\n" + "".join(dbs) + "".join(peps) + "".join(pes) + "  " + rest)
