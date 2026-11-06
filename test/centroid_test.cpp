// Profile-MS2 centroiding (FASTag 1.12 #9, src/Centroid.h): what
// centroidProfileMs2 does to one spectrum, and which spectra each
// -pick_profile mode hands to it on each reader.
//
//  (a) Gaussian peaks (FWHM 0.01 Th, 200-1500 m/z) are picked within 1 ppm,
//      one centroid per peak, with the spectrum's metadata kept;
//  (b) a CENTROID spectrum is left alone, byte for byte;
//  (c) data too sparse to pick returns -1 and keeps the profile points;
//  (d) 8 threads, each with its own picker, give the serial result;
//  (e) low-resolution Gaussians (FWHM 0.3 Th): either >= 90% of the
//      resolvable peaks are picked within 0.1 Th, or the spectrum is left
//      unpicked and counted (-1) -- never silently thinned;
//  (f) MS1 and empty spectra are not touched;
//  (g) an UNKNOWN-typed profile spectrum is picked only with pick_unknown,
//      (h) an UNKNOWN-typed centroid spectrum not even then;
//  (i) the -pick_profile mode table per reader, the option parser and the
//      counters;
//  (j) points out of m/z order are picked from a sorted copy under auto
//      (the Thermo profile mzML case) and as stored under legacy.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Centroid.h"

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <cmath>
#include <cstdio>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <vector>

using namespace OpenMS;
using FASTag::centroidProfileMs2;
namespace C = FASTag::Centroid;

namespace
{
  int failures = 0;

  void check(bool ok, const std::string& what)
  {
    if (!ok)
    {
      std::printf("FAIL: %s\n", what.c_str());
      ++failures;
    }
  }

  /// Gaussians of apex @p heights at @p centres, FWHM @p fwhm, sampled every
  /// @p step Th over +-1.5 FWHM, with a zero either side of every peak.
  MSSpectrum gaussians(const std::vector<double>& centres, const std::vector<double>& heights, double fwhm,
                       double step, SpectrumSettings::SpectrumType type, int level = 2)
  {
    const double sigma = fwhm / (2.0 * std::sqrt(2.0 * std::log(2.0)));
    std::map<long, double> acc;
    const long span = static_cast<long>(std::ceil(1.5 * fwhm / step));
    for (size_t p = 0; p < centres.size(); ++p)
    {
      const long k0 = std::lround(centres[p] / step);
      for (long k = k0 - span - 1; k <= k0 + span + 1; ++k)
      {
        const double d = k * step - centres[p];
        const double v = std::abs(k - k0) > span ? 0.0 : heights[p] * std::exp(-0.5 * (d / sigma) * (d / sigma));
        acc[k] += v;
      }
    }
    MSSpectrum s;
    s.setMSLevel(level);
    s.setRT(1234.5);
    s.setNativeID("synthetic=" + std::to_string(centres.size()));
    s.setType(type);
    Precursor pr;
    pr.setMZ(712.35);
    pr.setCharge(2);
    s.getPrecursors().push_back(pr);
    for (const auto& kv : acc) s.push_back(Peak1D(kv.first * step, static_cast<float>(kv.second)));
    return s;
  }

  std::vector<double> spaced(double from, double to, size_t n, std::mt19937& rng, double jitter)
  {
    std::uniform_real_distribution<double> u(-jitter, jitter);
    std::vector<double> c;
    for (size_t i = 0; i < n; ++i) c.push_back(from + (to - from) * (i + 0.5) / n + u(rng));
    return c;
  }

  std::vector<double> heights(size_t n, std::mt19937& rng)
  {
    std::uniform_real_distribution<double> u(1e3, 1e6);
    std::vector<double> h;
    for (size_t i = 0; i < n; ++i) h.push_back(u(rng));
    return h;
  }

  bool samePeaks(const MSSpectrum& a, const MSSpectrum& b)
  {
    if (a.size() != b.size() || a.getType() != b.getType() || a.getMSLevel() != b.getMSLevel()) return false;
    for (Size i = 0; i < a.size(); ++i)
      if (a[i].getMZ() != b[i].getMZ() || a[i].getIntensity() != b[i].getIntensity()) return false;
    return true;
  }

  /// Fraction of @p centres with a picked peak within @p tol_th (or ppm).
  double matched(const MSSpectrum& picked, const std::vector<double>& centres, double tol, bool ppm)
  {
    size_t hit = 0;
    for (const double c : centres)
    {
      const double t = ppm ? c * tol * 1e-6 : tol;
      for (const Peak1D& p : picked)
        if (std::fabs(p.getMZ() - c) <= t) { ++hit; break; }
    }
    return centres.empty() ? 0.0 : static_cast<double>(hit) / centres.size();
  }
}

