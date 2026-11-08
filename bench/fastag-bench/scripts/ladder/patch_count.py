"""Equal-length header patch: set <spectrumList count> to the true spectrum number and drop the same
number of indentation tabs from earlier header lines, so every byte offset in the mzML index stays valid."""
import sys, shutil
src, dst, n = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, "rb") as f:
    head = f.read(200000)
old = b"<spectrumList count=\"0\""
new = b"<spectrumList count=\"" + n.encode() + b"\""
i = head.index(old)
need = len(new) - len(old)
pre = bytearray(head[:i])
removed = 0
pos = 0
while removed < need:
    j = pre.index(b"\n\t", pos)       # a newline followed by a tab: drop that tab (insignificant whitespace)
    del pre[j + 1]
    removed += 1
    pos = j + 1
out = bytes(pre) + new + head[i + len(old):]
assert len(out) == len(head)
with open(src, "rb") as f, open(dst, "wb") as g:
    g.write(out); f.seek(len(head)); shutil.copyfileobj(f, g, 64 << 20)
print("patched", need, "bytes of indentation; size", len(out))
