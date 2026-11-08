# #5 / #17 DEV freeze and engine acceptance A5-02 (RC a117801)

2026-11-08, node data. Rules: `FREEZE-RULES.md`, committed (61bda59) before any DEV search ran. DEV runs only:
PXD003531 `20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML` (sha256 2b1da222...) and PXD017035
`d12_12_hTT_I.mzML` (sha256 20f78fcc...). No held-out file was read and no frozen config ran on a held-out manifest.
FASTag.bin c4c2ad67..., Sage 0.14.7 (d3820543...), Comet 2026.03.0 (ad93b4cf...). Large DB ref50.fasta
(2bc7295c..., 589010 entries) + cRAP (4b0e6e97..., 116); #17 DB Homo_sapiens.fasta (dffdff38..., 20416).
Every search had a shuffled entrapment copy of its own target database (r = 1, `scripts/entrap.py`); 1 % PSM FDR.
Numbers: `results/dev05/dev05_scores.tsv`, `results/dev17/dev17_scores.tsv`. DEV numbers are in-sample.

## A5-02 engine acceptance: PASS (fixture and real DEV data)

- Fixture: `search_engine_smoke_test.sh` with `FASTAG_ENGINES_REQUIRED=1`, both engines: all checks passed
  (Sage 21 target PSMs at q <= 0.05, Comet 95 target rows; `results/smoke/smoke.log`).
- Real data: 51 Sage/Comet searches on FASTag-written configurations (both engines, 2 DEV runs, full and
  reduced databases, #17 closed and shift-carrying configurations): all exit 0, all report target PSMs at 1 % FDR
  (Sage 2067-16619, Comet 2057-16220 per search); Sage's results.json echoes the exported tolerances, isotope
  errors and modifications (checked on cand_3_10: ppm 10/20, isotope [0, 2], M/S/^ variable, C static).
- Comet key layout against the real `comet -p` of the pinned binary (`comet.params.new`, sha256 0b6abd4c...):
  15 variable_mod slots and the 8-field slot format as the file documents; FASTag's merge inserts slots 06-15
  before `[COMET_ENZYME_INFO]` and Comet ran with them; `isotope_error` is a mode (0 off, 1 = 0/1, 2 = 0/1/2,
  3 = 0/1/2/3), so `-search_isotope_errors n` -> `isotope_error = n` is right for n = 0..3 (and the isotope-2
  closed search gave +56 % Comet PSMs, so Comet used it); positive `mass_offsets` work (mirror run below).

## A5-01 Comet negative offsets: checked, recorded here (fixture not replaced)

The fixture `test/fixtures/comet_template.params` is not replaced: the RC is frozen and `search_config_test`
expects that fixture's deliberate defects (missing keys, TMT on `add_Nterm_peptide`, Lys_C enzyme), so a swap needs
test changes in the next RC. The real `comet -p` file is kept here instead.
On PXD003531, the closed Comet configuration with `mass_offsets = 0.0 -17.026549` gave results byte-identical to
the same configuration without offsets (3730 target PSMs, 0 at exp - calc = -17.03), while the mirror
`0.0 17.026549` gave 4219 target PSMs, 399 of them at +17.03. FASTag's own gap list on this run has a
Gln->pyro-Glu peak at -17.020 (96 spectra). So Comet 2026.03.0 silently ignores negative mass offsets, and the RC
rule that drops them (`dropped_engine`) loses nothing Comet could search. Negative shifts reach Comet only as
variable modifications (rule 3), e.g. Gln->pyro-Glu, here `dropped_cap` at the default cap 3.

## #5 freeze: no admissible grid point (DEV miss)

| max_evalue / min_spectra | min retained recall (runs x engines) | min DB recall | max FDP | min reduction |
|---|---|---|---|---|
| 1 / 1 (frozen) | 0.826 (PXD003531 Sage) | 0.830 | 0.0136 | 49x |
| 0.1 / 1 | 0.818 | 0.822 | 0.0149 | 51x |
| 0.01 / 1 | 0.810 | 0.814 | 0.0144 | 52x |
| best of min_spectra 2 (1 / 2) | 0.544 | 0.546 | 0.0143 | 119x |
| best of min_spectra 3 (1 / 3) | 0.410 | 0.410 | 0.0158 | 190x |

Retained recall is the share of the full-database search's target peptides found again on the reduced database;
database recall the share still contained in it. PXD017035 reaches 0.89-0.91 at 1/1, PXD003531 0.83-0.84. FDP
<= 1.5 % holds at every point with min_spectra 1 (max 1.36 %) but fails at every min_spectra 3 point with Comet on PXD003531 (1.58-1.64 %).
No point meets database recall >= 0.95 or retained recall >= 0.90 on both runs, so by the rule the frozen point is
`-shortlist_max_evalue 1 -shortlist_min_spectra 1` (largest minimum retained recall), with the plan's held-out
thresholds missed in-sample. The RC's provisional defaults (0.1 / 2) lose about half of the peptides on
PXD003531 (retained 0.54). The reduced databases are mostly orthologs (PXD003531: 8560 entries of human, primate,
rodent and other mammal proteins). Frozen CFG-05 options: `-tag_length 4 -extension 6 -variable_modifications
'Oxidation (M)' -shortlist_out -fasta_out -shortlist_background <host+cRAP> -shortlist_max_evalue 1
-shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -search_config_out -search_engine sage|comet
(-search_config_template <comet -p of 2026.03.0> for Comet), engine-config defaults`.
doc/SHORTLIST.md is not edited (RC frozen); this file is the written freeze.

## #17 freeze: RC defaults (shift_max_variable 3, shift_max_offsets 10)

PXD003531, human DB + entrapment, vs the closed search (3930 Sage / 3730 Comet target PSMs):

| arm | Sage PSMs (gain, FDP) | Comet PSMs (gain, FDP) |
|---|---|---|
| cand 3/10 (default) | 9964 (+154 %, 1.28 %) | 10360 (+178 %, 1.34 %) |
| cand 1/10 | 9162 (+133 %, 1.28 %) | 9661 (+159 %, 1.05 %) |
| cand 3/3 | - | 9855 (+164 %, 1.19 %) |
| closed + isotope 0..2 (diagnostic, added after the grid) | 6022 (+53 %, 1.35 %) | 5808 (+56 %, 1.44 %) |

The default beats both alternatives in PSMs with FDP <= 1.5 % and no PSM loss, so it is frozen. About a third of
the gain is the isotope range #17 exports (0..2); the exported modifications (Phospho S, Carbamyl N-term,
Dioxidation M) and the Comet offsets give the rest. Frozen CFG-17-base: FASTag `-tag_length 4 -extension 6
-variable_modifications 'Oxidation (M)' -search_config_out` (Carbamidomethyl C fixed, Oxidation M variable,
isotope errors 0); CFG-17-cand: the same + `-search_shifts both` (Comet) / `variable` (Sage), defaults. Not
covered on DEV: the MSFragger + PTM-Shepherd top-10 recovery criterion (no MSFragger run).

## What is still open before held-out scoring (README gate)

No PREREG-item05.md / PREREG-item17.md: per held-out run the truth database (organism, host for the background),
the arm definitions (full, reduced, selection-symmetric, post-reduction entrapment), denominators and the scorer
(`scripts/score.py` is the DEV scorer; it has no selection-symmetric arm) with its sha256. CFG-05 and CFG-17-* are
therefore `pending_prereg`, and #5 additionally carries the DEV miss above for the user to weigh.
