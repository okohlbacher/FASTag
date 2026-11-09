# Database-free label discovery (`-label_discovery_out`): design

Status: design, 2026-11-09, branch `feat/label-discovery` (from `origin/main` 702b45c, FASTag 1.12.1).
Nothing here is implemented yet. The thresholds are priors. They are not fitted, and none is
frozen until the evaluation in section 13 has run.

Backlog seed: `output/BACKLOG.md`, "Database-free label discovery". Related code and documents:
`-label_out` (`src/Digest.{h,cpp}`, `src/DigestReport.cpp`), `-massgap_out` / `-delta_out`,
the README section "Digest, label and mass-gap reports", `doc/DESIGN-digest.md` and
`doc/ALKYLATION-REPORT.md`. The ALKYLATION report is the model for how a versioned report is
written down.

## 1. Purpose and scope

`-label_out` answers one question: is this run labelled with TMT, TMTpro or iTRAQ4, or with
SILAC Lys8/Arg10? It counts tag ends at a few fixed masses. It cannot see any other label: other
isobaric tags (iTRAQ8, DiLeu, ...), dimethyl (light, medium or heavy), chemical acetylation or
propionylation of the N-termini, carbamylation, or a lysine-only label. It also cannot tell
iTRAQ8 from TMTpro, which lie 0.0018 Da apart. Of the 193 label-evaluable runs, all three iTRAQ8
runs were called TMTpro (`output/jpr-paper/carryover-1.12/label_call.tsv`).

The new opt-in report finds every terminal or lysine mass offset that a run's tag flanks carry,
known or not, without a protein database. It explains each offset with residues, the known
labels or Unimod (OpenMS `ModificationsDB`) where it can. It reports the offsets as run-level
candidates with a significance, and makes a provisional run-level call.

Out of scope for format 1:

- c/z tags. They are counted and excluded (section 4).
- Internal lysine labels inside a tag. The tag alphabet decides those. A K label that is not
  configured breaks the tag at that K. The C-terminal flank images in section 3 still show it.
- MS1 evidence, such as SILAC pairs. That is the job of `-massgap_out`'s SILAC call.
- Changes to `-label_out`, its `label_call` or the GUI.

## 2. Options

| option | default | meaning |
|---|---|---|
| `-label_discovery_out <file>` | none (off) | Write the report (TSV, format in `doc/LABEL-DISCOVERY-REPORT.md`, to be written with the code). This option alone switches the feature on. |
| `-label_discovery_max_flank <Da>` | 420 | Advanced: largest flank mass histogrammed. It covers the TMTpro images (zero-residue N-terminal flank 304.2, C-terminal K + TMTpro 432.3 is above it; see below), dimethyl/acetyl plus two residues, and K + TMT (357.26). |
| `-label_discovery_depth <0\|1\|2>` | 2 | Advanced: the most residues a flank explanation may contain. |
| `-label_discovery_min_spectra <n>` | 20 | Advanced: spectra a peak or site candidate needs. This is the `-massgap_min_spectra` prior. |
| `-label_discovery_min_share <f>` | 0.005 | Advanced: share of the counted spectra a peak needs. This is the `-massgap_min_share` prior. |
| `-label_discovery_window_n <Da>` / `-label_discovery_window_c <Da>` | 0 / 0 | Advanced: the half-window of the N- and C-terminal flank channels. 0 means estimate it from the run (section 5). |
| `-label_discovery_unimod_top <n>` | 3 | Advanced: Unimod alternatives listed per peak. |

**Ignored-option rule.** Any `-label_discovery_*` advanced option given without
`-label_discovery_out` is warned about and ignored. It goes into the existing `IgnoredOption`
table in `FASTag.cpp` (about line 2272), with reader `-label_discovery_out`.

**K + TMTpro.** K + TMTpro is 432.30 Da, so it is not covered by the default `max_flank` of 420.
Two options were considered:

- Raise the default to 440.
- Leave the K-site TMTpro signal to its zero-residue image K0f at 304.2 (section 3), which the
  default covers.

The choice is decided on the TMTpro runs in section 13. The memory cost of 440 is in section 10.

**Interface change.** `--help`, `-write_ctd` and the INI gain these options. The `-out_spectra`
mzML does not, because of the 1.12 legacy-parameter shim (`FASTag::Cli::kLegacyOutSpectraParameters`,
`test/out_spectra_params_test.sh`). The baseline interface-added list
(`tools/baseline_iface_added.py`, `test/baseline_iface_added_test.sh`) gains the new names.

## 3. Reading convention and the flank images (from `src/FASTagger.cpp`)

