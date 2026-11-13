// Run-measured complement tolerance (1.13 item 15, src/ComplementTol.h).
//   (a) measurementWindow: 6x the fragment tolerance at m/z 1000, in [0.1, 0.9] Da.
//   (b) probeParam: Da mode at the window, seed length 3 and the CLI's
//       default preprocessing and search settings, the run's measurement
//       settings; two runs that differ only in -tag_length, -no_deisotope,
//       -gaps, peak budget or E-value cut probe with the same Param.
//   (c) collectErrors on a synthetic spectrum whose fragments all sit +s Da
//       off: every rank-1 tag end that has its partner reports +2s (the pair
//       sum moves by 2s); with no partner peak nothing is reported; a partner
//       beyond the window is not reported; the precursor rule reads 3+ pairs
//       that same_charge does not.
//   (d) estimate: Gaussian errors (sd sigma) on a flat floor give a window
//       near the 95% two-sided bound |offset| + 1.96 sigma, wider for a wider error,
//       and independent of the floor's density; too few pairs, or a floor
//       alone, give no measurement; values beyond the window are ignored;
//       the 0.001 Da lower bound holds.
//   (c2) a tag end at its own complement m/z has no partner, as in prepare().
//   (g) inForce: the measured window, never below -complement_tolerance;
//       the fallback when nothing was measured.
//   (e) pickProbe: a uniform, ascending, deterministic draw over the run.
//   (f) stability at the sample sizes a probe gives (50-150 signal pairs on
//       a floor): over 200 independent samples the estimate's 95th/5th
//       percentile ratio stays below 2 and its coefficient of variation
//       below 0.25, centred on the true bound. 1.13's first estimator (the
//       95% order statistic of |error|) gives ratios of 3.1-7.8 and
//       coefficients of variation of 0.43-0.92 on the same samples; the
//       reference implementation here reproduces that, so the bound can fail.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "CliParam.h"
#include "ComplementTol.h"
#include "FASTagger.h"
#include "complement_synth.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using namespace OpenMS;
namespace CT = FASTag::ComplTol;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  /// Gaussian (Box-Muller from raw mt19937 output, platform-stable) errors
  /// plus a uniform floor over [-w, w].
  std::vector<double> synth(std::size_t n_sig, double sigma, std::size_t n_floor, double w, unsigned seed)
  {
    std::mt19937 rng(seed);
    const auto u = [&rng]() { return (static_cast<double>(rng() >> 8) + 0.5) * (1.0 / 16777216.0); };
    std::vector<double> e;
    for (std::size_t i = 0; i < n_sig; ++i)
    {
      const double a = u();
      const double b = u();
      e.push_back(sigma * std::sqrt(-2.0 * std::log(a)) * std::cos(6.283185307179586 * b));
    }
    for (std::size_t i = 0; i < n_floor; ++i)
    {
      const double a = u();
      e.push_back(-w + 2.0 * w * a);
    }
    return e;
  }

  /// Rank-1 tag of @p s at @p p (complement test neutral at @p w), its errors.
  std::vector<double> errorsOf(const ComplementSynth::Spec& s, int charge, FASTag::Param p, double w)
  {
    // The complement test made neutral as probeParam makes it, keeping the
    // test's own preprocessing (probeParam's defaults are checked in (b)).
    p.complement_tol_mode = FASTag::ComplementTolMode::DA;
    p.complement_tol = w;
    const FASTag::Tables tab(p);
    const std::vector<FASTag::Tag> tg = FASTag::tagSpectrum(s.spec, s.prec_mz, charge, p, tab);
    std::vector<double> e;
    if (tg.empty()) return e;
    const MSSpectrum prep = FASTag::preparedPeaks(s.spec, s.prec_mz, charge, p);
    CT::collectErrors(prep, s.prec_mz, charge, tg.front(), FASTag::ComplementSpec::fromParam(p), w, e);
    return e;
  }
}

