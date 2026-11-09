#!/usr/bin/env python3
"""b113-ax DEV (PXD018176): the E. coli target-decoy database and the MSFragger 4.4.1 parameter files.
Usage: mkparams.py <PXD018176 dir> <15B template params> <out dir>"""
import sys
from pathlib import Path
src, tmpl, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
entries, h, s = [], None, []
for l in open(src / "UP000000625_83333.fasta"):
    l = l.rstrip("\n")
    if l.startswith(">"):
        if h: entries.append((h, "".join(s)))
        h, s = l[1:], []
    else:
        s.append(l.strip())
if h: entries.append((h, "".join(s)))
with open(out / "ecoli.td.fasta", "w") as f:
    for h, q in entries:
        f.write(f">{h}\n{q}\n")
    for h, q in entries:
        f.write(f">rev_{h}\n{q[::-1]}\n")
t = tmpl.read_text()
def setp(t, k, v):
    lines = []
    found = False
    for l in t.splitlines():
        if l.split("=")[0].strip() == k:
            l = f"{k} = {v}"; found = True
        lines.append(l)
    assert found, k
    return "\n".join(lines) + "\n"
base = t
for k, v in [("database_name", str(out / "ecoli.td.fasta")), ("num_threads", "16"),
             ("precursor_mass_lower", "-10"), ("precursor_mass_upper", "10"), ("precursor_true_tolerance", "10"),
             ("fragment_mass_tolerance", "15"), ("allowed_missed_cleavage_1", "3"), ("activation_types", "all")]:
    base = setp(base, k, v)
(out / "msfragger_by.params").write_text(base)                      # HCD partner spectra: b, y
(out / "msfragger_abxy.params").write_text(setp(base, "fragment_ion_series", "a,b,x,y"))  # UVPD: a/x + b/y
(out / "msfragger_ax.params").write_text(setp(base, "fragment_ion_series", "a,x"))        # UVPD: a/x only
print(len(entries), "proteins")
