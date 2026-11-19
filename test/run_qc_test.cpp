// Run QC report (src/RunQC.h, -qc_out): every metric on synthetic data with a
// known answer.
//
//   analyser classes   filter strings, PSI-MS names, OpenMS types; the
//                      filter > configuration > run default precedence
//   resolution         Gaussian profiles of known FWHM (R = m/z / FWHM) at
//                      two resolutions; the exclusions (centroid, overlapping
//                      doublet, undersampled, low signal-to-background)
//   reporters          OpenMS's channel tables, the 20 ppm match, the
//                      signal-to-background rule, the assessability reasons
//                      and the kit calls (TMT6, TMT10, TMTpro 18, none, MS3)
//   redundancy         fingerprint removals, cosine, complete linkage with
//                      the 60 s span, charge/ppm/mobility/cosine/matched
//                      rules, the tag-driven variant, the component cap, and
//                      the same answer for any record order
//   collector          the same rows from one thread and from two threads
//                      fed in another order
//
// With arguments it is the fixture writer of run_qc_cli_test.sh:
//   run_qc_test --write-mzml <path>   writes the synthetic run (see writeRun)
//   run_qc_test --expect              prints its known facts as "key value"
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "RunQC.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Acquisition.h>
#include <OpenMS/METADATA/AcquisitionInfo.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <random>
#include <string>
#include <vector>

