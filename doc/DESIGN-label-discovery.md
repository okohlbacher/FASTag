# Database-free label discovery (`-label_discovery_out`): design

Status: design, 2026-11-09, branch `feat/label-discovery` (from `origin/main` 702b45c, FASTag 1.12.1).
Nothing here is implemented yet. The thresholds are priors. They are not fitted, and none is
frozen until the evaluation in section 13 has run.

Revision 2 (2026-11-09) takes in the first design review. The issues and what was done with each
are in section 15. Revision 3 (2026-11-10, section 16) follows the first evaluation on public data
(67 of 159 label-free runs with a false label call): systematic neutral-loss null readings, a tiered
evidence bar fitted on a DEV half only, more known labels, and a robust calibration uncertainty.

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
| `-label_discovery_max_flank <Da>` | 700 | Advanced: largest flank mass histogrammed, and the largest composition mass of the null image set (section 7). It covers every one- and two-residue image of TMTpro (K1f 432.30, K1r 450.31, K2f ≤ 618.38, K2r ≤ 636.39, N2f ≤ 676.37), and so every lighter label. At most 1500 (`kMaxFlankLimit`): the null image set grows faster than linearly with it (section 11). |
| `-label_discovery_depth <0\|1\|2>` | 2 | Advanced: the most residues a channel-peak explanation names (`N2r:TMT+AG`). It does not limit the null image set, which takes every composition up to `max_flank`. |
| `-label_discovery_min_spectra <n>` | 20 | Advanced: spectra a peak or site candidate needs. This is the `-massgap_min_spectra` prior. |
| `-label_discovery_min_share <f>` | 0.005 | Advanced: share of the counted spectra a peak needs. This is the `-massgap_min_share` prior. |
| `-label_discovery_window_n <Da>` / `-label_discovery_window_c <Da>` | 0 / 0 | Advanced: the half-window of the N- and C-terminal flank channels. 0 means estimate it from the run (section 5). At most 0.05 Da (`kWindowOptionMax`): the background is read at half-integer offsets (±(k + 0.5) Da, section 6) and must stay outside the window, and the local-maximum scans cost O(bins × w / 0.0005). |
| `-label_discovery_unimod_top <n>` | 3 | Advanced: Unimod alternatives listed per peak. |

**Ignored-option rule.** Any `-label_discovery_*` advanced option given without
`-label_discovery_out` is warned about and ignored. It goes into the existing `IgnoredOption`
table in `FASTag.cpp` (about line 2272), with reader `-label_discovery_out`.

**Why 700.** The first draft used 420, which put K1f (432.30) and K1r (450.31) of TMTpro outside
the range and left the TMTpro K site to its single K0f image. The default is now 700. The
half-integer background (section 6) still holds there: a peptide-like composition of 700 Da has a
mass defect of about 0.35, below 0.5. The memory cost is in section 11.

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
modification (0 for a free acid), S a multiset of residues and m(S) its mass. In the label
images below |S| ≤ 2. In the null image set of section 7, S is any composition up to `max_flank`.

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
   gap). That is the null (section 6). Up to 700 Da it is expected to stay near zero; this is
   checked on the probes in the implementation.
3. Added in revision 2: the scan mixes both termini and both readings into each channel, so the
   ordinary flanks of an unlabelled peptide leak into the label offsets (section 7, null image
   set). And channel n carries every precursor pick error, including 13C picks (section 5).

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
- **Per-tag record list.** Every counted tag is kept as one compact record: n, c, the
  precursor neutral mass M (all `float`), the spectrum's index in scan order (`uint32`), and a
  flag byte (first residue K, last residue K, first R, last R). That is 17 bytes, padded to 20.
  The 130k tags of the PXD004541 probe take 2.6 MB; a full, unsubsampled run of 2M tags takes
  40 MB. Records are collected per thread and merged in scan order, so the list does not depend
  on the thread count.
- **Two units, with different jobs.**
  - `image_hits`: the dense histograms (section 5) are built from the list, one count per tag
    and channel. They find the candidates and nothing else.
  - `spectra`: after the candidates are found, each one is recounted exactly on the list as the
    number of distinct spectra with at least one tag that lies within w of at least one of the
    candidate's images. `spectra`, `share`, `min_spectra`, the completeness and the Poisson test
    of the call all use this count. A b-ion ladder of one spectrum (b0, b1, b2) then counts
    once, not once per image and channel.
  - `tags` is reported beside them, as the unit of `-label_out`.
