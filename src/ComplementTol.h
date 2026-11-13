// Run-measured complement tolerance (1.13 backlog item 15,
// -complement_tolerance_unit auto).
//
// The complement test asks whether a kept peak has a partner within a window
// of its complement m/z. The window FASTag 1.11 used (0.02 Da) is a constant;
// the right one depends on the run: the precursor's mass error plus two
// fragment errors. This file measures that error on the run itself.
//
// A probe tags a sample of MS2 spectra with the complement window set to the
// whole measurement window W. The complement subscore still acts, but it no
// longer depends on the configured window, so the probe does not favour tags
// whose partners happen to sit inside it (a partner anywhere within W counts
// alike, whatever its error). The probe tags at a fixed seed length
// (kAutoProbeLength) with the command line's default preprocessing and search
// settings (probeParam), so one input file gives one window whatever the
// run's -tag_length, -no_deisotope, -gaps or peak budget; only the settings
// that describe the measurement (fragment tolerance, ion series, complement
// rule, modifications) are the run's. For each spectrum
// whose rank-1 tag reaches kAutoMaxEvalue, both ends of that tag (two
// observed peaks) give one signed error each: the observed partner peak
// nearest the complement m/z, minus the complement m/z, when it lies within
// the measurement window W. Those errors are a peak near 0 (true partners)
// on a flat floor (chance peaks). The floor's density is read from the outer
// third of the window. The tolerance is |m| + kAutoZ * 1.4826 * MAD, with m
// the floor-corrected median of the signed errors and MAD the floor-corrected
// median absolute deviation from m: the two-sided 95% bound of a normal error
// distribution, read from the middle half of the signal. The middle half is
// far more stable on the 50-150 signal pairs a probe gives than the 95%
// order statistic 1.13's first version read (one or two extreme errors set
// that one); complement_tol_test bounds the spread over repeated samples.
// The window in force is never narrower than -complement_tolerance
// (inForce): the median/MAD bound assumes a normal error, and real
// complement errors on high-resolution data have heavier tails, so it reads
// them too narrow (on the Q Exactive DEV run 0.0139 Da against 0.0225 Da from
// the 95% order statistic over 263 pairs, and -0.5 points rank-1 correct in
// two 3+ cells). A window somewhat too wide costs little there (the first
// version's 0.019-0.036 Da left DEV unchanged), one too narrow loses true
// pairs. So auto widens the window where the run needs it (ion-trap MS2)
// and otherwise keeps -complement_tolerance, which is also the fallback.
//
// Pure functions of their inputs; FASTag.cpp runs the probe and applies the
// result. Nothing here runs unless -complement_tolerance_unit auto is given.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "CliParam.h"
#include "FASTagger.h"
#include "SpectrumSampler.h"

#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <limits>
#include <string>
#include <vector>

namespace FASTag::ComplTol
{
  /// Rank-1 tags at or below this E-value count as high-confidence (the probe
  /// reads only them). Fixed on DEV data (DESIGN.md), not an option.
  inline constexpr double kAutoMaxEvalue = 0.01;
  /// The tolerance is |median| + kAutoZ standard deviations (two-sided 95%
  /// of a normal error distribution); the standard deviation is
  /// kAutoMadToSd times the median absolute deviation.
  inline constexpr double kAutoZ = 1.96;
  inline constexpr double kAutoMadToSd = 1.4826;
  /// The seed length the probe tags at, whatever the run's -tag_length.
  inline constexpr int kAutoProbeLength = 3;
  /// Fewer signal pairs than this (count minus floor), or fewer than 3
  /// standard deviations of the floor's fluctuation, is no measurement: the
  /// run keeps -complement_tolerance (Da).
  inline constexpr double kAutoMinSignal = 40.0;
  /// Lower bound of a measured tolerance (Da): below it the window is
  /// narrower than the m/z precision a centroid reports.
  inline constexpr double kAutoMinTol = 0.001;
  /// The measurement window: kAutoWindowFactor times the fragment tolerance
  /// at m/z 1000, within [kAutoWindowMin, kAutoWindowMax] Da. The upper bound
  /// stays below one 13C spacing, so a partner's isotope peak never enters
  /// the floor band.
  inline constexpr double kAutoWindowFactor = 6.0;
  inline constexpr double kAutoWindowMin = 0.1;
  inline constexpr double kAutoWindowMax = 0.9;
  /// The floor band is |error| in [kAutoFloorFrom * W, W].
  inline constexpr double kAutoFloorFrom = 2.0 / 3.0;

