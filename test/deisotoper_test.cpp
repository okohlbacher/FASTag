// The ported averagine deisotoper against OpenMS's own, bit for bit.
//
// FASTag::deisotopeAveragine claims to BE OpenMS's
// Deisotoper::deisotopeWithAveragineModel for the arguments prepare() passes:
// the same peaks, in the same order, with the same m/z doubles and intensity
// floats. Close is not enough -- one peak more or less shifts every intensity
// rank after it, and the tag output with it -- so every comparison here is on
// the bit patterns, and every case runs both implementations on the same
// input.
//
// Without arguments (ctest): synthetic spectra built to hit each place the
// port could drift -- isotope clusters at charges 1-4 with model-shaped and
// model-breaking intensities, overlapping clusters of different charge, peaks
// exactly equidistant from an isotope target (OpenMS gives the tie to the
// lower index), peaks exactly on the tolerance edge, exact and near duplicates,
// intensities around ThresholdMower's 0.05, m/z below a proton, a moved
// monoisotopic peak landing exactly on another peak, empty, 1- and 2-peak
// spectra -- at Da and ppm tolerances up to and just past the clamps FASTag
// applies (0.1 Da, 100 ppm), plus every spectrum of the vendored fixture.
//
// With an mzPeak archive as argument: every MS2 spectrum of the run, read
// through OnDiscMzPeakExperiment, both as read and as prepare() hands it to
// the deisotoper, at 0.02 Da, 20 ppm and the two clamps. Prints the number of
// mismatching spectra for each (must be 0) and each implementation's time.
//
//   deisotoper_test [archive.mzpeak [threads]]
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "AveragineDeisotoper.h"
#ifdef FASTAG_HAVE_MZPEAK_LIB
#include "OnDiscMzPeakExperiment.h"
#endif

#include <OpenMS/CHEMISTRY/ISOTOPEDISTRIBUTION/CoarseIsotopePatternGenerator.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/PROCESSING/DEISOTOPING/Deisotoper.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <memory>
#include <random>
#include <string>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

using namespace OpenMS;

namespace
{
  const double C13 = Constants::C13C12_MASSDIFF_U;
  const double PROTON = Constants::PROTON_MASS_U;

  struct Tol { double value; bool ppm; };
  // Da and ppm, up to the clamps prepare() applies, and just past them (both
  // implementations must then throw).
  const Tol TOLS[] = {{0.001, false}, {0.005, false}, {0.01, false}, {0.02, false}, {0.05, false},
                      {0.1, false}, {1, true}, {5, true}, {10, true}, {20, true}, {50, true},
                      {100, true}, {0.10000001, false}, {100.00001, true}};

  int failures = 0;
  long n_cases = 0, n_peaks_in = 0, n_peaks_out = 0, n_moved = 0, n_equal_mz_out = 0;

  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  bool sameBits(double a, double b) { return std::memcmp(&a, &b, sizeof a) == 0; }
  bool sameBits(float a, float b) { return std::memcmp(&a, &b, sizeof a) == 0; }

  /// "" when the peak lists are bit-identical, else the first difference.
  std::string difference(const MSSpectrum& ref, const MSSpectrum& got)
  {
    char buf[200];
    if (ref.size() != got.size())
    {
      std::snprintf(buf, sizeof buf, "%zu peaks vs %zu", ref.size(), got.size());
      return buf;
    }
    for (size_t i = 0; i < ref.size(); ++i)
      if (!sameBits(ref[i].getMZ(), got[i].getMZ()) ||
          !sameBits(ref[i].getIntensity(), got[i].getIntensity()))
      {
        std::snprintf(buf, sizeof buf, "peak %zu: OpenMS %.17g/%.9g, port %.17g/%.9g", i,
                      ref[i].getMZ(), double(ref[i].getIntensity()), got[i].getMZ(),
                      double(got[i].getIntensity()));
        return buf;
      }
    return "";
  }

