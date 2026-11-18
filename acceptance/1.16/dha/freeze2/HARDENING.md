# Item 1 hardening: review steps 2-4 on the development runs

Review: `../REVIEW-path-2026-11-18.md`, steps 2-4.
Build: `feat/deep-exam` at `425f16b2`, data node. OpenMS develop `70cebcd144`, conda env `fastag-omsdev`.
Runs: the six PXD045734 development runs `ah_4068_ZW_032115_{UIF,USF,WSF}_{IC,N}_57yo` only. No other PXD045734 run was opened, listed or run.
Reference: the MSFragger 4.4.1 open search of `OPENSEARCH-DEV.md`. It keeps the top-1 PSM with q ≤ 0.01 (per-run target-decoy) and joins by scan number, giving 40,244 PSMs.

Scripts, all in `hardening/`:
- `item1_dev3.sh`: nine arms × six runs.
- `make_entrap.py`: the entrapment FASTA.
- `harden_analysis.py`: every table below.

The tables are in `hardening/analysis/` and the per-run counts in `hardening/counts/`. Outputs on ceph are under `/ceph/ibmi/abi/oliver/fastag-deepexam/item1-dev3/`.

| arm | arguments beyond the dev set (`RESULT.md`) |
|---|---|
| main | defaults + `-delta_spectra_out -delta_counts_out -delta_loc_null 7.3` |
| t1 | main at `-threads 1` |
| compat | `-delta_loc_model count -delta_loc_min_evidence 1 -delta_isotope_flank any` |
| consensus | `-delta_select consensus` |
| count, unique | `-delta_loc_model count` / `unique` |
| blind | no `-variable_modifications` |
| entrap | target + shuffled entrapment proteome, `-recon_min_length 8` |
| iso01 | `-isotope_error 0 1` |

Main arm: 1.51–1.72 s and 435–514 MB per run at 32 threads (`hardening/timing.tsv`).

## Defaults changed (survey only; `-recon_out` is unchanged)

| option | was | now |
|---|---|---|
| `-delta_loc_model` | count (1.16a) | strict |
| `-delta_loc_min_evidence` | 1 | 2 |
| `-delta_isotope_flank` | any | precursor |

`-delta_loc_model count -delta_loc_min_evidence 1 -delta_isotope_flank any` reproduces `59492fa2` (item1-dev2) on all six runs:
- `-delta_out` columns 1–9 are byte-identical;
- `-delta_spectra_out` columns 1–10 are byte-identical.

`-delta_select` keeps `min_delta`.

## Step 2: provenance and counts

### Reconciliation (`-delta_counts_out`; `analysis/reconciliation.tsv`)

| run | MS2 | tagged | placed | clamped | samples | exact | gap | terminal gap | fragment | sequence | ambiguous | unlocalized | assumed charge | rows sum |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UIF_IC | 28,262 | 22,612 | 4,927 | 63 | 4,864 | 2,420 | 2,394 | 50 | 205 | 166 | 705 | 1,318 | 163 | 4,864 |
| UIF_N | 28,052 | 22,087 | 4,308 | 54 | 4,254 | 1,755 | 2,459 | 40 | 180 | 217 | 702 | 1,360 | 174 | 4,254 |
| USF_IC | 28,071 | 24,306 | 6,614 | 188 | 6,426 | 2,690 | 3,653 | 83 | 291 | 175 | 1,137 | 2,050 | 616 | 6,426 |
| USF_N | 28,445 | 24,720 | 6,224 | 166 | 6,058 | 2,364 | 3,616 | 78 | 318 | 208 | 1,107 | 1,983 | 583 | 6,058 |
| WSF_IC | 25,963 | 19,700 | 4,113 | 93 | 4,020 | 1,714 | 2,254 | 52 | 234 | 111 | 738 | 1,171 | 323 | 4,020 |
| WSF_N | 25,536 | 19,514 | 3,965 | 112 | 3,853 | 1,761 | 2,042 | 50 | 212 | 136 | 630 | 1,064 | 368 | 3,853 |
| **total** | **164,329** | **132,939** | **30,151** | **676** | **29,475** | **12,704** | **16,418** | **353** | **1,440** | **1,013** | **5,019** | **8,946** | **2,227** | **29,475** |

