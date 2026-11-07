// Raw-DIA detection (1.12 item #7): the classifier on synthetic runs, the
// probe helpers, the readers' agreement and the messages.
//
// The 21 synthetic cases are PLAN-data-types.md item #7, Tests 1-21. Each
// builds the Ms2Meta sequence a run of that kind gives the probe (first
// precursor of every MS2, in file order) with a fixed seed.
//
//   acquisition_test <fixture dir>              all checks
//   acquisition_test --write-mzpeak <out>       write a raw-DIA-shaped mzPeak
//                                               archive (for acquisition_cli_test);
//                                               exit 77 without mzPeak support
//   acquisition_test --probe <in>               print probeFile()'s INFO line
//                                               (acquisition_cli_test compares it
//                                               with FASTag's); exit 5 if unreadable
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Acquisition.h"
#include "AcquisitionProbe.h"
#include "IndexedMzMLReader.h"
#include "MzPeakStream.h"

#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <random>
#include <string>
#include <vector>

using namespace OpenMS;
namespace A = FASTag::Acquisition;
using A::Mode;
using A::Ms2Meta;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (ok) return;
    std::cerr << "FAIL: " << what << "\n";
    ++failures;
  }

  const char* name(Mode m)
  {
    switch (m)
    {
      case Mode::Undetermined: return "Undetermined";
      case Mode::DDA: return "DDA";
      case Mode::PseudoDDA: return "PseudoDDA";
      case Mode::PRM: return "PRM";
      case Mode::DIALike: return "DIALike";
      case Mode::DIA: return "DIA";
    }
    return "?";
  }

  void expect(const std::vector<Ms2Meta>& run, Mode want, const std::string& what)
  {
    const A::AcqCall c = A::classifyAcquisition(run);
    check(c.mode == want, what + ": expected " + name(want) + ", got " + name(c.mode) + " (" + c.why + ")");
  }
  void expectNot(const std::vector<Ms2Meta>& run, Mode never, const std::string& what)
  {
    const A::AcqCall c = A::classifyAcquisition(run);
    check(c.mode != never && c.mode != Mode::DIA,
          what + ": must not be " + name(never) + "/DIA, got " + name(c.mode) + " (" + c.why + ")");
  }

  Ms2Meta meta(double x, double lower, double upper, int charge, double target = -1)
  {
    Ms2Meta m;
    m.x = x;
    m.target = target < 0 ? x : target;
    m.lower = lower;
    m.upper = upper;
    m.charge = charge;
    return m;
  }

  /// A DIA scheme: windows [edges[k], edges[k+1]], selected ion = target =
  /// the window centre, @p per_window consecutive MS2 per window, @p cycles.
  std::vector<Ms2Meta> scheme(const std::vector<std::pair<double, double>>& windows, int cycles, int charge = 0,
                              int per_window = 1)
  {
    std::vector<Ms2Meta> r;
    for (int c = 0; c < cycles; ++c)
      for (const auto& [lo, hi] : windows)
        for (int k = 0; k < per_window; ++k)
        {
          const double t = 0.5 * (lo + hi);
          r.push_back(meta(t, t - lo, hi - t, charge));
        }
    return r;
  }
  std::vector<std::pair<double, double>> tiled(double from, double width, int n, double step = -1)
  {
    if (step < 0) step = width;
    std::vector<std::pair<double, double>> w;
    for (int k = 0; k < n; ++k) w.emplace_back(from + k * step, from + k * step + width);
    return w;
  }

  /// DDA-like: random mono m/z in [lo, hi], charge 2-4, narrow windows.
  std::vector<Ms2Meta> dda(std::mt19937& rng, std::size_t n, double half_width = 1.0, double lo = 400,
                           double hi = 1400)
  {
    std::uniform_real_distribution<double> mz(lo, hi);
    std::uniform_int_distribution<int> z(2, 4);
    std::vector<Ms2Meta> r;
    for (std::size_t i = 0; i < n; ++i) r.push_back(meta(mz(rng), half_width, half_width, z(rng)));
    return r;
  }

  MSSpectrum ms1()
  {
    MSSpectrum s;
    s.setMSLevel(1);
    return s;
  }
  MSSpectrum ms2(const Ms2Meta& m)
  {
    MSSpectrum s;
    s.setMSLevel(2);
    Precursor p;
    p.setMZ(m.x);
    p.setCharge(m.charge);
    if (m.lower > 0) p.setIsolationWindowLowerOffset(m.lower);
    if (m.upper > 0) p.setIsolationWindowUpperOffset(m.upper);
    if (m.target != m.x) p.setMetaValue("isolation window target m/z", m.target);
    s.getPrecursors().push_back(p);
    return s;
  }

  /// The 21 synthetic cases of the plan.
  void synthetic()
  {
    std::mt19937 rng(20261106);
    const auto w20 = tiled(400, 25, 20);  // 20 x 25 Th over 400-900

    // 1. 20 x 25 Th windows over 400-900, 10 cycles, uncharged.
    expect(scheme(w20, 10), Mode::DIA, "1 DIA 20x25 Th");
    {
      const A::AcqCall c = A::classifyAcquisition(scheme(w20, 10));
      check(c.n_win == 20 && c.cycle == 20 && std::fabs(c.per - 1.0) < 1e-12, "1 stats: 20 windows, cycle 20, per 1");
      check(std::fabs(c.median_width - 25) < 1e-9 && std::fabs(c.lo - 400) < 1e-9 && std::fabs(c.hi - 900) < 1e-9,
            "1 stats: width 25, 400-900");
      check(std::fabs(c.coverage - 1.0) < 1e-9 && c.frac_uncharged == 1.0, "1 stats: coverage 1, all uncharged");
      check(A::modeName(c) == "DIA", "1 mode name DIA");
    }
    // 2. The same windows, a random mono m/z inside each and charge 2-4.
    {
      std::vector<Ms2Meta> r;
      std::uniform_real_distribution<double> u(0, 1);
      std::uniform_int_distribution<int> z(2, 4);
      for (int c = 0; c < 10; ++c)
        for (const auto& [lo, hi] : w20)
        {
          const double x = lo + (hi - lo) * u(rng);
          r.push_back(meta(x, x - lo, hi - x, z(rng)));
        }
      // Few m/z repeat, so this is DDA or undetermined, never DIA.
      expectNot(r, Mode::DIALike, "2 DIA windows, mono m/z, charged");
    }
    // 3. diaTracer: +-0.011 Th windows on mono m/z, charged.
    expect(dda(rng, 4000, 0.011), Mode::DDA, "3 diaTracer-like");
    // 4. Astral: 300 x 2 Th over 380-980, uncharged.
    expect(scheme(tiled(380, 2, 300), 13), Mode::DIA, "4 Astral 300x2 Th");
    // 5. Staggered (alternating cycles offset by half a window) and overlapping windows.
    {
      std::vector<Ms2Meta> r;
      const auto a = tiled(400, 25, 20), b = tiled(387.5, 25, 21);
      for (int c = 0; c < 10; ++c)
        for (const auto& [lo, hi] : (c % 2 ? b : a))
        {
          const double t = 0.5 * (lo + hi);
          r.push_back(meta(t, t - lo, hi - t, 0));
        }
      expect(r, Mode::DIA, "5a staggered");
      expect(scheme(tiled(400, 30, 20, 25), 10), Mode::DIA, "5b overlapping 30 Th every 25 Th");
    }
    // 6. Variable widths: 10 x 10 Th, 10 x 20 Th, 3 x 50 Th.
    {
      std::vector<std::pair<double, double>> w;
      double e = 400;
      for (const auto& [n, width] : std::vector<std::pair<int, double>>{{10, 10}, {10, 20}, {3, 50}})
        for (int k = 0; k < n; ++k, e += width) w.emplace_back(e, e + width);
      expect(scheme(w, 10), Mode::DIA, "6 variable widths");
    }
    // 7. PRM: 8 scattered charged targets, 2 Th.
    {
      std::vector<Ms2Meta> r;
      const double t[] = {432.2, 518.7, 603.3, 677.8, 745.4, 812.9, 901.5, 1022.1};
      for (int c = 0; c < 20; ++c)
        for (int k = 0; k < 8; ++k) r.push_back(meta(t[k], 1, 1, 2 + k % 2));
      expect(r, Mode::PRM, "7 PRM 8 targets");
    }
    // 8. Scheduled PRM: 40 targets, 8 active at a time, the set moving on.
    {
      std::vector<Ms2Meta> r;
      std::vector<double> t;
      std::uniform_real_distribution<double> mz(400, 1200);
      for (int k = 0; k < 40; ++k) t.push_back(std::round(mz(rng) * 100) / 100);
      for (int block = 0; block < 9; ++block)
        for (int c = 0; c < 12; ++c)
          for (int k = 0; k < 8; ++k) r.push_back(meta(t[(block * 4 + k) % 40], 1, 1, 2));
      expectNot(r, Mode::DIALike, "8 scheduled PRM");
    }
    // 9. DDA with dynamic exclusion: each precursor 1-3 times close together.
    {
      std::vector<Ms2Meta> r;
      std::uniform_real_distribution<double> mz(400, 1400);
      std::uniform_int_distribution<int> rep(1, 3), z(2, 4);
      while (r.size() < 4000)
      {
        const double x = mz(rng);
        const int zz = z(rng);
        for (int k = rep(rng); k > 0; --k) r.push_back(meta(x + 0.001 * k, 1, 1, zz));
      }
      expect(r, Mode::DDA, "9 DDA dynamic exclusion");
    }
    // 10. No windows recorded, periodic: uncharged is DIA, charged is DDA.
    {
      std::vector<Ms2Meta> r = scheme(w20, 10), rc;
      for (Ms2Meta& m : r) m.lower = m.upper = 0;
      rc = r;
      for (Ms2Meta& m : rc) m.charge = 2;
      expect(r, Mode::DIA, "10a no windows, periodic, uncharged");
      expect(rc, Mode::DDA, "10b no windows, periodic, charged");
    }
    // 11. Fewer than 10 repeat gaps.
    {
      std::vector<Ms2Meta> r = scheme(w20, 1);
      for (int k = 0; k < 5; ++k) r.push_back(r[k]);
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.mode == Mode::Undetermined && c.n_gaps == 5, std::string("11 five gaps: ") + name(c.mode));
      // Wide and uncharged: a WARN, still tagged.
      check(c.warn, "11 wide uncharged undetermined warns");
      std::vector<Ms2Meta> d(r.begin(), r.end());
      for (Ms2Meta& m : d) m.charge = 2;
      check(!A::classifyAcquisition(d).warn, "11 charged undetermined does not warn");
    }
    // 12. A long MS1 head is crossed by the probe (collectMs2Meta).
    {
      const std::vector<Ms2Meta> dia = scheme(w20, 10);
      std::vector<MSSpectrum> run(6000, ms1());
      for (const Ms2Meta& m : dia)
      {
        run.push_back(ms1());
        run.push_back(ms2(m));
      }
      const auto read = [&run](std::size_t i) { return run[i]; };
      const std::vector<Ms2Meta> got = A::collectMs2Meta(run.size(), read, A::ProbeLimits());
      check(got.size() == dia.size(), "12 every MS2 behind 6000 MS1 probed");
      expect(got, Mode::DIA, "12 DIA behind a long MS1 head");
      A::ProbeLimits tight;
      tight.max_spectra = 5000;
      check(A::collectMs2Meta(run.size(), read, tight).empty(), "12 the spectra cap bounds the probe");
      A::ProbeLimits few;
      few.max_ms2 = 50;
      check(A::collectMs2Meta(run.size(), read, few).size() == 50, "12 the MS2 cap bounds the probe");
    }
    // 13. No MS2 at all.
    expect({}, Mode::Undetermined, "13 empty");
    // 14. Frame-split diaPASEF: k = 2..10 consecutive MS2 per window.
    for (int k = 2; k <= 10; ++k)
    {
      std::vector<Ms2Meta> r = scheme(w20, 6, 0, k);
      for (Ms2Meta& m : r) m.im = true;
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.mode == Mode::DIA && c.im && A::modeName(c) == "DIA (diaPASEF)",
            "14 frame-split k=" + std::to_string(k) + ": " + name(c.mode) + " (" + c.why + ")");
    }
    // 14b. Converted raw diaPASEF (E7-02: the OpenMS FileConverter on .d):
    // each TIMS frame holds k windows at different ion mobilities, written in
    // a varying order, so a window returns after cycle-1, cycle or cycle+1
    // events and the periodicity is about 1/k (0.26-0.53 on 10 public runs).
    for (int k = 2; k <= 4; ++k)
    {
      std::mt19937 r14(140 + k);
      const auto w = tiled(400, 25, 8 * k);  // 8 frames of k windows each
      std::vector<Ms2Meta> r;
      for (int cy = 0; cy < 40; ++cy)
        for (int f = 0; f < 8; ++f)
        {
          std::vector<int> pos(k);
          for (int i = 0; i < k; ++i) pos[i] = f * k + i;
          std::shuffle(pos.begin(), pos.end(), r14);
          for (int p : pos)
          {
            const double t = 0.5 * (w[p].first + w[p].second);
            Ms2Meta m = meta(t, 12.5, 12.5, 0);
            m.im = true;
            r.push_back(m);
          }
        }
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.mode == Mode::DIA && c.per < 0.8 && c.cycle == static_cast<std::size_t>(8 * k),
            "14b diaPASEF, frame order varies, k=" + std::to_string(k) + ": " + name(c.mode) + " (" + c.why + ")");
    }
    // 15. MSX-style: 100 x 4 Th over 500-900 visited in a fixed scrambled
    // order every cycle, two consecutive (multiplexed) MS2 per window.
    {
      const auto w = tiled(500, 4, 100);
      std::vector<std::size_t> order(w.size());
      for (std::size_t k = 0; k < order.size(); ++k) order[k] = k;
      std::shuffle(order.begin(), order.end(), std::mt19937(15));
      std::vector<std::pair<double, double>> visit;
      for (std::size_t k : order) visit.push_back(w[k]);
      expect(scheme(visit, 6, 0, 2), Mode::DIA, "15 MSX-style");
    }
    // 16. Wide-window DDA: 12 Th windows on jittered mono m/z, charged.
    {
      std::vector<Ms2Meta> r = dda(rng, 4000, 6.0);
      std::uniform_real_distribution<double> j(-3, 3);
      for (Ms2Meta& m : r) m.target = m.x + j(rng);
      expect(r, Mode::DDA, "16 wide-window DDA");
    }
    // 17. Inclusion list: 40 targets x 2 Th every cycle over 400-1000 (uncharged, the worst case).
    {
      std::vector<std::pair<double, double>> w;
      for (int k = 0; k < 40; ++k) w.emplace_back(400 + 15 * k, 402 + 15 * k);
      expect(scheme(w, 12), Mode::PRM, "17 inclusion list");
    }
    // 17b. The same without isolation windows (MGF, mzML without window
    // cvParams): 40 random targets over 400-1000, uncharged, 12 cycles. Not a
    // window grid, so not DIA (a false refusal before the grid criterion).
    {
      std::mt19937 r17(17);
      std::uniform_real_distribution<double> mz(400, 1000);
      std::vector<double> targets;
      for (int k = 0; k < 40; ++k) targets.push_back(mz(r17));
      std::vector<Ms2Meta> r;
      for (int c = 0; c < 12; ++c)
        for (double x : targets) r.push_back(meta(x, 0, 0, 0));
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.periodic && !c.windows && c.mode == Mode::PRM && c.grid_share < 0.8,
            std::string("17b inclusion list, no windows, uncharged, random targets: ") + name(c.mode) + " (" +
                c.why + ")");
      // The same targets on a 15 Th grid would read as window centres.
      std::vector<Ms2Meta> g;
      for (int cy = 0; cy < 12; ++cy)
        for (int k = 0; k < 40; ++k) g.push_back(meta(400 + 15 * k, 0, 0, 0));
      expect(g, Mode::DIA, "17b control: a regular 15 Th grid without windows");
      // Variable-width windows without recorded windows: not a grid, so not
      // refused (tagged as in 1.11) -- the cost of the criterion.
      std::vector<Ms2Meta> v;
      for (int cy = 0; cy < 12; ++cy)
      {
        double lo = 400;
        for (int k = 0; k < 30; ++k)
        {
          const double wdt = 5 + 1.5 * k;
          v.push_back(meta(lo + wdt / 2, 0, 0, 0));
          lo += wdt;
        }
      }
      expectNot(v, Mode::DIA, "17b variable windows without recorded windows");
    }
    // 18. 300 polysiloxane repeats (3 lock masses), then DDA.
    {
      std::vector<Ms2Meta> r;
      for (int c = 0; c < 100; ++c)
        for (double x : {445.12, 519.14, 593.16}) r.push_back(meta(x, 1, 1, 1));
      const std::vector<Ms2Meta> d = dda(rng, 3700);
      r.insert(r.end(), d.begin(), d.end());
      expectNot(r, Mode::DIALike, "18 polysiloxane head then DDA");
    }
    // 19. Cyclic charged wide-window counterexample: WARN, not refuse.
    {
      std::vector<Ms2Meta> r;
      for (int c = 0; c < 3; ++c)
        for (int k = 0; k < 5; ++k) r.push_back(meta(400 + 25 * k, 12.5, 12.5, 2));
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.mode == Mode::DIALike && c.warn, std::string("19 charged DIA-like warns: ") + name(c.mode) + " (" + c.why + ")");
      check(!A::warningMessage(c, "x.mzML").empty(), "19 a warning text");
    }
    // 20. Pseudo-DDA with repeated feature m/z: passes on provenance; the
    // same run without it is raw DIA.
    {
      std::vector<Ms2Meta> r = scheme(w20, 10);
      expect(r, Mode::DIA, "20 control: without provenance");
      for (Ms2Meta& m : r) m.provenance = true;
      expect(r, Mode::PseudoDDA, "20 pseudo-DDA with provenance");
      // A minority with provenance does not pass a file.
      for (std::size_t i = 0; i < r.size(); ++i) r[i].provenance = i % 3 == 0;
      expect(r, Mode::DIA, "20 a third with provenance is not pseudo-DDA");
    }
    // 21. Selected ion shifted from the target, asymmetric offsets: the
    // coverage is computed from the target.
    {
      std::vector<Ms2Meta> r;
      for (int c = 0; c < 6; ++c)
        for (int k = 0; k < 20; ++k)
        {
          const double t = 403 + 16 * k;
          r.push_back(meta(t + (k % 2 ? 8 : 0), 3, 13, 0, t));
        }
      const A::AcqCall c = A::classifyAcquisition(r);
      check(c.mode == Mode::DIA, std::string("21 shifted target: ") + name(c.mode) + " (" + c.why + ")");
      check(std::fabs(c.coverage - 1.0) < 1e-9 && std::fabs(c.lo - 400) < 1e-9 && std::fabs(c.hi - 720) < 1e-9,
            "21 coverage 1 over 400-720 from the target");
      // Read from the selected ion instead, the windows would not tile.
      for (Ms2Meta& m : r) m.target = m.x;
      check(A::classifyAcquisition(r).coverage < 0.8, "21 control: coverage from x is below 0.8");
    }
  }

  void spectra()
  {
    check(!A::fromSpectrum(ms1()), "MS1 is not probed");
    MSSpectrum no_prec;
    no_prec.setMSLevel(2);
    check(!A::fromSpectrum(no_prec), "an MS2 without a precursor is not probed");

    Ms2Meta m = meta(455, 3, 5, 0, 454);
    MSSpectrum s = ms2(m);
    const auto g = A::fromSpectrum(s);
    check(g && g->x == 455 && g->target == 454 && g->lower == 3 && g->upper == 5 && g->charge == 0 && !g->im &&
            !g->provenance,
          "fromSpectrum reads x, the target meta value, offsets and charge");
    s.getPrecursors()[0].setMetaValue("isolation window target m/z", 0.0);
    check(A::fromSpectrum(s)->target == 455, "a target of 0 (none in the file) falls back to x");
    check(A::fromSpectrum(s, true)->provenance, "run provenance marks the MS2");
    s.setMetaValue("spx_guessed", 0);
    check(A::fromSpectrum(s)->provenance, "an spx_* userParam is provenance");
    MSSpectrum t = ms2(m);
    t.setDriftTime(0.9);
    t.setDriftTimeUnit(DriftTimeUnit::VSSC);
    check(A::fromSpectrum(t)->im, "a 1/K0 on the scan is ion mobility");
    MSSpectrum f = ms2(m);
    f.setDriftTime(-45);
    f.setDriftTimeUnit(DriftTimeUnit::FAIMS_COMPENSATION_VOLTAGE);
    check(!A::fromSpectrum(f)->im, "a FAIMS CV is not ion mobility");
    MSSpectrum d = ms2(m);
    auto dp = std::make_shared<DataProcessing>();
    Software sw;
    sw.setName("DIAspeXtract");
    dp->setSoftware(sw);
    d.getDataProcessing().push_back(dp);
    check(A::fromSpectrum(d)->provenance, "DIAspeXtract data processing is provenance");
  }

  void messages()
  {
    const A::AcqCall c = A::classifyAcquisition(scheme(tiled(400, 25, 20), 10));
    const std::string msg = A::refusalMessage(c, "/data/run 1.mzML");
    check(msg.find("'/data/run 1.mzML' is raw DIA") != std::string::npos, "refusal names the input");
    check(msg.find("DIAspeXtract -in /data/run 1.mzML -out /data/run 1.pseudo.mzML") != std::string::npos,
          "refusal recommends DIAspeXtract with the pseudo-DDA output path: " + msg);
    check(msg.find("diaTracer") != std::string::npos && msg.find("-acquisition_check warn") != std::string::npos,
          "refusal mentions diaTracer and the override");
    check(msg.find("20 isolation windows") != std::string::npos && msg.find("400-900 m/z") != std::string::npos,
          "refusal gives the statistics: " + msg);
    check(A::refusalSentinel(c) == "FASTAG_REFUSED reason=raw_dia windows=20 median_width=25",
          "sentinel line: " + A::refusalSentinel(c));
    check(A::infoLine(c).rfind("Acquisition check: DIA", 0) == 0, "INFO line: " + A::infoLine(c));
    check(!A::taggedAnywayMessage(c, "x.mzML").empty(), "warn-mode text");
    // The summary line the gate digests must never be matched by ours.
    for (const std::string& l : {A::infoLine(c), A::refusalSentinel(c)})
      check(!(l.size() && std::isdigit(static_cast<unsigned char>(l[0]))), "no new line starts with a digit");
    std::vector<Ms2Meta> im = scheme(tiled(400, 25, 20), 10);
    for (Ms2Meta& m : im) m.im = true;
    check(A::refusalMessage(A::classifyAcquisition(im), "a.mzML").find("diaPASEF") != std::string::npos,
          "IM refusal says diaPASEF");
    const A::AcqCall dda_call = A::classifyAcquisition({});
    check(A::warningMessage(dda_call, "x").empty(), "no warning for an empty run");
  }

  /// The probe through both mzML readers agrees, and the header provenance.
  void fixtures(const std::string& dir)
  {
    const auto f = [&dir](const char* n) { return dir + "/" + n; };
    check(A::mzmlHeaderProvenance(f("dia_pseudo_like.mzML")), "DIAspeXtract header is provenance");
    check(A::mzmlHeaderProvenance(f("diatracer_like.mzML")), "diaTracer header is provenance");
    check(!A::mzmlHeaderProvenance(f("dia_like.mzML")), "raw DIA header is no provenance");
    check(!A::mzmlHeaderProvenance(f("Ecoli_MS2_small.mzML")), "OpenMS example header is no provenance");
    check(!A::mzmlHeaderProvenance(f("does_not_exist.mzML")), "a missing file is no provenance");

    for (const char* name : {"dia_shifted_target.mzML", "dia_like.mzML", "diapasef_split_like.mzML"})
    {
      FASTag::IndexedMzMLReader fast(f(name));
      check(fast.ok(), std::string(name) + " opens in the fast reader");
      OnDiscMSExperiment od;
      check(od.openFile(f(name)), std::string(name) + " opens in OnDisc");
      const auto meta_od = od.getMetaData();
      const A::ProbeLimits lim;
      const auto a = A::collectMs2Meta(fast.getNrSpectra(), [&](std::size_t i) { return fast.getSpectrumMetadata(i); }, lim);
      const auto b = A::collectMs2Meta(meta_od->size(), [&](std::size_t i) { return (*meta_od)[i]; }, lim);
      bool same = a.size() == b.size() && !a.empty();
      for (std::size_t i = 0; same && i < a.size(); ++i)
        same = a[i].x == b[i].x && a[i].target == b[i].target && a[i].lower == b[i].lower &&
               a[i].upper == b[i].upper && a[i].charge == b[i].charge && a[i].im == b[i].im &&
               a[i].provenance == b[i].provenance;
      check(same, std::string(name) + ": the fast reader and OnDisc give the same Ms2Meta");
      const A::AcqCall c = A::classifyAcquisition(a);
      check(c.mode == Mode::DIA, std::string(name) + " is DIA: " + c.why);
      if (std::string(name) == "dia_shifted_target.mzML")
        check(std::fabs(c.coverage - 1.0) < 1e-9, "dia_shifted_target: coverage from the target is 1");
    }
  }

  /// probeFile() and probeRun() (the one probe FASTag and its other callers
  /// share): the call per fixture, the same call through every mzML reader.
  void probes(const std::string& dir)
  {
    const auto f = [&dir](const char* n) { return dir + "/" + n; };
    const std::vector<std::pair<const char*, Mode>> want = {
        {"dia_like.mzML", Mode::DIA},          {"dia_pseudo_like.mzML", Mode::PseudoDDA},
        {"diatracer_like.mzML", Mode::PseudoDDA}, {"dia_nowin_like.mgf", Mode::DIA},
        {"prm_noz_like.mgf", Mode::PRM},       {"prm_like.mzML", Mode::PRM},
        {"Ecoli_MS2_small.mzML", Mode::DDA},   {"Ecoli_MS2_small.mgf", Mode::DDA}};
    for (const auto& [n, m] : want)
    {
      const A::ProbeResult r = A::probeFile(f(n));
      check(r.ok && r.call.mode == m,
            std::string("probeFile ") + n + ": expected " + name(m) + ", got " + name(r.call.mode) + " (" +
                (r.ok ? r.call.why : r.error) + ")");
    }
    for (const char* n : {"dia_like.mzML", "dia_pseudo_like.mzML", "diatracer_like.mzML"})
    {
      const std::string fast_line = A::infoLine(A::probeFile(f(n)).call);
      // OnDisc (FASTag's reader under -out_spectra) and in memory.
      OnDiscMSExperiment od;
      check(od.openFile(f(n)), std::string(n) + " opens in OnDisc");
      A::ProbeSource s_od;
      s_od.ondisc = &od;
      s_od.n_total = od.getNrSpectra();
      const A::ProbeResult r_od = A::probeRun(f(n), s_od);
      PeakMap exp;
      FileHandler().loadExperiment(f(n), exp, {FileTypes::MZML});
      A::ProbeSource s_mem;
      s_mem.exp = &exp;
      s_mem.n_total = exp.size();
      const A::ProbeResult r_mem = A::probeRun(f(n), s_mem);
      check(r_od.ok && A::infoLine(r_od.call) == fast_line, std::string(n) + ": OnDisc probeRun = probeFile");
      check(r_mem.ok && A::infoLine(r_mem.call) == fast_line, std::string(n) + ": in-memory probeRun = probeFile");
    }
    // The probe limits: n MS2, 10 n spectra.
    const A::ProbeLimits l = A::probeLimits(7);
    check(l.max_ms2 == 7 && l.max_spectra == 70, "probeLimits(7) = 7 MS2, 70 spectra");
    check(A::probeFile(f("dia_like.mzML"), 5).call.n_ms2 == 5, "probeFile honours the MS2 cap");
    // An unreadable input is an error, not a call.
    check(!A::probeFile(f("does_not_exist.mgf")).ok, "probeFile: a missing MGF is not ok");
  }

  /// The raw-DIA run as an MSExperiment: an MS1 then 20 MS2 per cycle.
  PeakMap diaExperiment()
  {
    PeakMap exp;
    double rt = 1;
    for (int c = 0; c < 6; ++c)
    {
      MSSpectrum m1 = ms1();
      m1.setRT(rt);
      m1.setNativeID("scan=" + std::to_string(exp.size() + 1));
      m1.push_back(Peak1D(500, 1000));
      exp.addSpectrum(m1);
      for (int k = 0; k < 20; ++k)
      {
        MSSpectrum s = ms2(meta(412.5 + 25 * k, 12.5, 12.5, 0));
        rt += 0.1;
        s.setRT(rt);
        s.setNativeID("scan=" + std::to_string(exp.size() + 1));
        s.setType(SpectrumSettings::SpectrumType::CENTROID);
        for (int p = 0; p < 30; ++p) s.push_back(Peak1D(150 + 23.1 * p + k, static_cast<float>(100 + 7 * p)));
        exp.addSpectrum(s);
      }
    }
    return exp;
  }

  void mzpeak(const std::string& tmpdir)
  {
    if (!MzPeakFile::isSupported())
    {
      std::cout << "acquisition_test: mzPeak probe skipped (no mzPeak support)\n";
      return;
    }
    const std::string path = tmpdir + "/acq_dia.mzpeak";
    MzPeakFile().store(path, diaExperiment());
    const auto got = FASTag::probeMzPeakMetadata(path, A::ProbeLimits(), 2);
    check(got.size() == 120, "mzPeak probe reads the 120 MS2, got " + std::to_string(got.size()));
    const A::AcqCall c = A::classifyAcquisition(got);
    check(c.mode == Mode::DIA, "mzPeak probe: DIA (" + c.why + ")");
    A::ProbeLimits few;
    few.max_ms2 = 25;
    check(FASTag::probeMzPeakMetadata(path, few, 2).size() == 25, "mzPeak probe stops at the MS2 cap");
    const A::ProbeResult pf = A::probeFile(path, 4000, 2);
    check(pf.ok && pf.call.mode == Mode::DIA && pf.ms2.size() == 120, "mzPeak probeFile: DIA over 120 MS2");
    std::filesystem::remove_all(path);
  }
}

int main(int argc, char** argv)
{
  if (argc == 3 && std::strcmp(argv[1], "--write-mzpeak") == 0)
  {
    if (!MzPeakFile::isSupported()) return 77;
    MzPeakFile().store(argv[2], diaExperiment());
    return 0;
  }
  if (argc == 3 && std::strcmp(argv[1], "--probe") == 0)
  {
    const A::ProbeResult r = A::probeFile(argv[2], 4000, 2);
    if (!r.ok)
    {
      std::cerr << r.error << "\n";
      return 5;
    }
    std::cout << A::infoLine(r.call) << "\n";
    return 0;
  }
  const std::string dir = argc > 1 ? argv[1] : FASTAG_TEST_DATA;
  synthetic();
  spectra();
  messages();
  fixtures(dir);
  probes(dir);
  const std::filesystem::path tmp =
      std::filesystem::temp_directory_path() /
      ("acq_test_" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directories(tmp);
  mzpeak(tmp.string());
  std::filesystem::remove_all(tmp);
  if (failures)
  {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "acquisition_test: all checks passed\n";
  return 0;
}
