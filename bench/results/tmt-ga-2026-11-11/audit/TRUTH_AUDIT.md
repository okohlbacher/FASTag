# Frozen-reference audit for the GA-only experiment

This audit does not alter any reference PSM or use FASTag output to relabel truth. The primary experiment must retain its original denominator and labels. Independent-engine comparisons and selected raw-spectrum inspection are supplemental evidence, not a new gold standard.

## Integrity and chemistry

All 42,108 frozen PSMs (33,854 TMT, 8,254 label-free) parse under their actual Sage search configuration, without duplicate scan identifiers. The maximum difference between the annotated neutral peptide mass and Sage's `calcmass` is 0.00160 Da (0.00147 Da in TMT), consistent with the written single-precision masses. Every selected numerical modification is allowed by the corresponding configuration. The first audit flagged 90 control protein-N-terminal acetylations because the audit parser initially omitted Sage's `[` site notation; that parser omission was fixed, and these are valid configured modifications.

For the three runs whose complete raw metadata were read (PXD037999, PXD004541 fr09 and Erwinia), all 21,984 frozen PSMs map to raw MS2 scan identifiers with the same charge. Raw precursor neutral masses and Sage `expmass` differ by at most 0.00050 Da. This verifies mapping; it does not establish peptide identity.

Erwinia has 28 reference PSMs containing TMT on tyrosine. The frozen Sage search allows this variable modification; the benchmark tagger omits it. This chemistry limitation must not be attributed to the GA filter. Label-free Sage truth also allows deamidation and protein-N-terminal acetylation that are absent from the tagger alphabet.

## Independent searches

Existing closed-search Comet outputs were used; no FASTag-derived candidate/open-search configurations were used. We rebuilt a conservative per-spectrum comparison: retain the best rank-1 E-value, preserve tied candidates, treat a tied all-decoy candidate conservatively as decoy, calculate monotone D/T q-values over tied score groups, and reject any entrapment assignment. This differs from older scripts that could count multiple tied rank-1 rows as multiple PSMs. These comparisons do not change the frozen Sage reference.

| Run | Frozen Sage PSMs | Shared accepted Comet spectra | Same sequence, I=L | Same modified peptide |
|---|---:|---:|---:|---:|
| PXD037999 | 8,270 | 6,774 | 6,773 | 6,772 |
| PXD004541 fr09 | 11,072 | 9,548 | 9,543 | 9,541 |
| Erwinia | 2,642 | 1,101 | 1,088 | 1,087 |

The first two Comet inputs match the benchmark input SHA256 exactly. Historical Erwinia Comet used another conversion of the same acquisition, so its agreement is weaker corroboration than an exact-input replication. All 6,103 MS2 scan IDs, charges and retention times match (RT numerical difference below 4e-13); precursor values and centroid peak selection differ in some spectra. For all 26 selected Erwinia spectra, every benchmark mz/intensity pair occurs exactly in the old conversion; 3 peak arrays are identical, and 23 omit some old peaks. Their selected precursor values differ by less than 0.001 m/z. The whole-file conversion comparison also finds some larger precursor changes, which prevents treating the full Erwinia Comet comparison as an exact-input control.

The deposited Erwinia Mascot DAT reproduces the earlier 2,254 accepted PSMs at score >=16.85 using separate target/decoy score distributions and a 1% D/T cutoff. We decoded the variable modifications, unlike the old repository reader. It shares 2,142 accepted spectra with Sage; 2,132 sequences and 2,128 modified peptides agree. This is a different search on the same acquisition, not an independent biological sample.

## What the reference cannot guarantee

The reference is a one-best-PSM search result at nominal 1% PSM q, not exhaustive truth for every ion or peptide in a spectrum. Before conservative entrapment exclusion, PXD037999 had 44 pure-entrapment and 181 mixed target/entrapment assignments among 8,495 accepted targets; fr09 had 82 pure-entrapment and 114 mixed assignments among 11,268. The mixed assignments must not be counted as known false sequences. On the historical equal-size real/entrapment design, `2E/(T+E)` is approximately 1.04% and 1.46%, respectively; these are aggregate checks with uncertainty, not per-PSM correctness labels.

