#!/usr/bin/env python3
# Writes sciex_paramgroup.mzML: a few spectra of a SCIEX MS Data Converter
# mzML, cut out byte for byte, with the converter's quirks kept.
#
#   make_sciex_fixture.py <source.mzML> <out.mzML>
#
# Source: PXD079630 (CC0), 250226_Sterre_P2020__250226_Sterre_P2020_1.mzML,
# SCIEX ZenoTOF, converted by SCIEX MS Data Converter. Kept as written: CRLF
# line ends, the MS level and the scan windows only in
# referenceableParamGroups, and an index whose offsets point into the
# whitespace before each <spectrum (the first 10 bytes early, the others 9,
# as the converter writes them). The run header is the source's, with the
# referenceableParamGroupList cut to the groups the kept spectra reference
# and without the chromatogram list.
#
# Copyright (c) 2026 Oliver Kohlbacher and contributors
# SPDX-License-Identifier: MIT
import hashlib
import re
import sys

src, out = sys.argv[1], sys.argv[2]
d = open(src, "rb").read()
CRLF = b"\r\n"

# Kept: the first two spectra (empty MS1 scans at the run start) and the
# first 12 MS2 of cycle 1610 (experiments 2-13; experiment 3 is one the
# deposited Mascot search identified).
KEEP = [b"sample=1 period=1 cycle=1 experiment=1", b"sample=1 period=1 cycle=2 experiment=1"] + [
    b"sample=1 period=1 cycle=1610 experiment=%d" % e for e in range(2, 14)]

spectra = []
for sid in KEEP:
    b = d.find(b'<spectrum id="' + sid + b'"')
    e = d.find(b"</spectrum>", b) + len(b"</spectrum>")
    spectra.append((sid, d[b:e]))

refs = set()
for _, s in spectra:
    refs.update(re.findall(rb'<referenceableParamGroupRef ref="([^"]*)"', s))

# Run header: everything before the first spectrum's line, groups cut down.
sl = d.find(b"<spectrumList ")
head = d[:d.rfind(CRLF, 0, sl) + 2]
gl_b = head.find(b"<referenceableParamGroupList ")
gl_e = head.find(b"</referenceableParamGroupList>")
groups = re.findall(rb'( *<referenceableParamGroup id="([^"]*)">.*?</referenceableParamGroup>\r\n)',
                    head[gl_b:gl_e], re.S)
kept = [g for g, gid in groups if gid in refs]
indent = head[head.rfind(CRLF, 0, gl_b) + 2:gl_b]
gl_line = indent + b'<referenceableParamGroupList count="%d">' % len(kept) + CRLF
head = head[:head.rfind(CRLF, 0, gl_b) + 2] + gl_line + b"".join(kept) + head[gl_e - len(indent):]

list_line = d[d.rfind(CRLF, 0, sl) + 2:d.find(CRLF, sl) + 2]
list_line = re.sub(rb'count="\d+"', b'count="%d"' % len(spectra), list_line)

body = bytearray(head + list_line)
offsets = []
for i, (sid, s) in enumerate(spectra):
    s = re.sub(rb' index="\d+"', b' index="%d"' % i, s)
    pos = len(body) + 8  # after the 8-space indent
    # The converter's offsets: the first at the CR before it, the rest at the LF.
    offsets.append((sid, pos - 10 if i == 0 else pos - 9))
    body += b" " * 8 + s + CRLF
body += b"      </spectrumList>" + CRLF + b"    </run>" + CRLF + b"  </mzML>" + CRLF
index_at = len(body) - 2  # the converter's indexListOffset: the CR before <indexList
body += b'  <indexList count="1">' + CRLF + b'    <index name="spectrum">' + CRLF
for sid, off in offsets:
    body += b'      <offset idRef="' + sid + b'">%d</offset>' % off + CRLF
body += b"    </index>" + CRLF + b"  </indexList>" + CRLF
body += b"  <indexListOffset>%d</indexListOffset>" % index_at + CRLF
body += b"  <fileChecksum>"
body += hashlib.sha1(bytes(body)).hexdigest().upper().encode() + b"</fileChecksum>" + CRLF + b"</indexedmzML>"
open(out, "wb").write(bytes(body))