FASTagger writes the flanks of a b/y tag from the fitted low-peak m/z `avg`, the tag mass `cum`,
the fragment charge `z` and the precursor neutral mass `M` (`FASTagger.cpp` lines 862-870).
`M` is `precursor_mz*z_prec - z_prec*PROTON` (line 359).

```
cterm_mass = max(0, avg*z - PROTON*z - H2O)
nterm_mass = max(0, M - ((avg + cum)*z - PROTON*z))
```

The low peak is assumed to be a **y ion** (`FASTagger.h`, struct Tag). The tag is written N->C.

- **Forward reading** (the tag really reads y ions). `cterm_mass` = the residues C-terminal to the
  tag, plus any C-terminal modification. `nterm_mass` = M − y_high = the residues N-terminal to the
  tag plus the N-terminal modification.
- **Reversed reading** (the tag really reads b ions, so the sequence is spelled reversed). The
  low peak is b_low, so `cterm_mass = b_low_neutral − H2O` = (N-side residues + N-terminal
  modification) − H2O. And `nterm_mass = M − b_high_neutral` = C-side residues + C-terminal
  modification + H2O. The one-water offset is `IonSeries::IonPair::reversedOffset()`, +18.010565
  for b/y. It is the same offset `TerminusCounter::add_` uses (`n_h2o` keys at m + H2O).

FASTag cannot know which reading a tag is. So the report works on the two raw channels, `n` =
`nterm_mass` and `c` = `cterm_mass`, exactly as written. Each hypothesis is turned into the
masses it predicts in each channel. These predicted masses are its "images".

L_N is an N-terminal modification, L_K a lysine side-chain modification, c_C a C-terminal
modification (0 for a free acid), S a multiset of 0-2 residues and m(S) its mass.

| image | channel | predicted mass | how the ion arises |
|---|---|---|---|
| N0f | n | L_N | Forward. The high peak is [M − L_N + H]+, the precursor that lost the whole label (no residue left on the N side). |
| N0r | c | L_N − H2O | Reversed. The low peak is the label's own "b0" ion, L_N + H+ (TMT 230.17). It is only observable when L_N + 1.007 lies inside the MS2 scan range. That rules it out for dimethyl (29.04), acetyl (43.02) and propionyl (57.03). |
| N1f, N2f | n | L_N + m(S), \|S\| = 1, 2 | Forward, high peak y_{n-1} or y_{n-2}. |
| N1r, N2r | c | L_N + m(S) − H2O | Reversed, low peak b1 or b2. |
| K0f | c | L_K, and the tag's last residue is K | Forward. The low peak is at L_K + H2O + H+; the tag's last step is the bare K residue up to y1(K + L_K). This was observed (below), but the mechanism of the ion is not established. |
| K1f, K2f | c | K + L_K + c_C (+ m(S)) | Forward, y1 or y2 of a C-terminal labelled K. |
| K1r, K2r | n | K + L_K + c_C + H2O (+ m(S)) | Reversed, high peak b_{n-1}. |
| R1f, R1r (and with S) | c / n | R + c_C, and R + c_C + H2O | The same for R. A Lys8 or Arg10 shift appears here as a K- or R-only offset. |

For an unlabelled peptide, L_N = 0 and the images are the ordinary residue flanks. Examples are
n = m(S) and c = m(S) − H2O, and the C-terminal y1 and y2 images of K and R. The zero-residue
unlabelled images do not exist: they would need a y0 or b0 ion, or the precursor itself.

**The clamp.** FASTagger writes `max(0, .)`, so a value of exactly 0 is a clamp, not a flank.
Clamped values are counted separately and never binned. That is the `-delta_out` rule for
clamped flanks. An image predicted below 0, such as N0r for a label under 18.01 Da, is dropped
from the hypothesis.

### Checked on public data before writing this design

FASTag 1.12 RC a117801 on node data, run settings of the 193-run evaluation: `-tag_length 4`,
`-subsample_fraction 0.25`, 20 ppm, 8 threads. Files are in
`data:/scratch/kohlbach/fastag-labeldisc/probe/`. The counts are of filtered tags (ungapped, E ≤ 1).

PXD004541 `HF1_..._TMT10_..._fr02` (TMT10, 130,182 filtered tags):

| image | predicted | tags | median deviation (5-95 %) |
|---|---|---|---|
| N0r (c = TMT − H2O) | 211.152367 | 19,400 | −0.0001 (−0.0008 to 0.0004) |
| K1f (c = K + TMT) | 357.257892 | 7,075 | −0.0003 (−0.0013 to 0.0008) |
| K0f (c = TMT, last residue K in 3,822 of 3,876) | 229.162932 | 3,876 | |
| N0f (n = TMT) | 229.162932 | 2,598 | +0.0005 (−0.0069 to 0.0067) |
| K1r (n = K + TMT + H2O) | 375.268457 | 2,031 | +0.0006 (−0.0046 to 0.0046) |
| N1r, e.g. A (c = A + TMT − H2O) | 282.18948 | 1,532 | |
| R1f (c = R), reference | 156.10111 | 1,456 | −0.0001 (−0.0018 to 0.0004) |

