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
//   kit decision       the label mass and the channels: one kit, the smallest
//                      consistent with both; reporters_only fallback; iTRAQ
//   channel counts     assessable MS2 with each reporter above the noise
//                      threshold, every channel of the family listed
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
#include <OpenMS/DATASTRUCTURES/DateTime.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Acquisition.h>
#include <OpenMS/METADATA/AcquisitionInfo.h>

#include <algorithm>
#include <bit>
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
          if (k.patterns.front() & (1u << c)) v.push_back(t.mz[c]);
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
    // Da tolerance (the CLI test's): the label call cannot be made, so the
    // reporters alone leave TMT10 or TMTpro16.
    std::printf("reporter_kit ambiguous\nreporter_kit_candidates tmt10plex,tmt16plex\n"
                "reporter_family_evidence reporters_only\nreporter_label_delta n/a\n");
    std::printf("reporter_channel_126 %d\nreporter_channel_127C %d\nreporter_channel_131N %d\n"
                "reporter_channel_131C 0\nreporter_channel_134N 0\n", ftms2, ftms2, ftms2);
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
      if (k.name == "tmt10plex") want = k.patterns.front();
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
        if (k.name == n) return k.patterns.front();
      return 0u;
    };
    // The original TMT 6-plex reagent (126, 127C, 128C, 129C, 130C, 131;
    // MSnbase TMT6, PXD000001), from the m/z, not from the kit's patterns.
    const auto mask_of = [&](std::initializer_list<double> mzs) {
      std::uint32_t m = 0;
      for (const double x : mzs)
        for (std::size_t c = 0; c < t.mz.size(); ++c)
          if (std::fabs(t.mz[c] - x) < 1e-4) m |= 1u << c;
      return m;
    };
    const std::uint32_t orig6 = mask_of({126.127725, 127.131079, 128.134433, 129.137787, 130.141141, 131.138176});
    CHECK(std::popcount(orig6) == 6, "original TMT6 channels are in the table: %d", std::popcount(orig6));
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
    c = Q::callReporters(tally(orig6, 0.9, 100, 0), t, 0);
    CHECK(join(c.compatible) == "tmt6plex,tmt10plex,tmt11plex,tmt16plex,tmt18plex",
          "original TMT6 (127C/129C): %s", join(c.compatible).c_str());
    c = Q::callReporters(tally(orig6 | kit_mask("tmt6plex"), 0.9, 100, 0), t, 0);
    CHECK(state(c, "tmt6plex") == "absent", "both TMT6 generations at once is not TMT6");
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

    // ---- the kit decision: what was seen, not what it could be ----
    const auto& keys = FASTag::Digest::labelKeys();
    const auto label = [&](std::initializer_list<const char*> pass) {
      Q::LabelEvidence ev;
      ev.counted = ev.called = true;
      ev.tags = 1000;
      for (std::size_t l = 0; l < keys.size(); ++l)
        for (const char* p : pass)
          if (std::string(keys[l].name) == p)
          {
            ev.passed[l] = true;
            ev.ends[l] = 400;
          }
      return ev;
    };
    const Q::LabelEvidence none_counted;
    Q::LabelEvidence few = label({});
    few.called = false;
    few.reason = "few_tags";
    const auto decide = [&](std::uint32_t channels, const Q::LabelEvidence& ev) {
      return Q::decideKit(Q::callReporters(tally(channels, 0.9, 100, 0), t, 0), t, ev);
    };
    const std::uint32_t c131C = kit_mask("tmt11plex") & ~kit_mask("tmt10plex");
    const std::uint32_t c134N = kit_mask("tmt18plex") & ~kit_mask("tmt16plex");
    Q::KitDecision d = decide(kit_mask("tmt10plex"), label({"TMT"}));
    CHECK(d.kit == "tmt10plex" && d.evidence == "label_mass" && join(d.candidates) == "tmt10plex" &&
              keys[static_cast<std::size_t>(d.label)].name == std::string("TMT"),
          "TMT10 channels + TMT label: %s %s [%s]", d.kit.c_str(), d.evidence.c_str(), join(d.candidates).c_str());
    d = decide(kit_mask("tmt10plex") | c131C, label({"TMT"}));
    CHECK(d.kit == "tmt11plex" && join(d.candidates) == "tmt11plex", "+131C: %s", d.kit.c_str());
    d = decide(kit_mask("tmt6plex"), label({"TMT"}));
    CHECK(d.kit == "tmt6plex", "TMT6 channels + TMT label: %s", d.kit.c_str());
    d = decide(orig6, label({"TMT"}));
    CHECK(d.kit == "tmt6plex" && d.evidence == "label_mass" && join(d.candidates) == "tmt6plex",
          "original TMT6 channels + TMT label: %s [%s]", d.kit.c_str(), join(d.candidates).c_str());
    d = decide(kit_mask("tmt16plex"), label({"TMTpro"}));
    CHECK(d.kit == "tmt16plex" && d.evidence == "label_mass", "TMTpro16: %s", d.kit.c_str());
    d = decide(kit_mask("tmt16plex") | c134N, label({"TMTpro"}));
    CHECK(d.kit == "tmt18plex" && join(d.candidates) == "tmt18plex", "TMTpro + 134N: %s", d.kit.c_str());
    d = decide(kit_mask("tmt10plex"), label({"TMTpro"}));
    CHECK(d.kit == "tmt16plex" && join(d.candidates) == "tmt16plex", "TMT10 channels + TMTpro label: %s [%s]",
          d.kit.c_str(), join(d.candidates).c_str());
    d = decide(kit_mask("tmt10plex"), none_counted);
    CHECK(d.kit == "ambiguous" && d.evidence == "reporters_only" && d.why == "not_counted" &&
              join(d.candidates) == "tmt10plex,tmt16plex",
          "TMT10 reporters only: %s %s %s [%s]", d.kit.c_str(), d.evidence.c_str(), d.why.c_str(),
          join(d.candidates).c_str());
    d = decide(kit_mask("tmt6plex"), few);
    CHECK(d.kit == "ambiguous" && d.why == "few_tags" && join(d.candidates) == "tmt6plex,tmt16plex",
          "TMT6 few tags: %s [%s]", d.why.c_str(), join(d.candidates).c_str());
    d = decide(kit_mask("tmt18plex"), none_counted);
    CHECK(d.kit == "tmt18plex" && d.evidence == "reporters_only" && join(d.candidates) == "tmt18plex",
          "TMTpro18 channels alone: %s %s", d.kit.c_str(), d.evidence.c_str());
    d = decide(kit_mask("tmt18plex"), label({"TMT"}));
    CHECK(d.kit == "conflict" && d.evidence == "label_conflict" && d.why == "label_conflict" &&
              join(d.candidates) == "tmt18plex" && d.label >= 0 &&
              keys[static_cast<std::size_t>(d.label)].name == std::string("TMT"),
          "TMT label, 134N seen: %s %s %s [%s]", d.kit.c_str(), d.evidence.c_str(), d.why.c_str(),
          join(d.candidates).c_str());
    d = decide(kit_mask("itraq8plex"), label({"iTRAQ4"}));
    CHECK(d.kit == "conflict" && d.evidence == "label_conflict" && join(d.candidates) == "itraq8plex" &&
              d.label >= 0 && keys[static_cast<std::size_t>(d.label)].name == std::string("iTRAQ4"),
          "iTRAQ4 label, 8-plex-only channels: %s %s [%s]", d.kit.c_str(), d.evidence.c_str(),
          join(d.candidates).c_str());
    d = decide(kit_mask("tmt10plex"), label({"TMT", "TMTpro"}));
    CHECK(d.kit == "ambiguous" && d.why == "several_labels", "two labels: %s %s", d.kit.c_str(), d.why.c_str());
    d = decide(kit_mask("tmt10plex"), label({"iTRAQ4"}));
    CHECK(d.kit == "ambiguous" && d.why == "no_label", "iTRAQ4 label with TMT reporters: %s %s", d.kit.c_str(),
          d.why.c_str());
    d = decide(kit_mask("itraq4plex"), label({"iTRAQ4"}));
    CHECK(d.kit == "itraq4plex" && d.evidence == "label_mass", "iTRAQ4: %s", d.kit.c_str());
    d = decide(kit_mask("itraq4plex"), label({"TMTpro"}));
    CHECK(d.kit == "itraq8plex" && d.evidence == "label_mass", "iTRAQ4 channels + 304.2 label: %s", d.kit.c_str());
    d = decide(kit_mask("itraq4plex"), none_counted);
    CHECK(d.kit == "ambiguous" && join(d.candidates) == "itraq4plex,itraq8plex", "iTRAQ4 reporters only: [%s]",
          join(d.candidates).c_str());
    d = decide(kit_mask("itraq8plex"), none_counted);
    CHECK(d.kit == "itraq8plex" && d.evidence == "reporters_only", "iTRAQ8 reporters only (113/119/121): %s",
          d.kit.c_str());
    d = decide(0, label({"TMT"}));
    CHECK(d.kit == "none" && d.evidence == "-" && d.candidates.empty(), "unlabelled: %s", d.kit.c_str());
    d = Q::decideKit(Q::callReporters(tally(0, 0, 0, 500), t, 0), t, label({"TMT"}));
    CHECK(d.kit == "not_assessable", "ion trap run: %s", d.kit.c_str());
    {
      // TMT assessed and absent, iTRAQ cut off: none, not "not_assessable".
      Q::ReporterTally r;
      r.seen.assign(t.mz.size(), 0);
      r.by_assess[0][0] = 100;
      r.by_assess[1][static_cast<std::size_t>(Q::Assess::LOW_MASS_CUTOFF)] = 100;
      d = Q::decideKit(Q::callReporters(r, t, 0), t, label({}));
      CHECK(d.kit == "none", "TMT absent, iTRAQ cut off: %s", d.kit.c_str());
    }
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
    CHECK(one.find("qc_version\t3\t-\ninstrument_model\tn/a\t-\ninstrument_serial_number\tn/a\t-\n"
                   "start_timestamp\tn/a\t-\nspectra_input\t") != std::string::npos,
          "run metadata rows follow qc_version, n/a when not set");
    if (failures) std::printf("%s", one.c_str());
  }
}

