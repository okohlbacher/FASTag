# Run-measured complement tolerance (`-complement_tolerance_unit auto`)

Experimental, opt-in (1.13, backlog item 15); `auto` **failed** its held-out
test with the first estimator; the second test, with the revised estimator,
was **inconclusive** with no criterion failed (see Validation). With the option off, nothing in this
file runs and every output is unchanged.

## What it does

The complement subscore asks, for each kept peak, whether a partner peak lies
within a window of its complement m/z (b + y = M + 2 protons at the same
fragment charge, or the precursor rule of `-complement_rule`). The window is
`-complement_tolerance` (0.02 Da, FASTag 1.11's value) or a multiple of the
fragment tolerance (`-complement_tolerance_unit fragment`). Neither knows the
run: a pair's mass error is the precursor's error plus two fragment errors,
and that differs by instrument and calibration. On ion-trap MS2 read at
0.5 Da, a 0.02 Da window finds almost no true pairs.

`auto` measures the window on the run before tagging:

1. **Probe.** A uniform draw (fixed seed) of 4 x `-complement_probe` spectra
   over the run is read; of the MS2 among them, a second uniform draw keeps
   `-complement_probe` (default 500), so the probe spans the whole run. They
   are read as the tagging pass reads them (centroided under
   `-pick_profile` as there) and tagged at seed length 3 with the command
   line's default preprocessing and search settings (deisotoping on, `-gaps 1`,
   the default peak budget, E-value cut and gap penalty), whatever the run's
   own `-tag_length`, `-no_deisotope`, `-gaps` or peak options; only the
   settings that describe the measurement (fragment tolerance, ion series,
   complement rule, modifications) are the run's. So one input file gives one
   window in every configuration (`complement_tol_cli_test` checks
   `-tag_length 4`, `-no_deisotope` and `-gaps 0`). At the header charge (2
   when none). The probe's complement window is the whole
   measurement window W: the complement subscore still acts, but it no longer
   depends on the configured window, so tags are not selected for having
   partners inside it.
2. **Errors.** For each probe spectrum whose rank-1 tag has E <= 0.01, each
   end of that tag (two observed peaks) gives one signed error: the nearest
   other peak to the complement m/z under the run's rule(s), minus that m/z,
   kept when it lies within W. W is 6 times the fragment tolerance at m/z
   1000, within 0.1-0.9 Da (below one 13C spacing): 0.12 Da at 20 ppm,
   0.9 Da at 0.5 Da.
3. **Window.** The errors are a peak near zero (true partners) on a flat floor
   (chance peaks). The floor's density is read from the outer third of W.
   From the middle half of the signal, with the floor subtracted, come the
   median signed error m and the median absolute deviation from it (MAD).
   The window is |m| + 1.96 x 1.4826 x MAD (at least 0.001 Da): the
   two-sided 95% bound of a normal error, widened by a systematic offset
   because the window is centred on the complement m/z. A probe gives 50 to
   150 signal pairs on typical high-resolution runs; at that size the median
   and MAD are stable (`complement_tol_test` (f): over 200 samples the
   95th/5th percentile ratio of the estimate stays below 2), where the 95%
   order statistic that 1.13's first version read was not (ratios 3.1 to 7.8
   on the same samples: one or two extreme errors set it).
4. **Lower bound.** The window in force is never narrower than
   `-complement_tolerance` (0.02 Da unless given): `auto` widens the window
   where the run needs it and otherwise keeps the Da window. The median/MAD
   bound assumes a normal error; real complement errors on high-resolution
   data have heavier tails, so it reads them too narrow. On the Q Exactive
   DEV run it gave 0.0139 Da (the 95% order statistic over the same 263
   signal pairs: 0.0225 Da), and in force that cost up to -0.54 points
   rank-1 correct in two powered 3+ cells. A window somewhat too wide costs
   little there (the first version's 0.019-0.036 Da left DEV within +-0.27
   points). Give a smaller `-complement_tolerance` to let `auto` narrow it.