  /**
    @brief The measurement window W (Da) for a run's fragment tolerance.

    kAutoWindowFactor times the fragment tolerance at m/z 1000, clamped to
    [kAutoWindowMin, kAutoWindowMax].

    @param[in] frag_tol the run's fragment tolerance
    @param[in] ppm true when @p frag_tol is in ppm, false for Da
    @return the window W in Da
  */
  inline double measurementWindow(double frag_tol, bool ppm)
  {
    const double at1000 = ppm ? 1000.0 * frag_tol * 1e-6 : frag_tol;
    return std::clamp(kAutoWindowFactor * at1000, kAutoWindowMin, kAutoWindowMax);
  }

  /**
    @brief The Param the probe tags with.

    @p p's measurement settings (fragment tolerance and unit, ion series,
    complement rule, modifications), the command line's default
    preprocessing and search settings (Cli::cliDefaultParam) at seed length
    kAutoProbeLength, and the complement test made neutral (Da mode, window
    @p window). So the window a file gives does not depend on the run's
    -tag_length, -no_deisotope, -gaps, -extension, peak budget, E-value cut
    or gap penalty.

    @param[in] p the run's Param (only its measurement settings are read)
    @param[in] window the measurement window W (Da), used as complement tolerance
    @return the probe's Param
  */
  inline Param probeParam(const Param& p, double window)
  {
    Param q = Cli::cliDefaultParam(/*resolve_mods=*/false);
    q.tag_length = kAutoProbeLength;
    q.frag_tol = p.frag_tol;
    q.tol_ppm = p.tol_ppm;
    q.ion_pair = p.ion_pair;
    q.complement_rule = p.complement_rule;
    q.mods = p.mods;
    q.complement_tol_mode = ComplementTolMode::DA;
    q.complement_tol = window;
    return q;
  }

  /**
    @brief The probe: a uniform sample of the candidate spectra.

    @p want of the @p candidates, drawn uniformly without replacement with
    @p seed, returned ascending. All of them when there are at most @p want.
    Uniform over the run, not the first @p want in file order.

    @param[in] candidates spectrum indices, ascending
    @param[in] want the sample size
    @param[in] seed the random seed (sampleByCount)
    @return the sampled indices, ascending
  */
  inline std::vector<std::size_t> pickProbe(const std::vector<std::size_t>& candidates, std::size_t want,
                                            std::uint32_t seed)
  {
    if (candidates.size() <= want) return candidates;
    const SampleMask m = sampleByCount(candidates.size(), want, seed);
    std::vector<std::size_t> out;
    out.reserve(want);
    for (std::size_t i = 0; i < candidates.size(); ++i)
      if (m[i]) out.push_back(candidates[i]);
    return out;
  }