PXD037999 has 290 accepted PSMs with only 4–6 matched fragments (3.51% of its reference); the other TMT runs have 3 (fr02), 9 (fr09), and 8 (Erwinia). Its 653 PSMs with q>0.005 are still accepted but are less secure than high-scoring consensus identifications. A small benchmark delta may involve uncertain reference assignments even when the aggregate FDR is acceptable.

## Selected actual-spectrum evidence

`spectrum_support.json` includes raw peaks, raw precursor metadata, reference scores, and every matched theoretical ion. All b/y cleavage ions at charges 1 through min(2, precursor charge) are considered. A match uses the highest-intensity raw peak within 20 ppm; reported TIC counts each peak only once per peptide. The matching is descriptive and does not estimate a peptide-level false-discovery probability. There is no denoising, neutral-loss matching, or deisotoping. Erwinia additionally includes matching at its original 0.2-Da search tolerance.

* **PXD037999, scan 55112:** the two adjacent-methionine oxidation placements have exactly the same 14 matched raw peaks and 24.73% TIC at 20 ppm. Sage `delta_next=0`. This is unresolved modification localization, not evidence that either search is corrupt.
* **PXD037999, scan 49759:** frozen Sage's peptide has 19 matched peaks / 24.59% TIC; accepted Comet's different near-isobaric peptide has 15 / 9.55%. All matched peaks are exclusive to the respective candidate in this two-peptide comparison. Sage has strong support, but the additional independent peptide cannot be dismissed merely because it differs from the one-best reference; a mixed spectrum is plausible.
* **Erwinia, scan 5076:** Sage's isotope+1 peptide has 21 matched peaks / 21.37% TIC and isotope-corrected precursor error −15.4 ppm (inside its 25-ppm search limit). Accepted Comet and deposited Mascot agree on a different peptide with 22 peaks / 38.08% TIC and +3.79 ppm precursor error. Sage has 19 exclusive peaks / 9.76% TIC and the competing peptide 20 / 26.47%. At 0.2 Da the counts become 24 and 23. Both peptides have substantial independent fragment support; coisolation and incomplete single-peptide truth are plausible. Do not call this a proven wrong Sage PSM.
* **Erwinia, scan 1273:** Sage has 2 matched peaks / 1.61% TIC at 20 ppm, compared with accepted Comet's 10 / 6.18%. At the original 0.2 Da these become 10 / 4.55% and 11 / 6.25%; Sage residuals span −0.0563 to +0.0567 Da, while the competing 20-ppm matches span −0.00480 to +0.00108 Da. This suggests a questionable reference assignment under the narrow fragment model, but the broader original tolerance and low signal must remain explicit. Mascot's top peptide agrees with Comet but its q=0.0736 is not accepted at 1%.
* **PXD037999, scans 7504 and 11923:** raw peaks are supplied for the separate gap-order/composition audit. A missing intermediate cleavage can leave equal-mass dipeptide spellings unresolved; one chosen peptide cannot confer order information on the gap itself.
* **PXD037999, scans 28458, 28925, 28731, 33905:** apparent displaced N-terminal GA-anchor patterns are not actual precursor isotope mistakes. Raw precursor residuals relative to their reference peptides are +0.00824, +0.00693, +0.00448, +0.00813 Da; all Sage isotope-error fields are zero. The anchor−1/−2-isotope coincidences do not justify broadening the filter by those isotope offsets. Raw peaks are supplied for the first two.

The actual GA-v1 tag output demonstrates the consequence of incomplete reference truth. Erwinia 1273 reports rank-1 `QSED`, which passes both sequence/flank and residue-mass matching to the accepted Comet peptide but fails both metrics against frozen Sage; no Sage-correct tag appears in its top 50. Erwinia 5076 reports rank-1 `EELT`, which passes both metrics against the accepted Comet/Mascot peptide, while Sage-correct tags remain lower in the top 50. These outputs are unchanged between baseline and GA-auto, in both chemistry configurations. They explain residual apparent failures; they do not explain away any negative filter effect or inflate its measured improvement. `case_alternate_peptide_scores.tsv` preserves the full case-level sensitivity calculation.