- **Adjacent residue.** The flags come from `FASTag::baseSequence(t.seq)`. For channel c the
  report also builds a histogram restricted to tags whose
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
  - Channel c is fragment-limited, and its error does not grow with M. w_c = 3 × 1.4826 × MAD
    of the c deviations (after the calibration below), clamped to [0.0015, 0.02].
  - Channel n is precursor-limited: its error is a precursor ppm error, so in Da it grows with M
    (5 ppm is 0.005 Da at 1000 Da and 0.02 Da at 4000 Da). So the n deviations are taken as ppm
    of M, σ_ppm = 1.4826 × MAD(dev / M × 1e6), and the window is a function of the tag's
    precursor, w_n(M) = 3 × σ_ppm × M × 1e-6, clamped to [0.0015, 0.02]. The exact recounts of
    section 4 use w_n(M) per tag. The histograms need one Da window, so they use w_n at the 90th
    percentile of M. That is wider than most tags need, which can merge close peaks but does not
    miss any; the recount then narrows it.
  - With fewer than 200 reference values, the defaults are used instead: w_n = 0.008 (the
    `-digest_window` value, as a flat Da window) and w_c = 0.004.
  - `ld_run` records `window_source_n/_c` (`estimated`, `default` or `option`), `sigma_ppm_n`,
    `window_n_p90`, and the M quantiles 10/50/90 %.
  - On the PXD004541 probe the quantiles above give about w_c 0.0015 (the floor) and w_n 0.006.
    This is still to be measured on the implementation.
- **Calibration.** The same reference deviations give a per-channel calibration. For channel c
  it is the median ppm offset of the c deviations against the reference mass. For channel n it
  is the median of dev / M in ppm. When at least 1000 reference values span at least 150 Da, a
  linear term in mass is fitted as well (Theil-Sen, deterministic); otherwise the offset alone
  is used. Every peak centroid is corrected before annotation. `ld_run` writes `calib_ppm_c`,
  `calib_ppm_n`, `calib_slope_c` (or `-`) and `calib_unc_ppm_c/_n`. The residual uncertainty is
  the MAD of the reference ppm divided by √n_ref, plus the spread of the median ppm across the
  reference masses. *Revision 3:* each per-reference median (≥ 50 values) is taken over the
  residuals within 4 σ_c (at least 2 mDa) of the calibrated position, and the spread is the robust
  standard deviation of the medians (1.4826 MAD; half their difference for two references). The
  range of medians over the whole ±0.02 Da reference window (±350 ppm at G) was set by one
  contaminated reference: above 50 ppm on 64 of 183 runs of the first evaluation.
- **Precursor isotope picks.** FASTag's default is `-isotope_error 0` (`FASTag.cpp` line 794).
  A precursor picked one or two 13C peaks too high shifts n by +1.003355 or +2.006710. Every
  n-channel image, including the unlabelled N1f ladder, then has satellites at those offsets.
  Section 7 models them as images and section 8 classes them `isotope_error`.
- **Mass of a peak.** It is the count-weighted mean of the bin centres within ±w, summed in
  ascending bin order. Its spread is reported as the MAD-based σ over the same bins, and its
  standard error as se = σ/√spectra.
- **Close masses.** Two masses closer than the window are not resolved as two peaks. They are
  told apart by the corrected centroid instead (section 8). Example: iTRAQ8 304.205360 vs
  TMTpro 304.207146 differ by 0.0018 Da, about 6 ppm at the N0r image (286.19). The statistical
  se of a 1,000-spectra peak (≈ 1e-5 Da) is not the limit. A systematic fragment calibration
  offset of 2-4 ppm, common on TOF and uncalibrated Orbitrap runs, moves the centroid by
  0.6-1.2 mDa. So a near-isobaric pair (separation s) is decided only when both hold:
  - |corrected centroid − label| < 0.25 × s, and
  - the residual calibration uncertainty at that mass is below 0.25 × s.

  The decision combines every image the range allows: N0r and N0f, and K0f and K1f. Each image
  is corrected and compared on its own; they must agree. Otherwise the label is written
  `ambiguous:iTRAQ8plex|TMTpro`. A sample with both labels at once would stay a single peak.
  *Revision 3:* iTRAQ8plex is a range, 304.199040-304.205360. The kit's channels carry two
  compositions (Unimod 731 iTRAQ8plex:13C(6)15N(2) and 730), so a sample of mixed channels centres
  between them; on the first evaluation the iTRAQ8 runs centred at 304.2032, 2.2 mDa below Unimod
  730 and 3.9 mDa below TMTpro, and no point hypothesis matched. The error of the range is 0
  inside it, and the two entries are one family, not rivals.
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

**Null expectation for site candidates.** For a site candidate the half-integer background is
not the right null: ordinary flanks land on many label images (section 7). So each candidate is
also scored against the expected count from the unlabelled flanks. At each of its images, the
null expectation is the observed count of the null images that lie within w of it (the
delta-0 flank distribution, shifted by the residue differences). λ for the candidate is then
max(half-integer background, null expectation, 1), and fold and q of a site candidate use that
λ.

**Peak calling in a channel:**

1. A peak is a local maximum of C over ±2w. A plateau goes to its lowest bin.
2. It is kept when all of these hold (spectra from the exact recount of section 4):
   spectra ≥ `min_spectra`, spectra / counted spectra ≥
   `min_share`, fold ≥ 20 (the `kLabelBackgroundFold` prior), log10_q ≤ −2.
