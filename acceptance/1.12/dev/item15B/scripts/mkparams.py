#!/usr/bin/env python3
"""E15B-04 DEV: target+rev_ decoy FASTA and MSFragger 4.4.1 parameter files for PXD060724 (PREREG-item15B common
settings). Usage: mkparams.py <target fasta> <out dir> <threads>"""
import sys
from pathlib import Path
tgt, out, thr = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
recs, h, s = [], None, []
for line in tgt.read_text().splitlines():
    if line.startswith(">"):
        if h: recs.append((h, "".join(s)))
        h, s = line[1:], []
    elif line.strip():
        s.append(line.strip())
if h: recs.append((h, "".join(s)))
db = out / "Oryctolagus_cuniculus.td.fasta"
with open(db, "w") as f:
    for h, q in recs: f.write(f">{h}\n{q}\n")
    for h, q in recs: f.write(f">rev_{h}\n{q[::-1]}\n")
ENZ = {"trypsin": ("trypsin", "KR", "P"), "chymotrypsin": ("chymotrypsin", "FWYL", "P")}
SER = {"hybrid": ("b,y,c,z", "EThcD"), "cz": ("c,z", "EThcD"), "by": ("b,y", "HCD")}
for enz, (name, cut, nocut) in ENZ.items():
    for srch, (ions, act) in SER.items():
        p = f"""database_name = {db}
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
search_enzyme_name_1 = {name}
search_enzyme_sense_1 = C
search_enzyme_cut_1 = {cut}
search_enzyme_nocut_1 = {nocut}
allowed_missed_cleavage_1 = 2
num_enzyme_termini = 2
clip_nTerm_M = 1
digest_min_length = 7
digest_max_length = 50
digest_mass_range = 500.0 6000.0
max_fragment_charge = 2
variable_mod_01 = 15.9949 M 3
variable_mod_02 = 42.0106 [^ 1
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
        (out / f"msfragger_{srch}_{enz}.params").write_text(p)
print(len(recs), "targets")