## Sage field semantics

Sage v0.14.7 `posterior_error` stores log10(PEP), explicitly assigned in `crates/sage/src/ml/linear_discriminant.rs` lines 194–199, so negative numbers are expected. `isotope_error` is a mass offset in Da, not an integer isotope count. `matched_intensity_pct` sums matched b/y intensities by theoretical-ion matches, without requiring unique raw peaks; values above 100 are possible and are not unique explained TIC. This audit's raw matching uses unique peaks instead.

Sources: [Sage v0.14.7 LDA implementation](https://raw.githubusercontent.com/lazear/sage/v0.14.7/crates/sage/src/ml/linear_discriminant.rs), [Sage v0.14.7 scoring implementation](https://raw.githubusercontent.com/lazear/sage/v0.14.7/crates/sage/src/scoring.rs).

## GA-v1 outcomes on supplemental quality strata

These calculations use the completed `tmt-ga-2026-11-11/spectrum_outcomes.tsv.gz`, with the original labels unchanged. An independent-support subset requires the same modified peptide, with I=L, in an accepted Comet or Mascot result. The Erwinia support remains subject to the conversion and separate-search caveats above. These are post hoc diagnostic subsets, not a replacement primary benchmark or a new independent biological validation.

On the two independent projects (PXD037999 and Erwinia), this subset has 8,979 PSMs. Label-aware paper rank-1 correctness increases from 7,642 to 7,672 (+30, +0.334 percentage points); strict correctness increases from 7,640 to 7,670. There are no rank-1 losses. Recall is unchanged at 8,685 paper / 8,684 strict. Label-blind rank-1 correctness gains 29 under either rule, with no losses and unchanged recall. Adding within-project fr09 gives 18,520 supported PSMs: label-aware rank-1 gains 86; label-blind gains 88 paper / 81 strict; there are no losses and no recall changes. Thus the rank-1 benefit survives this corroboration requirement; the small whole-cohort recall gains are absent from this subset.

Residual error is associated with weak search evidence. Across all TMT runs, label-aware GA-auto under the paper rule misses all top-50 correct tags in 310/2,183 PSMs with q>0.005 (14.2%), versus 486/31,671 with q<=0.005 (1.53%). The higher-q group comprises 6.45% of PSMs but 38.9% of the 796 recall misses. For <=6 matched fragments, 157/310 PSMs miss (50.6%), versus 639/33,544 (1.91%) above six fragments. On only the independent projects, the higher-q comparison is 234/710 (33.0%) versus 352/10,202 (3.45%). These associations are consistent with both genuinely hard spectra and uncertain reference assignments; they do not establish that a failed tag is actually correct.

In Erwinia, 4/28 TMT(Y) PSMs lack a correct top-50 tag and 10/28 lack a correct rank-1 tag, versus 102/2,614 and 425/2,614 without TMT(Y). This small, omitted-chemistry stratum has worse performance, while most of its PSMs still yield a correct tag elsewhere in the peptide. Quality strata overlap and their error counts must not be added.

Exact numerators are in `quality_subset_paired.tsv`, `failure_quality_strata.tsv`, `quality_audit_summary.json`, and `selected_case_outcomes.tsv`. `analyze_outcomes.py` reproduces the first, second, and selected-case tables from the frozen-reference audit tables and completed outcome file.

## Reproduction and provenance

`audit_truth.py` writes `truth_audit_summary.json` and `truth_rows.tsv.gz`. `compare_engines.py` writes `engine_summary.json`, `independent_candidates.tsv.gz`, `engine_comparisons.tsv.gz` and `engine_disagreements.tsv`. `extract_raw_spectra.py` and `raw_requests.json` write the selected raw spectra plus full raw precursor metadata. `score_raw_spectra.py` writes the compact evidence JSON/TSV and Erwinia conversion comparison. `independent/manifest.json` preserves source paths, input mappings, SHA256 and sizes of the copied independent outputs. No production FASTag source or frozen benchmark truth is modified by these scripts.