The N1r ladder is present for G, A, S, V, T, L and N: 268.17, 282.19, 298.18, 310.22, 312.20,
324.24 and 326.18.

**What this means for `-label_out`.** Its "2404 N- and 3888 C-terminal" bare-TMT counts on this
run are N0f and K0f. The large N0r image (19,400 tags at 211.15) is not counted by `-label_out`
at all.

PXD001587 `140120_Lysate90min_38` (label-free, 55,431 filtered tags):

- c channel: R 156.10 (2,452 tags), K 128.09 (2,182), K+L 241.18 and R+L 269.18.
- n channel: L 113.08 (N1f) and dipeptide sums (L+V 212.15, L+L 226.17, A+L 184.12).
- No peak at any label image.
- 65 n values are clamped zeros.
- Half-integer bins (fraction 0.45-0.55, 50-400 Da, c channel): 0 tags, against 21,629 in the
  integer-near bins.

**Consequences:**

1. The two channels have different precision. Channel c is fragment-limited, about ±0.001 Da.
   Channel n is precursor-limited, about ±0.007 Da. So they get separate windows (section 5).
   Channel c is the one that can separate iTRAQ8 (304.205360) from TMTpro (304.207146).
2. Below 420 Da, the background at half-integer masses is effectively zero (the mass-defect
   gap). That is the null (section 6).

## 4. Which tags count

The same rows `-label_out` counts, at the same place in the code: `FASTag.cpp` around line 3777,
`count_on && sel && !t.gapped && t.evalue <= 1.0`. That is:

- every written tag row,
- of the selected precursor hypothesis,
- ungapped,
- with E-value ≤ 1,
- read as b/y.

The new code gets its own switch `ldisc_on`. It does not change `count_on`, so no existing
counter sees a different input.

- **With `-fasta`,** only database matches are written. As README says for the other reports,
  write the report in a run without `-fasta` for an unbiased picture. The report records
  `ld_run tags_source` = `all` or `fasta_filtered`.
- **c/z tags** (`t.ion_series == CZ`) are counted in `ld_count tags_excluded_cz` and not binned.
  Their reversed-read offset is −15.0347, not +H2O, and format 1 does not model them. A run with
  only c/z tags gets `no_call cz_only`.
- **Both units are kept.**
  - Tags: every counted tag adds its n and c value. This is the unit of `-label_out`.
  - Spectra: within one spectrum, each (channel, bin) counts once, so many overlapping tags of
    one ion ladder cannot inflate a peak. This is the `-delta_out` "one sample per spectrum"
    idea.
  - Peaks are called on spectra. Tags are reported beside them.
- **Adjacent residue.** For channel c the report also keeps a histogram restricted to tags whose
  last residue is K, and for channel n one restricted to tags whose first residue is K. That is
  `FASTag::baseSequence(t.seq)` front and back, after I/L folding. These are the K0f image (the
  K-site evidence that needs no residue in the flank) and its reversed counterpart.

## 5. Binning and tolerance

- **Bins.** The bins are 0.0005 Da wide over (0, max_flank]. The key is `floor(v / 0.0005)`. The
  index is integer, so the counts are exact.
- **Smoothed count.** The smoothed count at a bin is the sum over bins within ±w of its centre.
  It is computed from prefix sums.
- **Window per channel.** w_n and w_c are taken from the run itself when
  `-label_discovery_window_n/_c` is 0:
  - Take the deviations from the nearest one-residue reference image within ±0.02 Da. The
    reference images are c = K, R and the residue keys of `Digest::residueKeys()`, and
    n = (the same) + H2O.
  - w = 3 × 1.4826 × MAD of those deviations.
  - Clamp w to [0.0015, 0.02].
  - With fewer than 200 reference values, the defaults are used instead: w_n = 0.008 (the
    `-digest_window` value) and w_c = 0.004.
  - `ld_run window_source_n/_c` records `estimated`, `default` or `option`.
  - On the PXD004541 probe the quantiles above give about w_c 0.0015 (the floor) and w_n 0.006.
    This is still to be measured on the implementation.
- **Mass of a peak.** It is the count-weighted mean of the bin centres within ±w, summed in
  ascending bin order. Its spread is reported as the MAD-based σ over the same bins, and its
  standard error as se = σ/√spectra.
