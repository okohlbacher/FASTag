# #5 / #17 DEV freeze rules (written before the DEV searches ran)

2026-11-08. RC a117801 (FASTag.bin c4c2ad67...), node data, DEV runs only (PXD003531 gate run; PXD017035
d12_12_hTT_I). Engines: Sage 0.14.7 (binary d3820543...), Comet 2026.03.0 (ad93b4cf...), template = real
`comet -p` of that binary (sha256 0b6abd4c..., `engines/comet.params.new`). Scripts: `scripts/run_dev05.sh`,
`scripts/run_dev17.sh`, `scripts/entrap.py`, `scripts/score.py`, `scripts/negoff.py`. Nothing in src/ changes;
the RC's compiled constants (protease margin 0.05 and the rest) are what is frozen with the binary.

Fixed before the runs (not tuned): FASTag `-tag_length 4 -extension 6 -variable_modifications 'Oxidation (M)'`
(fixed Carbamidomethyl (C) default), engine-config defaults (precursor 10 ppm, fragment 20 ppm, 1 missed
cleavage, isotope errors 0 unless #17 raises them), `-shortlist_parsimony none -shortlist_top 0`, not gapped,
background cRAP (116 entries; no host proteome in either DEV design). Every search: shuffled entrapment at r = 1 of
its own target database, engine-generated decoys, 1 % PSM FDR.

## #5 rule

Grid: `-shortlist_max_evalue` {0.01, 0.1, 1} x `-shortlist_min_spectra` {1, 2, 3}. A grid point is admissible when,
on both DEV runs and both engines: database recall >= 0.95, retained-peptide recall >= 0.90, post-reduction
entrapment FDP <= 1.5 %. Among admissible points, the frozen one has the largest minimum (over runs) residue
reduction; ties go to the smaller max_evalue, then the larger min_spectra. If no point is admissible, the point with
the largest minimum retained recall (over runs and engines) is frozen and the DEV result is recorded as not meeting
the plan's held-out thresholds in-sample (a DEV miss, the user decides; no held-out run is implied).

## #17 rule

Grid (Comet): (`-shift_max_variable`, `-shift_max_offsets`) in {(3,10) RC default, (1,10), (3,3)}, mode `both`;
Sage: max_variable {3, 1}, mode `variable`. The RC default is frozen unless another point beats it on DEV in PSMs at
1 % FDR with entrapment FDP <= 1.5 % and does not lose > 1 % of the closed-search PSMs; then the best such point.
The closed baseline (CFG-17-base) is the same FASTag configuration without `-search_shifts`.

## A5-01 negative offsets

Comet base config with `mass_offsets = 0.0 -17.026549` and the mirror `0.0 17.026549`: Comet must run (exit 0),
and the count of 1 % FDR PSMs at exp - calc = offset is reported. Negative offsets are usable when the NEG run
finds them (pyro-Glu/NH3 loss expected on PXD003531) well above the mirror. The RC drops negative offsets
(`dropped_engine`); that is not changed here (src/ frozen), the result says whether the rule loses information.
