# Digest, label and mass-gap reports

## Purpose

Three opt-in reports that describe how a run was digested and labelled, computed from the tags FASTag
already reports:

- `-digest_out`: the terminal residues of the tags and the protease call they support;
- `-label_out`: isobaric label gaps at either tag end (N- and C-terminal counts pooled, each given in the description) and heavy SILAC residues;
- `-massgap_out`: the precursor-vs-peptide mass-gap distribution, Cys alkylation counts and gap
  explanations as modification combinations.

FASTag reports measurements: counts, log-likelihoods, the call, its margin and the no-call reason.
Interpretation (confidence, thresholds for evidence) stays with the caller; see the last section.
The counting reproduces prose-auto 0.1.3 (`prose_auto/external.py`, `prose_auto/delta_combos.py`),
but on the internal doubles instead of the 4-decimal tag TSV values.

The tag TSV, `-recon_out`, `-delta_out` and the species report are byte-identical with and without
these options; `-out_spectra` mzML records every parameter, so it lists the new options and their
values. The three passes of a typical caller stay separate runs
(species at k=7, termini at k=4, mass gaps with `-recon_fasta`), since their settings differ.

## File format

Long-form TSV, one header row, no comment lines:

```
section	key	value	n	description
```

| Column | Content |
|---|---|
| `section` | group of rows (below) |
| `key` | name within the section; dotted sub-keys, e.g. `C.P1.K` |
| `value` | integer, decimal (shortest round-trip form of the double), or a word |
| `n` | number of tags or spectra the value is based on; `-` if none |
| `description` | one factual English sentence with the numbers, no confidence wording |

Example descriptions: "A share of 0.127 of the C-terminal tag ends are K or R, labelled ones
included." and "Chymotrypsin fits 0.673 log-likelihood per tag end better than unspecific." Every file starts with `run` rows: `version`,
`input`, `fragment_tolerance`, `fragment_tolerance_unit`, `tag_length`, `subsample_fraction`,
`subsample_spectra`, then the report's own settings: for `-digest_out` `window_da`, `tag_min`,
`background_share`, `models` and `background`; for `-label_out` `window_da`, `low_resolution` and
`silac_min`; for `-massgap_out` `window_da` (the window in effect), `min_spectra`, `min_share`,
`min_bin`, `max_mods` and `mods` (the number of modifications combined). `-massgap_top`,
`-massgap_silac_share` and `-massgap_silac_min` have no run row: the first sets how many `top` rows
there are, and the other two are named in the `silac call` description.

## Counting rules (`-digest_out`, `-label_out`)

All counts are over the tag rows FASTag writes (after `-max_tags`, `-max_evalue`, deduplication
and, with `-fasta`, the database filter, whose `efwd`/`erev` entrapment rows count too),
filtered as in `fastag_termini`: `gapped == 0` and `evalue <= 1`. Let `c` and `n` be the sorted
`cterm_mass` and `nterm_mass` values of these tags and `near(v, m)` the number of values within
`m ± w`, both ends inclusive, `w = -digest_window` (0.008 Da, `TERMINUS_WINDOW_DA`). Residue masses
are 0.1.3's table `_RES` (Ile (I) counted as Leu (L), C = 160.03065 for carbamidomethyl), H2O = 18.010565.

| Quantity | Definition (0.1.3 name) |
|---|---|
| `tags_filtered` | number of filtered tags (`len(c)`) |
| unmerged `C.<r>` | `near(c, m_r) + near(n, m_r + H2O)` for r in K, K+TMT, K+TMTpro, K+iTRAQ4, K+8, R, R+10 (`res`) |
| unmerged `N.<r>` | `near(n, m_r)` for the same r |
| `tot` | sum of `res` over all residue keys, including the labelled ones (`tot`) |
| `C.P1.<aa>` | merged C-terminal count: as `res`, with K+TMT, K+TMTpro, K+iTRAQ4 and K+8 added to K, R+10 left out (`cterm`) |
| `N.P1'.<aa>` | merged N-terminal count: `near(n, m)` with the same merging (`nterm`) |
| `n_c`, `n_n` | sums of the merged C- and N-terminal counts |
| `kr` | share of `tot` on keys starting with K or R (`kr`) |
| `anchors_LVFYM` | share of `tot` on L, V, F, Y, M |

