#!/usr/bin/env python3
"""Turn entries extracted from a Windows-made zip ('x.d\\analysis.tdf' as one file name) into real paths."""
import os, sys
d = sys.argv[1]
for n in os.listdir(d):
    if "\\" in n:
        t = os.path.join(d, *n.split("\\"))
        os.makedirs(os.path.dirname(t), exist_ok=True)
        os.rename(os.path.join(d, n), t)