- **Close masses.** Two masses closer than the window are not resolved as two peaks. They are
  told apart by the centroid instead (section 8). Example: iTRAQ8 304.205360 vs TMTpro
  304.207146 differ by 0.0018 Da. A c-channel peak of 1,000 spectra at σ 0.0004 has
  se ≈ 0.00001, so its centroid decides between them. A sample with both labels at once would
  stay a single peak.
- **Da tolerance.** On a Da fragment tolerance (`fragment_tolerance_unit Da`), peaks are not
  called. The report keeps `ld_run`, `ld_count` and writes `ld_call no_call low_resolution`.
  This is the `-label_out` rule (`low_resolution yes on a Da tolerance`).

## 6. Background model and significance

The background generalises `-label_out`'s +0.5 Da control. For a smoothed count C(x), the
background is

```
b(x) = mean of C at x + k + 0.5 for k in {-5, ..., 4}   (ten half-integer offsets)
```

Offsets that fall outside (0, max_flank] are left out of the mean. Below 1000 Da, peptide-like
masses have a mass defect of 0.0-0.5, and below 420 Da it is under about 0.3. So the half-integer
positions hold only non-chemical noise, such as tags with wrong flanks. On the probes this was
exactly 0.

- λ = max(b(x), 1). The floor of 1 is `label_call`'s `max(background, 1)`.
- fold = C / λ.
- p = Poisson upper tail P(X ≥ C | λ).
- q = min(1, p × n_tested). n_tested is the number of smoothed positions examined in both
  channels (Bonferroni).
- The report writes `log10_q`, floored at −300, and `fold`.

**What the background guards against.** It guards against noise only. It does not say whether a
peak is a label. A dipeptide flank is a strong and real peak, and so is the unlabelled N-terminal
ladder. Telling these apart is the job of the explanation (section 8) and of the site scan
(section 7). The same half-integer rule is applied to the site scan, whose background is not 0
(it carries the smear of the residue subtraction).

**Peak calling in a channel:**

1. A peak is a local maximum of C over ±2w. A plateau goes to its lowest bin.
2. It is kept when all of these hold: spectra ≥ `min_spectra`, spectra / counted spectra ≥
   `min_share`, fold ≥ 20 (the `kLabelBackgroundFold` prior), log10_q ≤ −2.
3. Peaks are ranked by spectra, then by mass, and at most 200 per channel are written.

## 7. Site scan: separating labels from 0-2-residue flanks

A real label L_N moves a whole family of images by the same offset: N0f, N0r, then N1f and N1r
for every residue r. A residue combination does not. The site scan turns each channel into an
offset spectrum per site, so that a label piles up at one offset across many residues.

S1 is the run's alphabet:

- the 19 residues of `Digest::kAAs` (I folded into L),
- with the run's fixed residue modifications applied (`p.mods`, the C mass from
  `-fixed_modifications`, not the fixed 160.03065 of `-digest_out`),
- plus one alternative per configured variable modification.

The run's fixed terminal modifications (`fixed_term_n/c`, `FASTag.cpp` line 1767) are not
subtracted. The flanks carry them, so they show up as what they are.

```
O_N(x) = C_n(x) + C_c(x − H2O)  +  Σ_{r in S1} [ C_n(x + m_r) + C_c(x + m_r − H2O) ]   N-terminal offset x
O_K(y) = C_c^K(y) + Σ_{S ∈ {K} ∪ ({K} + S1)} [ C_c(m(S) + y) + C_n(m(S) + y + H2O) ]   lysine offset y
O_R(y) = the same for R, without the zero-residue term
```

- C^K is the "last residue K" histogram (image K0f).
- C(·) is the smoothed count at that channel's own window.
- x and y run over [−50, max_flank] at the bin width. That covers negative C-terminal offsets
  such as amidation (−0.984).

**Two-residue images.** For dimethyl, which has no b0 ion and weak b1, the N2 images (b2 ions)
are the main evidence. But sums over all pairs smear the whole scan. So S2 = unordered pairs of
S1 (about 325 sums) is not scanned. It is used in a second pass that scores each candidate
offset with its N2 or K2 images.

**Site candidates.** These are the local maxima of O_N, O_K and O_R. They are kept by the
peak-calling rule of section 6, with O's own half-integer background. For each candidate the
report gives:

- `spectra`: distinct spectra with at least one image.
- `share`: spectra over counted spectra.
- `ladder`: the distinct residues r whose N1 or K2 image alone reaches `min_spectra`/4 (prior 5).
- `images`: the count per image class, for example `N0f=2598;N0r=19400;N1f=...;N1r=...`.
- `log10_q`, `fold`.

**Site attribution:**