  /**
    @brief Append the signed complement errors of one spectrum's rank-1 tag.

    For each end of the tag (low_mz, high_mz at the tag's fragment charge),
    the nearest other peak to each complement m/z the rules give; the one
    closest over the rules is kept when within @p window. Nothing is
    appended for an empty spectrum or a precursor m/z that is not finite and
    positive.

    @param[in] prepared the spectrum as tagSpectrum prepared it (the tag's
               peaks are among its peaks; m/z sorted)
    @param[in] precursor_mz precursor m/z as tagged
    @param[in] charge precursor charge as tagged; <= 0 is 2, as tagSpectrum
    @param[in] tag the rank-1 tag
    @param[in] cs the rule(s), the ion-pair deltas and the charge loss of the run
    @param[in] window the measurement window W (Da)
    @param[in,out] out signed errors (Da); new ones are appended
    @return the number of errors appended (0, 1 or 2)
  */
  inline std::size_t collectErrors(const OpenMS::MSSpectrum& prepared, double precursor_mz, int charge,
                                   const Tag& tag, const ComplementSpec& cs, double window,
                                   std::vector<double>& out)
  {
    if (prepared.empty() || !(precursor_mz > 0) || !std::isfinite(precursor_mz)) return 0;
    if (charge <= 0) charge = 2;
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const double M0 = precursor_mz * charge - charge * P;  // tagSpectrum's precursor_mass
    const int z = tag.charge;
    const bool same_rule = cs.rule != ComplementRule::PRECURSOR;
    const bool prec_rule = cs.rule != ComplementRule::SAME_CHARGE;
    // The nearest peak to target, as prepare()'s complement test takes it
    // (PeakGrid::nearest): when that peak is the end itself, the end has no
    // partner under this rule (infinity), as there.
    const auto nearestOther = [&prepared](double target, double self) {
      const auto it = std::lower_bound(prepared.begin(), prepared.end(), target,
                                       [](const OpenMS::Peak1D& a, double v) { return a.getMZ() < v; });
      double best = std::numeric_limits<double>::infinity();
      double at = 0;
      if (it != prepared.end()) { best = it->getMZ() - target; at = it->getMZ(); }
      if (it != prepared.begin())
      {
        const double d = std::prev(it)->getMZ() - target;
        if (std::fabs(d) < std::fabs(best)) { best = d; at = std::prev(it)->getMZ(); }
      }
      if (at == self) return std::numeric_limits<double>::infinity();
      return best;
    };
    std::size_t added = 0;
    for (const double mz : {tag.low_mz, tag.high_mz})
    {
      if (added == 1 && tag.high_mz == tag.low_mz) break;
      double best = std::numeric_limits<double>::infinity();
      for (const double d : cs.pair_deltas)
      {
        const double M = d == 0.0 ? M0 : M0 + d;
        for (int r = 0; r < 2; ++r)
        {
          if (r == 0 ? !same_rule : !prec_rule) continue;
          const double cmz = complementMz(M, charge - cs.charge_loss, z, mz,
                                          r == 0 ? ComplementRule::SAME_CHARGE : ComplementRule::PRECURSOR);
          if (std::isnan(cmz)) continue;
          const double e = nearestOther(cmz, mz);
          if (std::fabs(e) < std::fabs(best)) best = e;
        }
      }
      if (std::fabs(best) <= window)
      {
        out.push_back(best);
        ++added;
      }
    }
    return added;
  }

  /**
    @brief The measurement of one run.
  */
  struct Estimate
  {
    bool ok = false;           ///< a tolerance was measured
    double tol = std::numeric_limits<double>::quiet_NaN();  ///< Da, when ok
    double window = 0;         ///< W, Da
    std::size_t n = 0;         ///< errors within W
    double floor_per_da = 0;   ///< chance errors per Da (both signs together)
    double signal = 0;         ///< n minus the floor over [-W, W]
    double median = 0;         ///< floor-corrected median signed error (systematic offset), when measured
    double mad = 0;            ///< floor-corrected median absolute deviation from median, when measured
    std::string why;           ///< when not ok: why not
  };

  /**
    @brief The window in force under auto.

    The measured tolerance, but never below @p fallback; @p fallback when
    nothing was measured.

    @param[in] e the run's measurement
    @param[in] fallback -complement_tolerance (Da)
    @return the complement window in force (Da)
  */
  inline double inForce(const Estimate& e, double fallback)
  {
    return e.ok ? std::max(e.tol, fallback) : fallback;
  }