int main()
{
  std::mt19937 rng(20261106);
  PeakPickerHiRes picker;

  // (a) high resolution: 30 peaks, FWHM 0.01 Th, 6 samples per FWHM.
  {
    const std::vector<double> c = spaced(200, 1500, 30, rng, 5.0), h = heights(30, rng);
    MSSpectrum s = gaussians(c, h, 0.01, 0.01 / 6, SpectrumSettings::SpectrumType::PROFILE);
    const Size profile_points = s.size();
    const int r = centroidProfileMs2(s, picker);
    check(r == 1, "(a) a profile MS2 is picked (+1)");
    check(s.getType() == SpectrumSettings::SpectrumType::CENTROID, "(a) the picked spectrum is CENTROID");
    check(s.size() == 30, "(a) one centroid per Gaussian (" + std::to_string(s.size()) + " of " +
                              std::to_string(profile_points) + " points)");
    check(matched(s, c, 1.0, true) == 1.0, "(a) every centroid within 1 ppm of its apex");
    check(s.getMSLevel() == 2 && s.getRT() == 1234.5 && s.getNativeID() == "synthetic=30" &&
              s.getPrecursors().size() == 1 && s.getPrecursors()[0].getMZ() == 712.35 &&
              s.getPrecursors()[0].getCharge() == 2,
          "(a) MS level, RT, native ID and precursor kept");
    // The apex intensity is kept, so the peak order by intensity is.
    bool apex = true;
    for (size_t i = 0; i < c.size(); ++i)
      for (const Peak1D& p : s)
        if (std::fabs(p.getMZ() - c[i]) <= c[i] * 1e-6 && std::fabs(p.getIntensity() - h[i]) > 0.01 * h[i]) apex = false;
    check(apex, "(a) picked intensities within 1% of the apex heights");
  }

  // (b) CENTROID is never re-picked, whatever pick_unknown says.
  {
    const std::vector<double> c = spaced(200, 1500, 30, rng, 5.0), h = heights(30, rng);
    const MSSpectrum src = gaussians(c, h, 0.01, 0.01 / 6, SpectrumSettings::SpectrumType::CENTROID);
    for (const bool unknown : {false, true})
    {
      MSSpectrum s = src;
      check(centroidProfileMs2(s, picker, unknown) == 0, "(b) CENTROID returns 0");
      check(samePeaks(s, src), "(b) CENTROID spectrum unchanged");
    }
  }

  // (c) sparse: isolated single samples have no peak shape.
  {
    MSSpectrum s;
    s.setMSLevel(2);
    s.setType(SpectrumSettings::SpectrumType::PROFILE);
    for (const double mz : {250.0, 600.0, 999.0}) s.push_back(Peak1D(mz, 1000.0f));
    const MSSpectrum src = s;
    check(centroidProfileMs2(s, picker) == -1, "(c) sparse profile returns -1");
    check(samePeaks(s, src) && s.getType() == SpectrumSettings::SpectrumType::PROFILE,
          "(c) sparse profile keeps its points and its type");
  }

  // (d) 8 threads, one picker each, equal the serial pass.
  {
    std::vector<MSSpectrum> in;
    for (int k = 0; k < 64; ++k)
    {
      const size_t n = 10 + static_cast<size_t>(k % 40);
      in.push_back(gaussians(spaced(150, 1800, n, rng, 3.0), heights(n, rng), 0.004 + 0.0005 * (k % 9),
                             0.001, SpectrumSettings::SpectrumType::PROFILE));
    }
    std::vector<MSSpectrum> serial = in;
    std::vector<int> serial_r(in.size());
    for (size_t i = 0; i < in.size(); ++i) serial_r[i] = centroidProfileMs2(serial[i], picker);
    std::vector<MSSpectrum> par = in;
    std::vector<int> par_r(in.size());
    std::vector<std::thread> team;
    for (int t = 0; t < 8; ++t)
      team.emplace_back([&, t] {
        PeakPickerHiRes own;
        for (size_t i = static_cast<size_t>(t); i < in.size(); i += 8) par_r[i] = centroidProfileMs2(par[i], own);
      });
    for (std::thread& th : team) th.join();
    bool same = true;
    size_t picked = 0;
    for (size_t i = 0; i < in.size(); ++i)
    {
      same = same && serial_r[i] == par_r[i] && samePeaks(serial[i], par[i]);
      picked += serial_r[i] == 1;
    }
    check(same, "(d) 8 threads give the serial result");
    check(picked == in.size(), "(d) every spectrum was picked (the comparison is not vacuous)");
  }

  // (e) low resolution: FWHM 0.3 Th, sampled every 0.05 Th; peaks at least
  // 1 Th apart are resolvable.
  {
    size_t picked = 0, kept = 0;
    for (int k = 0; k < 20; ++k)
    {
      const size_t n = 20 + static_cast<size_t>(k);
      const std::vector<double> c = spaced(200, 1500, n, rng, 4.0), h = heights(n, rng);
      std::vector<double> resolvable;
      for (size_t i = 0; i < c.size(); ++i)
      {
        const bool left = i == 0 || c[i] - c[i - 1] >= 1.0, right = i + 1 == c.size() || c[i + 1] - c[i] >= 1.0;
        if (left && right) resolvable.push_back(c[i]);
      }
      MSSpectrum s = gaussians(c, h, 0.3, 0.05, SpectrumSettings::SpectrumType::PROFILE);
      const MSSpectrum src = s;
      const int r = centroidProfileMs2(s, picker);
      check(r != 0, "(e) a low-resolution profile is handled (picked or counted)");
      if (r == 1)
      {
        ++picked;
        const double f = matched(s, resolvable, 0.1, false);
        check(f >= 0.9, "(e) spectrum " + std::to_string(k) + ": " + std::to_string(f) +
                            " of the resolvable peaks picked within 0.1 Th (>= 0.9 required)");
      }
      else
      {
        ++kept;
        check(samePeaks(s, src), "(e) an unpicked low-resolution spectrum keeps its profile");
      }
    }
    std::printf("(e) low resolution: %zu picked, %zu kept as profile\n", picked, kept);
  }

  // (f) MS1 and empty spectra.
  {
    MSSpectrum ms1 = gaussians({500.0, 600.0, 700.0}, {1e5, 2e5, 3e5}, 0.01, 0.01 / 6,
                               SpectrumSettings::SpectrumType::PROFILE, 1);
    const MSSpectrum src = ms1;
    check(centroidProfileMs2(ms1, picker, true) == 0 && samePeaks(ms1, src), "(f) MS1 not picked");
    MSSpectrum empty;
    empty.setMSLevel(2);
    empty.setType(SpectrumSettings::SpectrumType::PROFILE);
    check(centroidProfileMs2(empty, picker, true) == 0 && empty.empty(), "(f) empty PROFILE MS2 returns 0");
  }

  // (g) UNKNOWN-typed profile data, (h) UNKNOWN-typed centroid data.
  {
    const std::vector<double> c = spaced(200, 1500, 30, rng, 5.0), h = heights(30, rng);
    const MSSpectrum src = gaussians(c, h, 0.01, 0.01 / 6, SpectrumSettings::SpectrumType::UNKNOWN);
    check(src.getType(true) == SpectrumSettings::SpectrumType::PROFILE,
          "(g) OpenMS estimates the untyped Gaussians as PROFILE (fixture sanity)");
    MSSpectrum s = src;
    check(centroidProfileMs2(s, picker) == 0 && samePeaks(s, src), "(g) UNKNOWN not picked without pick_unknown");
    check(centroidProfileMs2(s, picker, true) == 1 && s.getType() == SpectrumSettings::SpectrumType::CENTROID &&
              s.size() == 30 && matched(s, c, 1.0, true) == 1.0,
          "(g) UNKNOWN profile picked with pick_unknown, within 1 ppm");

    MSSpectrum sticks;
    sticks.setMSLevel(2);
    for (size_t i = 0; i < c.size(); ++i) sticks.push_back(Peak1D(c[i], static_cast<float>(h[i])));
    check(sticks.getType(true) == SpectrumSettings::SpectrumType::CENTROID,
          "(h) OpenMS estimates untyped sticks as CENTROID (fixture sanity)");
    const MSSpectrum sticks_src = sticks;
    check(centroidProfileMs2(sticks, picker, true) == 0 && samePeaks(sticks, sticks_src),
          "(h) UNKNOWN centroid data untouched with pick_unknown");
  }

  // (i) modes, readers, parsing, counters.
  {
    using M = C::Mode;
    using I = C::Input;
    struct Row
    {
      M mode;
      I input;
      bool flag;
      bool pick;
      bool unknown;
    };
    const Row rows[] = {
        {M::Legacy, I::MzPeak, false, true, false}, {M::Legacy, I::MzML, false, false, false},
        {M::Legacy, I::Mgf, false, false, false},   {M::Legacy, I::MzPeak, true, true, false},
        {M::Legacy, I::MzML, true, false, false},   {M::Auto, I::MzPeak, false, true, false},
        {M::Auto, I::MzML, false, true, false},     {M::Auto, I::Mgf, false, false, false},
        {M::Auto, I::MzPeak, true, true, true},     {M::Auto, I::MzML, true, true, true},
        {M::Auto, I::Mgf, true, false, false},      {M::Off, I::MzPeak, false, false, false},
        {M::Off, I::MzML, true, false, false},      {M::Off, I::Mgf, true, false, false},
    };
    for (const Row& r : rows)
    {
      const C::Policy p = C::policyFor(r.mode, r.input, r.flag);
      // Auto picks from m/z-sorted points; legacy as stored (1.11).
      check(p.pick == r.pick && p.unknown == r.unknown && p.sort == (r.mode == M::Auto && r.pick),
            "(i) policy mode " + std::to_string(static_cast<int>(r.mode)) + " input " +
                std::to_string(static_cast<int>(r.input)) + " flag " + std::to_string(r.flag));
    }
    M m = M::Off;
    check(C::parseMode("legacy", m) && m == M::Legacy, "(i) parse legacy");
    check(C::parseMode("auto", m) && m == M::Auto, "(i) parse auto");
    check(C::parseMode("off", m) && m == M::Off, "(i) parse off");
    check(!C::parseMode("Auto", m) && !C::parseMode("", m), "(i) unknown mode strings refused");
    check(std::string(C::kModeDefault) == "legacy" && std::string(C::kModeValues) == "legacy,auto,off",
          "(i) registered default and valid strings");

    // A policy that does not pick leaves even a profile spectrum alone.
    const std::vector<double> c = spaced(200, 1500, 10, rng, 5.0), h = heights(10, rng);
    MSSpectrum s = gaussians(c, h, 0.01, 0.01 / 6, SpectrumSettings::SpectrumType::PROFILE);
    const MSSpectrum src = s;
    check(C::apply(s, picker, C::Policy{}) == 0 && samePeaks(s, src), "(i) apply with pick off is a no-op");
    check(C::apply(s, picker, C::Policy{true, false}) == 1, "(i) apply with pick on picks");

    C::Counts a, b;
    a.add(1);
    a.add(1);
    a.add(-1);
    a.add(0);
    b.add(1);
    b.add(-1);
    a.merge(b);
    check(a.picked == 3 && a.failed == 2, "(i) counters add and merge");
  }

  // (j) points out of m/z order (Thermo profile mzML, PXD000865: the zero
  // padding point after a peak's last sample sits at a slightly lower m/z).
  // With sort the result is the pick of the m/z-sorted points; without it
  // the points are picked as stored (legacy, 1.11), which moves peaks.
  {
    const std::vector<double> c = spaced(200, 1500, 40, rng, 5.0), h = heights(40, rng);
    MSSpectrum sorted = gaussians(c, h, 0.01, 0.01 / 6, SpectrumSettings::SpectrumType::PROFILE);
    // Every zero that follows a sample: moved to 30% of a step below that sample.
    MSSpectrum unsorted = sorted;
    size_t moved = 0;
    for (Size i = 1; i < unsorted.size(); ++i)
      if (unsorted[i].getIntensity() == 0 && unsorted[i - 1].getIntensity() > 0)
      {
        unsorted[i].setMZ(unsorted[i - 1].getMZ() - 0.3 * (0.01 / 6));
        ++moved;
      }
    check(moved >= 40 && !unsorted.isSorted(), "(j) the fixture is out of m/z order");
    MSSpectrum resorted = unsorted;
    resorted.sortByPosition();
    MSSpectrum want = resorted, as_stored = unsorted, got = unsorted;
    check(centroidProfileMs2(want, picker) == 1, "(j) the sorted points pick");
    check(centroidProfileMs2(got, picker, false, true) == 1, "(j) sort: picked");
    check(samePeaks(got, want), "(j) sort: the pick of the m/z-sorted points");
    check(centroidProfileMs2(as_stored, picker, false, false) == 1, "(j) no sort: picked as stored");
    check(!samePeaks(as_stored, want), "(j) no sort: unsorted points pick differently (the case is real)");
    const MSSpectrum before = unsorted;
    MSSpectrum c_sorted = unsorted;
    c_sorted.setType(SpectrumSettings::SpectrumType::CENTROID);
    check(centroidProfileMs2(c_sorted, picker, false, true) == 0 && c_sorted.size() == before.size() &&
              !c_sorted.isSorted(),
          "(j) sort never touches a spectrum that needs no picking");
    MSSpectrum viaPolicy = unsorted;
    check(C::apply(viaPolicy, picker, C::policyFor(C::Mode::Auto, C::Input::MzML, false)) == 1 &&
              samePeaks(viaPolicy, want),
          "(j) auto on mzML picks the sorted points");
  }

  if (failures)
  {
    std::printf("%d FAILURE(S)\n", failures);
    return 1;
  }
  std::printf("centroid_test: all checks passed\n");
  return 0;
}