int main()
{
  // (a)
  CHECK(std::fabs(CT::measurementWindow(20, true) - 0.12) < 1e-12, "20 ppm: W %.6g", CT::measurementWindow(20, true));
  CHECK(CT::measurementWindow(5, true) == 0.1, "5 ppm: lower bound");
  CHECK(CT::measurementWindow(0.5, false) == 0.9, "0.5 Da: upper bound below one 13C spacing");
  CHECK(std::fabs(CT::measurementWindow(0.05, false) - 0.3) < 1e-12, "0.05 Da: 6x");

  // (b)
  {
    FASTag::Param p = FASTag::cliDefaultParam();
    p.complement_tol_mode = FASTag::ComplementTolMode::FRAGMENT;
    p.frag_tol = 0.5;
    p.tol_ppm = false;
    p.complement_rule = FASTag::ComplementRule::BOTH;
    p.ion_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
    p.tag_length = 5;
    p.deisotope = false;
    p.max_gaps = 0;
    p.max_extension = 2;
    p.peaks_per_window = 0;
    p.max_peak_count = 150;
    p.max_evalue = 1;
    p.gap_penalty = 10;
    p.diversity = true;
    const FASTag::Param q = CT::probeParam(p, 0.12);
    const FASTag::Param d = FASTag::cliDefaultParam();
    CHECK(q.complement_tol_mode == FASTag::ComplementTolMode::DA && q.complement_tol == 0.12, "probe window");
    CHECK(q.frag_tol == 0.5 && !q.tol_ppm && q.complement_rule == FASTag::ComplementRule::BOTH
            && q.ion_pair.kind == FASTag::IonSeries::Series::CZ && q.mods.size() == p.mods.size(),
          "probeParam dropped a measurement setting of the run");
    CHECK(q.tag_length == CT::AUTO_PROBE_LENGTH && CT::AUTO_PROBE_LENGTH == 3, "probe seed length %d", q.tag_length);
    CHECK(q.deisotope == d.deisotope && q.max_gaps == d.max_gaps && q.max_extension == d.max_extension
            && q.peaks_per_window == d.peaks_per_window && q.max_peak_count == d.max_peak_count
            && q.max_evalue == d.max_evalue && q.gap_penalty == d.gap_penalty && q.diversity == d.diversity
            && q.max_tag_count == d.max_tag_count,
          "probeParam kept a search or preprocessing setting of the run");
    // A run at the defaults with the same measurement settings probes alike.
    FASTag::Param r = FASTag::cliDefaultParam();
    r.frag_tol = 0.5;
    r.tol_ppm = false;
    r.complement_rule = FASTag::ComplementRule::BOTH;
    r.ion_pair = p.ion_pair;
    const FASTag::Param qr = CT::probeParam(r, 0.12);
    CHECK(qr.tag_length == q.tag_length && qr.deisotope == q.deisotope && qr.max_gaps == q.max_gaps
            && qr.peaks_per_window == q.peaks_per_window && qr.max_peak_count == q.max_peak_count
            && qr.max_evalue == q.max_evalue && qr.complement_tol == q.complement_tol,
          "two runs differing only in search settings probe differently");
  }

  // (c) fragments shifted by +s: pair errors +2s.
  {
    FASTag::Param p = FASTag::cliDefaultParam();
    p.deisotope = false;
    p.frag_tol = 0.02;
    p.tol_ppm = false;
    for (const double s : {0.004, -0.01, 0.025})
    {
      const ComplementSynth::Spec sp = ComplementSynth::make("VGAHAGEYGAEALER", 2, false, 0, s, 10, 21);
      const std::vector<double> e = errorsOf(sp, 2, p, 0.12);
      CHECK(!e.empty(), "shift %.3g: no errors collected", s);
      for (const double x : e)
        CHECK(std::fabs(x - 2 * s) < 1e-6, "shift %.3g: error %.9g, want %.9g", s, x, 2 * s);
    }
    // Beyond the window: shift 0.08 gives errors of 0.16 > W = 0.12.
    {
      const ComplementSynth::Spec sp = ComplementSynth::make("VGAHAGEYGAEALER", 2, false, 0, 0.08, 0, 21);
      const std::vector<double> e = errorsOf(sp, 2, p, 0.12);
      CHECK(e.empty(), "a partner 0.16 Da off was reported within a 0.12 Da window (%zu errors)", e.size());
    }
    // No partner peaks: only the y ions of the peptide.
    {
      ComplementSynth::Spec sp = ComplementSynth::make("VGAHAGEYGAEALER", 2, false, 0, 0.0, 0, 21);
      const AASequence aa = AASequence::fromString("VGAHAGEYGAEALER");
      MSSpectrum y;
      for (size_t i = 1; i < aa.size(); ++i)
        y.emplace_back(aa.getSuffix(aa.size() - i).getMonoWeight(Residue::YIon, 1), 1.0);
      y.sortByPosition();
      sp.spec = y;
      const std::vector<double> e = errorsOf(sp, 2, p, 0.12);
      CHECK(e.empty(), "a spectrum without b ions gave %zu complement errors", e.size());
    }
    // 3+ precursor, y at 2+ and b at 1+: same_charge pairs a 1+ end with a
    // 1+ partner (absent at its exact place), the precursor rule with the 2+.
    {
      const ComplementSynth::Spec sp = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, true, 0, 0.0, 0, 12);
      FASTag::Param pr = p;
      pr.complement_rule = FASTag::ComplementRule::PRECURSOR;
      const std::vector<double> e_prec = errorsOf(sp, 3, pr, 0.12);
      std::size_t exact = 0;
      for (const double x : e_prec) exact += std::fabs(x) < 1e-6;
      CHECK(exact >= 1, "precursor rule: %zu exact errors of %zu", exact, e_prec.size());
    }
  }

  // (c2) a tag end at the complement midpoint: prepare()'s test takes the
  // nearest peak and drops it when it is the end itself, so the end has no
  // partner; the probe must not report the next peak instead.
  {
    const double P = Constants::PROTON_MASS_U;
    MSSpectrum prep;
    for (const double mz : {500.0, 500.01, 557.02146372, 628.05857751, 715.09060592}) prep.emplace_back(mz, 1.0);
    FASTag::Tag t;
    t.charge = 1;
    t.low_mz = 500.0;
    t.high_mz = 715.09060592;
    const double prec_mz = 500.0;  // charge 2: M = 1000 - 2p, so 500's complement is 500
    std::vector<double> e;
    CT::collectErrors(prep, prec_mz, 2, t, FASTag::ComplementSpec::fromParam(FASTag::cliDefaultParam()), 0.12, e);
    CHECK(e.empty(), "midpoint end reported %zu errors (first %.6g); prepare() gives it no partner",
          e.size(), e.empty() ? 0.0 : e[0]);
    (void)P;
  }

  // (e) the probe draw: uniform over the run, ascending, deterministic.
  {
    std::vector<std::size_t> c;
    for (std::size_t i = 0; i < 10000; ++i) c.push_back(3 * i);
    const std::vector<std::size_t> a = CT::pickProbe(c, 500, 7);
    const std::vector<std::size_t> b = CT::pickProbe(c, 500, 7);
    CHECK(a.size() == 500 && a == b, "probe draw: %zu, deterministic %d", a.size(), int(a == b));
    CHECK(std::is_sorted(a.begin(), a.end()), "probe draw not ascending");
    CHECK(!a.empty() && a.front() < 3 * 1000 && a.back() > 3 * 9000,
          "probe draw does not span the run: %zu..%zu", a.empty() ? 0 : a.front(), a.empty() ? 0 : a.back());
    std::size_t second_half = 0;
    for (const std::size_t x : a) second_half += x >= 3 * 5000;
    CHECK(second_half > 200 && second_half < 300, "probe draw: %zu of 500 in the second half", second_half);
    const std::vector<std::size_t> few(c.begin(), c.begin() + 40);
    CHECK(CT::pickProbe(few, 500, 7) == few, "fewer candidates than the probe size: not all kept");
  }

  // (d)
  {
    const double w = 0.12;
    for (const double sigma : {0.003, 0.008})
    {
      const CT::Estimate e = CT::estimate(synth(2000, sigma, 600, w, 7), w);
      CHECK(e.ok, "sigma %.3g: not measured (%s)", sigma, e.why.c_str());
      CHECK(e.tol > 1.7 * sigma && e.tol < 2.3 * sigma, "sigma %.3g: tol %.6g, want ~1.96 sigma", sigma, e.tol);
      CHECK(std::fabs(e.signal - 2000) < 150, "sigma %.3g: signal %.1f, want ~2000", sigma, e.signal);
      CHECK(e.floor_per_da > 600 / (2 * w) * 0.7 && e.floor_per_da < 600 / (2 * w) * 1.3,
            "sigma %.3g: floor %.1f per Da", sigma, e.floor_per_da);
    }
    const CT::Estimate narrow = CT::estimate(synth(2000, 0.003, 600, w, 8), w);
    const CT::Estimate wide = CT::estimate(synth(2000, 0.008, 600, w, 8), w);
    CHECK(narrow.ok && wide.ok && wide.tol > 2 * narrow.tol, "wider errors: %.6g vs %.6g", wide.tol, narrow.tol);
    // The floor's density does not move the window much.
    const CT::Estimate sparse = CT::estimate(synth(2000, 0.005, 100, w, 9), w);
    const CT::Estimate dense = CT::estimate(synth(2000, 0.005, 3000, w, 9), w);
    CHECK(sparse.ok && dense.ok && std::fabs(sparse.tol - dense.tol) < 0.25 * sparse.tol,
          "floor density moved the window: %.6g (100) vs %.6g (3000)", sparse.tol, dense.tol);
    // Without a floor correction a dense floor would widen the window a lot:
    // at coverage 0.95 of n (not of the signal) the window reaches far out.
    CHECK(dense.tol < 0.02, "dense floor: window %.6g", dense.tol);
    // A systematic offset: errors centred on +0.01 need a window past it.
    {
      std::vector<double> off = synth(2000, 0.003, 300, w, 10);
      for (std::size_t i = 0; i < 2000; ++i) off[i] += 0.01;
      const CT::Estimate e = CT::estimate(off, w);
      CHECK(e.ok && e.tol > 0.013 && e.tol < 0.02, "offset 0.01: tol %.6g", e.tol);
      CHECK(std::fabs(e.median - 0.01) < 0.003, "offset 0.01: median %.6g", e.median);
    }
    // Too few pairs, a floor alone: no measurement.
    CHECK(!CT::estimate(synth(20, 0.003, 30, w, 11), w).ok, "20 pairs measured a window");
    CHECK(!CT::estimate(synth(0, 0.003, 3000, w, 12), w).ok, "a floor alone measured a window");
    CHECK(!CT::estimate({}, w).ok, "no errors measured a window");
    // Values beyond the window are ignored.
    {
      std::vector<double> e = synth(2000, 0.003, 600, w, 13);
      const CT::Estimate a = CT::estimate(e, w);
      for (int i = 0; i < 5000; ++i) e.push_back(0.5 + 1e-4 * i);
      const CT::Estimate b = CT::estimate(e, w);
      CHECK(a.ok && b.ok && a.tol == b.tol && a.n == b.n, "values beyond W changed the estimate");
    }
    // Lower bound.
    {
      std::vector<double> e(500, 0.0);
      const CT::Estimate a = CT::estimate(e, w);
      CHECK(a.ok && a.tol == CT::AUTO_MIN_TOL, "exact pairs: tol %.6g, want the 0.001 bound", a.tol);
    }
  }

  // (g)
  {
    CT::Estimate e;
    e.ok = true;
    e.tol = 0.2;
    CHECK(CT::inForce(e, 0.02) == 0.2, "wider measured window not in force");
    e.tol = 0.0139;
    CHECK(CT::inForce(e, 0.02) == 0.02, "narrower measured window not raised to the lower bound");
    CHECK(CT::inForce(e, 0.005) == 0.0139, "measured window above a lower bound 0.005 not in force");
    e.ok = false;
    CHECK(CT::inForce(e, 0.05) == 0.05, "fallback not -complement_tolerance");
  }

  // (f) stability on realistic probe sizes.
  {
    const double w = 0.12;
    // 1.13's first estimator, kept here only as the reference the bound
    // must separate from: the smallest |error| t whose floor-corrected
    // count reaches 95% of the signal.
    const auto order95 = [w](std::vector<double> e) {
      const double from = CT::AUTO_FLOOR_FROM * w;
      std::vector<double> a;
      for (const double x : e)
        if (std::fabs(x) <= w) a.push_back(std::fabs(x));
      std::size_t nf = 0;
      for (const double x : a) nf += x >= from;
      const double f = nf / (2.0 * (w - from));
      const double sig = a.size() - f * 2.0 * w;
      std::sort(a.begin(), a.end());
      for (std::size_t i = 0; i < a.size() && a[i] < from; ++i)
        if (static_cast<double>(i + 1) - f * 2.0 * a[i] >= 0.95 * sig) return std::max(a[i], CT::AUTO_MIN_TOL);
      return std::numeric_limits<double>::quiet_NaN();
    };
    struct Case { std::size_t n_sig, n_floor; double sigma, offset; };
    for (const Case c : {Case{50, 15, 0.008, -0.006}, Case{65, 15, 0.005, 0.0}, Case{100, 20, 0.008, -0.006},
                         Case{150, 30, 0.005, 0.0}})
    {
      std::vector<double> got, ref;
      for (unsigned seed = 1; seed <= 200; ++seed)
      {
        std::vector<double> e = synth(c.n_sig, c.sigma, c.n_floor, w, 1000 + seed);
        for (std::size_t i = 0; i < c.n_sig; ++i) e[i] += c.offset;
        const CT::Estimate est = CT::estimate(e, w);
        if (est.ok) got.push_back(est.tol);
        const double o = order95(e);
        if (std::isfinite(o)) ref.push_back(o);
      }
      const auto spread = [](std::vector<double> v, double& ratio, double& cv, double& mean) {
        std::sort(v.begin(), v.end());
        const double p5 = v[static_cast<std::size_t>(0.05 * (v.size() - 1))];
        const double p95 = v[static_cast<std::size_t>(0.95 * (v.size() - 1))];
        ratio = p95 / p5;
        mean = 0;
        for (const double x : v) mean += x;
        mean /= v.size();
        double ss = 0;
        for (const double x : v) ss += (x - mean) * (x - mean);
        cv = std::sqrt(ss / (v.size() - 1)) / mean;
      };
      const double truth = std::fabs(c.offset) + 1.96 * c.sigma;
      CHECK(got.size() >= 190, "n_sig %zu: only %zu of 200 samples measured", c.n_sig, got.size());
      double ratio = 0, cv = 0, mean = 0;
      if (got.size() >= 10) spread(got, ratio, cv, mean);
      std::printf("stability n_sig %zu sigma %.3g offset %.3g: p95/p5 %.2f cv %.3f mean %.5g (true %.5g)\n",
                  c.n_sig, c.sigma, c.offset, ratio, cv, mean, truth);
      CHECK(ratio > 0 && ratio < 2.0, "n_sig %zu: p95/p5 %.2f, want < 2", c.n_sig, ratio);
      CHECK(cv > 0 && cv < 0.25, "n_sig %zu: coefficient of variation %.3f, want < 0.25", c.n_sig, cv);
      CHECK(std::fabs(mean - truth) < 0.15 * truth, "n_sig %zu: mean %.5g, true bound %.5g", c.n_sig, mean, truth);
      double rr = 0, rcv = 0, rmean = 0;
      if (ref.size() >= 10) spread(ref, rr, rcv, rmean);
      std::printf("  order statistic (1.13 first version): p95/p5 %.2f cv %.3f\n", rr, rcv);
      CHECK(rr >= 2.0 || rcv >= 0.25, "n_sig %zu: the reference order statistic is within the bound too "
            "(p95/p5 %.2f, cv %.3f), so the bound cannot tell the estimators apart", c.n_sig, rr, rcv);
    }
  }

  if (failures) std::printf("%d failure(s)\n", failures);
  else std::printf("complement_tol_test: all checks passed\n");
  return failures ? 1 : 0;
}
