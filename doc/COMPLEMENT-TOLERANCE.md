# Run-measured complement tolerance (`-complement_tolerance_unit auto`)

Experimental, opt-in (1.13, backlog item 15). With the option off, nothing in
this file runs and every output is unchanged.

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
   `-pick_profile` as there) and tagged at the first seed length, at the
   header charge (2 when none). The probe's complement window is the whole
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
   (chance peaks). The floor's density is read from the outer third of W. The
   window is the smallest |error| t for which the errors inside [-t, t], minus
   the floor over that width, reach 95% of the signal over all of W (at
   least 0.001 Da). A systematic offset widens the window, because the
   window is centred on the complement m/z.
4. **Fallback.** When the signal is below 40 pairs, or below three standard
   deviations of its fluctuation (Poisson variance doubled for the shared
   precursor error of a tag's two ends), or not contained in the inner two
   thirds of W, nothing is measured and the run keeps `-complement_tolerance`.

The result goes to stderr, for example

    Complement tolerance (auto): measured 0.0170 Da; probe 500 MS2, 289 confident tags,
    330 pairs within 0.12 Da (signal 315, median error -0.00403 Da)

The window is printed at full precision: giving it back as
`-complement_tolerance <value> -complement_tolerance_unit Da` reproduces the
run's tags exactly (`complement_tol_cli_test`). The rest of the run is the Da
mode at that window: the tags, the `-unknown_charge infer` and
`-isotope_error` complement counts and every report use it.

## Limits

- Not with `-stream` (refused) and not with mzPeak input (refused: mzPeak is
  read in one pass); mzML and MGF only.
- The probe's errors come from the ends of confident tags, whose own m/z fit
  is good, so the measured window is somewhat narrower than the 95% bound of
  all fragment pairs (on the in-silico fixtures 0.0097 for a 0.0111 Da bound
  and 0.205 for 0.277 Da).
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

## Validation

DEV: the #2 DEV runs with the frozen #2 scorer. On PXD003531 (Q Exactive, 20 ppm) the measured windows were
0.019-0.036 Da, and the powered cells moved by -0.20 to +0.27 points. On PXD001819 (LTQ Orbitrap Velos,
ion-trap MS2, 0.5 Da) they were 0.177-0.208 Da, and the powered cells gained +2.2 to +7.6 points.

Held-out (`acceptance/1.13`, `PREREG-compltol.md`, `results/compltol/RESULT.md`): the #2 design and margins on
11 runs (astral 2, ion_trap 5, qe 1, timsTOF 3), scored once. Verdict **FAIL**:
- (i) fails on three Astral cells: L5 default 2+ at -0.503 points, and two 4+ cells whose Holm bound is below
  -1.0.
- (ii) passes: pooled length-3 gain +3.05 points on astral + ion trap, carried by the ion trap.
- (iii) timsTOF 4+ passes.
- (iv) time passes (ratio 1.027).

The ion-trap runs gained +2.1 to +5.1 points in every powered 2+ and 3+ cell. Q Exactive and timsTOF stayed
within +-0.33 points. Two high-resolution runs fell back to 0.02 Da (too few pairs). The option stays
experimental; the default stays `Da`.

## Code

`src/ComplementTol.h` (the probe Param, the error collection and the
estimate; pure functions), the probe in `src/FASTag.cpp` (phase 5, before the
null tables are built). Tests: `test/complement_tol_test.cpp`,
`test/complement_tol_cli_test.sh`, fixtures `test/fixtures/compltol_*.mgf`
(`make_compltol_fixture.py`).