  void openms(MSSpectrum& s, double tol, bool ppm, int max_charge)
  {
    // Exactly the call prepare() made before the port.
    Deisotoper::deisotopeWithAveragineModel(s, tol, ppm, 0, 1, max_charge, false, 2, 10, true,
                                            false, false, false);
  }

  /// Both implementations on copies of @p in; "" when they agree bit for bit
  /// (throwing counts as a result, and must agree too).
  std::string compare(const MSSpectrum& in, double tol, bool ppm, int max_charge,
                      double* t_openms = nullptr, double* t_port = nullptr)
  {
    using Clock = std::chrono::steady_clock;
    MSSpectrum ref = in, got = in;
    bool ref_threw = false, got_threw = false;
    const auto t0 = Clock::now();
    try { openms(ref, tol, ppm, max_charge); }
    catch (const Exception::IllegalArgument&) { ref_threw = true; }
    const auto t1 = Clock::now();
    try { FASTag::deisotopeAveragine(got, tol, ppm, max_charge); }
    catch (const Exception::IllegalArgument&) { got_threw = true; }
    const auto t2 = Clock::now();
    if (t_openms) *t_openms += std::chrono::duration<double>(t1 - t0).count();
    if (t_port) *t_port += std::chrono::duration<double>(t2 - t1).count();
    if (ref_threw != got_threw) return ref_threw ? "only OpenMS threw" : "only the port threw";
    if (ref_threw) return "";
    return difference(ref, got);
  }

  /// A spectrum as prepare() builds it: a fresh MSSpectrum carrying peaks
  /// only, sorted stably by m/z.
  MSSpectrum spectrum(std::vector<Peak1D> peaks)
  {
    std::stable_sort(peaks.begin(), peaks.end(), Peak1D::PositionLess());
    MSSpectrum s;
    for (const auto& p : peaks) s.push_back(p);
    return s;
  }

  /// Every tolerance and charge range on one input.
  void all(const std::string& what, const MSSpectrum& in, const std::vector<int>& charges = {1, 2, 3, 4})
  {
    for (const Tol& t : TOLS)
      for (int z : charges)
      {
        const std::string d = compare(in, t.value, t.ppm, z);
        ++n_cases;
        check(d.empty(), what + " @ " + std::to_string(t.value) + (t.ppm ? " ppm" : " Da") +
                             ", max charge " + std::to_string(z) + ": " + d);
        // What the case exercised, so the test cannot pass vacuously.
        if (z == 3 && t.value == 0.02 && !t.ppm)
        {
          MSSpectrum out = in;
          FASTag::deisotopeAveragine(out, t.value, t.ppm, z);
          n_peaks_in += static_cast<long>(in.size());
          n_peaks_out += static_cast<long>(out.size());
          for (size_t i = 0; i < out.size(); ++i)
          {
            if (i > 0 && out[i].getMZ() == out[i - 1].getMZ()) ++n_equal_mz_out;
            bool found = false;
            for (const auto& p : in) found = found || sameBits(p.getMZ(), out[i].getMZ());
            if (!found) ++n_moved;
          }
        }
      }
  }

  /// Averagine-shaped isotope cluster of neutral mass @p mass at charge @p z,
  /// @p n peaks, intensities scaled by @p scale and perturbed by up to
  /// @p wobble (relative), m/z jittered by up to @p jitter Da.
  void cluster(std::vector<Peak1D>& out, std::mt19937_64& rng, double mass, int z, int n,
               double scale, double wobble, double jitter)
  {
    std::uniform_real_distribution<double> u(-1.0, 1.0);
    // Poisson with lambda = mass / 1800, the model OpenMS tests against.
    double w = 1.0;
    const double lambda = mass / 1800.0;
    for (int k = 0; k < n; ++k)
    {
      if (k > 0) w *= lambda / k;
      const double mz = (mass + z * PROTON) / z + k * C13 / z + jitter * u(rng);
      const double in = scale * w * (1.0 + wobble * u(rng));
      out.emplace_back(mz, static_cast<float>(std::max(in, 1.0)));
    }
  }