- An offset in O_N is an N-terminal modification. Delta 0 is the unlabelled N-terminus.
- An offset in O_K only is a lysine modification (TMT side chain, Lys8, a K-only label).
- An offset in O_R only is an arginine modification (Arg10).
- The same offset in both O_K and O_R, within w_c, is a C-terminal modification of the peptide
  (for example 18O labelling, +2.0042 or +4.0085).
- The scan assumes K and R at P1, which is the tryptic case. For a non-tryptic call by
  `-digest_out` this is noted in `ld_run`; it is not corrected.

**Second pass.** Once a K label L_K is found, K + L_K joins S1, and O_N is scanned again. This
is because a labelled N-terminal K carries both labels, so its N1 image is L_N + K + L_K. Only
one second pass is made.

**Completeness.** It is spectra(L) / (spectra(L) + spectra(delta 0)), per site. It is
descriptive, because labels change fragment detectability: TMT enhances the b ions. It is the
"partial labelling" read-out of the backlog entry.

## 8. Annotation of peaks and site candidates

Every channel peak and every site candidate gets exactly one class and up to `unimod_top`
alternatives. Classes are tried in this order, and the first that matches within ±w wins:

1. **`residue_combo`.** It matches an image of the unlabelled hypotheses with |S| ≤ `depth`. Those
   hypotheses are L_N = 0, or the run's configured fixed terminal modification; the C-side K or R
   with c_C = 0; and the run alphabet. For a site candidate, the offset itself equals m(S) for
   some |S| ≤ 2. Such an offset is the image of a longer unlabelled flank, for example x = 113.08
   in O_N from three-residue flanks.
   - Collisions are listed as alternatives: GG = N, AG = Q exactly; K/Q at 0.036 Da, separated
     only at w < 0.018.
   - A known artefact whose mass equals a residue, such as N-terminal carbamidomethyl = G
     (57.02146), is shown as `residue_combo` with the Unimod alternative listed. It is never
     silently dropped.
2. **`known_label`.** It matches an image of `Digest::labelKeys()` (TMT, TMTpro, iTRAQ4), the K
   keys of `residueKeys()` (K+TMT, K+TMTpro, K+iTRAQ4, K+8, R+10), or the run's configured fixed
   terminal or K modification. All of these are on N-terminal, K or R sites, with S as above.
3. **`unimod`.** It matches one `ModificationsDB` entry with these specificities:
   - N-terminal (`N_TERM` or `PROTEIN_N_TERM`) for O_N and the N images. A residue-specific
     N-terminal entry such as `Gln->pyro-Glu (N-term Q)` counts only when its origin is the
     first residue of S.
   - origin K (`ANYWHERE`) for O_K.
   - origin R for O_R.
   - `C_TERM` for an offset common to K and R.

   The candidates come from `searchModificationsByDiffMonoMassSorted(mass, w, residue,
   term_spec)` (`OpenMS/CHEMISTRY/ModificationsDB.h`). `ModificationsDB` is built once, when the
   report is written, in a single thread.

   Ranking: fewer residues in S first, then smaller |error|, then the `getFullId()` string. That
   order is deterministic. The same rule ranks `known_label` alternatives. The explanation names
   the best one. An alternative whose error is within 2 se of the best one is written as
   `ambiguous` in `.alternatives`.

   Two-modification combinations are reused from `-massgap_out`: `FD::combinations` /
   `FD::explain` over `share/FASTag/digest/massgap_mods.tsv`. They are tried only when no single
   entry matches, and are tagged `unimod_combo`.
4. **`unexplained`.** Nothing matched. The mass, the site and the images are still reported, so
   an unknown label is visible. This is the point of the report.

## 9. Output format (format 1)

The format is the long-form report family of `-digest_out`, `-label_out`, `-massgap_out` and
`-alkylation_out`, written by `FASTag::Digest::writeReport`:

- UTF-8, header `section key value n description`, five fields per row, none empty.
- `-` means "no value".
- Numbers via `FASTag::Digest::num`; `FASTAG_FULL_PRECISION=1` widens them.
- Each (section, key) appears once. A reader looks rows up by (section, key), never by line
  number, and ignores rows and sections it does not know.
- The file is written to `.part` and renamed when complete. A refused or failed run leaves no
  file.

The contract goes into `doc/LABEL-DISCOVERY-REPORT.md` with the code. The version is the row
`ld_run format` = `1`.

Sections, in this order:

