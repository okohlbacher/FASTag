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

1. **Probe.** Up to `-complement_probe` MS2 spectra (default 500), drawn
   uniformly over the run with a fixed seed and read as the tagging pass reads
   them (centroided under `-pick_profile` as there), are tagged at the first
   seed length. The complement test is made neutral for the probe: its window
   is the whole measurement window W, so tags are not selected for having
   partners inside the configured window.
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
   deviations of the floor's fluctuation, or not contained in the inner two
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
- Cost: one extra tagging pass over the probe (500 spectra; about 0.35 s at
  one thread on a Q Exactive run, ~2% of a 27,000-MS2 run).
- One window per run. Runs whose calibration drifts over the gradient get
  one compromise window.

## Validation

DEV (PXD003531 Q Exactive at 20 ppm; PXD001819 LTQ Orbitrap Velos ion-trap
MS2 at 0.5 Da; the #2 DEV runs and the frozen #2 scorer) and the held-out
test are recorded in the `acceptance/1.13` branch (`PREREG-compltol.md`). The
option stays experimental until the held-out test passes.

## Code

`src/ComplementTol.h` (the probe Param, the error collection and the
estimate; pure functions), the probe in `src/FASTag.cpp` (phase 5, before the
null tables are built). Tests: `test/complement_tol_test.cpp`,
`test/complement_tol_cli_test.sh`, fixtures `test/fixtures/compltol_*.mgf`
(`make_compltol_fixture.py`).
