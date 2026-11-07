"""Equal-length header patch for DirecTag 1.4 (ProteoWizard 2012): replace three post-2012 CV accessions
(Orbitrap Astral, Astral analyzer, ThermoRawFileParser) by older same-length accessions of the same kind.
Spectrum data and every index offset are unchanged."""
import sys, shutil
src, dst = sys.argv[1:3]
rep = {b"MS:1003378": b"MS:1000483", b"MS:1003379": b"MS:1000084", b"MS:1003145": b"MS:1000799"}
with open(src, "rb") as f:
    head = f.read(50000)
i = head.index(b"<spectrumList")
h = head[:i]
for a, b in rep.items():
    h = h.replace(a, b)
out = h + head[i:]
assert len(out) == len(head)
with open(src, "rb") as f, open(dst, "wb") as g:
    g.write(out); f.seek(len(head)); shutil.copyfileobj(f, g, 64 << 20)
print("ok")