| section | keys |
|---|---|
| `run` | The shared versioned run rows (`FASTag::RunReport::runRows`, `run_report_version`), as in `-alkylation_out`. |
| `ld_run` | `format`, `tags_source`, `low_resolution`, `window_n`, `window_c`, `window_source_n`, `window_source_c`, `bin_da`, `max_flank_da`, `depth`, `min_spectra`, `min_share`, `min_fold`, `max_log10_q`, `fixed_nterm_delta`, `fixed_cterm_delta`, `alphabet` (residue=mass list), `unimod_entries` (searched entries), `digest_assumption` (`tryptic_P1`). |
| `ld_count` | `spectra_counted`, `tags_counted`, `tags_excluded_cz`, `clamped_n`, `clamped_c`, `above_max_n`, `above_max_c`. |
| `ld_peak` | Per channel `n` and `c`, ranked: `<ch>.<i>.mass`, `.sigma`, `.spectra`, `.tags`, `.background`, `.fold`, `.log10_q`, `.class`, `.explanation` (e.g. `N1r:TMT+A` or `K1f:K+TMT6plex (K)`), `.alternatives`, `.share_adjacent_k`, `.se`. |
| `ld_site` | Per site `N`, `K`, `R`, `C`, ranked: `<site>.<i>.delta`, `.sigma`, `.spectra`, `.share`, `.ladder`, `.images`, `.fold`, `.log10_q`, `.class`, `.explanation`, `.alternatives`, `.completeness`. The delta 0 rows (unlabelled N, K, R) are always written, as the positive control. |
| `ld_known` | For each `labelKeys()` label and configured fixed terminal/K modification: tags and spectra per image at `-digest_window` (0.008 Da). This lets a reader relate the report to `-label_out`. |
| `ld_call` | `status` (`call`, `no_call`), `labels` (e.g. `TMT`, `Dimethyl`, `TMTpro+K:TMTpro`, `unknown:N+123.4567`, `label-free`; `+`-joined; `-` on a no call), `sites`, `basis` (`site_scan`), `reason` (`low_resolution`, `few_spectra`, `cz_only`, `no_reference`; `-` on a call). |

**Call rule (prior, unfitted).** A site candidate with delta ≠ 0 whose class is not
`residue_combo` is called when all of these hold:

- share ≥ 0.01 (`kLabelMinShare`),
- fold ≥ 20,
- log10_q ≤ −2,
- ladder ≥ 3, or a zero-residue image (N0f, N0r, K0f) with ≥ `min_spectra`.

The call is `label-free` when no candidate passes and the delta 0 N-terminal control passes the
same rule. If neither passes, it is `no_call no_reference`: no sign of N-terminal flanks at all.
Below 175 counted spectra (the `kLabelTagMin` prior) it is `no_call few_spectra`.

The report states measurements first, and the call is the last section, as in `-label_out`.

## 10. Coexistence with `-label_out`

- `-label_out`, its `label_call` and every other output stay byte-identical, with and without
  `-label_discovery_out`.
- The new code reads the same tag values, but through its own counter. `TerminusCounter` is not
  modified.
- The discovery report never feeds `label_call`.
- **Cross-check.** The `ld_known` tag counts are computed at the `-label_out` window and with the
  same `near_` rule (`[m − w, m + w]`) on the same values:
  - the N0f tags at a label equal `-label_out`'s N count for it,
  - the K0f (all residues) tags equal its C count.

  A unit test and a CLI test pin this.
- A later prose-auto or `label_call` revision may read `ld_site`. That needs its own decision and
  a held-out test. It is not part of this work.

## 11. Runtime, memory, determinism

**Memory.** There are four dense histograms (n, c, c with last residue K, n with first residue K)
of `ceil(max_flank / 0.0005)` = 840,000 `std::atomic<uint32_t>` bins each. That is 13.4 MB,
allocated only when the option is on, and shared by all threads. At `max_flank` 440 it would be
14.1 MB. The prefix sums and offset spectra of the post-processing take another ≤ 30 MB, freed
before the report is written.

**Counting.** Each counting thread keeps a small per-spectrum key buffer, which is a
`thread_local` vector, for the spectrum dedupe. At the end of the spectrum the buffer is sorted,
made unique, and added with `fetch_add(relaxed)`. Integer addition commutes, so the final counts
do not depend on the thread count or the schedule. The post-processing runs single-threaded on
the merged integer counts and sums floats in ascending bin order. So the report is byte-identical
at any `-threads`.

**Time.**

- Counting is O(1) per tag.
- The site scan is about 3 sites × 900k positions × 2 × 26 lookups, roughly 140 M array reads.
- The S2 second pass is ≤ 600 candidates × 650 lookups.
- Annotation is ≤ 1,000 peaks × 351 images, with binary search in sorted image and Unimod
  tables.
- Target: ≤ 0.5 s of post-processing, and a wall-time overhead of ≤ 1 % when on, on PXD004541 at
  8 and 64 threads.
- Timing is measured on node data, paired with the option off. ibminode05 is reserved, so this
  timing is indicative, not a benchmark.
- With the option off, the only added work is one bool test per tag.

## 12. Code layout and tests

**New code:**