5. **Fallback.** When the signal is below 40 pairs, or below three standard
   deviations of its fluctuation (Poisson variance doubled for the shared
   precursor error of a tag's two ends), or the window is not inside the inner
   two thirds of W, nothing is measured and the run keeps
   `-complement_tolerance`.

The result is logged to stderr, for example

    Complement tolerance (auto): measured 0.22422414115406886 Da, in force 0.22422414115406886 Da;
    probe 500 MS2, 160 confident tags, 286 pairs within 0.9 Da (signal 259, median error 0.0548 Da,
    MAD 0.0583 Da)

and recorded with the run's outputs, so a run can be reproduced and audited
without its log:

- `-out_spectra` (mzML): the processing step carries the userParams
  `complement_tolerance (auto)` (the window in force, Da, full precision),
  `complement_tolerance (auto) source` (`measured`, `lower_bound` when the
  measurement was below `-complement_tolerance`, or `fallback`),
  `complement_tolerance (auto) measured` (when measured) and
  `complement_tolerance (auto) probe` (the probe statistics, as logged).
  mzPeak output has no processing-step record and does not carry them.
- Every run report that writes the versioned run section (`-census` summary,
  `-alkylation_out`) adds the rows `complement_tolerance` (in force),
  `complement_tolerance_source`, `complement_tolerance_measured` (when
  measured), `complement_probe_confident`,
  `complement_probe_signal` and, when measured, `complement_probe_median` and
  `complement_probe_mad`, and says run report format 6.
- Without `auto` none of this is written: those outputs stay byte-identical
  (format 5).

The window is written at full precision: giving it back as
`-complement_tolerance <value> -complement_tolerance_unit Da` reproduces the
run's tags exactly (`complement_tol_cli_test` reads it back from
`-out_spectra` and from the census summary). The rest of the run is the Da
mode at that window: the tags, the `-unknown_charge infer` and
`-isotope_error` complement counts and every report use it.

## Limits

- Not with `-stream` (refused) and not with mzPeak input (refused: mzPeak is
  read in one pass); mzML and MGF only.
- The probe's errors come from the ends of confident tags, whose own m/z fit
  is good, so the measured window is somewhat narrower than the 95% bound of
  all fragment pairs (on the in-silico fixtures 0.0105 for a 0.0111 Da bound
  and 0.255 for 0.277 Da).
- The probe reads the header charge and m/z only: the hypotheses of
  `-unknown_charge` and `-isotope_error` are not probed (a run whose header
  monoisotopes are often wrong measures fewer pairs and may fall back).
- The floor model assumes chance partners are flat across W and true pairs
  lie well inside 2W/3. A real error population near the edge of W (a second
  calibration group, or errors as wide as the fragment tolerance x 4) is read
  as floor and is not covered; dense spectra make the nearest-peak floor
  slope towards zero. Both ends of a tag share the precursor error, so the
  significance gate doubles the Poisson variance.
- Cost: one extra tagging pass over the probe (500 spectra; about 0.35 s at
  one thread on a Q Exactive run, ~2% of a 27,000-MS2 run).
- One window per run. Runs whose calibration drifts over the gradient get
  one compromise window.
- The MAD-based window assumes the true-pair errors are roughly normal. A
  heavier-tailed error leaves more than 5% of true pairs outside it; the
  lower bound `-complement_tolerance` covers that on high-resolution data,
  not on low-resolution data whose tails are heavy too.

## Validation

The first held-out result below was measured with 1.13's first version
(c5f96b5): the probe tagged at the run's first seed length with the run's
preprocessing, and the window was the 95% order statistic of the
floor-corrected |error|. That version's window was not a property of the
input file: on the held-out Astral file PXD066944 it was 0.0146 Da
(L4 default), 0.0184 Da (L3 default) and 0.0566 Da (L5 default), each from
65 to 71 signal pairs, and PXD076520 ranged from 0.026 to 0.037 Da. The
failing Astral L5 default 2+ cell is the cell with the 0.0566 Da window, so
the Astral failure is at least partly estimator variance, not only a wrong
window. The current version (probe at length 3 with default settings; median
and MAD; `-complement_tolerance` as the lower bound) removes that dependence
by construction and is far less variable on probe-sized samples. On DEV:
on PXD003531 one window per file (measured 0.0139 Da in all
six cells, so 0.02 Da in force and the tags equal the defaults); on PXD001819
(0.5 Da) 0.224 Da in all six cells and +2.3 to +7.6 points rank-1 correct in
every powered 2+ and 3+ cell ((ii) PASS on DEV; the 4+ cells are
underpowered). Its held-out result is the second test below.