Column meanings:
- **tagged:** a selected-hypothesis tag reached placement.
- **placed:** at least one placement.
- **gap:** gaps with a residue region.
- **terminal gap:** a nonzero gap with the tag at the terminus, so no residue to place it on (353). These are the "nonzero rows with spectra > localized + unlocalized" of the review.

Every run passes the six sum checks:
- tagged ≤ MS2;
- placed ≤ tagged;
- placed = samples + clamped;
- samples = exact + gap + terminal;
- gap = the four evidence classes;
- the rows sum to the samples.

The largest loss is placement: 18 % of the tagged MS2 place. The index derives a minimum tag length of 8 for this FASTA.

### 28,803 vs 28,524 (`analysis/discrepancy.tsv`)

Every build sampled 29,475 spectra; the log line "Delta histogram" is the same in 1.15.0, `a66ad9d9` and `59492fa2`. The two smaller totals come from row grouping, not from sampling:
- **28,803:** 1.15's local-maximum rows, summed per run. The rule dropped 672 spectra whose bins were neither a peak nor next to one. 1.15.0, `a66ad9d9` and `-delta_group 0` all give 28,803.
- **28,524:** the `a66ad9d9` RESULT pooled the six per-run tables with the same lossy rule (`pool.py`), which dropped 279 more.
- Together that is the 951 lost spectra `59492fa2` reported. Since `59492fa2` the rows sum to 29,475.

### Determinism (`analysis/determinism.tsv`)

32 versus 1 thread gives byte-identical `-delta_out`, `-delta_spectra_out` and `-delta_counts_out` on all six runs.

### Where shifts are lost (`analysis/funnel.tsv`)

The population is the MSFragger PSMs with |massdiff| > 0.05 Da: 24,389 PSMs. The 0.05 Da cut is needed because uncalibrated massdiffs of unmodified peptides reach 0.01–0.04 Da.

| stage | PSMs | share |
|---|---|---|
| MS2 with an MSFragger shifted PSM | 24,389 | 1.000 |
| tagged | 24,388 | 1.000 |
| a tag that is a substring of MSFragger's peptide | 22,337 | 0.916 |
| some placement on MSFragger's peptide | 11,317 | 0.464 |
| ... with MSFragger's shift (±0.02 Da) | 8,731 | 0.358 |
| the selected sample has that peptide and shift (±0.01 Da) | 7,628 | 0.313 |
| localized (fragment or sequence class) | 1,320 | 0.054 |
| site checkable (MSFragger localized it) | 1,170 | – |
| site agrees | 1,024 | 0.875 of checkable |

- Placement loses most: 22,337 → 11,317 PSMs.
  - 1,625 of the PSMs have two missed cleavages, which `-recon_missed_cleavages 1` cannot reach.
  - Shift-specific numbers are in `funnel.tsv`. For example, Na: 1,479 → 553 placed. Unalkylated Cys: 341 → 106.
- Selection loses 8,731 → 7,628. Of the 1,092 joined spectra where FASTag's sample is exact but MSFragger's PSM is shifted:
  - 1,045 have the shift as a variable modification inside the selected tag, so it is read, but not as a gap;
  - in 2, the right gapped placement was among the selected tag's placements;
  - in 29, the exact placement had a gapped rival on a homologous (non-nested) peptide.
  - In the blind arm, the missed-shift rate is 0.004.
- The review's mechanism, "an exact homolog beats the modified peptide", is therefore measurably rare here: at most 29 of 12,105 shifted joined spectra.

### Selection rules (`analysis/selection.tsv`)

Measured on the joined spectra (Wilson 95 % CI). "gap precision" is the share of FASTag's gaps that MSFragger confirms within 0.01 Da. "false shift" is a FASTag gap where MSFragger has no shift.

| rule | joined | shift agreement | gap precision | false shift | shift recall | missed shift |
|---|---|---|---|---|---|---|
| min_delta (default) | 22,630 | 0.721 [0.715, 0.726] | 0.650 [0.642, 0.659] | 0.061 [0.057, 0.066] | 0.630 [0.622, 0.639] | 0.090 [0.085, 0.095] |
| consensus (most tags agree) | 22,622 | 0.723 [0.717, 0.729] | 0.656 [0.647, 0.664] | 0.061 [0.057, 0.066] | 0.635 [0.627, 0.644] | 0.091 [0.086, 0.096] |
| homolog gapped rival preferred over exact | 22,630 | 0.700 [0.694, 0.706] | 0.623 [0.614, 0.632] | **0.098** [0.093, 0.104] | 0.630 | 0.088 |
| exact with a homolog gapped rival → ambiguous (514 flagged) | 22,116 | 0.717 [0.711, 0.723] | 0.650 | 0.061 | 0.632 | 0.088 |
| min_delta, blind arm | 25,148 | 0.789 [0.784, 0.794] | 0.709 [0.702, 0.717] | 0.057 [0.054, 0.061] | 0.750 [0.742, 0.757] | 0.004 [0.003, 0.005] |