// Channel counts: assessable MS2 with each reporter above the noise threshold.
void channelCounts()
{
  const Q::ReporterTable t;
  const auto mzOf = [&](const char* lab) {
    for (std::size_t c = 0; c < t.mz.size(); ++c)
      if (t.label[c] == lab) return t.mz[c];
    return 0.0;
  };
  // 25 FTMS MS2 from 110: 126 and 129N in all at 5x the background, 127N in
  // 10, 131C in 3 (counted, below the 20% share for "observed"), 128C in all
  // at 2x (below the 3x threshold: never counted).
  std::vector<MSSpectrum> run;
  for (int k = 0; k < 25; ++k)
  {
    MSSpectrum s;
    for (int j = 0; j < 30; ++j) s.emplace_back(200.0 + 20.0 * j, 1000.0);
    s.emplace_back(mzOf("126"), 5000.0);
    s.emplace_back(mzOf("129N"), 5000.0);
    s.emplace_back(mzOf("128C"), 2000.0);
    if (k < 10) s.emplace_back(mzOf("127N"), 5000.0);
    if (k < 3) s.emplace_back(mzOf("131C"), 5000.0);
    s.sortByPosition();
    s.setMSLevel(2);
    s.setRT(10.0 + k);
    s.setMetaValue("filter string", "FTMS + c NSI d Full ms2 500.00@hcd30.00 [110.00-2000.00]");
    ScanWindow w;
    w.begin = 110.0;
    w.end = 2000.0;
    s.getInstrumentSettings().getScanWindows().push_back(w);
    run.push_back(s);
  }
  const auto rows = [&](const Q::LabelEvidence* ev) {
    Q::Collector c(run.size(), Q::InstrumentMap{}, 1, 0.02, false);
    for (std::size_t i = 0; i < run.size(); ++i)
    {
      c.scan(0, i, run[i]);
      c.ms2(0, i, run[i], 1.0, "");
    }
    c.finish();
    if (ev) c.setLabelEvidence(*ev);
    std::map<std::string, std::pair<std::string, std::string>> got;
    for (const auto& r : c.rows(false)) got[r.key] = {r.value, r.n};
    return got;
  };
  auto got = rows(nullptr);
  CHECK(got["reporter_kit"].first == "ambiguous", "reporters only: %s", got["reporter_kit"].first.c_str());
  CHECK(got["reporter_kit_candidates"].first == "tmt6plex,tmt16plex", "candidates %s",
        got["reporter_kit_candidates"].first.c_str());
  CHECK(got["reporter_family_evidence"].first == "reporters_only", "evidence");
  CHECK(got["reporter_label_delta"].first == "n/a", "no label delta");
  CHECK(got["reporter_channel_126"] == std::make_pair(std::string("25"), std::string("25")), "126: %s/%s",
        got["reporter_channel_126"].first.c_str(), got["reporter_channel_126"].second.c_str());
  CHECK(got["reporter_channel_127N"].first == "10" && got["reporter_channel_127N_share"].first == "0.4000",
        "127N: %s %s", got["reporter_channel_127N"].first.c_str(), got["reporter_channel_127N_share"].first.c_str());
  CHECK(got["reporter_channel_131C"].first == "3", "131C below the share is still counted: %s",
        got["reporter_channel_131C"].first.c_str());
  CHECK(got["reporter_channel_128C"].first == "0", "128C below 3x the median is not counted: %s",
        got["reporter_channel_128C"].first.c_str());
  CHECK(got["reporter_channel_135N"].first == "0", "every TMT/TMTpro channel listed without a label decision");
  CHECK(!got.count("reporter_channel_113"), "no iTRAQ channel rows");
  int n_chan = 0;
  for (const auto& [k, v] : got)
    if (k.rfind("reporter_channel_", 0) == 0 && k.find("_share") == std::string::npos) ++n_chan;
  CHECK(n_chan == 18, "18 TMT/TMTpro channels, got %d", n_chan);

  // The TMT label decides: tmt6plex; the channels of TMT 6/10/11 only.
  Q::LabelEvidence ev;
  ev.counted = ev.called = true;
  ev.tags = 900;
  ev.ends[0] = 300;
  ev.background[0] = 2;
  ev.passed[0] = true;  // labelKeys()[0] is TMT
  got = rows(&ev);
  CHECK(got["reporter_kit"].first == "tmt6plex" && got["reporter_kit"].second == "25", "TMT label: %s",
        got["reporter_kit"].first.c_str());
  CHECK(got["reporter_kit_candidates"].first == "tmt6plex", "one candidate");
  CHECK(got["reporter_family_evidence"] == std::make_pair(std::string("label_mass"), std::string("300")),
        "label_mass with its support: %s %s", got["reporter_family_evidence"].first.c_str(),
        got["reporter_family_evidence"].second.c_str());
  CHECK(got["reporter_label_delta"] == std::make_pair(std::string("229.162932"), std::string("900")), "delta %s",
        got["reporter_label_delta"].first.c_str());
  CHECK(got.count("reporter_channel_131C") && !got.count("reporter_channel_132N") && !got.count("reporter_channel_135N"),
        "TMT: channels of TMT 6/10/11 only");
  n_chan = 0;
  for (const auto& [k, v] : got)
    if (k.rfind("reporter_channel_", 0) == 0 && k.find("_share") == std::string::npos) ++n_chan;
  CHECK(n_chan == 11, "11 TMT channels, got %d", n_chan);

  // labelEvidence(): the -label_out call over tag-end counts.
  FASTag::Digest::DigestSettings ds;
  FASTag::Digest::TerminusCounter tc(ds.window);
  // 300 tryptic tags (C-terminal K/R ends), 120 of them with a TMT N-terminal flank.
  for (int k = 0; k < 300; ++k)
    tc.add(k < 120 ? 229.162932 : 1000.0 + k, 128.09496, "PEPTIDE");
  const Q::LabelEvidence le = Q::labelEvidence(tc, ds);
  CHECK(le.counted && le.called && le.passed[0] && !le.passed[1] && le.ends[0] == 120, "labelEvidence: TMT %d %d %llu",
        (int)le.called, (int)le.passed[0], (unsigned long long)le.ends[0]);
  ds.low_resolution = true;
  const Q::LabelEvidence lr = Q::labelEvidence(tc, ds);
  CHECK(lr.counted && !lr.called && lr.reason == "low_resolution", "labelEvidence: Da tolerance");
  CHECK(!lr.da_tagged, "labelEvidence: a Da tolerance is not da_tagged");
  // 1.16.3: a ppm run whose tags mostly come from ion-trap MS2 tagged at 0.5 Da.
  ds.low_resolution = false;
  CHECK(le.names[1] == "TMTpro/iTRAQ8" && le.names[0] == "TMT", "labelEvidence: label_call names %s", le.names[1].c_str());
  FASTag::Digest::TerminusCounter tc_da = tc;
  tc_da.tags_da = 151;  // of 300
  const Q::LabelEvidence ld = Q::labelEvidence(tc_da, ds);
  CHECK(ld.counted && !ld.called && ld.reason == "low_resolution" && ld.da_tagged, "labelEvidence: mostly Da-tagged");
  tc_da.tags_da = 150;
  CHECK(Q::labelEvidence(tc_da, ds).called, "labelEvidence: half Da-tagged still calls");
}

