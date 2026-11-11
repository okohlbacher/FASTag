#!/usr/bin/env python3
"""Derive the acqcheck2 draw script from the E7-03 one (sample.py): same stratum regexes and
file-pick rule; new seed, Thermo .raw only, <= 2.5 GiB, new quotas, new id prefix."""
import sys
s = open(sys.argv[1]).read()
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("SEED = 20261108", "SEED = 20261110")
rep("MAX_BYTES = 6 * 1024**3", "MAX_BYTES = int(2.5 * 1024**3)")
q0 = s[s.index("QUOTA = ["):s.index("]\n", s.index("QUOTA = [")) + 2]
rep(q0, '''QUOTA = [  # (stratum, class, n)
    ("DIA_orbitrap", "DIA", 45),
    ("DIA_astral", "DIA", 12),
    ("PRM", "nonDIA", 8),
    ("WWA_DDA", "nonDIA", 6),
    ("DDA_qexactive", "nonDIA", 14),
    ("DDA_exploris", "nonDIA", 14),
    ("DDA_tribrid", "nonDIA", 14),
    ("DDA_astral", "nonDIA", 14),
]
''')
rep('RAW_OK = R(r"\\.(raw|d\\.zip|d\\.tar|d\\.tar\\.gz|d\\.tgz|wiff|mzML|mzML\\.gz)$")', 'RAW_OK = R(r"\\.raw$")')
rep('"E7-03.%s.%02d"', '"AQ2.%s.%02d"')
open(sys.argv[2], "w").write(s)