3. Peaks are ranked by spectra, then by mass, and at most 200 per channel are written.

## 7. Site scan: separating labels from residue flanks

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

**The termini leak into each other (revision 2).** Each channel holds both termini and both
readings. Channel c also holds the forward C-side flanks (c = m(S)), and channel n the reversed
C-side flanks (n = m(S) + H2O). O_N reads c at x − H2O and n at x, so the unlabelled C-side
flanks give O_N peaks at x = m(S) + H2O. These include:

- x = +18.0106: every y1 or b(n−1) flank minus its own residue lands there, a ladder over all
  19 residues;
- x = K + H2O (146.1055) and R + H2O (174.1117);
- in a TMT run, the K1f, K1r and K2 images at L_K + H2O (247.17) and K + L_K + H2O (375.27).

The same leak puts y = −18.0106 and y = r − H2O (G − H2O 39.01, A − H2O 53.03, ...) into O_K
and O_R, and −18.0106 in both would be attributed to site C. O_N also peaks at x = m(S) for
three-residue and longer flanks. The first draft explained only offsets m(S) with |S| ≤ 2 and
did not catch any of this.

**Null image set.** The fix is to model the unlabelled flanks completely and to count only the
evidence they cannot produce.

- A DP over the run alphabet S1 enumerates every composition S with m(S) ≤ `max_flank` + H2O.
  It runs on the 0.0005 Da bins and keeps, per reachable bin, the exact lowest and highest
  composition mass, so that rounding does not accumulate. For the standard alphabet and 720 Da
  there are about 41,000 distinct composition masses.
- The null channel images are all four reading/terminus combinations: n = m(S),
  n = m(S) + H2O, c = m(S) and c = m(S) − H2O, for every S.
- The precursor isotope picks (section 5) add n = (each null n image) + k × 1.003355, k = 1, 2.
- *Revision 3:* the readings are derived from the flank formula of section 3 for every ion type
  and its single NH3 and H2O losses: channel c y, y − NH3, y − H2O (forward low peak; c = m(S),
  m(S) − NH3, m(S) − H2O) and b, b − NH3, b − H2O, a, a − NH3 (reversed low peak; c = m(S) − H2O,
  − H2O − NH3, − 2 H2O, − H2O − CO, − H2O − CO − NH3); channel n y, y − NH3, y − H2O (forward high
  peak; n = m(S), m(S) + NH3, m(S) + H2O) and b, b − NH3, b − H2O (reversed high peak; n = m(S) +
  H2O, + H2O + NH3, + 2 H2O), each with the 13C picks. The precursor family (S empty): the
  precursor less NH3 or H2O as a forward high peak (n = NH3, H2O) and b_n = M − H2O less nothing,
  NH3 or H2O (n = H2O, H2O + NH3, 2 H2O), each at −1, 0, +1, +2 × 13C. y1(K) − NH3 (c = 111.068)
  was the clean N0r image of N + 129.079 and N1rK of N + 0.984 on real runs (PXD003531), and
  n = 16.02 / 17.00-17.03 the clean N0f images of N + 16.02 / 17.02. The table is
  `LabelDiscovery::nullReadings()`; unit test 16 fails without these readings.
- A label image is **confounded** when a null channel image lies within w (the channel's own
  window) of it. Otherwise it is **clean**.
- Once a hypothesis is accepted (section 9, in order of strength), its full image set, including
  its isotope satellites, joins the null set for every later candidate.

A check of the rule, done for this revision with monoisotopic masses, CAM-Cys, Met-ox,
w_c 0.0015 and w_n 0.006 (scratch script, to become unit test 11): of the N0/N1 images (40 per
label), the clean ones are TMT 24, TMTpro 16, iTRAQ4 24, Dimethyl 25, Acetyl 31, Propionyl 31,
Carbamyl 24, an unknown +123.4567 40. The leak offsets +18.0106 and K + H2O have 0 clean images.
TMT's N0f, N0r and K0f are all clean.

**Site candidates.** These are the local maxima of O_N, O_K and O_R. They are kept by the
peak-calling rule of section 6, with O's own background and the null expectation. For each
candidate the report gives:

- `spectra`: distinct spectra with at least one image within w, from the exact recount on the
  tag list (section 4). `spectra_clean` is the same count restricted to clean images.
- `image_hits`: the summed histogram reads over all images. It is reported only.
- `share`: spectra over counted spectra.
- `ladder_clean`: the distinct residues r whose clean N1 (n: L + m_r, c: L + m_r − H2O) or
  clean K2 image alone reaches `min_spectra`/4 (prior 5) distinct spectra.
- `ladder_confounded`: the same for confounded images. It is descriptive only.
- `support_c`, `support_n`: spectra with a clean image in channel c, or in channel n.
- `images`: the count per image class with a `*` on the confounded ones, for example
  `N0f=2598;N0r=19400;N1rA=1532;N1fV*=...`.