- **Consensus:** its intervals overlap the default's, so it is not adopted. It stays available as `-delta_select consensus`.
- **Preferring the gapped rival:** raises false shifts from 6.1 % to 9.8 %, so it is rejected.
- **The ambiguity flag:** removes 514 spectra and changes nothing measurable. It is reported per spectrum (`n_exact`, `n_gapped`, `n_peptides`, `placements`), not used as a rule.
- **"Exact vs gapped" in the raw sense:** 11,419 of 12,704 exact samples have a gapped rival placement on the same tag. Almost all of these are the tag's own longer or shorter (missed-cleavage) window. This trivial ambiguity is why the flag only counts non-nested rivals.
- **No variable modifications (blind arm):** this, not the selection rule, gives the measurable gain.

## Step 3: localization, neutral losses, nulls

### Evidence classes and the precision–coverage curve (`analysis/loc_curve.tsv`)

The 15,405 gaps with rival sites were scored under each model against two references:
- MSFragger's localized residues, on joined spectra with the same peptide and the shift within 0.01 Da (Wilson 95 %);
- the null: the same placements on the same spectrum with every peak moved by +7.3 Th, which keeps the peak density and removes the ladder.

| model | evidence ≥ | fragment-localized | coverage | null-localized | null / real | MSFragger checked | site precision |
|---|---|---|---|---|---|---|---|
| count (1.16a) | 1 | 6,559 | 0.426 | 273 | 0.042 | 2,653 | 0.733 [0.716, 0.749] |
| count | 2 | 1,486 | 0.096 | 2 | 0.001 | 747 | 0.877 [0.851, 0.898] |
| strict | 1 | 6,459 | 0.419 | 268 | 0.041 | 2,641 | 0.735 [0.718, 0.751] |
| **strict** | **2** | **1,440** | **0.093** | **2** | **0.001** | **731** | **0.882 [0.857, 0.904]** |
| strict | 3 | 181 | 0.012 | 0 | 0.000 | 86 | 0.930 [0.856, 0.968] |
| strict | 4 | 14 | 0.001 | 0 | 0.000 | 11 | 0.909 [0.623, 0.984] |

`unique` lies between `count` and `strict` (`loc_curve.tsv`). Sequence-constrained gaps (1,013, every model) agree with MSFragger 0.863 [0.828, 0.892] (439 checked).

**Rule chosen: `strict`, evidence ≥ 2.**
- At 1, the lower bound of site precision (0.72) misses the review's 0.8 stop line.
- At 2, it is 0.857 (Clopper–Pearson, charge given: 644/729 = 0.883 [0.858, 0.906]), and the null localizes 2 of 1,440.
- At 3, coverage falls to 1 % for a precision gain within the interval.
- The moved-peak null (0.1 %) is far below the MSFragger disagreement (12 %). Most false sites therefore come from structured evidence, such as wrong placements, chimeras and neighbouring residues, not from chance peaks. Both are reported.
- On these runs, residue columns of fragment-localized calls clear the stop criterion. The 1.16a "localized" share (46 %) did not.

### Neutral-loss satellites (`analysis/dehydration.tsv`)

`strict` removed 251 satellite matches on the 34 −18.011 samples, and 462 on the 86 −17.027 samples.

| shift | count | strict | blind (strict) |
|---|---|---|---|
| −18.011, fragment-localized | 1 (S) | 2 (S 1, A 1) | 3 (S 2, A 1) |
| −17.027, fragment-localized | 2 (Q, N) | 2 (Q, N) | 8 (Q 6, N, I) |