// Run metadata: what OpenMS's readers put into ExperimentalSettings.
void runInfo()
{
  {
    // mzML: the PSI-MS name, MS:1000529, a startTimeStamp of 19 characters
    // (MzMLHandler keeps no "mzml_start_time_stamp" then).
    ExperimentalSettings es;
    es.getInstrument().setName("Q Exactive");
    es.getInstrument().setMetaValue("instrument serial number", " Exactive Series slot #1 ");
    es.setDateTime(DateTime::fromString("2016-03-01T09:08:07", "yyyy-MM-ddThh:mm:ss"));
    const Q::RunInfo r = Q::runInfoOf(es);
    CHECK(r.model == "Q Exactive", "model from the PSI-MS name");
    CHECK(r.serial == "Exactive Series slot #1", "serial trimmed");
    CHECK(r.start_time == "2016-03-01T09:08:07", "start from DateTime");
  }
  {
    // Thermo / Bruker: the stamp as written wins; an unnamed model falls back to the vendor string.
    ExperimentalSettings es;
    es.getInstrument().setName("instrument model");
    es.getInstrument().setModel("Orbitrap Exploris 480");
    es.setDateTime(DateTime::fromString("2023-09-19T13:29:04", "yyyy-MM-ddThh:mm:ss"));
    es.setMetaValue("mzml_start_time_stamp", "2023-09-19T13:29:04.090-04:00");
    const Q::RunInfo r = Q::runInfoOf(es);
    CHECK(r.model == "Orbitrap Exploris 480", "model from the vendor string");
    CHECK(r.serial.empty(), "no serial");
    CHECK(r.start_time == "2023-09-19T13:29:04.090-04:00", "start as written");
  }
  {
    // A vendor parent term: the vendor string wins when there is one, else the term stays.
    ExperimentalSettings es;
    es.getInstrument().setName("Thermo Fisher Scientific instrument model");
    es.getInstrument().setModel("Q Exactive Plus");
    CHECK(Q::runInfoOf(es).model == "Q Exactive Plus", "vendor string over a parent term");
    es.getInstrument().setModel("");
    CHECK(Q::runInfoOf(es).model == "Thermo Fisher Scientific instrument model", "parent term kept without a vendor string");
    es.getInstrument().setName("instrument model");
    CHECK(Q::runInfoOf(es).model.empty(), "the bare root term is no model");
  }
  {
    const Q::RunInfo r = Q::runInfoOf(ExperimentalSettings());
    CHECK(r.model.empty() && r.serial.empty() && r.start_time.empty(), "nothing stated");
  }
  {
    Q::Collector c(0, Q::InstrumentMap{}, 1, 0.02, false);
    c.setRunInfo({"LTQ Orbitrap Velos", "", "2012-02-06T19:52:53Z"}, "MGF carries no run metadata");
    c.finish();
    std::map<std::string, std::pair<std::string, std::string>> got;
    for (const auto& r : c.rows(false)) got[r.key] = {r.value, r.description};
    CHECK(got["instrument_model"].first == "LTQ Orbitrap Velos", "model row");
    CHECK(got["instrument_serial_number"].first == "n/a", "serial row n/a");
    CHECK(got["instrument_serial_number"].second.find("MGF carries no run metadata") != std::string::npos,
          "n/a row says why");
    CHECK(got["start_timestamp"].first == "2012-02-06T19:52:53Z", "start row");
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
  channelCounts();
  runInfo();
  if (failures)
  {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("run_qc_test: all checks passed\n");
  return 0;
}