- `src/LabelDiscovery.{h,cpp}`, namespace `FASTag::LabelDiscovery`:
  - `Histograms` (atomic arrays, `addSpectrum`)
  - `ImageTable` (hypothesis → images)
  - `estimateWindow`
  - `callPeaks`
  - `siteScan`
  - `annotate` (takes a `ModificationsDB` adaptor, so that unit tests can inject a table)
  - `reportRows`

**Changes to `FASTag.cpp`:**

- option registration next to `label_out` (about line 560),
- the `IgnoredOption` rows,
- the counting hook next to `pt.digest.add` (about line 3777),
- writing in phase 9 after `-label_out` (about line 5337), through `OutputGuard` like the other
  reports.

**Other files:** `CMakeLists.txt` and the test registration. `README.md`: one option row and one
paragraph in "Digest, label and mass-gap reports". `CHANGELOG.md`.

**Unit tests** (`test/label_discovery_test.cpp`, synthetic flanks, no spectra unless stated):

1. **Image table.** For TMT, TMTpro, iTRAQ4, Dimethyl and an unknown +123.4567 label, the
   predicted N0f/N0r/N1f/N1r/K0f/K1f/K1r masses are checked against hand-computed values.
2. **Convention anchor.** A synthetic b/y spectrum of a TMT-labelled peptide with a b0 ion at
   230.1702 goes through `FASTag::tagSpectrum`, built with the existing synth helpers
   (`test/complement_synth.h`). The reversed tag's `cterm_mass` must be L − H2O ± 1e-6, and the
   forward tag's `nterm_mass` must be N-side + L. If anyone changes the flank formula in
   `FASTagger.cpp`, this test fails.
3. **Separation.**
   - Synthetic flank sets of unlabelled 0-2-residue flanks only give `residue_combo` and the call
     `label-free`.
   - Adding N0f/N0r/N1r images of +123.4567 gives one `unexplained` N site with ladder ≥ 3 and
     the call `unknown:N+123.4567`.
   - Dimethyl given only as N1f/N2r images gives `unimod` Dimethyl via `ModificationsDB`.
   - A TMT K-only set gives site K, not N.
   - An offset common to K and R (+4.0085) gives site C.
4. **Collisions.** GG/N and AG/Q are listed as alternatives. N-terminal carbamidomethyl is
   `residue_combo` with Unimod `Carbamidomethyl (N-term)` among the alternatives.
5. **Precision.**
   - iTRAQ8 (304.205360) and TMTpro (304.207146) N0r images at σ 0.0004 Da, given one label at a
     time, are each annotated as the correct label at w_c 0.0015.
   - At the same σ they form one peak at w 0.008.
   - The centroid still names the right label in both cases, with the other label listed as an
     alternative and its error.
6. **Background.** The half-integer mean, the floor 1, the Bonferroni count, and the Poisson tail
   against a reference value. Edge bins near 0 and near `max_flank` are checked.
7. **Window estimate.** Gaussian deviations with a known σ give w within 10 %. Fewer than 200
   reference values gives the defaults.
8. **Determinism.** The same flanks, shuffled and split over 1/3/7 histogram feeders, give a
   byte-identical report.
9. **Clamp.** Values of exactly 0 are counted in `clamped_*` and never binned.
10. **`-label_out` parity.** On one flank list, the `ld_known` tags equal `TerminusCounter`'s
    `lab_n`/`lab_c`.

**CLI tests** (`test/label_discovery_cli_test.sh`, fixture `test/fixtures`):

- **Off is identity.** Without the option, the tag TSV, `-digest_out`, `-label_out`,
  `-massgap_out`, `-recon_out` and `-out_spectra` are byte-identical to a run that does not
  mention it. With it on, every other output is byte-identical to the run without it.
- **Format.** With the option on, the report exists, `ld_run format 1` is present, the sections
  come in the documented order, and every row has five non-empty fields.
- **Threads.** `-threads 1` and `-threads 4` give a byte-identical report.
- **Low resolution.** A Da tolerance gives `ld_call status no_call` with reason `low_resolution`.
- **c/z.** `-ion_series cz` gives `tags_excluded_cz` > 0 and reason `cz_only`.
- **Guards.**
  - An advanced option without `-label_discovery_out` is warned about and ignored.
  - Invalid values (depth 3, `max_flank` ≤ 0, `min_share` > 1) are rejected with the usual
    exit code.
  - The `.part` file is renamed, and a refused run leaves no file.
- **Interface.** `--help` and `-write_ctd` list the options. `baseline_iface_added_test` passes
  with the updated list. `out_spectra_params_test` passes unchanged.

**Gate identity, binding:**

