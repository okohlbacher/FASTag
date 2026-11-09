#!/usr/bin/env python3
"""#15B held-out truth (PREREG-item15B.md amendment 1, 2026-11-09): target + rev_ decoy FASTAs and the MSFragger
4.4.1 parameter files of item15B-sets-r2. Same template as the DEV files (acceptance/1.12/dev/item15B/scripts/
mkparams.py, E15B-04); only database, activation_types, fragment_ion_series and the per-project variable mods
differ. Decoys: every target entry reversed, header prefixed 'rev_', written after the targets.
Usage (node data): mkparams_heldout.py <panel dir> <db out dir> <params out dir> <threads>"""
import sys
from pathlib import Path

panel, dbdir, pdir, thr = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4])
dbdir.mkdir(parents=True, exist_ok=True)
pdir.mkdir(parents=True, exist_ok=True)


def td(org):
    recs, h, s = [], None, []
    for line in (panel / f"{org}.fasta").read_text().splitlines():
        if line.startswith(">"):
            if h:
                recs.append((h, "".join(s)))
            h, s = line[1:], []
        elif line.strip():
            s.append(line.strip())
    if h:
        recs.append((h, "".join(s)))
    out = dbdir / f"{org}.td.fasta"
    with open(out, "w") as f:
        for h, q in recs:
            f.write(f">{h}\n{q}\n")
        for h, q in recs:
            f.write(f">rev_{h}\n{q[::-1]}\n")
    return out


DB = {o: td(o) for o in ("Mus_musculus", "Homo_sapiens")}
# set -> (organism, extra variable mods as PRIDE's data-processing protocol states)
SETS = {"set7": ("Mus_musculus", ["79.96633 STY 3"]),             # PXD024621 phospho
        "set9": ("Homo_sapiens", ["541.06111 CDEHKRSTY 1"]),      # PXD009208 ADP-ribosylation (CDEHKRSTY), at most
                                                                  # 1 per peptide: with 3 the index (1.4e9 modified
                                                                  # peptides) does not fit 48 GB (DEV parse check)
        "set10": ("Homo_sapiens", [])}                            # PXD010595 synthetic tryptic peptides
SER = {"by": ("b,y", "HCD"), "cz": ("c,z", "ETD"), "hybrid": ("b,y,c,z", "EThcD")}
SEARCHES = {"set7": ("by", "cz"), "set9": ("cz",), "set10": ("cz", "hybrid")}

for st, (org, extra) in SETS.items():
    vm = ["15.9949 M 3", "42.0106 [^ 1"] + extra
    vml = "\n".join(f"variable_mod_{i:02d} = {m}" for i, m in enumerate(vm, start=1))
    for srch in SEARCHES[st]:
        ions, act = SER[srch]
        p = f"""database_name = {DB[org]}
decoy_prefix = rev_
num_threads = {thr}
precursor_mass_lower = -20
precursor_mass_upper = 20
precursor_mass_units = 1
data_type = 0
precursor_true_tolerance = 20
precursor_true_units = 1
fragment_mass_tolerance = 20
fragment_mass_units = 1
calibrate_mass = 0
use_all_mods_in_first_search = 0
deisotope = 1
deneutralloss = 1
isotope_error = 0/1/2
mass_offsets = 0
precursor_mass_mode = selected
remove_precursor_peak = 1
remove_precursor_range = -1.5,1.5
intensity_transform = 0
activation_types = {act}
analyzer_types = all
fragment_ion_series = {ions}
ion_series_definitions =
search_enzyme_name_1 = trypsin
search_enzyme_sense_1 = C
search_enzyme_cut_1 = KR
search_enzyme_nocut_1 = P
allowed_missed_cleavage_1 = 2
num_enzyme_termini = 2
clip_nTerm_M = 1
digest_min_length = 7
digest_max_length = 50
digest_mass_range = 500.0 6000.0
max_fragment_charge = 2
{vml}
allow_multiple_variable_mods_on_residue = 0
max_variable_mods_per_peptide = 3
max_variable_mods_combinations = 5000
add_C_cysteine = 57.021464
precursor_charge = 1 6
override_charge = 0
output_format = tsv
output_report_topN = 1
output_max_expect = 50
report_alternative_proteins = 0
minimum_peaks = 15
use_topN_peaks = 150
min_fragments_modelling = 2
min_matched_fragments = 4
minimum_ratio = 0.01
clear_mz_range = 0.0 0.0
"""
        (pdir / f"msfragger_{srch}_{st}.params").write_text(p)
print("ok", {o: str(p) for o, p in DB.items()})