- S/T enrichment of −18.011 calls against a shuffled-site null (each call's site redrawn within its region, 10,000 draws; `analysis/amend_st_enrichment.tsv`):
  - main: 1 of 2 calls on S/T, null mean 0.34, p = 0.34;
  - blind: 2 of 3, null mean 0.67, p = 0.11.
- This is inconclusive by count, as `OPENSEARCH-DEV.md` found: on this donor −18.011 is mostly pyro-Glu and succinimide.
- The satellite exclusion changes the dehydration calls little. Its main effect is that loss peaks of genuine unshifted ions no longer give every site a shifted match.

### Hypothesis-blind arm (`analysis/blind.tsv`)

The rows count localized samples (fragment or sequence class) within ±0.01 Da.

| shift | informed: localized, on expected residue | blind: localized, on expected residue |
|---|---|---|
| +0.984 on N/Q | 163/189 = 0.862 [0.806, 0.904] | 370/433 = 0.855 [0.818, 0.885] |
| +15.995 on M | 129/156 = 0.827 [0.760, 0.878] | 151/184 = 0.821 [0.759, 0.869] |
| +31.990 on W | 7/24 | 6/26 |

- The N/Q and M enrichment persists without the variable modifications, so the hypotheses do not create it.
- The blind arm has more +0.984 samples (2,035 vs 1,337), because the informed arm reads deamidated residues inside the tags.
- The blind arm's shift agreement is higher (table above).

### Entrapment (`analysis/entrapment.tsv`)

`make_entrap.py` adds 80,581 shuffled twins: each tryptic peptide is shuffled, with its K/R kept. `-recon_min_length 8` is the target-only derived value.

| | all | entrapment | share |
|---|---|---|---|
| samples | 29,539 | 67 | 0.23 % |
| exact | 12,704 | 0 | 0 |
| gapped | 16,835 | 67 | 0.40 % |
| localized (fragment or sequence) | 2,459 | 7 | 0.28 % |
| per-run named rows with localized spectra | 264 | 1 row (+71.037 Propionamide@N-term, 1 spectrum) | – |

With an entrapment database of equal size, about 0.4 % of the target's gapped placements are expected to be chance placements. Named, localized rows are essentially free of them.

## Step 4: isotope, charge, classes

### Isotope flag on the precursor flank (`analysis/isotope_flank.tsv`)

| samples within 5 mDa | n | on the precursor-derived flank |
|---|---|---|
| +0.984 | 1,036 | 0.503 |
| +1.003 | 436 | 0.977 |
| +2.007 | 202 | 1.000 |

- +1.003 and +2.007 sit on the precursor flank as precursor isotope errors must. Deamidation splits by side, as residue chemistry does.
- The `isotope_error` reading now needs at least half of a row's gaps on that flank. In the six per-run tables one row loses it: +0.9920 (13C+1, −4.3 ppm), a mixed row with fewer than half of its gaps on the precursor flank. Every other row keeps it.
- With `-isotope_error 0 1`, the complement pairs choose k = 1 for 2,760 of 29,349 samples. The +1.003 samples fall only from 436 to 428, and +2.007 from 202 to 170, so the isotope hypothesis does not remove these rows.

### Charge source (`analysis/charge_strata.tsv`)

2,227 of 29,475 samples (7.6 %) come from precursors without a charge, which are tagged and localized as 2+. The `charge_assumed` column counts them per row.

| charge source | samples | gapped | shift agreement | gap precision |
|---|---|---|---|---|
| given | 27,248 | 14,617 | 0.766 [0.761, 0.772] | 0.734 [0.726, 0.743] |
| assumed (2+) | 2,227 | 1,965 | 0.135 [0.120, 0.153] | 0.098 [0.084, 0.114] |

Assumed-charge gaps are mostly wrong, from a wrong precursor-derived flank. They must be reported apart and left out of any gating count.

### Observation classes and isobars (`analysis/classes.tsv`, `analysis/pooled_rows.tsv`)

The 16,771 nonzero samples fall into these classes:

| class | samples |
|---|---|
| unknown | 7,456 |
| residue | 3,993 |
| isotope | 1,459 |
| adduct | 1,179 |
| terminal | 1,023 |
| extension | 666 |
| fixed-mod replacement | 488 |
| truncation | 236 |
| fixed-mod loss | 139 |
| loss | 123 |
| substitution | 9 |

The pooled rows below are the largest nonzero ones (`-delta_group` rule at 4 mDa on the per-spectrum deltas). The name and isobars come from the largest per-run row. MSF is the share of the row's charge-given joined spectra within 0.01 Da.

| delta | spectra | frag | seq | class (top) | first name / reading | isobars | MSF |
|---|---|---|---|---|---|---|---|
| 0.9860 | 1,098 | 159 | 12 | residue | Deamidated@N/Q | Deamidated=Asn->Asp=Gln->Glu | 0.78 |
| 15.9960 | 649 | 96 | 48 | residue | Oxidation@M/W/I | Oxidation=Ala->Ser | 0.93 |
| 21.9840 | 469 | 51 | 20 | adduct (Na) | Cation:Na | – | 0.84 |
| 31.9900 | 426 | 6 | 17 | residue | Dioxidation | Dioxidation=Oxidation+Oxidation | 0.97 |
| 57.0225 | 399 | 19 | 116 | terminal 240, residue 151 | Carbamidomethyl | Carbamidomethyl=Ala->Gln=Gly=Gly->Asn=… | 0.96 |
| 1.0030 | 392 | 9 | 16 | isotope 385 | 13C+1 | – | 0.81 |
| −43.0035 | 302 | 120 | 0 | fixed-mod replacement | Methyl@C[-Carbamidomethyl] | – | 0.92 |
| 156.1020 | 266 | 30 | 10 | extension 191 | Arg@N-term | – | 0.48 |
| 42.0120 | 262 | 112 | 117 | terminal | Acetyl@N-term/Protein N-term | Acetyl=Methyl+Formyl | 0.89 |
| 43.0065 | 256 | 10 | 33 | terminal 168 | Carbamyl | – | 0.93 |
| 58.0055 | 142 | 49 | 59 | terminal | Carboxymethyl | Carboxymethyl=Oxidation+Acetyl=Deamidated+Carbamidomethyl | 0.85 |
| 37.9470 | 137 | 13 | 0 | adduct (Ca[II]) | – | – | 0.98 |
| 269.1865 | 122 | 35 | 3 | extension 121 | – | – | 0.00 |
| 52.9120 | 117 | 11 | 0 | adduct (Fe[III]) | – | – | 0.93 |
| −57.0205 | 117 | 63 | 0 | fixed-mod loss 104 | (unalkylated Cys) | – | 0.74 |

- The new adduct classes read rows that had no name. +37.947 is Ca²⁺ for 2H, not K⁺, which is 9 mDa off. +52.912 is Fe³⁺.
- −57.021 localized on C is a fixed-mod loss, before the isobaric reading "Gly lost".
- +156.102 and +269.187 are extensions (missed cleavages). MSFragger puts the +269 spectra elsewhere, because its digest contains them.

## Proposed amendment text for PREREG-dha (not applied; the author decides)

> **AMENDMENT-2 to PREREG-dha (draft, 2026-11-18).** Completes AMENDMENT-1 §4. Written from development data only (`output/features-1.16/item1-dev/HARDENING.md`). No held-out run has been opened. To be frozen in `dha/freeze2/` with SHA256SUMS before any held-out output exists.
>
> **1. Build and arguments.**
> - FASTag `feat/deep-exam` at `425f16b2` or a later commit that leaves the survey outputs of the six development runs byte-identical.
> - Defaults: `-delta_loc_model strict`, `-delta_loc_min_evidence 2`, `-delta_select min_delta`, `-delta_isotope_flank precursor`, `-delta_group 0.004`, `-recon_sub_tolerance 5` ppm, `-delta_name_tolerance 10` ppm, `-delta_isobar_tolerance 0.001`.
> - Every run adds `-delta_spectra_out -delta_counts_out -delta_loc_null 7.3`.
> - **Two arms:**
>   - **blind** (no `-variable_modifications`): **gating**;
>   - **informed** (Oxidation (M), Deamidated (N/Q), as frozen): reported.
>   - Reason: on dev the blind arm agrees better with the reference (shift agreement 0.789 vs 0.721, missed shifts 0.4 % vs 9.0 %), and it is the blind survey the paper claims. *Alternative for the author: gate on the informed arm. Then the floors of §3 fail on dev for unalkylated Cys (precision lower bound 0.65).*
> - MSFragger and the join as frozen. Analysis: `hardening/harden_analysis.py`, frozen with the held-out run list.
>
> **2. Units.**
> - A *call* is a `-delta_spectra_out` line with |delta − shift| ≤ 0.01 Da and `loc_class` = `fragment`, on the expected residue: C, N-term|C or C-term|C for Cys; S/T, including terminal-ambiguous, for −18.011.
> - Spectra with `charge_source` = `assumed` are excluded from every gating count and reported separately (dev: 7.6 % of samples, gap precision 0.10).
> - A run whose `-delta_counts_out` has a `check_*` row that is not `ok` is excluded and reported.
> - All intervals are exact Clopper–Pearson 95 %; a criterion passes on its lower bound (LB).
>
> **3. Gating criteria (blind arm).**
> - **G1 Shift precision**, per common shift: of FASTag samples within 0.01 Da of the shift that have a joined MSFragger PSM, those whose massdiff is within 0.01 Da. LB ≥ 0.80 for each of oxidation +15.9949, Na +21.9819, dioxidation +31.9898, Methyl@C −43.0058, acetyl +42.0106, carbamyl +43.0058, carbamidomethyl +57.0215 and unalkylated Cys −57.0215. Dev LBs: 0.938, 0.935, 0.971, 0.917, 0.861, 0.844, 0.946, 0.869.
> - **G2 Recovery**, per common shift: of joined MSFragger PSMs at the shift, those FASTag places there. LB ≥ 0.60. Dev LBs: 0.694 (carbamyl) to 0.935. Recovery against all MSFragger positives (dev 0.31 overall, placement-limited) is reported, not gating.
> - **G3 Site precision:** fragment-localized calls of all shifts that MSFragger localizes, same peptide and shift. Agreement with MSFragger's localized residues LB ≥ 0.80 (dev 845/978 = 0.864 [0.841, 0.885]). The moved-peak null (`null_class` = `fragment`) must not exceed 2 % of the fragment-localized calls (dev 0.1 %).
> - **G4 Hand-check, common shifts:** 100 fragment-localized calls, stratified over the eight G1 shifts in proportion to their calls, at least 8 each, drawn with `random.Random(20261118)` over the calls sorted by (run, scan). Protocol §4 unchanged; ambiguous counts against. Pass: ≥ 80 correct (LB ≥ 0.70).
> - **G5 Rare shifts, all calls hand-checked:** Cys→Dha at −91.009 (and at −33.988 if any) on C; −18.011 on S/T. Per shift, with ≥ 20 calls: LB ≥ 0.50 (e.g. ≥ 15/20). With fewer: INCONCLUSIVE for that shift. Dev (blind): 0 fragment-localized −91.009 calls (2 ambiguous on C), 2 S/T −18.011 calls.
> - **G6 S/T enrichment of −18.011:** observed S/T calls against the shuffled-site null (each call's site redrawn uniformly in its region, 10,000 draws, `random.Random(20261118)`), one-sided p ≤ 0.05, with ≥ 10 calls. Fewer: INCONCLUSIVE (dev: 3 calls, p = 0.11).
> - **G7 Naming:** of the 20 largest nonzero pooled rows (charge-given spectra), a row counts when both hold:
>   - (a) its majority observation class is not `unknown` and it carries a name, an `isotope_error` reading or a class detail (extension residues, adduct, fixed-mod loss);
>   - (b) MSFragger confirms the mass (≥ 50 % of joined spectra within 0.01 Da).
>
>   Unnamed or unknown rows count as failures. A row whose name has isobars counts as its isobar class, not as one chemistry. Pass: ≥ 14 of 20 (dev, informed arm: 18 of 20; +156.102 and +269.187 fail b).
>
> **4. Outcome.**
> - B passes when G1–G7 pass.
> - B fails when any criterion fails on its LB with enough data.
> - Otherwise B is INCONCLUSIVE. A per-shift criterion with < 30 joined MSFragger positives is INCONCLUSIVE for that shift.
>
> **5. Reported, not gating.**
> - The informed arm.
> - Deamidation and 13C+1 precision and recovery (overlapping windows; MSFragger does not localize < 1.5 Da).
> - The precursor-flank share of the +1.003 / +2.007 rows (dev 0.98 / 1.00).
> - The entrapment share in a separate entrapment run (dev 0.4 % of gaps).
> - The reconciliation table, the loss funnel and the charge-assumed stratum.
>
> **6. Unchanged.** The 171-run held-out split, MSFragger 4.4.1, scoring once.

## Limits

- One donor, six runs.
- MSFragger's `best_locs` is its own heuristic. Site precision measures agreement with it, not truth.
- The moved-peak null is a floor for chance localization. It is not the false-localization rate of wrong placements.
- The observation classes say what a mass is consistent with, in a fixed order. The adduct, extension and fixed-loss readings are mass coincidences until checked by MS1 or an independent search.