  void synthetic()
  {
    std::mt19937_64 rng(20260929);

    // Degenerate inputs.
    all("empty", spectrum({}));
    all("one peak", spectrum({Peak1D(500.0, 1000.f)}));
    all("two peaks, a 1+ pair", spectrum({Peak1D(500.0, 1000.f), Peak1D(500.0 + C13, 300.f)}));
    all("two peaks, a 2+ pair", spectrum({Peak1D(500.0, 1000.f), Peak1D(500.0 + C13 / 2, 600.f)}));
    all("two peaks, unrelated", spectrum({Peak1D(500.0, 1000.f), Peak1D(612.3, 300.f)}));
    all("three peaks, a 1+ triple", spectrum({Peak1D(800.0, 1000.f), Peak1D(800.0 + C13, 450.f),
                                              Peak1D(800.0 + 2 * C13, 100.f)}));

    // ThresholdMower's 0.05: below, at (float 0.05 is just above), zero, negative.
    all("intensity threshold",
        spectrum({Peak1D(400.0, 0.f), Peak1D(401.0, 0.0499999f), Peak1D(402.0, 0.05f),
                  Peak1D(403.0, -1.f), Peak1D(404.0, 1e-30f), Peak1D(405.0, 100.f),
                  Peak1D(405.0 + C13, 40.f), Peak1D(405.0 + 2 * C13, 0.04f)}));

    // m/z below a proton: the averagine mass goes negative and KL goes NaN,
    // which OpenMS lets through (NaN > threshold is false).
    all("m/z below a proton", spectrum({Peak1D(0.3, 100.f), Peak1D(0.3 + C13, 80.f),
                                        Peak1D(0.9, 50.f), Peak1D(0.9 + C13 / 2, 45.f),
                                        Peak1D(1.2, 60.f), Peak1D(1.2 + C13, 10.f)}));

    // Clean and dirty clusters at every charge, singly and overlapping.
    for (int rep = 0; rep < 40; ++rep)
    {
      std::uniform_real_distribution<double> mass(200, 4000);
      std::vector<Peak1D> peaks;
      for (int z = 1; z <= 4; ++z)
      {
        cluster(peaks, rng, mass(rng), z, 2 + rep % 9, 1e4, 0.05, 0.002);   // fits the model
        cluster(peaks, rng, mass(rng), z, 3 + rep % 5, 1e4, 0.9, 0.004);    // breaks it somewhere
      }
      // Same neutral mass at 1+ and 2+: the 2+ cluster's even peaks also form
      // a 1+ cluster, so charges compete for one monoisotopic peak.
      const double m = mass(rng);
      cluster(peaks, rng, m, 2, 6, 1e4, 0.02, 0.0);
      cluster(peaks, rng, m, 1, 3, 5e3, 0.02, 0.0);
      all("clusters " + std::to_string(rep), spectrum(peaks));
    }

    // Exact ties for the nearest peak: two peaks equidistant from an isotope
    // target, bit for bit (a power-of-two offset from a target in [256, 512)
    // is exact on both sides). OpenMS's findNearest gives the tie to the lower.
    for (int q = 1; q <= 3; ++q)
      for (double d : {0.0009765625, 0.001953125, 0.0048828125, 0.009765625})
      {
        const double mono = 300.0 + 7.0 * q;
        const double t1 = mono + C13 / static_cast<double>(q);
        const double t2 = mono + 2.0 * C13 / static_cast<double>(q);
        check(std::fabs((t1 + d) - t1) == std::fabs((t1 - d) - t1), "tie construction");
        all("tie q=" + std::to_string(q) + " d=" + std::to_string(d),
            spectrum({Peak1D(mono, 1000.f), Peak1D(t1 - d, 300.f), Peak1D(t1 + d, 700.f),
                      Peak1D(t2 - d, 90.f), Peak1D(t2 + d, 10.f)}));
      }

    // Peaks exactly on the tolerance edge, and one ulp outside it.
    for (const Tol& t : TOLS)
      for (int q = 1; q <= 3; ++q)
      {
        const double mono = 650.0 + q;
        const double tol = t.ppm ? (t.value / 1e6) * mono : t.value;
        const double t1 = mono + C13 / static_cast<double>(q);
        const double t2 = mono + 2.0 * C13 / static_cast<double>(q);
        all("edge " + std::to_string(t.value) + (t.ppm ? "ppm" : "Da") + " q=" + std::to_string(q),
            spectrum({Peak1D(mono, 1000.f), Peak1D(t1 - tol, 500.f), Peak1D(t2 + tol, 150.f)}));
        all("past edge " + std::to_string(t.value) + (t.ppm ? "ppm" : "Da") + " q=" + std::to_string(q),
            spectrum({Peak1D(mono, 1000.f), Peak1D(std::nextafter(t1 - tol, 0.0), 500.f),
                      Peak1D(std::nextafter(t2 + tol, 1e9), 150.f)}));
      }

    // Duplicates: exact, one ulp apart, 1e-9 apart, equal and unequal
    // intensity -- also exactly ON an isotope target, where lower_bound must
    // land on the first of them and not past them.
    for (int z = 1; z <= 3; ++z)
    {
      std::vector<Peak1D> peaks;
      for (int k = 0; k < 20; ++k)
      {
        const double mz = 500.0 + 1.37 * k;
        const double t1 = mz + C13 / static_cast<double>(z), t2 = mz + 2.0 * C13 / static_cast<double>(z);
        peaks.emplace_back(mz, 1000.f);
        peaks.emplace_back(mz, k % 2 ? 1000.f : 400.f);
        peaks.emplace_back(std::nextafter(mz, 1e9), 300.f);
        peaks.emplace_back(mz + 1e-9, 200.f);
        peaks.emplace_back(t1, 450.f);
        peaks.emplace_back(t1, k % 2 ? 450.f : 430.f);
        peaks.emplace_back(t1 + 1e-9, 440.f);
        peaks.emplace_back(t2, 200.f);
        peaks.emplace_back(t2, 190.f);
      }
      all("duplicates z=" + std::to_string(z), spectrum(peaks));
    }

    // The KL test's edge. OpenMS accumulates the divergence in a FLOAT from
    // double terms and stops at KL > threshold; a double accumulator, or >=,
    // decides a few intensity ratios differently. So walk the deciding
    // isotope's intensity float by float across every crossing, and count
    // that the walk really met both kinds of edge.
    {
      long on_threshold = 0, float_vs_double = 0;
      for (int q = 1; q <= 3; ++q)
        for (double mono : {212.3, 412.3, 555.5, 777.7, 901.1, 1301.9, 1717.2, 2222.2, 2999.9, 3500.5})
          for (int second = 0; second <= 1; ++second)  // edge at the 1st extension (0.05) or the 2nd (0.1)
          {
            const std::vector<double> d =
              CoarseIsotopePatternGenerator::approximateIntensities(q * (mono - PROTON), 10);
            const double t1 = mono + C13 / static_cast<double>(q);
            const double t2 = mono + 2.0 * C13 / static_cast<double>(q);
            const float i0 = 1000.f, i1 = static_cast<float>(1000.0 * d[1] / d[0]);
            const float thr = second ? 0.1f : 0.05f;
            auto kl = [&](float last, float& kf, double& kd)
            {
              const double obs[3] = {i0, second ? double(i1) : double(last), double(last)};
              const size_t m = second ? 3 : 2;
              double st = 0, dt = 0;
              for (size_t k = 0; k < m; ++k) { st += obs[k]; dt += d[k]; }
              kf = 0;
              kd = 0;
              for (size_t k = 0; k < m; ++k)
              {
                const double px = obs[k] / st, term = px * std::log(px / (d[k] / dt));
                kf += term;
                kd += term;
              }
            };
            const double model = second ? 1000.0 * d[2] / d[0] : double(i1);
            for (double far : {model / 50, model * 50})
            {
              double in = model, out = far;  // KL below / above the threshold
              for (int it = 0; it < 80; ++it)
              {
                float kf; double kd;
                const double mid = 0.5 * (in + out);
                kl(static_cast<float>(mid), kf, kd);
                (kd > thr ? out : in) = mid;
              }
              float x = static_cast<float>(in);
              for (int s = 0; s < 200; ++s) x = std::nextafter(x, static_cast<float>(in < out ? 0 : 1e30));
              for (int s = 0; s < 400; ++s, x = std::nextafter(x, static_cast<float>(in < out ? 1e30 : 0)))
              {
                float kf; double kd;
                kl(x, kf, kd);
                on_threshold += kf == thr;
                float_vs_double += (kf > thr) != (kd > thr);
                std::vector<Peak1D> peaks = {Peak1D(mono, i0), Peak1D(t1, second ? i1 : x)};
                if (second) peaks.emplace_back(t2, x);
                const std::string diff = compare(spectrum(peaks), 0.02, false, q);
                ++n_cases;
                check(diff.empty(), "KL edge q=" + std::to_string(q) + " mono=" + std::to_string(mono) +
                                      ": " + diff);
              }
            }
          }
      check(on_threshold > 0, "the KL walk met KL == threshold exactly");
      check(float_vs_double > 0, "the KL walk met a float/double disagreement");
      std::cout << "KL edge: " << on_threshold << " probes exactly on the threshold, "
                << float_vs_double << " decided differently by a double accumulator\n";
    }

    // ppm window edges that only OpenMS's own rounding decides: (tol / 1e6) *
    // mz and tol * mz / 1e6 differ in the last bit now and then, and a peak
    // on the edge of the window sees it. Search for m/z values where it shows
    // after the subtraction, and put peaks on and just past both edges.
    {
      long found = 0;
      for (double v : {1.0, 5.0, 10.0, 20.0, 50.0, 100.0})
        for (int q = 1; q <= 3; ++q)
        {
          int hits = 0;
          for (long k = 0; k < 4000000 && hits < 3; ++k)
          {
            const double mono = 300.0 + 0.000731 * static_cast<double>(k);
            const double tol = (v / 1e6) * mono, alt = v * mono / 1e6;
            const double t1 = mono + C13 / static_cast<double>(q);
            if (t1 - tol == t1 - alt && t1 + tol == t1 + alt) continue;
            ++hits;
            ++found;
            for (double edge : {t1 - tol, std::nextafter(t1 - tol, 0.0), t1 + tol, std::nextafter(t1 + tol, 1e9)})
            {
              const std::string diff = compare(spectrum({Peak1D(mono, 1000.f), Peak1D(edge, 500.f)}), v, true, q);
              ++n_cases;
              check(diff.empty(), "ppm edge " + std::to_string(v) + " mono=" + std::to_string(mono) + ": " + diff);
            }
          }
        }
      check(found > 0, "ppm edge cases found");
      std::cout << "ppm edge: " << found << " m/z values where the rounding of the window shows\n";
    }

    // A monoisotopic peak moved to charge 1 that lands exactly on another peak:
    // OpenMS's stable sort keeps them in input order, and so must the merge.
    for (int z = 2; z <= 3; ++z)
    {
      std::vector<Peak1D> peaks;
      const double mono = 700.0 + 0.25 * z;
      cluster(peaks, rng, mono * z - z * PROTON, z, 4, 1e4, 0.0, 0.0);
      const Size zs = static_cast<Size>(z);
      peaks.emplace_back(peaks.front().getMZ() * zs - (zs - 1) * PROTON, 77.f);
      all("moved onto a peak, z=" + std::to_string(z), spectrum(peaks));
    }

    // Dense random spectra, the diaTracer shape (500 peaks), with planted
    // clusters; m/z on a 1e-4 grid so coincidences happen.
    for (int rep = 0; rep < 60; ++rep)
    {
      std::uniform_real_distribution<double> u(100, 2000), li(0, 5);
      std::vector<Peak1D> peaks;
      const int n = rep % 3 == 0 ? 60 : 500;
      for (int k = 0; k < n; ++k)
        peaks.emplace_back(std::round(u(rng) * 1e4) / 1e4, static_cast<float>(std::pow(10.0, li(rng))));
      for (int c = 0; c < n / 25; ++c)
        cluster(peaks, rng, u(rng) * 2, 1 + c % 3, 2 + c % 6, std::pow(10.0, li(rng) + 1), 0.1, 0.003);
      all("random " + std::to_string(rep), spectrum(peaks), {3});
    }
  }