DEV of the first version (c5f96b5): the #2 DEV runs with the frozen #2 scorer. On PXD003531 (Q Exactive, 20 ppm) the measured windows were
0.019-0.036 Da, and the powered cells moved by -0.20 to +0.27 points. On PXD001819 (LTQ Orbitrap Velos,
ion-trap MS2, 0.5 Da) they were 0.177-0.208 Da, and the powered cells gained +2.2 to +7.6 points.

First held-out test, first version (`acceptance/1.13`, `PREREG-compltol.md`, `results/compltol/RESULT.md`): the #2 design and margins on
11 runs (astral 2, ion_trap 5, qe 1, timsTOF 3), scored once. Verdict **FAIL**:
- (i) fails on three Astral cells: L5 default 2+ at -0.503 points, and two 4+ cells whose Holm bound is below
  -1.0.
- (ii) passes: pooled length-3 gain +3.05 points on astral + ion trap, carried by the ion trap.
- (iii) timsTOF 4+ passes.
- (iv) time passes (ratio 1.027).

The ion-trap runs gained +2.1 to +5.1 points in every powered 2+ and 3+ cell. Q Exactive and timsTOF stayed
within +-0.33 points. Two high-resolution runs fell back to 0.02 Da (too few pairs).

Second held-out test, current version (`acceptance/1.13/PREREG-compltol-heldout2.md`, branch `acc113r/compltol`:
freeze cb84295, results 56f604d; integration/1.13 at e21d803): 8 new runs (astral 2, ion_trap 3, qe 3), 54 cells.
Against the first test, underpowered or uninformative 4+ cells do not block (i), and (ii) is the ion-trap set alone
with a threshold of +1.0 points; both were fixed before the freeze. Verdict **INCONCLUSIVE**; no criterion failed:
- (i) 44 cells pass, 0 fail, 10 are uninformative (all ion trap). Astral 18/18 and Q Exactive 18/18 pass with a
  difference of 0 in every cell. Ion trap: 8 cells pass (+0.62 to +1.57 points); six 4+ cells and four 3+ cells
  (L4 and L5, baseline 0.85 to 1.22%) are uninformative, and the four 3+ cells block a PASS (their differences:
  -0.13 to +0.47 points).
- (ii) passes: ion trap, length 3, 6.74% to 7.81%, +1.07 points (95% interval 0.87 to 1.27; 13,969 clusters).
- (iii) timsTOF: not tested (no timsTOF run).
- (iv) time passes (ratio 1.010).
- One window per file in all six cells, never below 0.02 Da (8 of 8 files).

On all five high-resolution files the window in force was 0.02 Da (three measured below it, 0.0064 to 0.0185 Da;
two fell back with too few pairs), so `auto` equals the default there. The three ion-trap files measured 0.337 to
0.426 Da. Limits: one Astral project, and in neither of its files did `auto` change the window, so windows above
0.02 Da on Astral data are untested; three ion-trap files, all at a fragment tolerance of 0.5 Da and with low
identification rates; no timsTOF; the scorer was started twice (the first start stopped at an import, before it
read data).

The option stays experimental; the default stays `Da`.

## Code

`src/ComplementTol.h` (the probe Param, the error collection and the
estimate; pure functions), the probe in `src/FASTag.cpp` (phase 5, before the
null tables are built). Tests: `test/complement_tol_test.cpp`,
`test/complement_tol_cli_test.sh`, fixtures `test/fixtures/compltol_*.mgf`
(`make_compltol_fixture.py`).