  /**
    @brief The tolerance from signed complement errors.

    The tolerance is |m| + kAutoZ * kAutoMadToSd * MAD, with m the
    floor-corrected median and MAD the floor-corrected median absolute
    deviation; at least kAutoMinTol. No measurement (Estimate::ok false,
    Estimate::why set) when the signal above the chance floor is too small,
    or median or spread cannot be read inside the window, or the tolerance
    is not below kAutoFloorFrom * W.

    @param[in] errors signed errors (Da), any order; non-finite values and
               values beyond @p window are ignored
    @param[in] window the measurement window W (Da)
    @param[in] min_signal the minimum signal (pairs above the floor)
    @return the measurement
  */
  inline Estimate estimate(std::vector<double> errors, double window, double min_signal = kAutoMinSignal)
  {
    Estimate e;
    e.window = window;
    std::vector<double> kept;
    kept.reserve(errors.size());
    for (const double x : errors)
      if (std::isfinite(x) && std::fabs(x) <= window) kept.push_back(x);
    e.n = kept.size();
    std::sort(kept.begin(), kept.end());
    const double from = kAutoFloorFrom * window;
    std::size_t n_floor = 0;
    for (const double x : kept)
      if (std::fabs(x) >= from) ++n_floor;
    // The band |x| in [from, W] spans 2 (W - from) Da over both signs.
    e.floor_per_da = n_floor / (2.0 * (window - from));
    e.signal = static_cast<double>(e.n) - e.floor_per_da * 2.0 * window;
    // The signal is n_inner - (f - 1) n_floor with f = W / (W - from); its
    // Poisson variance n_inner + (f - 1)^2 n_floor. A floor alone fluctuates
    // by that much, so the signal must clear 3 of its standard deviations as
    // well as min_signal.
    const double f1 = window / (window - from) - 1.0;
    const double n_inner = static_cast<double>(e.n - n_floor);
    // Both ends of a tag share the precursor's error, so the two errors of a
    // spectrum are not independent: the variance is doubled (two perfectly
    // paired counts), which keeps the gate conservative.
    const double need =
        std::max(min_signal, 3.0 * std::sqrt(2.0 * (n_inner + f1 * f1 * static_cast<double>(n_floor))));
    if (!(e.signal >= need))
    {
      e.why = "too few complement pairs above the chance floor (signal " + std::to_string(static_cast<long>(std::lround(e.signal)))
            + ", needs " + std::to_string(static_cast<long>(std::ceil(need))) + ")";
      return e;
    }
    const double half = 0.5 * e.signal;
    // Floor-corrected median m: the smallest error x with
    // count(errors <= x) - floor over [-W, x] >= half the signal.
    double m = std::numeric_limits<double>::quiet_NaN();
    for (std::size_t i = 0; i < kept.size(); ++i)
      if (static_cast<double>(i + 1) - e.floor_per_da * (kept[i] + window) >= half)
      {
        m = kept[i];
        break;
      }
    if (!std::isfinite(m))
    {
      e.why = "the complement errors have no floor-corrected median inside the measurement window";
      return e;
    }
    // Floor-corrected MAD: the smallest d with count(|error - m| <= d) -
    // floor over [m - d, m + d] (within [-W, W]) >= half the signal.
    std::vector<double> dev;
    dev.reserve(kept.size());
    for (const double x : kept) dev.push_back(std::fabs(x - m));
    std::sort(dev.begin(), dev.end());
    double mad = std::numeric_limits<double>::quiet_NaN();
    for (std::size_t j = 0; j < dev.size(); ++j)
    {
      const double d = dev[j];
      const double len = std::min(m + d, window) - std::max(m - d, -window);
      if (static_cast<double>(j + 1) - e.floor_per_da * len >= half)
      {
        mad = d;
        break;
      }
    }
    if (!std::isfinite(mad))
    {
      e.why = "the complement errors have no floor-corrected spread inside the measurement window";
      return e;
    }
    e.median = m;
    e.mad = mad;
    const double t = std::fabs(m) + kAutoZ * kAutoMadToSd * mad;
    if (!(t < from))
    {
      e.why = "the complement errors are not contained well inside the measurement window";
      return e;
    }
    e.ok = true;
    e.tol = std::max(t, kAutoMinTol);
    return e;
  }
}