Positions use the protease notation of Schechter and Berger: the cleavage falls between P1 and P1';
P1 is the last residue before it, P2 the one before P1, and P1' the first residue after it.
Positions P4..P2 and P2'..P4' come from the tag sequence of each tag counted at P1 or P1': a tag counted
through `cterm_mass` gives P2..P4 as its last three residues (right to left), one counted through
`nterm_mass + H2O` (a reversed b-ion tag) gives them as its first three, and one counted at P1' gives
P2'..P4' as its first three. Residues outside the 19-letter alphabet are not counted at that position.
The classifier uses P1 and P1' only.

**Classifier** (`protease_call`, `_tag_models`). For each model and end, the mixed distribution is
`p'(a) = (1 − s)·p(a) + s·bg(a)` over the 19 residues, `s = -digest_background_share` (0.05,
`NONSPECIFIC_SHARE`), with the background of the same end. The score is the multinomial
log-likelihood `Σ k_a·ln(p'(a)/Σp')` of the C-terminal counts plus, only when `n_n ≥ -digest_tag_min`
(100, `TAG_MIN`), that of the N-terminal counts. Sums run in the residue order `GASPVTCLNDQKEMHFRYW`, as in 0.1.3, and add
as Python's `sum()` does (Neumaier-compensated, CPython ≥ 3.12). The call
is the top model; the runner-up is the best model of **another class**; the margin is the score
difference divided by `n_c` (plus `n_n` when the N end is used). Ties go to the model listed first, and
a score that is not a number ranks last; an exact tie between the call and the runner-up is no call
(`tie`), never a margin of 0.

## `-digest_out` sections

