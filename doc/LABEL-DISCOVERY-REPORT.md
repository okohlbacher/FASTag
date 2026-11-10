# The label discovery report (`-label_discovery_out`), format 1

Experimental and opt-in. It failed its held-out test (acceptance/1.13
PREREG-labeldisc.md; 190 public runs, scored once on 2026-11-10):

| Endpoint | Verdict | Result |
|---|---|---|
| P1: no label call on a label-free run | **FAIL** | 6 of 150 label-free runs got a label call (4.0 %) |
| P2: at least as many runs right as "always label-free" | **FAIL** | 96/190 against 150/190 |
| P3: at least as many runs right as `-label_out`'s `label_call` | **PASS** | 96/190 against 91/190 (sign test p = 0.33) |

Do not rely on the call as free of false label calls. The evidence bar was
set on development runs only (doc/DESIGN-label-discovery.md, sections 9 and
13).
The code is `src/LabelDiscovery.{h,cpp}`; its unit tests are
`test/label_discovery_test.cpp`.

## What it reports

`-label_out` counts tag ends at a few fixed label masses. This report finds
every terminal or lysine mass offset the tag flanks carry, known or not,
without a protein database:

- the **channel peaks** of the two flank channels as FASTagger writes them,
  `n` = `nterm_mass` and `c` = `cterm_mass`, each explained by residues, a
  known label or a Unimod entry;
- the **site candidates**: offsets at the peptide N-terminus (`N`), at lysine
  (`K`), at arginine (`R`) or at the peptide C-terminus (`C`), each with its
  evidence and class;
- a **call**.

It reads the tags `-label_out` reads: every written row of the selected
precursor hypothesis that is ungapped with E-value <= 1, read as b/y. c/z tags
are counted (`ld_count tags_excluded_cz`) and not binned. With `-fasta` only
database matches are written (`ld_run tags_source fasta_filtered`): run the
report without `-fasta` for an unbiased picture. With the option off nothing
of this runs, and every other output is the same with and without it.

## File format

The long-form report family of `-digest_out`, `-label_out`, `-massgap_out`
and `-alkylation_out`:

- UTF-8, header `section key value n description`, five tab-separated fields
  per row, none empty; `-` means "no value".
- Each (section, key) appears once. Read rows by (section, key), never by
  line number, and ignore sections and keys you do not know.
- Masses are rounded to 6 decimals (shares and folds to 4, standard errors to
  7); `FASTAG_FULL_PRECISION=1` in the environment writes them in full.
- The file is written to `<file>.part` and renamed when complete. A refused
  or failed run leaves no file.
- The version is the row `ld_run format` = `1`. A reader that does not know
  the format should stop.

Sections, in this order:

| section | content |
|---|---|
| `run` | the shared versioned run rows (`FASTag::RunReport::runRows`, `run_report_version`), as in `-alkylation_out` |
| `ld_run` | settings and run-level estimates (below) |
| `ld_count` | the counts of the tags read |
| `ld_peak` | the channel peaks, per channel `n` and `c`, ranked |
| `ld_site` | the site candidates, per site `N`, `K`, `R`, `C`; the delta 0 control first |
| `ld_known` | `-label_out`-compatible counts of the known labels |
| `ld_call` | the call |

On a Da fragment tolerance nothing is analysed: `run`, `ld_run`, `ld_count`,
the three delta 0 control rows of `ld_site` (with `-` values) and `ld_call`
are written, with `ld_call status no_call`, `reason low_resolution` (the
`-label_out` rule). A run with only c/z tags is the same, with `ld_known`
and `reason cz_only`.

### `ld_run`

