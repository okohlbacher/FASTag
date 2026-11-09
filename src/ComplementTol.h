// Run-measured complement tolerance (1.13 backlog item 15,
// -complement_tolerance_unit auto).
//
// The complement test asks whether a kept peak has a partner within a window
// of its complement m/z. The window FASTag 1.11 used (0.02 Da) is a constant;
// the right one depends on the run: the precursor's mass error plus two
// fragment errors. This file measures that error on the run itself.
//
// A probe tags a sample of MS2 spectra with the complement test made neutral
// (a window as wide as the measurement window, so every tag is scored as if
// its peaks had partners or not alike, which does not favour tags whose
// partners happen to sit inside the configured window). For each spectrum
// whose rank-1 tag reaches kAutoMaxEvalue, both ends of that tag (two
// observed peaks) give one signed error each: the observed partner peak
// nearest the complement m/z, minus the complement m/z, when it lies within
// the measurement window W. Those errors are a peak near 0 (true partners)
// on a flat floor (chance peaks). The floor's density is read from the outer
// third of the window, and the tolerance is the smallest |error| t at which
// the signal inside [-t, t] (count minus floor) reaches kAutoCoverage of the
// whole window's signal.
//
// Pure functions of their inputs; FASTag.cpp runs the probe and applies the
// result. Nothing here runs unless -complement_tolerance_unit auto is given.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "FASTagger.h"

#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <string>
#include <vector>

namespace FASTag::ComplTol
{
  /// Rank-1 tags at or below this E-value count as high-confidence (the probe
  /// reads only them). Fixed on DEV data (DESIGN.md), not an option.
  inline constexpr double kAutoMaxEvalue = 0.01;
  /// Share of the measured signal the tolerance covers.
  inline constexpr double kAutoCoverage = 0.95;
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

  /// The measurement window W (Da) for a run's fragment tolerance.
  inline double measurementWindow(double frag_tol, bool ppm)
  {
    const double at1000 = ppm ? 1000.0 * frag_tol * 1e-6 : frag_tol;
    return std::clamp(kAutoWindowFactor * at1000, kAutoWindowMin, kAutoWindowMax);
  }

  /// The Param the probe tags with: @p p with the complement test made
  /// neutral (Da mode, window @p window).
  inline Param probeParam(Param p, double window)
  {
    p.complement_tol_mode = ComplementTolMode::Da;
    p.complement_tol = window;
    return p;
  }

  /// Signed complement errors of one spectrum's rank-1 tag, appended to
  /// @p out. @p prepared is the spectrum as tagSpectrum prepared it (the
  /// tag's peaks are among its peaks; m/z sorted), @p precursor_mz and
  /// @p charge as tagged (charge <= 0 is 2, as tagSpectrum). @p cs gives the
  /// rule(s), the ion-pair deltas and the charge loss of the run. For each
  /// end of the tag (low_mz, high_mz at the tag's fragment charge), the
  /// nearest other peak to each complement m/z the rules give; the one
  /// closest over the rules is kept when within @p window. Returns the number
  /// of errors appended (0, 1 or 2).
  inline std::size_t collectErrors(const OpenMS::MSSpectrum& prepared, double precursor_mz, int charge,
                                   const Tag& tag, const ComplementSpec& cs, double window,
                                   std::vector<double>& out)
  {
    if (prepared.empty() || !(precursor_mz > 0) || !std::isfinite(precursor_mz)) return 0;
    if (charge <= 0) charge = 2;
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const double M0 = precursor_mz * charge - charge * P;  // tagSpectrum's precursor_mass
    const int z = tag.charge;
    const bool same_rule = cs.rule != ComplementRule::Precursor;
    const bool prec_rule = cs.rule != ComplementRule::SameCharge;
    const auto nearestOther = [&prepared](double target, double self) {
      // The peak nearest target, skipping the end itself.
      const auto it = std::lower_bound(prepared.begin(), prepared.end(), target,
                                       [](const OpenMS::Peak1D& a, double v) { return a.getMZ() < v; });
      double best = std::numeric_limits<double>::infinity();
      for (auto j = it; j != prepared.end(); ++j)
      {
        if (j->getMZ() == self) continue;
        best = j->getMZ() - target;
        break;
      }
      for (auto j = it; j != prepared.begin();)
      {
        --j;
        if (j->getMZ() == self) continue;
        const double d = j->getMZ() - target;
        if (std::fabs(d) < std::fabs(best)) best = d;
        break;
      }
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
                                          r == 0 ? ComplementRule::SameCharge : ComplementRule::Precursor);
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

  /// The measurement of one run.
  struct Estimate
  {
    bool ok = false;           ///< a tolerance was measured
    double tol = std::numeric_limits<double>::quiet_NaN();  ///< Da, when ok
    double window = 0;         ///< W, Da
    std::size_t n = 0;         ///< errors within W
    double floor_per_da = 0;   ///< chance errors per Da (both signs together)
    double signal = 0;         ///< n minus the floor over [-W, W]
    double median = 0;         ///< median signed error within W (systematic offset)
    std::string why;           ///< when not ok: why not
  };

  /// The tolerance from signed errors (any order; values beyond W ignored).
  inline Estimate estimate(std::vector<double> errors, double window, double coverage = kAutoCoverage,
                           double min_signal = kAutoMinSignal)
  {
    Estimate e;
    e.window = window;
    std::vector<double> a;
    a.reserve(errors.size());
    std::vector<double> kept;
    kept.reserve(errors.size());
    for (const double x : errors)
      if (std::isfinite(x) && std::fabs(x) <= window)
      {
        a.push_back(std::fabs(x));
        kept.push_back(x);
      }
    e.n = a.size();
    if (!kept.empty())
    {
      std::sort(kept.begin(), kept.end());
      const std::size_t h = kept.size() / 2;
      e.median = kept.size() % 2 ? kept[h] : 0.5 * (kept[h - 1] + kept[h]);
    }
    const double from = kAutoFloorFrom * window;
    std::size_t n_floor = 0;
    for (const double x : a)
      if (x >= from) ++n_floor;
    // The band |x| in [from, W] spans 2 (W - from) Da over both signs.
    e.floor_per_da = n_floor / (2.0 * (window - from));
    e.signal = static_cast<double>(e.n) - e.floor_per_da * 2.0 * window;
    // The signal is n_inner - (f - 1) n_floor with f = W / (W - from); its
    // Poisson variance n_inner + (f - 1)^2 n_floor. A floor alone fluctuates
    // by that much, so the signal must clear 3 of its standard deviations as
    // well as min_signal.
    const double f1 = window / (window - from) - 1.0;
    const double n_inner = static_cast<double>(e.n - n_floor);
    const double need = std::max(min_signal, 3.0 * std::sqrt(n_inner + f1 * f1 * static_cast<double>(n_floor)));
    if (!(e.signal >= need))
    {
      e.why = "too few complement pairs above the chance floor (signal " + std::to_string(static_cast<long>(std::lround(e.signal)))
            + ", needs " + std::to_string(static_cast<long>(std::ceil(need))) + ")";
      return e;
    }
    std::sort(a.begin(), a.end());
    const double want = coverage * e.signal;
    for (std::size_t i = 0; i < a.size(); ++i)
    {
      const double t = a[i];
      if (t >= from) break;
      const double s = static_cast<double>(i + 1) - e.floor_per_da * 2.0 * t;
      if (s >= want)
      {
        e.ok = true;
        e.tol = std::max(t, kAutoMinTol);
        return e;
      }
    }
    e.why = "the complement errors are not contained well inside the measurement window";
    return e;
  }
}