  /// Every spectrum of the vendored fixture, as it comes.
  void fixture()
  {
#ifdef FASTAG_TEST_DATA
    PeakMap exp;
    MzMLFile().load(std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mzML", exp);
    for (Size i = 0; i < exp.size(); ++i)
    {
      std::vector<Peak1D> peaks(exp[i].begin(), exp[i].end());
      all("fixture spectrum " + std::to_string(i), spectrum(peaks), {3});
    }
    check(exp.size() > 100, "fixture loaded");
#endif
  }

#ifdef FASTAG_HAVE_MZPEAK_LIB
  /// The input prepare() hands the deisotoper: finite, positive, at most the
  /// precursor, equal m/z collapsed to the strongest. Mirrors FASTagger.cpp.
  MSSpectrum prepared(const MSSpectrum& in, double precursor_mz, int charge)
  {
    if (charge <= 0) charge = 2;
    const double precursor_tol = 1.5;  // Param's default
    const double max_mz = precursor_mz * charge - charge * PROTON + PROTON + precursor_tol;
    std::vector<Peak1D> work;
    for (const auto& pk : in)
    {
      if (!std::isfinite(pk.getMZ()) || !std::isfinite(pk.getIntensity())) continue;
      if (pk.getIntensity() <= 0 || pk.getMZ() > max_mz) continue;
      work.push_back(pk);
    }
    std::stable_sort(work.begin(), work.end(), Peak1D::PositionLess());
    std::vector<Peak1D> uniq;
    for (const auto& pk : work)
    {
      if (!uniq.empty() && pk.getMZ() == uniq.back().getMZ())
      {
        if (pk.getIntensity() > uniq.back().getIntensity()) uniq.back() = pk;
      }
      else uniq.push_back(pk);
    }
    return spectrum(uniq);
  }

  int realData(const std::string& path, int threads)
  {
    FASTag::OnDiscMzPeakExperiment archive(path);
    const long n = static_cast<long>(archive.getNrSpectra());
#ifdef _OPENMP
    if (threads <= 0) threads = std::min(32, omp_get_max_threads());
#else
    threads = 1;
#endif
    std::vector<std::unique_ptr<FASTag::OnDiscMzPeakExperiment>> readers(static_cast<size_t>(threads));
    for (auto& r : readers) r = std::make_unique<FASTag::OnDiscMzPeakExperiment>(archive);

    // Input kind (as read / as prepare() builds it) x tolerance.
    const Tol real_tols[] = {{0.02, false}, {20, true}, {0.1, false}, {100, true}};
    const char* kinds[] = {"as read", "prepared"};
    long ms2 = 0, peaks_in = 0, peaks_out = 0, nonfinite = 0;
    long bad[2][4] = {};
    double t_openms[2][4] = {}, t_port[2][4] = {};
    std::string first_bad;

#pragma omp parallel num_threads(threads) reduction(+:ms2, peaks_in, peaks_out, nonfinite)
    {
#ifdef _OPENMP
      FASTag::OnDiscMzPeakExperiment& reader = *readers[static_cast<size_t>(omp_get_thread_num())];
#else
      FASTag::OnDiscMzPeakExperiment& reader = *readers[0];
#endif
      long my_bad[2][4] = {};
      double my_to[2][4] = {}, my_tp[2][4] = {};
      std::string my_first;
#pragma omp for schedule(guided, 64)
      for (long i = 0; i < n; ++i)
      {
        const MSSpectrum s = reader.getSpectrum(static_cast<Size>(i));
        if (s.getMSLevel() != 2 || s.empty() || s.getPrecursors().empty()) continue;
        ++ms2;
        std::vector<Peak1D> finite;
        for (const auto& pk : s)
          if (std::isfinite(pk.getMZ()) && std::isfinite(pk.getIntensity())) finite.push_back(pk);
        nonfinite += static_cast<long>(s.size() - finite.size());
        const auto& prec = s.getPrecursors().front();
        const MSSpectrum inputs[2] = {spectrum(finite), prepared(s, prec.getMZ(), prec.getCharge())};
        for (int k = 0; k < 2; ++k)
          for (int t = 0; t < 4; ++t)
          {
            const std::string d = compare(inputs[k], real_tols[t].value, real_tols[t].ppm, 3,
                                          &my_to[k][t], &my_tp[k][t]);
            if (d.empty()) continue;
            ++my_bad[k][t];
            if (my_first.empty())
              my_first = "spectrum " + std::to_string(i) + " (" + kinds[k] + ", " +
                         std::to_string(real_tols[t].value) + (real_tols[t].ppm ? " ppm" : " Da") +
                         "): " + d;
          }
        peaks_in += static_cast<long>(inputs[1].size());
        MSSpectrum out = inputs[1];
        FASTag::deisotopeAveragine(out, 0.02, false, 3);
        peaks_out += static_cast<long>(out.size());
      }
#pragma omp critical
      {
        for (int k = 0; k < 2; ++k)
          for (int t = 0; t < 4; ++t)
          {
            bad[k][t] += my_bad[k][t];
            t_openms[k][t] += my_to[k][t];
            t_port[k][t] += my_tp[k][t];
          }
        if (first_bad.empty()) first_bad = my_first;
      }
    }

    std::printf("%s: %ld spectra, %ld MS2 compared, %ld non-finite peaks left out of 'as read'\n",
                path.c_str(), n, ms2, nonfinite);
    std::printf("prepared input at 0.02 Da: %ld peaks in, %ld out (%.1f%% removed)\n", peaks_in,
                peaks_out, peaks_in ? 100.0 * double(peaks_in - peaks_out) / double(peaks_in) : 0.0);
    long total_bad = 0;
    for (int k = 0; k < 2; ++k)
      for (int t = 0; t < 4; ++t)
      {
        total_bad += bad[k][t];
        std::printf("  %-8s %6g %-3s  mismatching spectra: %ld of %ld   OpenMS %7.2f s, port %6.2f s "
                    "(thread-seconds, %.1fx)\n",
                    kinds[k], real_tols[t].value, real_tols[t].ppm ? "ppm" : "Da", bad[k][t], ms2,
                    t_openms[k][t], t_port[k][t], t_port[k][t] > 0 ? t_openms[k][t] / t_port[k][t] : 0.0);
      }
    if (total_bad) std::printf("first mismatch: %s\n", first_bad.c_str());
    std::printf("%s\n", total_bad == 0 && ms2 > 0 ? "real data: IDENTICAL" : "real data: MISMATCH");
    return total_bad == 0 && ms2 > 0 ? 0 : 1;
  }
#endif
}

int main(int argc, char** argv)
{
  if (argc > 1)
  {
#ifdef FASTAG_HAVE_MZPEAK_LIB
    return realData(argv[1], argc > 2 ? std::atoi(argv[2]) : 0);
#else
    std::cerr << "this build has no mzPeak support; the real-data check needs it\n";
    return 2;
#endif
  }

  synthetic();
  fixture();

  // Guard against a vacuous pass: the cases must actually cluster, move
  // monoisotopic peaks, and produce the equal-m/z order the merge must keep.
  check(n_peaks_out < n_peaks_in, "clusters were collapsed");
  check(n_moved > 0, "monoisotopic peaks were moved to charge 1");
  check(n_equal_mz_out > 0, "an equal-m/z pair reached the final sort");

  std::cout << "deisotoper_test: " << n_cases << " comparisons, " << n_peaks_in << " -> "
            << n_peaks_out << " peaks at 0.02 Da, " << n_moved << " moved, " << n_equal_mz_out
            << " equal-m/z neighbours\n";
  if (failures == 0) std::cout << "deisotoper_test: port identical to OpenMS on every case\n";
  return failures == 0 ? 0 : 1;
}