| Section | Keys | Value |
|---|---|---|
| `run` | as above, plus `window_da`, `tag_min`, `background_share`, `models` (`shipped` or path), `background` (`shipped_human`, `fasta:<path>` or `models_table`; for a FASTA the sentence says whether a pseudocount was added) | |
| `meta` | `instrument`, `instrument_model`, `native_id_format` (accession), `ion_mobility` (`yes`/`no`/`absent`), `ion_mobility_unit` (`1/K0`, `ms`, `FAIMS CV`, `other` or `-`), `ms2_scan_window_low` (median lower limit, m/z), `ms2_first_peak_mz` (median m/z of the first peak of each MS2, the input of 0.1.3's gate), `ms2_whole_intensity_share` (share of the MS2 peak intensities above 0 that are whole numbers; `n` = those peaks) | word, m/z or decimal |
| `count` | `tags_filtered`, `tot`, `n_c`, `n_n` | integer |
| `residue` | `C.K`, `C.K+TMT`, `C.K+TMTpro`, `C.K+iTRAQ4`, `C.K+8`, `C.R`, `C.R+10`, same with `N.` | integer |
| `pos` | `C.P4.<aa>` .. `C.P1.<aa>`, `N.P1'.<aa>` .. `N.P4'.<aa>` (19 residues each) | integer |
| `share` | `kr`, `anchors_LVFYM`, `nterm_D` | decimal |
| `model` | `<model>.loglik`, `<model>.class`, and `<model>.C.<aa>`, `<model>.N.<aa>` (the model's distribution, normalised, before mixing; an end that is the background has the background's values), all written when `n_c ≥ tag_min` | decimal, word |
| `background` | `C.<aa>`, `N.<aa>` (19 residues each): the background in use, normalised | decimal |
| `call` | `status` (`call`/`no_call`); on a call `model`, `class`, `runner_up`, `runner_up_class`, `margin` (log-likelihood per tag), `uses_nterm`; on no call `reason`, and on a tie `tied` (the tied models) | |
| `nocall` | `low_resolution`, `timstof`, `ms2_scan_window`, `ms2_first_peak`, `ion_counts`, `few_tags`, `nonfinite_score`, `tie`: whether each rule fired (`yes`/`no`/`unknown`) | word |

No call is written as `status no_call` with a `reason`, never as a call with margin 0.

## No-call rules and metadata

Checked in this order; `reason` is the first that fires, and `nocall` lists all of them.

| Rule | Fires when | Source |
|---|---|---|
| `low_resolution` | `-fragment_tolerance_unit Da` | option; the file is still written |
| `timstof` | instrument name or model contains "timsTOF", or the native ID format is Bruker TDF (MS:1002818/MS:1002819), or MS2 ion mobility is in 1/K0 | metadata |
| `ms2_scan_window` | median MS2 scan-window lower limit > y1(K) + 0.1 = 147.2128 m/z (`Y1_K`); not 0.1.3's gate | metadata |
| `ms2_first_peak` | median m/z of the lowest peak of each MS2 > 147.2128 (0.1.3's gate, `external.py` `ms2_low_mz > Y1_K + 0.1`, there over a sample of 20,000 MS2) | peaks |
| `ion_counts` | the input names no instrument, model or native ID format (`timstof` reads `unknown`) and at least half of the MS2 peak intensities above 0 are whole numbers (`kWholeShare` 0.5); zero-intensity peaks are left out; native ID formats that name no vendor count as none: MS:1000774/MS:1000775 (multiple/single peak list), MS:1000776 (scan number only), MS:1000777 (spectrum identifier, which OpenMS writes when the type is unknown) and MS:1000824 (no nativeID format); `no` whenever real metadata is present, `unknown` without peaks; not in 0.1.3 | peaks |
| `few_tags` | `tot < tag_min` (gate in `fastag_termini`) or `n_c < tag_min` (gate in `protease_call`) | counts |
| `nonfinite_score` | the call's or the runner-up's log-likelihood is not finite: a residue seen at the tag ends has probability 0 (0.1.3 raises `ValueError` here) | scores |
| `tie` | the runner-up's log-likelihood equals the call's (e.g. Asp-N, Lys-N and unspecific when the N end is not used) | scores |

Metadata (OpenMS develop APIs):

- **Instrument:** `ExperimentalSettings::getInstrument()` → `Instrument::getName()`, `getModel()`;
  native ID format `ExperimentalSettings::getSourceFiles()` → `SourceFile::getNativeIDTypeAccession()`.
  MS:1000774, MS:1000775, MS:1000776, MS:1000777 and MS:1000824 are reported in `native_id_format`
  but name no vendor, so `timstof` and `ion_counts` treat them as absent.
  mzML: the run header read with `MzMLFile` and `PeakFileOptions::setMetadataOnly(true)` (parsing stops
  at `<spectrumList>`), because FASTag's fast mzML reader skips run-level metadata. mzPeak: the
  `ExperimentalSettings` that `MzPeakFile::transform` hands to FASTag's consumer.
- **Ion mobility:** `IMTypes::determineIMFormat(const MSSpectrum&)` (`IMFormat::IM_PEAK` /
  `IM_SPECTRUM`), unit from `MSSpectrum::getIMData()` (per-peak arrays, `containsIMData()`) or
  `MSSpectrum::getDriftTimeUnit()`; `DriftTimeUnit::VSSC` means TIMS. FAIMS
  (`FAIMS_COMPENSATION_VOLTAGE`) is ion mobility but not timsTOF.
- **Scan window:** `SpectrumSettings::getInstrumentSettings()` → `InstrumentSettings::getScanWindows()`
  → `ScanWindow::begin` (lowest per MS2, median over MS2). The fast mzML reader reads the scan window and
  the scan's ion mobility cvParams for this.

When a rule's metadata is missing, the rule reads `unknown`, the call is made normally, and the
`description` says "metadata absent".

**Why the metadata rules exist, and what replaces them without metadata.** prose-auto 0.1.3 makes no
call on timsTOF (ddaPASEF, diaPASEF), where C-terminal R is nearly invisible (unusable on its 23
DIA/timsTOF runs), and on MS2 that start above y1 of K (147.11), where the C-terminal K and R ions
cannot be seen. `ms2_first_peak` is 0.1.3's own gate for the second case and needs no metadata;
`ms2_scan_window` reads the same thing from the scan window. An MGF (and a converted pseudo-spectrum
mzML) names no instrument, native ID format or scan window, so `timstof` and `ms2_scan_window` read
`unknown` there. `ion_counts` stands in for `timstof` on such input: timsTOF intensities are ion
counts, whole numbers, and Orbitrap intensities are not. Measured on public runs (FASTag 1.9.0
differential set and MGFs written by `tools/mzml_to_mgf.py`):

| Runs (mzML and MGF of each give the same share) | whole-number share |
|---|---|
| 35 Orbitrap runs (Q Exactive, Exploris, Fusion, Lumos, Eclipse, Velos, Elite, Astral) | 0.00001 – 0.008 |
| 11 timsTOF runs (PXD017703, PXD047793 diaTracer; PXD010012, PXD054073 ddaPASEF) | 0.957 – 1 |

MGF writers that cut intensities to 6 significant digits (OpenMS FileConverter) raise the share of
Orbitrap data, because large intensities then end in zeros: rewritten with `%g`, the Orbitrap MGFs
of the parity set (35 runs, first 2 million peaks above 0 of each) reach 0.0006 to 0.187 (median
0.066), against 0.0000 to 0.0095 as written. The threshold 0.5 is still above that, but an
Orbitrap run whose MS2 intensities are mostly at or above 1e5 and written with 6 significant digits,
or an MGF whose writer rounds intensities to integers, would cross it and be withheld while its mzML
is called. Independently written Orbitrap MGFs (jpr-bench PXD000001 0.016, PXD003531 0.0011,
PXD076528 subset 0.0002) stay low. Every timsTOF mzML with
metadata is withheld by `timstof` (11 runs), and every scan-window run by `ms2_scan_window` (11 runs).
Their MGFs are withheld too: by `ms2_first_peak` on all 11 scan-window runs and on 11 of the 12
timsTOF MGFs, and by `ion_counts` on all 12. Only one of the 12 needs `ion_counts`: PXD054073's own
deposited AlphaTims MGF (centroided, median first peak 131.5; the MGF written from the run's
mzpeak-convert mzML has 185.1): under the earlier rules it is called `unspecific`, on a HeLa tryptic
digest. Every Orbitrap MGF whose mzML is called (19 runs) keeps the call. On the 1.9.0 differential set (199 runs, 43 of them converted
pseudo-spectra without metadata, whole-number share at most 0.038) `ion_counts` fires on none, and
every other row is unchanged. Converted timsTOF pseudo-spectra whose intensities are not whole numbers
are not caught by it; there `ms2_first_peak` fired on every timsTOF run of the set. Other TOF
instruments that write ion counts (SCIEX, Agilent, Waters) are withheld the same way when their
metadata is missing; with metadata `ion_counts` reads `no` and `timstof` decides. An mzML that
OpenMS writes from an MGF names only a native ID format without vendor (FileConverter: the generic
MS:1000777; FASTag `-out_spectra`: the peak-list MS:1000774), which is not metadata: `timstof` reads `unknown` there and `ion_counts` decides, so
PXD054073's AlphaTims MGF converted to mzML is withheld as the MGF is (before this, its mzML was
called `unspecific`). timsTOF MGFs whose intensities were scaled or averaged (not whole numbers) are
not caught; zero-intensity peaks are left out of the share, so profile-like MGFs padded with zeros
do not fire the rule. The rule comes after
`ms2_first_peak`, so it changes no reason that 1.9.0 already gave.

### Instrument class of the detection weights (1.12, #3c)

`meta instrument_class` (written with any 1.12 v2 option) picks the detection weights of
`-digest_detection shipped`. Detection is a property of the MS2 analyzer and the fragmentation,
so the class is read from them, not from the instrument name alone (`Digest::instrumentClass`):

- `timstof`: the `timstof` or `ion_counts` no-call rule reads `yes`.
- `orbitrap_hcd`: an Orbitrap-family run (name or model contains Orbitrap, Q Exactive, Exploris,
  Astral, Lumos, Fusion, Eclipse or Ascend, or the run header lists an Orbitrap analyzer) whose MS2
  are mostly beam-type CID (HCD: PSI-MS MS:1000422, or a filter-string `@hcd` token when the
  activation terms say nothing) and not mostly read in the ion trap (`ITMS` filter strings). With no
  activation information at all, only the HCD-only families (Q Exactive, Exploris, Astral) or a
  header with an Orbitrap and no ion-trap analyzer.
- `other`: everything else, in particular LTQ Orbitrap, Velos and Elite runs with ion-trap CID MS2
  (the vendored LTQ Orbitrap XL fixture is `other`).

The per-MS2 counts are taken in the tagging loop only with `-digest_out`. This rule is fixed before
the DEV fit, so the fitted `orbitrap_hcd` weights pool no ion-trap CID runs; PREREG-chem.md records
it when it is written.

## Model table (`-digest_models`)

```
# source header lines start with #
model	class	end	residue	freq
```

- `end` is `C` (P1) or `N` (P1'). Give `freq` values that sum to 1 for each end of each model and of
  the background. They are mixed with the background as given, before the score normalizes, so a table
  in counts or percentages changes the background share and can change the call.
- `class` drives the runner-up rule: the runner-up is the best model of another class.
- Rows with `model = background` are the mixing component, not a model, and must cover all 19 residues
  at both ends. A table without them is mixed with the FASTA composition when a FASTA is given, else
  with the shipped human background.
- `residue = *` (`freq` `-`) sets that end of a model to the background; an end with no rows is the
  background too.
- The table is read as it is: no renaming and no derived models.

**Background choice.** With `-digest_models`, its `background` rows are used, even when a FASTA is
given. Without `-digest_models`, the shipped table is used with its background replaced by the residue
composition of `-recon_fasta`, else `-fasta`, when one is given (Ile (I) counted as Leu (L), other
letters skipped; read as a stream). When the FASTA lacks one of the 19 residues, one count is added to
every residue, so no model scores −∞. The `run.background` row states which.

**Shipped table** `share/FASTag/digest/digest_models.tsv`, installed beside `share/FASTag/taxonomy`
and found the same way; a binary outside its install tree needs `FASTAG_DIGEST_DIR` set to the
directory. Cleavage rules, uniform over the cleaving residues, the other end background:

| Model | Class | C (P1) | N (P1') |
|---|---|---|---|
| Trypsin | Trypsin | K, R | background |
| Lys-C | Lys-C | K | background |
| Arg-C | Arg-C | R | background |
| Glu-C | Glu-C | E | background |
| Chymotrypsin | Chymotrypsin | F, Y, W, L | background |
| Asp-N | Asp-N | background | D |
| Lys-N | Lys-N | background | K |
| unspecific | unspecific cleavage | background | background |

The residues follow the ExPASy PeptideCutter rules and OpenMS `ProteaseDB` (`Enzymes.xml`), except
Glu-C, which is E only (bicarbonate; `ProteaseDB`'s "glutamyl endopeptidase" also cuts after D). The
background is the residue composition of the UniProt human reference proteome (UP000005640; download
date and counts in the file header), Ile (I) counted as Leu (L), normalized over 19 residues. Source: UniProt
(The UniProt Consortium, *Nucleic Acids Res.* 2025), CC BY 4.0. FASTag ships no MEROPS or MHC Motif
Atlas data: HLA ligand and proteasome models are available only through a user `-digest_models`
table. Tests use synthetic tables.

## `-label_out` sections

| Section | Keys | Value |
|---|---|---|
| `run` | as above, plus `window_da`, `low_resolution` (`yes` on a Da tolerance, where the label windows do not hold), `silac_min` | |
| `count` | `tags_filtered` | integer |
| `nlabel` | `<L>.count` = `near(n, m) + near(c, m)`, `<L>.background` = the same at `m + 0.5` Da, `<L>.share` = count / `tags_filtered`, for L = `TMT` (229.162932), `TMTpro` (304.207146), `iTRAQ4` (144.102063) (`_NLABEL`) | integer, decimal |
| `heavy` | `K8.share` = `s(K+8) / max(s(K+8) + s(K), 1e-9)`, `R10.share` likewise, with `s = res / tot` as in 0.1.3; `K.tags` = `res[K] + res[K+8]`, `R.tags` = `res[R] + res[R+10]`; `gate` = `yes` when both are ≥ `-digest_silac_min` (50, `SILAC_MIN_TAGS`) | decimal, integer, word |
| `label_call` (1.12, appended last; the rows above are byte-identical to 1.11) | `status` (`call`, `no_call`), `label` (`TMT`, `TMTpro`, `iTRAQ4`, `SILAC`, joined with `+` when several pass, isobaric first; `label-free` when none passes; `-` on a no call), `basis` (`nterm_gap`, `heavy_share`, `nterm_gap+heavy_share`, `none`), `silac` (`none`, `weak`, `strong`), `reason` (`low_resolution`, `few_tags` (only with `-label_call_min_tags` above 0, since 1.13); `-` on a call) | word |

`label_call` is prose-auto 0.1.10's termini label rule (`prose_auto/external.py` `fastag_termini` /
`termini_evidence`, commit e15aaf7), ported rule for rule (`FASTag::Digest::labelCall`):

- no call on a Da tolerance (`low_resolution`; prose-auto runs the termini only on ppm runs) and below
  `-label_call_min_tags` C-terminal tag ends, `count.tot` of `-digest_out` (`few_tags`; 1.12 used
  prose-auto's `TAG_MIN` 175; the default is 0 since 1.13, see "Label call minimum" below);
- an isobaric label when `<L>.count` ≥ 0.01 × `tags_filtered` and ≥ 20 × max(`<L>.background`, 1);
  the TMTpro row says that iTRAQ8plex has the same mass;
- SILAC (Lys8/Arg10) when `K8.share` and `R10.share` are both ≥ 0.2, the K/R share (`share.kr` of
  `-digest_out`) rounded to 3 decimals is ≥ 0.8 (`KR_TRYPTIC`; prose-auto compares the rounded value),
  and `heavy.gate` is `yes`; `strong` when both shares are ≥ 0.3, else `weak`.

It reads only the tag-end counts, never the mass-gap result, so `-massgap_out` and `-recon_out` do not
change it. Parity: 100 % identical calls with prose-auto 0.1.10 on the 193 label-evaluable SDRF runs of
the digest validation (fastag-bench `table_s3_digest_truth_v190.tsv`), run with prose-auto's own
termini command.

### Label call minimum (1.13, backlog #8; `-label_call_min_tags`)

1.12 ported prose-auto 0.1.10's `TAG_MIN` (175 C-terminal tag ends) as `no_call few_tags`. prose-auto
itself never returns "no call" for the label: below `TAG_MIN` its termini give no label evidence and its
answer is label-free, the default. Ported as a no-call, it cost 30 of the 193 development runs (28 of
them label-free), and `label_call` scored 150/193 (77.7 %), below "always label-free" (159/193). On the
other 163 runs its label equalled the harness's (prose-auto 0.1.3's thresholds, no tag minimum; 178/193)
(`output/jpr-paper/carryover-1.12/label_call.md`; all in-sample).

- `-label_call_min_tags <n>` (default **0**): the `count.tot` a call needs. At 0 every ppm run is called:
  the isobaric, SILAC and `KR_TRYPTIC` rules above run on whatever ends there are, and when none fires the
  call is label-free. That is the harness rule, so on the development runs the call is 178/193, not
  180/193: the 2 mass-gap SILAC runs stay label-free, because `label_call` still never reads
  `-massgap_out`.
- A call from fewer than 175 ends adds to the `status` row's description that "label-free" then means
  only that no label rule fired. Keys, values and the five-row layout are unchanged.
- No C-terminal end at all (`tot = 0`): no SILAC test (the heavy shares are undefined); label-free unless
  an isobaric gap passes.
- `low_resolution` stays a no-call and comes first at any minimum.
- `-label_call_min_tags 175` writes the 1.12 rows byte for byte.

Status: experimental. The held-out test of the default is preregistered in `acceptance/1.13`
(`PREREG-item08.md`).

## `-massgap_out` (requires `-recon_out`, like `-delta_out`)

Input is the `-delta_out` histogram (0.0005 Da bins, local-max grouped), built whether or not
`-delta_out` is written. The window `t` is `-massgap_window` (0.02 Da) on ppm runs and
`-massgap_window_da` (0.5 Da) on Da runs.

| Section | Keys | Value |
|---|---|---|
| `hist` | key = gap (Da, 4 decimals as in `-delta_out`) | spectra |
| `cys` | `spectra` (all rows), `zero_bin` (`|d| ≤ t`), and per 0.1.3 `DELTA_CANDIDATES` entry (`Carbamidomethyl (C)` 57.021464, `Propionamide (C)` 71.037114, `Nethylmaleimide (C)` 125.047679, `Methylthio (C)` 45.987721, `Carboxymethyl (C)` 58.005479): spectra with `|d − m| ≤ t` | integer |
| `combo` | `placed_spectra` (rows with ≥ `-massgap_min_bin` = 2 spectra), `shifted_spectra` (those with `|d| > 2t`; 0 when there are none, where 0.1.3's stats show 1, its division guard) | integer |
| `peak` | `<i>.delta` (the count-weighted mean, full precision), `<i>.spectra`, `<i>.explained_by` (`A + B` or `none`), `<i>.alternatives` (`A + B;C`, `-` when there are none), `<i>.context` (`-`, or `members seen as single-modification peaks` when that rule chose the explanation). Members are joined by space-plus-space, since names contain `+` but no space (`Oxidation + Met-loss+Acetyl`) | |
| `share` | per modification: spectra of the peaks it explains / `shifted_spectra` | decimal |
| `top` | `1` .. `-massgap_top` (5): modifications by share | word |
| `silac` | `call` (`SILAC (Lys8/Arg10)`, `SILAC (Lys4/Arg6)`, `SILAC triplex (Lys4/Arg6, Lys8/Arg10)` or `none`), `Lys4`, `Arg6`, `Lys8`, `Arg10` shares | word, decimal |

**Combination search** (port of `delta_combos.detect`, `explain`, `silac_from_gaps`):

- Modifications: the 38 of 0.1.3's `MODS` (e.g. Oxidation, Deamidated, Acetyl, Phospho, GG, TMTpro,
  Label:13C(6)15N(4)) with their priors, shipped as `share/FASTag/digest/massgap_mods.tsv` (columns
  `name`, `site` as an OpenMS full id such as `Cation:Na (D)`, `prior`). Masses come from
  `ModificationsDB::getInstance()->getModification(site)` → `ResidueModification::getDiffMonoMass()`;
  all 38 are in OpenMS develop's `unimod.xml` with the same masses as 0.1.3's constants.
- Candidates: every multiset of up to `-massgap_max_mods` (3) modifications, sorted by mass.
- Peaks: rows with ≥ 2 spectra, taken by decreasing count (ties: lower gap first); each sums the
  unclaimed rows within `t` of it, centred at the count-weighted mean. A peak is kept when it has
  ≥ `max(-massgap_min_spectra 20, -massgap_min_share 0.005 × placed_spectra)` spectra and `|d| > 2t`.
- Explanations: combinations within `t` of the peak, ranked by fewest modifications, then highest prior
  product, then smallest mass error. Among equal-size combinations, one whose members also occur as
  single-modification peaks wins. A three-modification explanation is kept only when all three occur
  alone; otherwise it becomes an alternative and the peak reads `none`.
- SILAC: Lys4, Arg6, Lys8, Arg10 each count when their share is ≥ `-massgap_silac_share` (0.08); a call
  needs two of them and ≥ `-massgap_silac_min` (500) shifted spectra.

## Options

| Option | Default | Notes |
|---|---|---|
| `-digest_out <tsv>` | | |
| `-label_out <tsv>` | | |
| `-massgap_out <tsv>` | | requires `-recon_out` |
| `-digest_models <tsv>` | shipped table | |
| `-digest_tag_min` | 100 | advanced |
| `-digest_window` | 0.008 Da | advanced |
| `-digest_background_share` | 0.05 | advanced; below 1 |
| `-digest_silac_min` | 50 | advanced |
| `-label_call_min_tags` | 0 | advanced, experimental (1.13) |
| `-massgap_window`, `-massgap_window_da` | 0.02, 0.5 Da | advanced |
| `-massgap_min_spectra`, `-massgap_min_share`, `-massgap_min_bin` | 20, 0.005, 2 | advanced |
| `-massgap_max_mods`, `-massgap_top` | 3, 5 | advanced |
| `-massgap_silac_share`, `-massgap_silac_min` | 0.08, 500 | advanced |

`-digest_models`, `-digest_tag_min` and `-digest_background_share` without `-digest_out`,
`-digest_window` without `-digest_out` or `-label_out`, and `-digest_silac_min` without `-label_out`
are ignored with a warning.

**`FASTAG_FULL_PRECISION=1`** (environment, not in `--help`): the tag TSV writes `nterm_mass`,
`cterm_mass` and `evalue` in shortest round-trip form instead of 4 decimals and 6 significant digits,
so a reader of the TSV sees the doubles the reports use. For differential tests only.

## GUI: Digest tab

Always present. With no report loaded, it offers to open a digest, label or mass-gap report.

- The call (or "no call" with the reason), runner-up, margin and the `description` sentences. With a
  models table that has no model of another class the CLI writes `runner_up none` and margin `-`;
  the tab then shows neither, and no runner-up logo.
- The observed sequence logo P4..P1 | P1'..P4' in bits against the background in use
  (letter height `f_a · I`, `I = Σ_b f_b log2(f_b/q_b) − (s − 1)/(2n ln 2)` clamped at 0, the
  small-sample correction over `s` residues; `n` under each column). Columns with fewer than `tag_min`
  tag ends are greyed, and so are the P' columns when the call does not use the N end. Below it, drawn the same way, the
  logos of the called model and the runner-up (P1 and P1' only; their other positions are the
  background and stay empty).
- The label rows and the heavy shares. Each block names its report file; opening a report of another
  run closes the reports of the previous one. Two reports come from one run when they sit in one
  folder and their `run` rows agree (input, version, fragment tolerance and unit, tag length,
  subsampling); `run input` holds only the input's file name, so it cannot tell two inputs of one
  name apart on its own.
- The mass gaps: a line with the most frequent modifications (the `top` rows) and the SILAC call
  when there is one; the `combo`, `cys` and `silac` sentences; a histogram of the gaps in whole-Da
  columns, with the column at 0 cut at the height of the fullest other column; the gap table with the
  bar cells already used in the Species tab (the fullest bins, expandable to all); the peaks with
  their explanations, alternatives and context; and a chip naming the Cys alkylation gap that the
  most placed spectra show, or saying that there is none.

The logo is a small React SVG component in `gui/src`; no new dependency.

## What stays in prose-auto

- Evidence confidence formulas (enzyme, label, alkylation, modifications).
- The margin = 0 override when isobaric K (`residue` K+TMT, K+TMTpro, K+iTRAQ4) exceeds half the merged K
  and a Lys-C/Arg-C call has Trypsin as runner-up.
- The alkylation call rule, the 2 % / 10 % variable-modification and enrichment shares, and the HLA
  class mapping. FASTag 1.12 also has an alkylation call of its own (`-alkylation_out`, opt-in,
  doc/ALKYLATION-REPORT.md): it bins the single-Cys placements of the reconciler instead of taking
  prose-auto's argmax over all gap placements, so it can call "none"; prose-auto switches to it only
  by a later decision, after the held-out test. The label rule (≥ 1 % of the tags and ≥ 20× background, the SILAC heavy-share
  thresholds and the `KR_TRYPTIC` gate) is also in FASTag since 1.12 (`label_call`, above); prose-auto
  switches to reading it only by a later decision.
- Reagent-genus handling of the species report.
- A PASEF acquisition-mode gate: converted diaPASEF pseudo-spectra carry no instrument, native-ID or
  scan-window metadata and their 1/K0 only on the precursor, so `timstof` reads `unknown` on them
  (`ion_counts` fires on them when their intensities are ion counts).

## Checks

Unit tests with synthetic model tables and tag lists cover `near`, merging, positions, the classifier
and its ties, each no-call rule, the background choice and the combination search. A differential run
on public PXD data (199 termini and 186 mass-gap runs, `FASTAG_FULL_PRECISION=1`) compared the reports
with 0.1.3's Python detectors on the same tag TSV. Under CPython ≥ 3.12 every count, score, call and
peak matched, except `shifted_spectra`, which reads 0 where 0.1.3 shows its division guard 1. Under
CPython 3.11, whose `sum()` is not compensated, scores differ by up to 8e-14 relative and equal-mass
alternatives can swap order. P2..P4 and P2'..P4' were checked against an independent implementation
of the rule above, as 0.1.3 has none.