- `null_coincident`: `yes` when the offset itself lies within w of a null offset, that is m(S)
  or m(S) ± H2O for some composition S. This is shown, but by itself it does not decide the
  class, because at 700 Da the null offsets are dense and true labels (TMT among them) can
  coincide with one.
- `log10_q`, `fold`, against λ of section 6.

**Site attribution:**

- An offset in O_N is an N-terminal modification. Delta 0 is the unlabelled N-terminus.
- An offset in O_K only is a lysine modification (TMT side chain, Lys8, a K-only label).
- An offset in O_R only is an arginine modification (Arg10).
- The same offset in both O_K and O_R, within w_c, is a C-terminal modification of the peptide
  (for example 18O labelling, +2.0042 or +4.0085). It is attributed to C only on channel-c
  support (K1f/R1f images). 2 × 13C (+2.0067) lies 2.5 mDa from +2.0042, inside w_n, so the
  n images cannot tell 18O from an isotope mis-pick; at w_c 0.0015 the c images can.
- The scan assumes K and R at P1, which is the tryptic case. For a non-tryptic call by
  `-digest_out` this is noted in `ld_run`; it is not corrected.

**Second pass.** Once a K label L_K is found, K + L_K joins S1, and O_N is scanned again. This
is because a labelled N-terminal K carries both labels, so its N1 image is L_N + K + L_K. Only
one second pass is made.

**Completeness.** It is spectra(L) / (spectra(L) + spectra(delta 0)), per site, with both
counts from the exact distinct-spectra recount and restricted to the image classes both
hypotheses can show (so a hypothesis with more observable images, such as TMT's b0, is not
favoured). It is descriptive, because labels change fragment detectability: TMT enhances the b
ions. It is the "partial labelling" read-out of the backlog entry.

## 8. Annotation of peaks and site candidates

Every channel peak and every site candidate gets exactly one class and up to `unimod_top`
alternatives. Classes are tried in this order, and the first that matches within ±w wins:

1. **`residue_combo`, `null_shadow`, `isotope_error`, `shadow`.** These are the classes of
   evidence that the unlabelled flanks, the precursor picks or an already accepted label explain.
   None of them is ever called.
   - `residue_combo` (channel peaks): the mass matches a null channel image (section 7) with
     |S| ≤ `depth` named in the explanation, or a longer S, named by its composition count.
   - `null_shadow` (site candidates): the candidate has no clean support, that is
     `ladder_clean` < 3 and no clean zero-residue image (N0f, N0r, K0f) with ≥ `min_spectra`
     spectra. This covers +18.0106, K + H2O, R + H2O, −18.0106, r − H2O, offsets m(S) of longer
     flanks (x = 113.08 from three-residue flanks), and the residue-difference collisions of
     common labels on a label-free run (Dimethyl A→V, S→P, N→AA, Q→GV, C(CAM)→GM; Methyl;
     Oxidation; Carbamyl; Formyl; Acetyl S→E, K→AV/GL), whose ladders are confounded.
   - `isotope_error`: the candidate lies at +k × 1.003355 (k = 1, 2) from a stronger candidate
     of the same site, within w_n, and its clean support is in channel n only.
   - `shadow:<site>+<delta>`: more than 50 % of the candidate's spectra have their supporting
     images among the images of an accepted hypothesis (for example the N candidate at
     L_K + H2O = 247.17 of a TMT K-only set, or K + L_K + H2O = 375.27).
   - A candidate that passes all four but has `null_coincident yes` keeps its class below and
     lists the composition as an alternative.
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

   **Same-composition groups.** Unimod has several entries with one elemental composition:
   C3H4O (56.0262) is Propionyl and `Delta:H(4)C(3)O(1)`; C2H4 (28.0313) is Dimethyl, Ethyl and
   `Delta:H(4)C(2)`. Entries with the same `getDiffFormula()` form one explanation group, and
   the group is named by this priority:
   1. a curated list of derivatisation labels: Dimethyl and its 2H/13C variants, Acetyl,
      Propionyl, Carbamyl, TMT6plex/TMTpro/iTRAQ4plex/iTRAQ8plex and DiLeu (kept in the code
      beside `Digest::labelKeys()`);
   2. then the Unimod classification of the matching specificity
      (`getSourceClassification()`): `ISOTOPIC_LABEL` or `CHEMICAL_DERIVATIVE` before
      everything else, `ARTIFACT` and the `Delta:` entries last;
   3. then the lowest `getUniModRecordId()`.

   The other members are listed in `.alternatives` as `same_composition`.

   Ranking between groups: fewer residues in S first, then smaller |error| of the corrected
   centroid, then the group priority above. That order is deterministic. The same rule ranks
   `known_label` alternatives. Entries of different composition that are within the decision
   limit of section 5 (for example iTRAQ8plex 304.2054 and iTRAQ8plex:13C(6)15N(2) 304.1990,
   6 mDa apart, inside w_n) are decided by the corrected c-channel centroids of section 5. When
   that rule cannot decide, the label is written `ambiguous:<a>|<b>` and both are listed.

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
| `ld_run` | `format`, `tags_source`, `low_resolution`, `window_n`, `window_c`, `window_source_n`, `window_source_c`, `bin_da`, `max_flank_da`, `depth`, `min_spectra`, `min_share`, `min_fold`, `max_log10_q`, `fixed_nterm_delta`, `fixed_cterm_delta`, `alphabet` (residue=mass list), `unimod_entries` (searched entries), `digest_assumption` (`tryptic_P1`), `sigma_ppm_n`, `window_n_p90`, `precursor_mass_q10/q50/q90`, `calib_ppm_c`, `calib_ppm_n`, `calib_slope_c`, `calib_unc_ppm_c`, `calib_unc_ppm_n`, `null_compositions`. |
| `ld_count` | `spectra_counted`, `tags_counted`, `tags_excluded_cz`, `clamped_n`, `clamped_c`, `above_max_n`, `above_max_c`. |
| `ld_peak` | Per channel `n` and `c`, ranked: `<ch>.<i>.mass`, `.sigma`, `.spectra`, `.tags`, `.background`, `.fold`, `.log10_q`, `.class`, `.explanation` (e.g. `N1r:TMT+A` or `K1f:K+TMT6plex (K)`), `.alternatives`, `.share_adjacent_k`, `.se`. |
| `ld_site` | Per site `N`, `K`, `R`, `C`, ranked: `<site>.<i>.delta`, `.sigma`, `.spectra`, `.spectra_clean`, `.image_hits`, `.share`, `.ladder_clean`, `.ladder_confounded`, `.support_c`, `.support_n`, `.null_coincident`, `.images`, `.fold`, `.log10_q`, `.class`, `.explanation`, `.alternatives`, `.completeness`. The delta 0 rows (unlabelled N, K, R) are always written, as the positive control. |
| `ld_known` | For each `labelKeys()` label and configured fixed terminal/K modification: tags and spectra per image at `-digest_window` (0.008 Da). This lets a reader relate the report to `-label_out`. |
| `ld_call` | `status` (`call`, `no_call`), `labels` (e.g. `TMT`, `Dimethyl`, `TMTpro+K:TMTpro`, `unknown:N+123.4567`, `ambiguous:iTRAQ8plex|TMTpro`, `label-free`; `+`-joined; `-` on a no call), `sites`, `basis` (`site_scan`), `reason` (`low_resolution`, `few_spectra`, `cz_only`, `no_reference`; `-` on a call). |