| key | value |
|---|---|
| `format` | `1` |
| `tags_source` | `all`, or `fasta_filtered` with `-fasta` |
| `low_resolution` | `yes` on a Da fragment tolerance |
| `window_n` | the flat n half-window (Da), or `ppm` when it is w_n(M) = 3 sigma_ppm_n M (clamped to 0.0015-0.02 Da) |
| `window_c` | the c half-window (Da). An option value (`window_source_* option`) is used as given, not clamped; the options take at most 0.05 Da |
| `window_source_n`, `window_source_c` | `estimated` (from >= 200 reference deviations), `default` (0.008 / 0.004 Da) or `option` |
| `bin_da` | 0.0005 |
| `max_flank_da`, `depth`, `min_spectra`, `min_share` | the options |
| `min_fold`, `max_log10_q`, `call_min_share`, `min_relative_parsimony` | the priors of the peak and call rules: 20, -2, 0.01, 0.1 |
| `tier<t>_min_relative_share`, `tier<t>_min_clean_share`, `tier<t>_min_ladder_clean` | the evidence bar of the call per tier t (0 known label, 1 Unimod label, 2 other or unknown): 0.15 / 0.02 / 0, 0.35 / 0.1 / 3, 0.5 / 0.2 / 5 (set on the DEV half of evaluation 2) |
| `fixed_nterm_delta`, `fixed_cterm_delta` | the run's fixed terminal modifications (they are not subtracted: the flanks carry them) |
| `alphabet` | the run alphabet S1, `residue=mass` comma-joined (`n`: its size): the 19 residues (I as L), the fixed residue modifications applied, one entry per variable modification |
| `unimod_entries` | the ModificationsDB entries with a Unimod record id that were searched |
| `digest_assumption` | `tryptic_P1`: the site scan assumes K and R at P1 |
| `sigma_ppm_n` | 1.4826 MAD of the channel n reference deviations, in ppm of the precursor mass |
| `window_n_p90` | the n window the histograms use: w_n at the 90th percentile of M |
| `precursor_mass_q10/q50/q90` | precursor neutral mass quantiles |
| `calib_ppm_c`, `calib_ppm_n` | the median reference offsets (ppm; for n, ppm of M), from >= 20 reference values (`n`) that form a peak (c: >= 60 % of the deviations within 0.005 Da of their median) at an offset within 30 ppm, else `-` and no correction |
| `calib_slope_c` | the linear term of the c calibration (ppm per Da; Theil-Sen over the per-reference medians, fitted with >= 1000 references spanning >= 150 Da), else `-` |
| `calib_unc_ppm_c`, `calib_unc_ppm_n` | residual calibration uncertainty: MAD / sqrt(n_ref), plus for c the spread of the per-reference medians: each median over the reference's residuals within 4 sigma_c (at least 2 mDa) of the calibrated position, with >= 50 values; the spread is 1.4826 MAD of the medians (half their difference for two) |
| `null_compositions` | residue compositions of the null image set (0.0005 Da bins) |

The reference deviations are those of the nearest one-residue image within
0.02 Da: c = m_r and n = m_r + H2O, m_r over the alphabet and bare K and R.
The channel n offset is taken from r = K or R only (the reversed read of a
tryptic one-residue C side; other residue masses there are often chance
compositions), its spread (`sigma_ppm_n`, `n` = its reference values) from
every residue.
Every flank is corrected by the calibration before it is binned. The
`-out_spectra` provenance never lists the `-label_discovery_*` options (the
report writes its own settings), so every other output is byte-identical
with the option on.

### `ld_count`

`spectra_counted`, `tags_counted` (b/y), `tags_excluded_cz`, `clamped_n`,
`clamped_c` (flanks of exactly 0, FASTagger's `max(0, .)` clamp, never
binned), `above_max_n`, `above_max_c`.

### `ld_peak`

Per channel (`n`, `c`) and rank `i` (by spectra, then mass; at most 200):
`<ch>.<i>.mass` (count-weighted centroid of the bins within +-w), `.sigma`
(1.4826 weighted MAD), `.spectra` (distinct spectra within w of the peak),
`.tags`, `.background` (mean smoothed count at the ten half-integer offsets
x + k + 0.5, k = -5..4, inside the range), `.fold` (smoothed count over
max(background, 1)), `.log10_q` (Poisson upper tail, Bonferroni over 2 x the
bins, floored at -300), `.class`, `.explanation`, `.alternatives`,
`.share_adjacent_k` (c: tags whose last residue is K; n: first residue K),
`.se`.

