#!/usr/bin/env python3
"""MSFragger 4.4.1 open-search parameters for the #17 reference (FASTag 1.13), derived from the run's FASTag base
Comet configuration so the open search carries exactly the base arm's declared chemistry: every non-zero add_<X>
fixed mass is copied, every used variable_modNN slot becomes a variable_mod (residue sites; 'n' -> '[^', 'c' -> ']^').
Open window -150..+500 Da, precursor_true_tolerance 20 ppm, fragment 20 ppm, isotope_error 0, mass_offsets 0,
localize_delta_mass 1, trypsin (KR, not before P), 2 missed cleavages, length 7-50, mass 500-5000, top 1 PSM, tsv.
Usage: mkfragger.py <base cfg_comet.params> <td.fasta> <threads> <out.params>"""
import sys

cfg, db, th, out = sys.argv[1:5]
fixed, var = [], []
for line in open(cfg):
    line = line.split("#")[0].strip()
    if "=" not in line:
        continue
    k, v = [x.strip() for x in line.split("=", 1)]
    if k.startswith("add_") and v and float(v) != 0.0:
        fixed.append((k, float(v)))
    elif k.startswith("variable_mod") and v:
        f = v.split()
        if float(f[0]) != 0.0:
            site = {"n": "n^", "c": "c^"}.get(f[1], f[1])
            var.append((float(f[0]), site))
P = f"""database_name = {db}
decoy_prefix = rev_
num_threads = {th}
precursor_mass_lower = -150
precursor_mass_upper = 500
precursor_mass_units = 0
data_type = 0
precursor_true_tolerance = 20
precursor_true_units = 1
fragment_mass_tolerance = 20
fragment_mass_units = 1
calibrate_mass = 0
use_all_mods_in_first_search = 0
deisotope = 1
deneutralloss = 1
isotope_error = 0
mass_offsets = 0
precursor_mass_mode = selected
localize_delta_mass = 1
remove_precursor_peak = 1
remove_precursor_range = -1.5,1.5
intensity_transform = 0
activation_types = all
analyzer_types = all
fragment_ion_series = b,y
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
digest_mass_range = 500.0 5000.0
max_fragment_charge = 2
allow_multiple_variable_mods_on_residue = 0
max_variable_mods_per_peptide = 3
max_variable_mods_combinations = 5000
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
for i, (m, s) in enumerate(var, 1):
    P += f"variable_mod_{i:02d} = {m:.6f} {s} 3\n"
for k, v in fixed:
    P += f"{k} = {v:.6f}\n"
open(out, "w").write(P)
print(f"fixed {len(fixed)} variable {len(var)}")