**Call rule (prior, unfitted).** Candidates are taken in order of `spectra_clean`. A site
candidate with delta ≠ 0 whose class is not `residue_combo`, `null_shadow`, `isotope_error` or
`shadow` is called when all of these hold (all counts are distinct spectra from the recount):

- share ≥ 0.01 (`kLabelMinShare`),
- fold ≥ 20 and log10_q ≤ −2, both against λ of section 6 (null expectation included),
- `ladder_clean` ≥ 3, or a clean zero-residue image (N0f, N0r, K0f) with ≥ `min_spectra`,
- channel-c support: `support_c` ≥ `min_spectra`, or clean images in both channels each with
  ≥ `min_spectra`/4. A delta with only n-channel support is never called.

A called candidate becomes an accepted hypothesis: its images join the null set (section 7) and
the remaining candidates are re-classed before the next one is taken.

*Revision 3, the evidence bar.* On real label-free runs clean N1/N2 images are taken by
compositions outside the null alphabet (variable modifications, internal and chimeric fragments),
so "3 clean ladder residues of `min_spectra`/4 spectra" called chance offsets on 42 % of them. A
candidate is now also held to the bar of its explanation's tier, with relative share =
spectra_clean / (spectra_clean + the site's delta 0 control spectra), clean share = spectra_clean /
counted spectra and the clean ladder:

| tier | explanation | relative share | clean share | ladder_clean |
|---|---|---|---|---|
| 0 | known label: TMT, TMTpro, iTRAQ4, iTRAQ8plex, Dimethyl (light, 2H(4), 2H(4)13C(2), 2H(6)13C(2)) at N or K; Lys4, Lys6, Lys8; Arg6, Arg10 | ≥ 0.15 | ≥ 0.02 | - |
| 1 | Unimod label: N-terminal or K/R entry classed isotopic label or chemical derivative, or curated (Acetyl, Propionyl, Carbamyl, DiLeu, ...) | ≥ 0.35 | ≥ 0.1 | ≥ 3 |
| 2 | unknown mass, other Unimod entries, the run's configured fixed modification | ≥ 0.5 | ≥ 0.2 | ≥ 5 |

The values were set on the DEV half (by PXD, stratified by label class) of the 256 runs of the
first evaluation and frozen before the TEST half and the held-out runs were scored
(acceptance/1.13 `PREREG-labeldisc.md`). On DEV the false tier-2 offsets of label-free runs reach a
relative share of 0.41 and a clean share of 0.24; the true labels have relative shares of 0.72 or
more (isobaric, N site) and 0.37-0.54 (Lys8). An offset common to K and R that is a known SILAC
pair (Lys6/Arg6) is not merged into a C-terminal candidate.

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

**Memory.** The per-tag record list (section 4) takes 20 bytes per counted tag: 2.6 MB on the
PXD004541 probe, about 40 MB for a full run of 2M tags. It is allocated only when the option is
on. The four dense histograms (n, c, c with last residue K, n with first residue K) are built
from the list in the post-processing, `ceil(max_flank / 0.0005)` = 1,400,000 `uint32_t` bins
each, 22.4 MB. The prefix sums and offset spectra take another ≤ 50 MB. All of this is freed
before the report is written.

*As implemented* (the figures above hold for the default `max_flank` 700 only): the null image
set is not a bitset but 11 intervals of 24 bytes per occupied 0.0005 Da composition bin, built
from a dense DP of 17 bytes per bin. With the 19-residue alphabet (fixed carbamidomethyl Cys) the
occupied bins grow faster than linearly with `max_flank`: about 17k at 700 Da (null set about
5 MB), 94k at 1000 Da (25 MB), 486k at 1500 Da (130 MB) and 1.2M at 2000 Da (315 MB); at 5000 Da
it would be several GB. Variable modifications in the run alphabet add more. The dense histograms
and the scan arrays grow linearly (about 24 bytes per bin and channel). So `max_flank` is limited
to 1500 Da (`kMaxFlankLimit`), and a larger value is refused before the run starts. Measured
peak RSS on the `ld_tmt.mgf` fixture (data node, 4 threads): 33 MB with the option off, 145 MB
at 700 Da, 260 MB at 1000 Da and 704 MB at 1500 Da (post-processing 0.9, 1.4 and 2.9 s).

**Counting.** Each counting thread appends records to a `thread_local` vector, tagged with the
spectrum's scan-order index. At the end of the run the vectors are merged and sorted by
(spectrum index, then the tag's write order within the spectrum), which is deterministic. The
histograms are no longer atomic and are filled single-threaded from the sorted list. The
post-processing sums floats in ascending bin or list order. So the report is byte-identical at
any `-threads`.

**Time.**

- Counting is O(1) per tag.
- The site scan is about 3 sites × 1.5M positions × 2 × 26 lookups, roughly 230 M array reads.
- The composition DP is 1.4M bins × 20 residues, about 30 M steps.
- The exact recount is ≤ 600 candidates × (tags in the candidate's image windows), with the
  list indexed by binned n and c, so each recount reads only the tags near its images.
- The S2 second pass is ≤ 600 candidates × 650 lookups.
- Annotation is ≤ 1,000 peaks × 351 images, with binary search in sorted image and Unimod
  tables.
- Target: ≤ 1 s of post-processing, and a wall-time overhead of ≤ 1 % when on, on PXD004541 at
  8 and 64 threads.
- Timing is measured on node data, paired with the option off. ibminode05 is reserved, so this
  timing is indicative, not a benchmark.
- With the option off, the only added work is one bool test per tag.

## 12. Code layout and tests

**New code:**

- `src/LabelDiscovery.{h,cpp}`, namespace `FASTag::LabelDiscovery`:
  - `TagList` (per-thread records, deterministic merge) and `Histograms` (built from the list)
  - `ImageTable` (hypothesis → images) and `NullImages` (composition DP, the four null readings,
    isotope satellites, accepted-hypothesis images)
  - `estimateWindow` and `calibrate` (per-channel ppm offset, n window in ppm of M)
  - `recount` (exact distinct-spectra counts per candidate)
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
   - Adding N0f/N0r/N1r images of +123.4567 gives one `unexplained` N site with
     `ladder_clean` ≥ 3 and the call `unknown:N+123.4567`.
   - Dimethyl given only as N1f/N2r images gives `unimod` Dimethyl via `ModificationsDB`.
   - A TMT K-only set gives site K, and no called N candidate at 247.17 (L_K + H2O) or 375.27;
     those are `shadow:K+229.1629`.
   - An offset common to K and R (+4.0085), present in the c images, gives site C.
4. **Collisions.** GG/N and AG/Q are listed as alternatives. N-terminal carbamidomethyl is
   `residue_combo` with Unimod `Carbamidomethyl (N-term)` among the alternatives.
5. **Precision.**
   - iTRAQ8 (304.205360) and TMTpro (304.207146) N0r images at σ 0.0004 Da, given one label at a
     time, are each annotated as the correct label at w_c 0.0015.
   - At the same σ they form one peak at w 0.008.
   - The corrected centroid still names the right label in both cases, with the other label
     listed as an alternative and its error.
   - With a +3 ppm offset applied to every c value (labels and references alike), the
     calibration recovers 3 ± 0.3 ppm and the label is still named correctly. With the
     references removed, so that the calibration uncertainty is large, the call is
     `ambiguous:iTRAQ8plex|TMTpro`.
6. **Background.** The half-integer mean, the floor 1, the Bonferroni count, and the Poisson tail
   against a reference value. Edge bins near 0 and near `max_flank` are checked.
7. **Window estimate.** Gaussian deviations with a known σ give w within 10 %. Fewer than 200
   reference values gives the defaults.
8. **Determinism.** The same flanks, shuffled and split over 1/3/7 histogram feeders, give a
   byte-identical report.
9. **Clamp.** Values of exactly 0 are counted in `clamped_*` and never binned.
10. **`-label_out` parity.** On one flank list, the `ld_known` tags equal `TerminusCounter`'s
    `lab_n`/`lab_c`.
11. **Null leak (label-free).** A label-free synthetic set with N-side flanks and forward and
    reversed C-terminal K/R flanks of 1-6 residues gives no called candidate, and in particular
    no candidate other than `null_shadow` at +18.0106, 146.1055, 174.1117, −18.0106 and the
    r − H2O offsets.
12. **Residue-difference collisions.** The same label-free set must not call any of: Dimethyl
    (A→V, S→P, N→AA, Q→GV, C(CAM)→GM), Methyl (G→A, S→T, V→L, T→P, N→Q, D→E, Q→AA), Oxidation
    (A→S, V→P, F→Y, M→Mox, Q→GS, W→AM), Carbamyl (A→N/GG, V→AA, T→GS, L→GV, Q→GN, E→DG),
    Formyl (S→D, T→E, K→GV), Acetyl (S→E, K→AV/GL). Their `ladder_confounded` is reported,
    their `ladder_clean` stays below 3. The clean-image counts per label of section 7 are
    pinned.
13. **Isotope picks.** The label-free set with 20 % of the n values shifted by +1.003355 (and
    5 % by +2.00671) gives no call; the +1.0034 N candidate is `isotope_error`. A TMT set with the
    same shift still calls TMT and nothing else.
14. **Same composition.** Synthetic Propionyl, Dimethyl and Acetyl N sites are named Propionyl,
    Dimethyl and Acetyl, with `Delta:H(4)C(3)O(1)`, Ethyl and `Delta:H(4)C(2)` listed as
    `same_composition`.
15. **Distinct spectra.** One spectrum holding a b0, b1 and b2 TMT ladder in both channels adds 1
    to `spectra` and 6 to `image_hits`.

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
  - Invalid values (depth 3, `max_flank` ≤ 0 or > 1500, `min_share` > 1, a window above 0.05 Da) are rejected with the usual
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
| TMTpro | PXD047517, PXD035354, PXD046211 (from the 193) | TMTpro (304.2071) at N and K, with K1f (432.30) and K1r (450.31) inside the default `max_flank` 700 |
| iTRAQ4 | PXD006536 | iTRAQ4plex (144.1021) |
| iTRAQ8 | PXD001540, PXD001670, PXD012764 | iTRAQ8plex 304.2054 told apart from TMTpro 304.2071 by the c-channel images. The 1.12 `label_call` calls all three TMTpro. |
| dimethyl | PXD052824 (in the 193, `label_call` no_call), PXD025168 (bigbio SDRF DIMETHYL3PLEX: Dimethyl, :2H(4), :2H(6)13C(2)) | Dimethyl 28.0313, and for PXD025168 three N-terminal deltas (28.0313, 32.0564, 36.0757) at N and K, class `unimod`. Confirm first that the label is fixed in the SDRF. |
| acetyl / propionyl | one public run with chemical N-terminal acetylation or propionylation, still to be selected (selection rule: SDRF lists it as a fixed N-terminal modification; histone propionylation sets are candidates) | Acetyl 42.0106 or Propionyl 56.0262, `unimod`, despite the missing b0 image |
| label-free | PXD001587 `140120_Lysate90min_38` (probe above), PXD003531 (gate input) | call `label-free`; no called N, K, R or C candidate; every candidate other than delta 0 is `residue_combo`, `null_shadow` or `isotope_error` |
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
- The site scan assumes tryptic C termini. Lys-C, Lys-N and non-specific digests may need O_K and
  O_R at every C-terminal residue. That would be format 2.
- c/z support: images with the c/z reversed offset (`reversedOffset()` −15.0347), also format 2.
- How dense the null image set is near 700 Da on real alphabets with several variable
  modifications. If the clean-image counts of section 7 fall too low for TMTpro (16 of 40 at the
  standard alphabet), the composition DP may be limited to the compositions the run's own
  delta-0 flanks support.
- The null expectation of section 6 assumes the delta-0 flank distribution is a fair model of
  where unlabelled flanks land. That is checked on the label-free probes.

## 15. Review of revision 1

The first design review raised seven issues. All were adopted; two with a change to the proposed
fix. The seventh issue reached this revision truncated after its first line (TMTpro K1f at 432.30
outside the default `max_flank` 420); it was handled on that content.

| # | severity | issue | decision | reason / where |
|---|---|---|---|---|
| 1 | critical | Both termini and readings leak into each site scan (+18.0106, K/R + H2O, L_K + H2O, −18.0106, r − H2O, longer m(S)); `residue_combo` covered only m(S), \|S\| ≤ 2 | Adopted, modified | Full null image set from a composition DP up to `max_flank`, four readings, plus accepted-hypothesis images and `shadow:` class (sections 7, 8; tests 3, 11). Modified: a candidate is classed by its *clean support*, not by its offset coinciding with a null offset. At 700 Da the null offsets are dense (about 41,000 composition masses) and a pure offset veto would also remove true labels; the offset coincidence is reported as `null_coincident`. |
| 2 | critical | Common labels equal residue differences (Dimethyl, Methyl, Oxidation, Carbamyl, Formyl, Acetyl), so their ladders build on label-free runs | Adopted | `ladder_clean` / `ladder_confounded`; the call needs `ladder_clean` ≥ 3 or a clean zero-residue image; λ includes the null expectation from the delta-0 flanks (sections 6, 7, 9; test 12 with the full collision table). |
| 3 | major | Channel n carries 13C precursor picks (`-isotope_error 0` default), so +1.0034/+2.0067 satellites with full ladders; 18O +2.0042 vs 2 × 13C; n error is ppm of M | Adopted | Isotope satellites in the null set, class `isotope_error`, no call on n-only support, site C only on c images; w_n(M) from a ppm σ, histograms at the 90th-percentile M (sections 5, 7, 8, 9; test 13). |
| 4 | major | iTRAQ8 vs TMTpro decided on statistical se; a 2-4 ppm calibration offset flips it | Adopted | Per-channel calibration from the reference deviations, corrected centroids, decision only within 0.25 × separation for both error and calibration uncertainty, several images, else `ambiguous:` (sections 5, 8; test 5 with +3 ppm). |
| 5 | major | Tie-break by `getFullId()` names Unimod artefacts (`Delta:H(4)C(3)O(1)`, `Delta:H(4)C(2)`) instead of Propionyl/Dimethyl | Adopted | Same-composition groups named by curated label list, then `getSourceClassification()`, then `getUniModRecordId()`; others as `same_composition` (section 8; test 14). |
| 6 | major | `spectra` not computable from aggregate histograms; summed image reads inflate share, min_spectra, Poisson test and completeness | Adopted, modified | A per-tag record list (n, c, M, spectrum index, flags; 20 bytes, M added for issue 3), merged in scan order; exact distinct-spectra recount per candidate; histogram sums kept as `image_hits`. Modified: the histograms are now built from the list after counting, which removes the atomic arrays (sections 4, 11; test 15). |
| 7 | major | Default `max_flank` 420 puts TMTpro K1f (432.30) and K1r (450.31) outside the range | Adopted | Default 700, which covers every one- and two-residue TMTpro image (≤ 676.37); the half-integer background still holds (sections 2, 11, 13). |

## 16. Revision 3 (evaluation 2, 2026-11-10)

The first evaluation on public data (`output/label-discovery/EVALUATION.md`, 1cdcb65) is the
input. Its findings and what was done:

| finding | change | where |
|---|---|---|
| y1(K) − NH3 and the precursor NH3/H2O losses missing from the null set (N + 129.079, N + 0.98, N + 16.02, N + 17.02) | null readings derived from the flank formula for every ion type with its NH3 and H2O losses, and the precursor family with its 13C peaks | section 7; `nullReadings()`; unit test 16 (fails without them) |
| a call on 3 ladder residues of 5 spectra; 42 % false label calls on label-free runs | tiered evidence bar (relative share, clean share, clean ladder), fitted on the DEV half only | section 9; `Settings::tier_min_*`; unit test 3 |
| medium SILAC read as N offsets; Lys4/Arg6 unknown | Lys4, Lys6, Arg6 known; a Lys6/Arg6 pair is not a C-terminal offset | section 8 |
| iTRAQ8 never named; centroid 304.2032 between the two Unimod iTRAQ8 compositions | iTRAQ8plex as the range 304.199040-304.205360 | section 5 |
| calibration uncertainty above 50 ppm on 64/183 runs | tight-window per-reference medians, robust spread | section 5 |
| dimethyl a Unimod-only explanation | dimethyl light/medium/heavy are known labels (tier 0) | section 8; the independent suite expects `known_label` |

Tests changed with the design (not to make them pass): the clean-image pins of test 12 (the null
set is larger: TMT 24 → 19, iTRAQ4 20 → 17, Dimethyl 21 → 20, Acetyl/Propionyl 13 → 11, Carbamyl
22 → 21); test 3's unknown +123.4567 set (now 3000 of 4000 spectra labelled; the former 1500 of
4000 is a second block that must not be called); the class of dimethyl (`known_label`) in test 3
and in `label_discovery_indep_test.sh`. Not changed: the runtime (the post-processing still takes
about 1 s at 76k tags), c/z and non-tryptic digests (section 14).