- `gate.sh` against `tools/gate-1.12/refs-1.12.0` must PASS with the option off.
- `tools/gate_job.sh` must end with `GATE JOB PASS`, including `BASELINE IDENTITY PASS`.
- The full ctest set must pass on node data in the build env of `data/HANDOFF.md` (`make -j 24`
  at most, rsync to `data:/scratch/kohlbach/fastag-labeldisc/src`, mind the rsync mtime trap).
- A new gate case (`label_discovery` on the PXD000001 gate input) may be proposed. Its reference
  is added only with the user's approval of the reference set.

## 13. Evaluation plan (public data only)

All runs use the settings of the 193-run evaluation (tag length 4, `-subsample_fraction 0.25`,
20 ppm, 8 threads, no `-fasta`). Outputs go to `data:/scratch/kohlbach/fastag-labeldisc/eval/`.
Inputs are read in place and read-only, from `/ceph/ibmi/abi/oliver/prose-auto-20261029/` and
the gate inputs. Truth comes from the SDRF.

| class | runs | what must hold |
|---|---|---|
| TMT6 | PXD000001 (gate input; SDRF TMT126-131) | N site TMT6plex (229.1629) `known_label`, K site the same, completeness reported |
| TMT10 | PXD004541 `..._fr02` (probe above), PXD010941, PXD004725 | as TMT6 |
| "TMT8" | PXD000865 (Kuster proteome, `/ceph/ibmi/abi/projects/proteomics/kuster_proteome/MZML/8/`, listed as qex_tmt8 in `jpr-paper/inventory.md`) | First confirm the label from PRIDE or the run. There is no 8-plex TMT reagent, and the folder name may be a sample number. The report itself is one check. |
| TMTpro | PXD047517, PXD035354, PXD046211 (from the 193) | TMTpro (304.2071) at N and K; check whether K1f lies above `max_flank` 420 (section 2) |
| iTRAQ4 | PXD006536 | iTRAQ4plex (144.1021) |
| iTRAQ8 | PXD001540, PXD001670, PXD012764 | iTRAQ8plex 304.2054 told apart from TMTpro 304.2071 by the c-channel images. The 1.12 `label_call` calls all three TMTpro. |
| dimethyl | PXD052824 (in the 193, `label_call` no_call), PXD025168 (bigbio SDRF DIMETHYL3PLEX: Dimethyl, :2H(4), :2H(6)13C(2)) | Dimethyl 28.0313, and for PXD025168 three N-terminal deltas (28.0313, 32.0564, 36.0757) at N and K, class `unimod`. Confirm first that the label is fixed in the SDRF. |
| acetyl / propionyl | one public run with chemical N-terminal acetylation or propionylation, still to be selected (selection rule: SDRF lists it as a fixed N-terminal modification; histone propionylation sets are candidates) | Acetyl 42.0106 or Propionyl 56.0262, `unimod`, despite the missing b0 image |
| label-free | PXD001587 `140120_Lysate90min_38` (probe above), PXD003531 (gate input) | call `label-free`; no N or K site candidate other than delta 0 and `residue_combo` |
| SILAC (secondary) | the 19 SILAC runs of the corpus | K+8.0142 at site K and R+10.0083 at site R. This is descriptive: SILAC is not a terminal label, but the site scan sees it. |

**Development data.** The 193 label-evaluable runs (`output/jpr-paper/carryover-1.12/label_call.tsv`)
are run with the option on, alongside the existing reports. Their use is descriptive only:

- the confusion of `ld_call` against `label_truth`,
- the false label calls on the 159 label-free runs (the primary safety number),
- the mass error of the found deltas against Unimod,
- the TMTpro/iTRAQ8 separation,
- the agreement of `ld_known` with `-label_out` (required to be 100 %),
- the completeness distribution.

These are the runs the label rules were developed on, so the numbers describe development, not
validation (as in the `label_call` report).

**Held-out.** The thresholds of sections 6-9 are frozen in a short pre-registration before any
held-out run. A held-out set is then taken from bigbio SDRFs that are not in the 193, with
labels from the SDRF: dimethyl, acetyl, iTRAQ8, TMTpro, DiLeu if available, and label-free
controls. It is scored once. Whether a change to `label_call` should read `ld_site` is decided
on that result and nothing else.

## 14. Open points

- Whether the K0f image (c = L_K, last residue K) is a real ion species or a tagging artefact.
  It is reported either way. Its mechanism needs a look at annotated TMT spectra.
- The `max_flank` default (420 or 440). This depends on the TMTpro K1f image.
- The site scan assumes tryptic C termini. Lys-C, Lys-N and non-specific digests may need O_K and
  O_R at every C-terminal residue. That would be format 2.
- c/z support: images with the c/z reversed offset (`reversedOffset()` −15.0347), also format 2.