A peak needs spectra >= `min_spectra`, share >= `min_share`, fold >= 20 and
log10_q <= -2.

Classes, the first that matches wins:

- `residue_combo`: the mass is an unlabelled flank in one of the null
  readings below, `<ch>:<reading>:<S>` (e.g. `n:S+H2O:LK`, `c:S-NH3:K`,
  `n:S+13C:L`), with |S| <= `depth` named; the precursor family as
  `n:<reading>` (e.g. `n:M-NH3`); a longer composition as
  `<ch>:<reading>:|S|=<k>`.
  Unimod entries at the zero-residue images are listed as alternatives
  (N-terminal carbamidomethyl beside G).
- `known_label`: an image of TMT, TMTpro, iTRAQ4, iTRAQ8plex (the range
  304.199040-304.205360 of its two compositions), Dimethyl, Dimethyl:2H(4),
  Dimethyl:2H(4)13C(2), Dimethyl:2H(6)13C(2) (N-terminal or on K), Lys4,
  Lys6, Lys8, Arg6, Arg10, or the run's fixed terminal or K modification:
  `<image>:<label>[+S]`, e.g. `N0r:TMT`, `N1r:TMT+A`, `K1f:K+TMT`, `K0f:TMT`.
- `unimod`: a ModificationsDB entry of matching specificity at an image,
  e.g. `N1r:Dimethyl+A`.
- `unexplained`.

Alternatives are `<explanation>(<error in Da>)`, `;`-joined, with
`same_composition:<id>` for the other members of the named entry's
composition group.

### `ld_site`