using namespace OpenMS;
namespace Q = FASTag::RunQC;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  /// Gaussian profile peaks of the given FWHM at each m/z, sampled at
  /// FWHM / @p per_fwhm, on a floor of 1.0 between peaks.
  MSSpectrum gaussianProfile(const std::vector<std::pair<double, double>>& mz_fwhm, double apex, double per_fwhm,
                             double floor_lo = 300.0, double floor_hi = 2000.0)
  {
    MSSpectrum s;
    s.setType(SpectrumSettings::SpectrumType::PROFILE);
    // A sparse noise floor of 1.0 outside the peaks, so the median positive
    // intensity is 1 (a profile has one sample per m/z).
    for (double m = floor_lo; m < floor_hi; m += 0.37)
    {
      bool inside = false;
      for (const auto& [mz, w] : mz_fwhm)
        if (std::fabs(m - mz) <= 5 * w) inside = true;
      if (!inside) s.emplace_back(m, 1.0);
    }
    // Each peak's grid; at every grid point the sum of all peaks (so
    // overlapping peaks add up as they would in a real profile).
    std::vector<double> grid;
    for (const auto& [mz, w] : mz_fwhm)
      for (double x = -5 * w; x <= 5 * w; x += w / per_fwhm) grid.push_back(mz + x);
    std::sort(grid.begin(), grid.end());
    for (const double m : grid)
    {
      double in = 0;
      for (const auto& [mz, w] : mz_fwhm)
      {
        const double sigma = w / (2.0 * std::sqrt(2.0 * std::log(2.0)));
        in += apex * std::exp(-(m - mz) * (m - mz) / (2 * sigma * sigma));
      }
      s.emplace_back(m, std::max(1.0, in));
    }
    s.sortByPosition();
    return s;
  }

  /// Singly charged b and y ions of @p pep (intensity @p base, jittered).
  MSSpectrum ladder(const std::string& pep, double base, std::mt19937& rng)
  {
    const AASequence aa = AASequence::fromString(pep);
    std::uniform_real_distribution<double> j(0.8, 1.2);
    MSSpectrum s;
    for (size_t i = 1; i < aa.size(); ++i)
    {
      s.emplace_back(aa.getPrefix(i).getMonoWeight(Residue::BIon, 1), base * j(rng));
      s.emplace_back(aa.getSuffix(i).getMonoWeight(Residue::YIon, 1), base * j(rng));
    }
    return s;
  }

  double precursorOf(const std::string& pep, int z)
  {
    return (AASequence::fromString(pep).getMonoWeight() + z * Constants::PROTON_MASS_U) / z;
  }

  // ---- the synthetic run of the CLI test ------------------------------------

  /// TMT10 channels (OpenMS's table), for the labelled MS2.
  std::vector<double> tmt10()
  {
    const Q::ReporterTable t;
    for (const auto& k : t.kits)
      if (k.name == "tmt10plex")
      {
        std::vector<double> v;
        for (std::size_t c = 0; c < t.mz.size(); ++c)
          if (k.channels & (1u << c)) v.push_back(t.mz[c]);
        return v;
      }
    return {};
  }

  const std::vector<std::string> DUP_PEPTIDES = {"LGEYGFQNALIVR", "AEFVEVTK", "HLVDEPQNLIK", "YLYEIAR", "DAFLGSFLYEYSR"};
  const std::vector<std::string> SINGLE_PEPTIDES = {"VPQVSTPTLVEVSR", "QTALVELLK", "ELPGLLALK", "SLGKVGTR"};
  const std::vector<std::string> IT_PEPTIDES = {"LVNELTEFAK", "TCVADESHAGCEK", "AVMDDFAAFVEK", "EACFAVEGPK",
                                                 "LKECCDKPLLEK", "SHCIAEVEK", "YICDNQDTISSK", "LVTDLTK",
                                                 "FKDLGEEHFK", "GACLLPK"};
  constexpr int MS1_COUNT = 6;
  constexpr int DUP_COPIES = 4;
  constexpr double MS1_R = 50000.0;  // every MS1 peak: FWHM = m/z / 50000

  /**
    The synthetic run: 6 profile FTMS MS1 (Gaussian peaks of R = 50000 at
    450, 650, 950 and 1300); 5 peptides x 4 FTMS HCD MS2 copies within 30 s
    (charge 2, TMT10 reporters, scan from 110, stated resolving power 15000);
    4 single FTMS MS2 (charges 3, 3, 0, 2, with reporters, no filter string:
    the analyser is the run's Orbitrap); 10 ITMS CID MS2 (charge 2) whose
    scan starts above the reporters.
  */
  void writeRun(const std::string& path)
  {
    std::mt19937 rng(7);
    PeakMap exp;
    const std::vector<double> rep = tmt10();
    double rt = 10.0;
    int scan = 0;
    auto native = [&]() { return "controllerType=0 controllerNumber=1 scan=" + std::to_string(++scan); };
    auto ms1 = [&]() {
      MSSpectrum s = gaussianProfile({{450.0, 450.0 / MS1_R}, {650.0, 650.0 / MS1_R}, {950.0, 950.0 / MS1_R},
                                      {1300.0, 1300.0 / MS1_R}},
                                     1e5, 10.0);
      s.setMSLevel(1);
      s.setRT(rt);
      s.setNativeID(native());
      s.setMetaValue("filter string", "FTMS + p NSI Full ms [350.00-1800.00]");
      exp.addSpectrum(s);
    };
    exp.getInstrument().getMassAnalyzers().resize(1);
    exp.getInstrument().getMassAnalyzers()[0].setType(MassAnalyzer::AnalyzerType::ORBITRAP);
    auto ms2 = [&](const std::string& pep, int z, bool it, bool reporters, double at, bool filter = true) {
      MSSpectrum s = ladder(pep, 1e4, rng);
      const double pmz = precursorOf(pep, z > 0 ? z : 2);
      if (reporters)
        for (const double m : rep) s.emplace_back(m, 5e4);
      std::uniform_real_distribution<double> nm(150.0, 1200.0);
      for (int k = 0; k < 20; ++k) s.emplace_back(nm(rng), 1e3);
      s.sortByPosition();
      s.setMSLevel(2);
      s.setRT(at);
      s.setType(SpectrumSettings::SpectrumType::CENTROID);
      s.setNativeID(native());
      Precursor pc;
      pc.setMZ(pmz);
      pc.setCharge(z);
      pc.getActivationMethods().insert(it ? Precursor::ActivationMethod::CID : Precursor::ActivationMethod::HCD);
      s.setPrecursors({pc});
      ScanWindow w;
      w.begin = it ? std::max(150.0, pmz * 0.28) : 110.0;
      w.end = 2000.0;
      s.getInstrumentSettings().getScanWindows().push_back(w);
      char f[160];
      std::snprintf(f, sizeof f, "%s + c NSI d Full ms2 %.4f@%s35.00 [%.2f-2000.00]", it ? "ITMS" : "FTMS", pmz,
                    it ? "cid" : "hcd", w.begin);
      if (filter) s.setMetaValue("filter string", f);
      if (!it && filter) s.setMetaValue("mass resolving power", 15000);
      exp.addSpectrum(s);
    };
    for (int k = 0; k < MS1_COUNT; ++k)
    {
      ms1();
      rt += 1.0;
    }
    for (const auto& pep : DUP_PEPTIDES)
    {
      const double t0 = rt;
      for (int c = 0; c < DUP_COPIES; ++c) ms2(pep, 2, false, true, t0 + 10.0 * c);
      rt += 100.0;
    }
    const int zs[] = {3, 3, 0, 2};
    for (std::size_t k = 0; k < SINGLE_PEPTIDES.size(); ++k)
    {
      ms2(SINGLE_PEPTIDES[k], zs[k], false, true, rt, false);
      rt += 100.0;
    }
    for (const auto& pep : IT_PEPTIDES)
    {
      ms2(pep, 2, true, false, rt);
      rt += 100.0;
    }
    exp.sortSpectra(false);
    MzMLFile().store(path, exp);
  }

  void printExpect()
  {
    const int ftms2 = static_cast<int>(DUP_PEPTIDES.size()) * DUP_COPIES + static_cast<int>(SINGLE_PEPTIDES.size());
    const int itms2 = static_cast<int>(IT_PEPTIDES.size());
    std::printf("count_ms1 %d\ncount_ms1_FTMS %d\ncount_ms2 %d\ncount_ms2_FTMS %d\ncount_ms2_ITMS %d\n", MS1_COUNT,
                MS1_COUNT, ftms2 + itms2, ftms2, itms2);
    std::printf("precursor_charge_0 1\nprecursor_charge_2 %d\nprecursor_charge_3 2\n",
                static_cast<int>(DUP_PEPTIDES.size()) * DUP_COPIES + 1 + itms2);
    std::printf("resolution_FTMS_ms1 %.0f\nresolution_stated_FTMS_ms2 15000\n", MS1_R);
    std::printf("analyzer_source_run %d\n", static_cast<int>(SINGLE_PEPTIDES.size()));
    std::printf("redundancy_ms2 %d\nredundancy_in_clusters %d\nredundancy_clusters %d\nredundancy_largest %d\n",
                ftms2 + itms2, static_cast<int>(DUP_PEPTIDES.size()) * DUP_COPIES,
                static_cast<int>(DUP_PEPTIDES.size()), DUP_COPIES);
    std::printf("reporter_assessable_TMT %d\nreporter_TMT_low_mass_cutoff %d\n", ftms2, itms2);
    std::printf("reporter_compatible_kits tmt10plex,tmt11plex,tmt16plex,tmt18plex\n");
  }

  // ---- unit checks -----------------------------------------------------------

  void analyzers()
  {
    CHECK(Q::analyzerFromFilter("FTMS + p NSI Full ms [350.00-1800.00]") == Q::Analyzer::FTMS, "FTMS filter");
    CHECK(Q::analyzerFromFilter("ITMS + c NSI d Full ms2 445.12@cid35.00 [110.00-1000.00]") == Q::Analyzer::ITMS, "ITMS");
    CHECK(Q::analyzerFromFilter("  ASTMS + c NSI Full ms2") == Q::Analyzer::TOF, "Astral");
    CHECK(Q::analyzerFromFilter("TOFMS + p ESI Full ms") == Q::Analyzer::TOF, "TOF");
    CHECK(Q::analyzerFromFilter("TQMS + c NSI SRM ms2") == Q::Analyzer::OTHER, "TQMS other");
    CHECK(Q::analyzerFromFilter("") == Q::Analyzer::UNKNOWN, "empty filter");
    CHECK(Q::analyzerFromFilter("+ p NSI") == Q::Analyzer::UNKNOWN, "no analyser token");
    CHECK(Q::analyzerFromName("orbitrap") == Q::Analyzer::FTMS, "orbitrap");
    CHECK(Q::analyzerFromName("fourier transform ion cyclotron resonance mass spectrometer") == Q::Analyzer::FTMS, "FT-ICR");
    CHECK(Q::analyzerFromName("radial ejection linear ion trap") == Q::Analyzer::ITMS, "LIT");
    CHECK(Q::analyzerFromName("time-of-flight") == Q::Analyzer::TOF, "TOF name");
    CHECK(Q::analyzerFromName("quadrupole") == Q::Analyzer::OTHER, "quadrupole");
    CHECK(Q::analyzerFromName("") == Q::Analyzer::UNKNOWN, "no name");
    CHECK(Q::analyzerFromType(MassAnalyzer::AnalyzerType::ORBITRAP) == Q::Analyzer::FTMS, "type orbitrap");
    CHECK(Q::analyzerFromType(MassAnalyzer::AnalyzerType::LIT) == Q::Analyzer::ITMS, "type LIT");
    CHECK(Q::analyzerFromType(MassAnalyzer::AnalyzerType::TOF) == Q::Analyzer::TOF, "type TOF");
    CHECK(Q::analyzerFromType(MassAnalyzer::AnalyzerType::ANALYZERNULL) == Q::Analyzer::UNKNOWN, "type null");

    Q::InstrumentMap map;
    map.by_config = {{"IC1", Q::Analyzer::FTMS}, {"IC2", Q::Analyzer::ITMS}};
    map.default_config = "IC1";
    MSSpectrum s;
    s.setMSLevel(2);
    s.setMetaValue("filter string", "ITMS + c NSI d Full ms2 500.00@cid35.00 [135.00-2000.00]");
    Acquisition acq;
    acq.setMetaValue("instrument_configuration_ref", "IC1");
    s.getAcquisitionInfo().push_back(acq);
    Q::ScanFacts f = Q::factsOf(s, map);
    CHECK(f.analyzer == Q::Analyzer::ITMS && f.source == Q::Source::FILTER, "the filter wins over the configuration");
    s.removeMetaValue("filter string");
    s.getAcquisitionInfo()[0].setMetaValue("instrument_configuration_ref", "IC2");
    f = Q::factsOf(s, map);
    CHECK(f.analyzer == Q::Analyzer::ITMS && f.source == Q::Source::CONFIG, "the scan's configuration");
    s.setAcquisitionInfo(AcquisitionInfo());
    f = Q::factsOf(s, map);
    CHECK(f.analyzer == Q::Analyzer::FTMS && f.source == Q::Source::RUN, "the default configuration");
    f = Q::factsOf(s, Q::InstrumentMap{});
    CHECK(f.analyzer == Q::Analyzer::UNKNOWN && f.source == Q::Source::NONE, "nothing names an analyser");
    s.setMetaValue("mass resolving power", "60000");
    CHECK(Q::factsOf(s, map).stated_resolution == 60000.0f, "stated resolution from a string meta value");
    s.setMetaValue("mass resolving power", 30000);
    CHECK(Q::factsOf(s, map).stated_resolution == 30000.0f, "stated resolution from an int meta value");
    s.removeMetaValue("mass resolving power");
    s.setMetaValue("mass resolution", 7500.0);
    CHECK(Q::factsOf(s, map).stated_resolution == 7500.0f, "mass resolution as fallback");
    s.setMetaValue("mass resolution", "n/a");
    CHECK(std::isnan(Q::factsOf(s, map).stated_resolution), "unparseable resolution");
    Precursor pc;
    pc.setMZ(500.0);
    pc.setCharge(3);
    s.setPrecursors({pc, pc});
    ScanWindow w;
    w.begin = 135.0;
    w.end = 2000.0;
    s.getInstrumentSettings().getScanWindows().push_back(w);
    f = Q::factsOf(s, map);
    CHECK(f.charge == 3 && f.precursor_mz == 500.0 && f.n_precursors == 2 && f.scan_low == 135.0f, "precursor facts");
  }

  void resolution()
  {
    // R = m/z / FWHM, known by construction, at two resolutions.
    for (const double R : {60000.0, 15000.0})
    {
      const MSSpectrum s = gaussianProfile({{400.0, 400.0 / R}, {700.0, 700.0 / R}, {1100.0, 1100.0 / R}}, 1e4, 10.0);
      const auto pts = Q::measureResolution(s);
      CHECK(pts.size() == 3, "R %.0f: three peaks measured, got %zu", R, pts.size());
      for (const auto& p : pts)
        CHECK(std::fabs(p.resolution / R - 1.0) < 0.03, "R %.0f at %.1f: measured %.0f", R, p.mz, p.resolution);
    }
    // Exclusions.
    const double R = 30000.0, w = 600.0 / R;
    const MSSpectrum doublet = gaussianProfile({{600.0, w}, {600.0 + 1.2 * w, w}, {900.0, 900.0 / R}}, 1e4, 10.0);
    const auto d = Q::measureResolution(doublet);
    CHECK(d.size() == 1 && std::fabs(d[0].mz - 900.0) < 0.01, "an overlapping doublet is excluded, got %zu", d.size());
    const MSSpectrum under = gaussianProfile({{600.0, w}}, 1e4, 1.2);
    CHECK(Q::measureResolution(under).empty(), "an undersampled peak is excluded");
    const MSSpectrum weak = gaussianProfile({{600.0, w}, {900.0, 900.0 / R}}, 5.0, 10.0);
    CHECK(Q::measureResolution(weak).empty(), "a peak below 10x background is excluded");
    MSSpectrum centroid;
    for (int k = 0; k < 50; ++k) centroid.emplace_back(300.0 + 13.7 * k, 1000.0 + k);
    CHECK(Q::measureResolution(centroid).empty(), "centroids give nothing");
    CHECK(Q::bandOf(399.9) == 0 && Q::bandOf(400.0) == 1 && Q::bandOf(5000.0) == 4, "bands");
    CHECK(Q::bandName(1) == "mz400-800" && Q::bandName(4) == "mz2000+", "band names %s %s", Q::bandName(1).c_str(),
          Q::bandName(4).c_str());

    std::vector<Q::ScanFacts> facts(300);
    for (std::size_t i = 0; i < facts.size(); ++i)
    {
      facts[i].valid = true;
      facts[i].ms_level = i % 2 ? 2 : 1;
      facts[i].analyzer = Q::Analyzer::FTMS;
      facts[i].type = i % 2 ? 1 : 2;  // MS2 centroid, MS1 profile
    }
    const auto smp = Q::profileSamples(facts, 32);
    CHECK(smp.size() == 32, "32 samples of the profile class, got %zu", smp.size());
    CHECK(std::all_of(smp.begin(), smp.end(), [](std::size_t i) { return i % 2 == 0; }), "no centroid sampled");
    CHECK(smp.front() < 20 && smp.back() > 280, "spread over the run (%zu..%zu)", smp.front(), smp.back());
    CHECK(Q::profileSamples(facts, 32) == smp, "deterministic");
  }

  void reporters()
  {
    const Q::ReporterTable t;
    CHECK(t.mz.size() == 26, "18 TMT + 8 iTRAQ distinct channels, got %zu", t.mz.size());
    CHECK(t.kits.size() == 7, "seven kits");
    CHECK(std::find(t.label.begin(), t.label.end(), "127N") != t.label.end(), "TMT10 channel names");
    CHECK(std::fabs(t.family_low[0] - 126.127726) < 1e-4 && std::fabs(t.family_low[1] - 113.1078) < 1e-3,
          "family ranges %.4f %.4f", t.family_low[0], t.family_low[1]);
    const std::vector<double> ten = tmt10();
    CHECK(ten.size() == 10, "TMT10 channels");
    MSSpectrum s;
    for (int k = 0; k < 30; ++k) s.emplace_back(200.0 + 20.0 * k, 1000.0);
    for (const double m : ten) s.emplace_back(m, 5000.0);
    s.sortByPosition();
    std::uint32_t seen = Q::reportersSeen(s, t);
    std::uint32_t want = 0;
    for (const auto& k : t.kits)
      if (k.name == "tmt10plex") want = k.channels;
    CHECK(seen == want, "TMT10 reporters seen");
    MSSpectrum shifted;
    for (int k = 0; k < 30; ++k) shifted.emplace_back(200.0 + 20.0 * k, 1000.0);
    // 12 mDa off (~95 ppm), clear of every other channel (the N/C pairs are 6.3 mDa apart).
    for (const double m : ten) shifted.emplace_back(m + 0.012, 5000.0);
    CHECK(Q::reportersSeen(shifted, t) == 0, "12 mDa off is not a reporter");
    MSSpectrum edge;
    for (int k = 0; k < 30; ++k) edge.emplace_back(200.0 + 20.0 * k, 1000.0);
    edge.emplace_back(126.127726 * (1 + 19e-6), 5000.0);
    edge.emplace_back(126.127726 * (1 + 21e-6), 5000.0);
    CHECK(Q::reportersSeen(edge, t) == 1u, "19 ppm matches channel 126");
    MSSpectrum faint;
    for (int k = 0; k < 30; ++k) faint.emplace_back(200.0 + 20.0 * k, 1000.0);
    for (const double m : ten) faint.emplace_back(m, 2000.0);
    CHECK(Q::reportersSeen(faint, t) == 0, "below 3x the median is not a reporter");

    Q::ScanFacts f;
    f.valid = true;
    f.ms_level = 2;
    f.analyzer = Q::Analyzer::FTMS;
    f.scan_low = 110.0f;
    CHECK(Q::assessReporters(f, 110.5, t, 0) == Q::Assess::OK, "FTMS from 110: TMT assessable");
    CHECK(Q::assessReporters(f, 110.5, t, 1) == Q::Assess::OK, "FTMS from 110: iTRAQ assessable");
    f.scan_low = 120.0f;
    CHECK(Q::assessReporters(f, 125.0, t, 1) == Q::Assess::LOW_MASS_CUTOFF, "from 120: iTRAQ cut off");
    CHECK(Q::assessReporters(f, 125.0, t, 0) == Q::Assess::OK, "from 120: TMT assessable");
    f.scan_low = std::numeric_limits<float>::quiet_NaN();
    CHECK(Q::assessReporters(f, 140.0, t, 0) == Q::Assess::LOW_MASS_CUTOFF, "no window: the lowest peak decides");
    CHECK(Q::assessReporters(f, std::numeric_limits<double>::quiet_NaN(), t, 0) == Q::Assess::NO_PEAKS, "empty");
    f.analyzer = Q::Analyzer::ITMS;
    f.scan_low = 110.0f;
    CHECK(Q::assessReporters(f, 112.0, t, 0) == Q::Assess::ION_TRAP, "ion trap with low mass");
    f.scan_low = 160.0f;
    CHECK(Q::assessReporters(f, 162.0, t, 0) == Q::Assess::LOW_MASS_CUTOFF, "ion trap with the 1/3 cutoff");

    // Kit calls.
    const auto tally = [&](std::uint32_t channels, double share, std::uint64_t ok, std::uint64_t it) {
      Q::ReporterTally r;
      r.seen.assign(t.mz.size(), 0);
      for (std::size_t fam = 0; fam < 2; ++fam)
      {
        r.by_assess[fam][0] = ok;
        r.by_assess[fam][static_cast<std::size_t>(Q::Assess::ION_TRAP)] = it;
      }
      for (std::size_t c = 0; c < t.mz.size(); ++c)
        if (channels & (1u << c)) r.seen[c] = static_cast<std::uint64_t>(share * static_cast<double>(ok));
      return r;
    };
    const auto kit_mask = [&](const char* n) {
      for (const auto& k : t.kits)
        if (k.name == n) return k.channels;
      return 0u;
    };
    const auto state = [&](const Q::ReporterCall& c, const char* n) {
      for (std::size_t k = 0; k < t.kits.size(); ++k)
        if (t.kits[k].name == n) return c.kits[k].state;
      return std::string("?");
    };
    auto join = [](const std::vector<std::string>& v) {
      std::string s;
      for (const auto& x : v) s += (s.empty() ? "" : ",") + x;
      return s;
    };
    Q::ReporterCall c = Q::callReporters(tally(kit_mask("tmt10plex"), 0.9, 100, 0), t, 0);
    CHECK(join(c.compatible) == "tmt10plex,tmt11plex,tmt16plex,tmt18plex", "TMT10: %s", join(c.compatible).c_str());
    CHECK(state(c, "tmt6plex") == "absent" && state(c, "itraq4plex") == "absent", "TMT10: TMT6 and iTRAQ absent");
    c = Q::callReporters(tally(kit_mask("tmt6plex"), 0.9, 100, 0), t, 0);
    CHECK(join(c.compatible) == "tmt6plex,tmt10plex,tmt11plex,tmt16plex,tmt18plex", "TMT6 is ambiguous: %s",
          join(c.compatible).c_str());
    c = Q::callReporters(tally(kit_mask("tmt18plex"), 0.9, 100, 0), t, 0);
    CHECK(join(c.compatible) == "tmt18plex", "TMTpro 18: %s", join(c.compatible).c_str());
    c = Q::callReporters(tally(kit_mask("itraq4plex"), 0.9, 100, 0), t, 0);
    CHECK(join(c.compatible) == "itraq4plex,itraq8plex", "iTRAQ4: %s", join(c.compatible).c_str());
    c = Q::callReporters(tally(kit_mask("tmt10plex"), 0.1, 100, 0), t, 0);
    CHECK(c.compatible.empty() && state(c, "tmt10plex") == "absent", "seen in 10% only: absent");
    c = Q::callReporters(tally(0, 0, 100, 0), t, 0);
    CHECK(state(c, "tmt10plex") == "absent", "unlabelled: absent");
    c = Q::callReporters(tally(0, 0, 100, 0), t, 50);
    CHECK(state(c, "tmt10plex") == "not_assessable" && c.kits[1].reason == "sps_ms3_not_read", "MS3 run: %s %s",
          state(c, "tmt10plex").c_str(), c.kits[1].reason.c_str());
    c = Q::callReporters(tally(0, 0, 0, 500), t, 0);
    CHECK(state(c, "tmt10plex") == "not_assessable" && c.kits[1].reason == "ion_trap_ms2", "ion trap run: %s",
          c.kits[1].reason.c_str());
    c = Q::callReporters(tally(0, 0, 0, 0), t, 0);
    CHECK(c.kits[1].reason == "no_ms2", "no MS2: %s", c.kits[1].reason.c_str());
    c = Q::callReporters(tally(kit_mask("tmt10plex"), 0.9, 10, 1), t, 0);
    CHECK(c.kits[1].reason == "too_few_assessable_ms2", "10 assessable: %s", c.kits[1].reason.c_str());
  }

  Q::RedundancyRecord rec(std::size_t index, double mz, double rt, int z, const Q::Fingerprint& fp)
  {
    Q::RedundancyRecord r;
    r.index = index;
    r.mz = mz;
    r.rt = rt;
    r.charge = z;
    r.fp = fp;
    return r;
  }

  void redundancy()
  {
    const Q::ReporterTable t;
    std::mt19937 rng(3);
    MSSpectrum s = ladder("LGEYGFQNALIVR", 1e4, rng);
    const double pmz = precursorOf("LGEYGFQNALIVR", 2);
    s.emplace_back(126.127726, 1e6);  // reporter
    s.emplace_back(86.0964, 1e6);     // immonium L/I
    s.emplace_back(pmz, 1e6);         // precursor
    s.emplace_back(pmz - 18.0105646863 / 2, 1e6);  // precursor - water
    s.sortByPosition();
    const Q::Fingerprint fp = Q::fingerprint(s, pmz, 2, t, 0.02, false, 50);
    const auto has_bin = [&](double m) {
      const std::uint32_t b = static_cast<std::uint32_t>(std::lround(m / 1.0005079));
      return std::any_of(fp.begin(), fp.end(), [&](const auto& x) { return x.first == b; });
    };
    CHECK(!has_bin(126.127726) && !has_bin(86.0964) && !has_bin(pmz), "reporter, immonium, precursor removed");
    CHECK(fp.size() >= 20, "fragments kept: %zu", fp.size());
    double n2 = 0;
    for (const auto& x : fp) n2 += x.second * x.second;
    CHECK(std::fabs(n2 - 1.0) < 1e-5, "normalized");
    CHECK(Q::fingerprint(s, pmz, 2, t, 0.02, false, 5).size() <= 5, "top peaks bound");
    std::size_t m = 0;
    CHECK(std::fabs(Q::cosine(fp, fp, m) - 1.0) < 1e-5 && m == fp.size(), "self cosine");
    const Q::Fingerprint other = Q::fingerprint(ladder("VPQVSTPTLVEVSR", 1e4, rng), pmz, 2, t, 0.02, false, 50);
    CHECK(Q::cosine(fp, other, m) < 0.5, "unrelated peptides");

    Q::RedundancyRules R;
    // Three copies within 20 s, one 100 s later, a 60 s chain, rule breakers.
    std::vector<Q::RedundancyRecord> v;
    v.push_back(rec(0, 500.0, 100, 2, fp));
    v.push_back(rec(1, 500.0 * (1 + 3e-6), 110, 2, fp));
    v.push_back(rec(2, 500.0 * (1 - 3e-6), 120, 2, fp));
    v.push_back(rec(3, 500.0, 200, 2, fp));             // 100 s on: its own
    v.push_back(rec(4, 500.0, 105, 3, fp));             // other charge
    v.push_back(rec(5, 500.0 * (1 + 20e-6), 105, 2, fp));  // 20 ppm
    v.push_back(rec(6, 500.0, 106, 2, other));         // other fragments
    v.push_back(rec(7, 700.0, 1000, 2, fp));           // chain 1000, 1040, 1080
    v.push_back(rec(8, 700.0, 1040, 2, fp));
    v.push_back(rec(9, 700.0, 1080, 2, fp));
    Q::RedundancyResult r = Q::cluster(v, R, false);
    CHECK(r.spectra == 10 && r.clusters == 2 && r.in_clusters == 5 && r.largest == 3,
          "clusters %llu in %llu largest %llu", (unsigned long long)r.clusters, (unsigned long long)r.in_clusters,
          (unsigned long long)r.largest);
    CHECK(r.cluster_of[0] == r.cluster_of[1] && r.cluster_of[1] == r.cluster_of[2] && r.cluster_of[3] != r.cluster_of[0],
          "the 100 s copy stays apart");
    CHECK(r.cluster_of[7] == r.cluster_of[8] && r.cluster_of[9] != r.cluster_of[8], "the chain: span <= 60 s");
    // Any record order gives the same counts.
    std::vector<Q::RedundancyRecord> sh = v;
    std::shuffle(sh.begin(), sh.end(), rng);
    const Q::RedundancyResult r2 = Q::cluster(sh, R, false);
    CHECK(r2.clusters == r.clusters && r2.in_clusters == r.in_clusters && r2.largest == r.largest
              && r2.links == r.links, "order independent");
    // Mobility.
    std::vector<Q::RedundancyRecord> im = {rec(0, 500.0, 100, 2, fp), rec(1, 500.0, 101, 2, fp), rec(2, 500.0, 102, 2, fp)};
    im[0].im = 0.90f;
    im[1].im = 0.95f;  // 0.05 away
    CHECK(Q::cluster(im, R, false).clusters == 0, "1/K0 0.05 apart, or one without: no cluster");
    im[1].im = 0.91f;
    CHECK(Q::cluster(im, R, false).in_clusters == 2, "1/K0 within 0.02");
    // Too few matched bins.
    Q::Fingerprint few(fp.begin(), fp.begin() + 5);
    std::vector<Q::RedundancyRecord> fv = {rec(0, 500.0, 100, 2, few), rec(1, 500.0, 101, 2, few)};
    CHECK(Q::cluster(fv, R, false).clusters == 0, "5 shared bins are too few");
    // Tag-driven variant.
    std::vector<Q::RedundancyRecord> tv = {rec(0, 500.0, 100, 2, other), rec(1, 500.0, 101, 2, fp),
                                           rec(2, 500.0, 102, 2, fp)};
    tv[0].tagged = tv[1].tagged = true;
    tv[0].tag = tv[1].tag = "LGEY";
    const Q::RedundancyResult rt = Q::cluster(tv, R, true);
    CHECK(rt.clusters == 1 && rt.in_clusters == 2 && rt.cluster_of[0] == rt.cluster_of[1], "same best tag");
    tv[1].tag = "GEYG";
    CHECK(Q::cluster(tv, R, true).clusters == 0, "different tags");
    // The component cap.
    Q::RedundancyRules small = R;
    small.max_component = 2;
    const Q::RedundancyResult rc = Q::cluster(v, small, false);
    CHECK(rc.components_split >= 1 && rc.largest <= 2, "capped components (%llu split)",
          (unsigned long long)rc.components_split);
  }

  void collector()
  {
    // The same spectra through one thread in order and two threads out of order.
    std::mt19937 rng(5);
    std::vector<MSSpectrum> run;
    for (int k = 0; k < 40; ++k)
    {
      MSSpectrum s;
      if (k % 4 == 0)
      {
        s = gaussianProfile({{500.0, 500.0 / 40000.0}}, 1e4, 10.0, 400.0, 600.0);
        s.setMSLevel(1);
        s.setMetaValue("filter string", "FTMS + p NSI Full ms [350.00-1800.00]");
      }
      else
      {
        const std::string pep = k % 3 ? "AEFVEVTK" : "YLYEIAR";
        s = ladder(pep, 1e4, rng);
        s.sortByPosition();
        s.setMSLevel(2);
        Precursor pc;
        pc.setMZ(precursorOf(pep, 2));
        pc.setCharge(2);
        s.setPrecursors({pc});
        s.setMetaValue("filter string", "FTMS + c NSI d Full ms2 500.00@hcd30.00 [110.00-2000.00]");
      }
      s.setRT(10.0 + k);
      run.push_back(s);
    }
    const auto rows = [&](std::size_t threads, bool reverse) {
      Q::Collector c(run.size(), Q::InstrumentMap{}, threads, 0.02, false);
      for (std::size_t n = 0; n < run.size(); ++n)
      {
        const std::size_t i = reverse ? run.size() - 1 - n : n;
        c.scan(i % threads, i, run[i]);
        if (run[i].getMSLevel() == 2) c.ms2(i % threads, i, run[i], i % 5 ? 1e-4 : 1.0, "AEFV");
      }
      c.finish();
      for (const std::size_t i : c.profileSamples()) c.profile(i, run[i]);
      std::string out;
      for (const auto& r : c.rows(false)) out += r.key + "\t" + r.value + "\t" + r.n + "\n";
      return out;
    };
    const std::string one = rows(1, false), two = rows(2, true);
    CHECK(one == two, "thread and order independent rows");
    CHECK(one.find("count_ms1\t10\t") != std::string::npos && one.find("count_ms2_FTMS\t30\t") != std::string::npos,
          "counts");
    CHECK(one.find("resolution_source_FTMS_ms1\tmeasured") != std::string::npos, "MS1 resolution measured");
    CHECK(one.find("resolution_measured_FTMS_ms2\tn/a") != std::string::npos, "MS2 centroids: n/a");
    CHECK(one.find("ms2_tagged_e001\t24\t30") != std::string::npos, "tag yield count");
    if (failures) std::printf("%s", one.c_str());
  }
}

int main(int argc, char** argv)
{
  if (argc == 3 && std::strcmp(argv[1], "--write-mzml") == 0)
  {
    writeRun(argv[2]);
    return 0;
  }
  if (argc == 2 && std::strcmp(argv[1], "--expect") == 0)
  {
    printExpect();
    return 0;
  }
  analyzers();
  resolution();
  reporters();
  redundancy();
  collector();
  if (failures)
  {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("run_qc_test: all checks passed\n");
  return 0;
}