Per site (`N`, `K`, `R`, `C`) and rank `i`; `<site>.0` is the delta 0
control (the unlabelled terminus or residue) and is always written for N, K
and R. Keys: `.delta` (Da), `.sigma`, `.spectra` (distinct spectra with a tag
within w of one of the candidate's images), `.spectra_clean` (the same, clean
images only), `.parsimony` (the call's order, below), `.image_hits` (summed
histogram reads over the images), `.null_expectation` (summed reads of its
images confounded by the null set), `.share` (spectra / counted spectra),
`.ladder_clean`, `.ladder_confounded`, `.support_c`, `.support_n` (spectra
with a clean image in that channel), `.null_coincident` (`yes` when the
offset itself lies within w of m(S) or m(S) +- H2O), `.images` (tags per
image, `*` = confounded), `.fold`, `.log10_q`, `.class`, `.explanation`,
`.alternatives`, `.completeness` (spectra(L) / (spectra(L) + spectra(delta
0)) over the non-zero images, descriptive), `.called` (`yes` when the
candidate is part of the call), `.tier` (the evidence tier of its
explanation: 0 a known label, 1 a Unimod label, 2 other or unknown; `-` for
the controls), `.relative_share` (spectra_clean / (spectra_clean + the
site's delta 0 control spectra; for C the K and R controls)), `.clean_share`
(spectra_clean / counted spectra).

Images (doc/DESIGN-label-discovery.md section 3). For an N offset L: `N0f`
(n = L), `N0r` (c = L - H2O), `N1f<r>`/`N1r<r>` (one residue), `N2f<rs>`/
`N2r<rs>` (two). For a K offset: `K0f` (c = L, last residue K), `K0r`
(n = L + H2O, first residue K), `K1f` (c = K + L), `K1r` (n = K + L + H2O),
`K2f<r>`, `K2r<r>`. R: the same without K0f/K0r. C (an offset common to K
and R): the K and R images and `C0f` (c = L), `C0r` (n = L + H2O). Images
below 1 Da or above `max_flank` are dropped.

The **null image set** is every residue composition S (|S| >= 1) of the
alphabet in every reading of FASTagger's flank formula (c = low peak neutral
- H2O, n = M - high peak neutral), the ion and its single NH3 and H2O losses:

| channel | reading | ion |
|---|---|---|
| c | `S`, `S-NH3`, `S-H2O` | forward low peak y, y - NH3, y - H2O (y1(K) - NH3: c = 111.068) |
| c | `S-H2O`, `S-H2O-NH3`, `S-2H2O`, `S-H2O-CO`, `S-H2O-CO-NH3` | reversed low peak b, b - NH3, b - H2O, a, a - NH3 (one residue: the immonium ion less NH3, Q/K 84.04) |
| n | `S`, `S+NH3`, `S+H2O` | forward high peak y, y - NH3, y - H2O |
| n | `S+H2O`, `S+H2O+NH3`, `S+2H2O` | reversed high peak b, b - NH3, b - H2O |
| n | each n reading `+13C`, `+2x13C` | the precursor picked one or two 13C peaks high |

and the precursor family once (S empty): `M-NH3`, `M-H2O` (forward: the
precursor less NH3 or H2O as the high peak, n = 17.027, 18.011), `M-H2O`,
`M-H2O-NH3`, `M-2H2O` (reversed: b_n = M - H2O, less nothing, NH3 or H2O),
each at -1, 0, +1, +2 x 13C (n = 16.023 is NH3 read at the precursor ion's
13C peak). Compositions are enumerated up to `max_flank` + 64 Da, so the
negative c shifts reach `max_flank`. An image within its channel window of a
null image is **confounded**, otherwise **clean**. Accepted (called) hypotheses add
their images, the n images' 13C satellites and the a-ion and NH3 satellites
(c - CO, c - NH3, n + CO, n + NH3) to the set for every later candidate.

A **ladder** residue is one whose ladder image (N1 for N, K2/R2 for K/R)
reaches `min_spectra`/4 distinct spectra and is centred on its own mass (the
mean deviation of its tags within half the window, so the tail of a
neighbouring peak does not count).

Site candidate classes, the first that matches wins (only the last three can
be called):

- `null_shadow`: fewer than 3 clean ladder residues and no clean zero-residue
  image (N0f, N0r, K0f, C0f) with >= `min_spectra` spectra: the unlabelled
  flanks explain it.
- `isotope_error`: +1 or +2 x 13C from a stronger candidate of the same site
  or from delta 0, without clean channel c support.
- `shadow:<site><delta>`: another candidate explains the same images. Either
  an isomorphic twin (an N offset x and the K or R offset y = x - H2O - K (R),
  or y = x - H2O for K0f/C0f, predict the same masses in the two channels;
  the family goes to the member with a known or curated label explanation,
  else a C member, else a K member with a clean K0f image, else the N
  member), or an accepted hypothesis: more than half of its spectra, or all
  of its base images (no residue besides the site's own), lie on its images.
- `known_label`, `unimod`, `unexplained`: as for the peaks, at the site.
  `unimod` entries match by specificity: N-terminal (`N_TERM`,
  `PROTEIN_N_TERM`) for N, origin K for K, origin R for R, `C_TERM` for C.
  Entries with one composition form a group named by a curated label list
  (Dimethyl and its isotopologues, Acetyl, Propionyl, Carbamyl, TMT,
  TMTpro, iTRAQ4/8, DiLeu), then `ISOTOPIC_LABEL`/`CHEMICAL_DERIVATIVE`,
  `ARTIFACT` and `Delta:` last, then the lowest record id.

Near-isobaric labels (iTRAQ8plex / TMTpro 304.2071) are decided by the
calibrated channel c centroids: a label wins when every estimate lies within
a quarter of the separation of it and the calibration uncertainty at that
mass is below a quarter of the separation; rivals are sought within the
window plus the calibration uncertainty (5 ppm when the channel has no
calibration). Otherwise the explanation is `ambiguous:<a>|<b>`. iTRAQ8plex is
a range, 304.199040 (Unimod 731, iTRAQ8plex:13C(6)15N(2)) to 304.205360
(Unimod 730): the kit's channels carry the two compositions, so a sample of
mixed channels centres between them (evaluation 2: 304.2031-304.2032 on the
DEV iTRAQ8 runs). Its error is 0 inside the range; the two Unimod entries are
one family, not rivals of each other. TMTpro's channels share one
composition.

The fold and q of a site candidate compare its clean reads with the
half-integer background of the same clean images (the null expectation is
reported, not divided by: a label's own signal sits on its confounded
images too).

### `ld_known`

For TMT, TMTpro, iTRAQ4 and the run's fixed N-terminal and K modifications:
`<label>.<image>.tags` and `.spectra` for N0f (n = L), N0r (c = L - H2O),
K0f (c = L, any last residue), K1f, K1r, at `-digest_window` with the
`-label_out` rule (`[m - w, m + w]`, the values as written, every counted tag
c/z included). `<label>.N0f.tags` equals `-label_out`'s N-terminal count of
that label and `<label>.K0f.tags` its C-terminal count.

### `ld_call`

| key | value |
|---|---|
| `status` | `call` or `no_call` |
| `labels` | the labels called, `+`-joined: an N label by name (`TMT`, `Dimethyl`, `iTRAQ8plex`), others `<site>:<name>` (`K:TMT`, `K:Lys8`, `R:Arg6`), unknown ones `unknown:<site><+delta>`, near-isobaric ones that the calibration cannot separate `ambiguous:<a>|<b>` (e.g. `ambiguous:iTRAQ8plex|TMTpro`: isobaric, not decided); `label-free`; `-` on a no call |
| `sites` | the sites of the called labels, comma-joined |
| `basis` | `site_scan` |
| `reason` | `low_resolution`, `cz_only`, `few_spectra` (below 175 counted spectra), `no_reference`; `-` on a call |

**Call rule (priors; the evidence bar set on development runs only; it
failed the held-out test above).** Candidates are taken in order of
parsimony: per spectrum 2^-k, k the fewest residues (besides the site's own
K or R) of a clean image supporting it, summed. A candidate of class
`known_label`, `unimod` or `unexplained` with delta != 0 is called when it
has spectra >= `min_spectra`, share >= 0.01, fold >= 20 and log10_q <= -2,
3 clean ladder residues or a clean zero-residue image with >= `min_spectra`
spectra, channel c support (`support_c` >= `min_spectra`, or both channels
>= `min_spectra`/4), and a parsimony of at least a tenth of the strongest
called label and of its site's delta 0 control (for C: of the K and R
controls), and the **evidence bar of its tier** (`.tier`): relative share,
clean share and clean ladder residues of at least 0.15, 0.02, 0 for a known
label (tier 0), 0.35, 0.1, 3 for a Unimod label (tier 1: an N-terminal or K
or R entry classed isotopic label or chemical derivative, or a curated
derivatisation label such as Acetyl, Propionyl, Carbamyl, DiLeu) and 0.5,
0.2, 5 for anything else (tier 2: an unknown mass, other Unimod entries, the
run's own configured modifications). A known label thus needs a share of the
peptides comparable to the unlabelled ones; an unknown offset needs to sit
on most of them, on a ladder of many residues. An offset common to K and R
that is a known SILAC pair (Lys6/Arg6, 13C(6)) stays a K and an R label, not a
C-terminal one. A called candidate's images join the null set and the rest are
re-classed before the next is taken. When a K label is called, K + its delta
joins the alphabet and the N site is scanned once more for new offsets.

`label-free`: no candidate is called and the N-terminal delta 0 control
passes the same evidence rule (3 ladder residues, channel c support). Else
`no_call no_reference`.

## Evaluation 2 (2026-11-10)

The first evaluation (output/label-discovery/EVALUATION.md) found false
label calls on 67 of 159 label-free runs. Changed in this revision, the
format number unchanged (new keys only; a reader ignores keys it does not
know):

1. **Null readings derived from the flank formula**, the table above: the
   NH3 and H2O losses of every unlabelled image type in both channels, and
   the precursor family with its 13C peaks. Before, y1(K) - NH3 (c = 111.068)
   was the clean N0r image of N + 129.079 and the clean N1rK image of
   N + 0.984 (PXD003531, a gate input), and n = 16.02 / 17.00-17.03 the clean
   N0f images of N + 16.02 / N + 17.02.
2. **The evidence bar per tier** of the call rule above (`.tier`,
   `.relative_share`, `.clean_share`; `ld_run tier<t>_*`).
3. **Known labels** added: iTRAQ8plex (as a range), dimethyl light, medium and
   heavy, Lys4, Lys6, Arg6. Medium SILAC was read as N offsets (N + 150.13 =
   K + Lys4 + H2O, N + 180.13 = R + Arg6 + H2O).
4. **Calibration uncertainty** from the robust spread of tight-window
   per-reference medians instead of the range of the medians. On the DEV half
   its median is 0.18 ppm, the largest 2.0 ppm (before: above 50 ppm on 64 of
   183 runs).

## Where the implementation goes beyond the design (revision 2)

Found on the PXD004541 (TMT10) and PXD001587 (label-free) probes:

1. **Parsimony order** instead of `spectra_clean`: an offset L - m_r reads
   L's N0r as its N1r and L's N1r as its N2r, so it has as many clean
   spectra as L. Weighting each spectrum by its fewest-residue image puts L
   first.
2. **Isomorphic twins.** In the two channels an N offset x and the K offset
   x - H2O - K (or the R offset x - H2O - R) predict exactly the same masses
   (N0r = K1f, N0f = K1r, N1 = K2). The design attributes sites by the scan
   they peak in, which cannot separate them; the family rule above does.
3. **More null readings**: n = H2O, the a ion and NH3 losses of the
   reversed read. Without them the immonium ion 84.04 (Q - NH3) and the a2
   ions of N-terminal pyro-Glu peptides gave an N+83.037 call on the
   label-free probe.
4. **Satellites of accepted labels** (a ion, NH3 loss): the TMT a-ion
   ladder (TMT - CO, N+201.168) is a shadow of TMT, not a label.
5. **Clean fold**: fold and q use the clean reads against their own
   half-integer background. With the null expectation in lambda, TMT on the
   TMT10 probe has a fold of about 3 (its confounded N1 images carry its own
   signal) and would not be called.
6. **Centred ladder images**, and a **relative parsimony** of 0.1 against
   the strongest called label and the site's delta 0 control: noise tails,
   residue-sum relatives of a strong label and chance offsets of a
   label-free run gave unknown calls with 3 weak ladder residues.
7. **Scan maxima are moved** to where the candidate's strongest image puts
   them before the candidate is evaluated (a flat O top can lie a window off
   the offset when the window is wider than the spread of the flanks).
8. **Calibration** needs 20 reference values, in channel c forming a peak;
   the channel n offset uses K + H2O and R + H2O only (the window estimate
   keeps the 200 references of the design).

Two-modification combinations (`unimod_combo`, `FD::combinations` over
`massgap_mods.tsv`) are not tried in format 1.

The clean N0/N1 image counts of the design's section 7 check (CAM-Cys,
Met-ox, w_c 0.0015, w_n 0.006) are, with this null set: TMT 19, TMTpro 14,
iTRAQ4 17, Dimethyl 20, Acetyl 11, Propionyl 11, Carbamyl 21, unknown
+123.4567 40, the leaks +18.0106 and K + H2O 0 (pinned in the unit test;
format 1 before evaluation 2: TMT 24, TMTpro 14, iTRAQ4 20, Dimethyl 21,
Acetyl 13, Propionyl 13, Carbamyl 22).
