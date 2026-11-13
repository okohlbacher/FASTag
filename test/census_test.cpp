// Census (src/Census.h): the per-spectrum status, its precedence on synthetic
// spectra run through the real tagger, the Gini coefficient, the best tag
// (minimum E-value, not the first row), the interval-union tag_cover, the row
// and summary formatting, tab escaping and the tally invariant.
//
// Every check here was mutation-checked: the rule it names was broken on
// purpose and the check confirmed to fail.
//
// With arguments it is also a helper for census_cli_test.sh:
//   census_test --sampled-ms2 <mzML> <n_want> <seed>
// prints the input indices of the MS2 spectra that -subsample_spectra n_want
// -subsample_seed seed selects, one per line. The mask is FASTag's own
// sampleByCount (std::uniform_int_distribution is library-specific, so a
// script cannot reproduce it); the MS levels come from OpenMS's MzMLFile, not
// from FASTag's reader, so the expectation is independent of the code under
// test.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Census.h"
#include "CliParam.h"
#include "FASTagger.h"
#include "SpectrumSampler.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <random>
#include <string>
#include <vector>

using namespace OpenMS;
namespace C = FASTag::Census;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  /// Singly charged b and y ions of @p pep; the precursor is 2+.
  MSSpectrum ladder(const std::string& pep, double& prec_mz)
  {
    const AASequence aa = AASequence::fromString(pep);
    prec_mz = (aa.getMonoWeight() + 2 * Constants::PROTON_MASS_U) / 2;
    MSSpectrum s;
    std::mt19937 rng(11);
    std::uniform_real_distribution<double> hi(0.6, 1.0);
    for (size_t i = 1; i < aa.size(); ++i)
    {
      s.emplace_back(aa.getPrefix(i).getMonoWeight(Residue::BIon, 1), hi(rng));
      s.emplace_back(aa.getSuffix(i).getMonoWeight(Residue::YIon, 1), hi(rng));
    }
    s.sortByPosition();
    return s;
  }

  /// The census row of one MS2 spectrum as FASTag.cpp builds it, without a
  /// FASTA filter and with or without counting placements.
  C::Row census(const MSSpectrum& s, double prec_mz, bool has_prec, int charge,
                const FASTag::Param& p, const FASTag::Tables& tab,
                std::size_t n_placed = 0, bool count_placed = false)
  {
    C::Row r;
    C::Facts f;
    f.empty = s.empty();
    f.has_precursor = has_prec;
    const C::Signal sig = C::signal(s);
    r.n_peaks = f.n_peaks = sig.n_peaks;
    r.has_gini = sig.has_gini;
    r.gini = sig.gini;
    f.precursor_mz = prec_mz;
    std::vector<FASTag::Tag> tags;
    if (!f.empty && has_prec)
    {
      FASTag::SpectrumDiag d;
      tags = FASTag::tagSpectrum(s, prec_mz, charge, p, tab, &d);
      f.enough_peaks = d.enough_peaks;
      r.prepared = d.prepared;
      r.n_kept = d.n_kept;
      r.n_edges = d.n_edges;
      r.n_compl = d.n_compl;
    }
    f.n_found = f.n_reported = r.n_found = r.n_reported = tags.size();
    f.n_placed = n_placed;
    f.count_placements = count_placed;
    r.status = C::classify(f);
    return r;
  }
}

static int sampledMs2(int argc, char** argv)
{
  if (argc != 5) { std::fprintf(stderr, "usage: census_test --sampled-ms2 <mzML> <n> <seed>\n"); return 2; }
  PeakMap exp;
  MzMLFile().load(argv[2], exp);
  const auto mask = FASTag::sampleByCount(exp.size(), std::strtoull(argv[3], nullptr, 10),
                                          static_cast<uint32_t>(std::strtoul(argv[4], nullptr, 10)));
  for (size_t i = 0; i < exp.size(); ++i)
    if (mask[i] && exp[i].getMSLevel() == 2) std::printf("%zu\n", i);
  return 0;
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::string(argv[1]) == "--sampled-ms2") return sampledMs2(argc, argv);

  const FASTag::Param p = FASTag::cliDefaultParam();
  const FASTag::Tables tab(p);
  const double nan = std::numeric_limits<double>::quiet_NaN();

  // 1. Status precedence on synthetic spectra through the real tagger.
  {
    double pmz = 0;
    const MSSpectrum clean = ladder("VGAHAGEYGAEALER", pmz);

    MSSpectrum empty;
    CHECK(census(empty, pmz, true, 2, p, tab).status == C::Status::EMPTY, "an empty MS2 is not 'empty'");
    // Empty wins over a missing precursor: the gate tests spec.empty() first.
    CHECK(census(empty, pmz, false, 2, p, tab).status == C::Status::EMPTY, "empty without precursor is not 'empty'");
    CHECK(census(clean, pmz, false, 2, p, tab).status == C::Status::NO_PRECURSOR, "no precursor is not 'no_precursor'");

    MSSpectrum zero = clean;
    for (auto& pk : zero) pk.setIntensity(0.0f);
    CHECK(census(zero, pmz, true, 2, p, tab).status == C::Status::NO_SIGNAL, "all-zero intensities are not 'no_signal'");
    MSSpectrum nanint = clean;
    for (auto& pk : nanint) pk.setIntensity(std::numeric_limits<float>::quiet_NaN());
    CHECK(census(nanint, pmz, true, 2, p, tab).status == C::Status::NO_SIGNAL, "all-NaN intensities are not 'no_signal'");
    // no_signal comes before bad_precursor.
    CHECK(census(zero, nan, true, 2, p, tab).status == C::Status::NO_SIGNAL, "no_signal does not precede bad_precursor");

    CHECK(census(clean, nan, true, 2, p, tab).status == C::Status::BAD_PRECURSOR, "a NaN precursor is not 'bad_precursor'");
    CHECK(census(clean, -5.0, true, 2, p, tab).status == C::Status::BAD_PRECURSOR, "a negative precursor is not 'bad_precursor'");
    CHECK(census(clean, 0.0, true, 2, p, tab).status == C::Status::BAD_PRECURSOR, "a zero precursor is not 'bad_precursor'");

    MSSpectrum two;
    two.emplace_back(300.1, 10.0f);
    two.emplace_back(400.2, 20.0f);
    const C::Row r2 = census(two, pmz, true, 2, p, tab);
    CHECK(r2.status == C::Status::TOO_FEW_PEAKS, "2 peaks are not 'too_few_peaks' (status %s)", C::name(r2.status));
    CHECK(r2.prepared && r2.n_kept == 2 && r2.n_edges == 0, "2-peak diag: prepared %d kept %zu edges %zu",
          int(r2.prepared), r2.n_kept, r2.n_edges);

    // Noise: peaks no residue mass connects (a 1.5 Th grid) give graphs but no tag.
    MSSpectrum noise;
    for (int i = 0; i < 40; ++i) noise.emplace_back(200.0 + 1.5 * i + 0.0001 * i * i, 1.0f + float(i % 7));
    const C::Row rn = census(noise, pmz, true, 2, p, tab);
    CHECK(rn.status == C::Status::NO_TAGS, "noise is not 'no_tags' (status %s, %zu found)", C::name(rn.status), rn.n_found);
    CHECK(rn.prepared && rn.n_kept >= 3, "noise was not prepared");

    const C::Row rc = census(clean, pmz, true, 2, p, tab);
    CHECK(rc.status == C::Status::TAGGED, "a clean y ladder is not 'tagged' (status %s)", C::name(rc.status));
    CHECK(rc.n_edges > 0 && rc.n_compl > 0, "clean ladder: edges %zu compl %zu", rc.n_edges, rc.n_compl);

    // Placements count only with -recon_out, and then win over tagged.
    CHECK(census(clean, pmz, true, 2, p, tab, 3, true).status == C::Status::PLACED, "placed does not precede tagged");
    CHECK(census(clean, pmz, true, 2, p, tab, 0, true).status == C::Status::TAGGED, "no placement is not tagged");
    CHECK(census(clean, pmz, true, 2, p, tab, 3, false).status == C::Status::TAGGED,
          "placements counted without -recon_out");

    // filtered: found but none reported.
    C::Facts f;
    f.has_precursor = true; f.n_peaks = 20; f.precursor_mz = 500; f.enough_peaks = true;
    f.n_found = 4; f.n_reported = 0;
    CHECK(C::classify(f) == C::Status::FILTERED, "found-but-unreported is not 'filtered'");
    f.n_reported = 1;
    CHECK(C::classify(f) == C::Status::TAGGED, "one reported row is not 'tagged'");
    std::printf("1. status precedence on synthetic spectra\n");
  }

  // 2. Which statuses the tagger processes (counted in n_ms2), and the names.
  {
    const char* want[] = {"empty", "no_precursor", "no_signal", "bad_precursor", "too_few_peaks",
                          "no_tags", "filtered", "placed", "tagged"};
    CHECK(C::STATUS_COUNT == 9, "status count %zu", C::STATUS_COUNT);
    for (size_t i = 0; i < C::STATUS_COUNT; ++i)
    {
      const auto s = static_cast<C::Status>(i);
      CHECK(std::string(C::name(s)) == want[i], "status %zu is named %s", i, C::name(s));
      CHECK(C::processed(s) == (i >= 2), "processed(%s) wrong", C::name(s));
    }
    std::printf("2. status names and the processed set\n");
  }

  // 3. Gini.
  {
    std::vector<double> eq(10, 3.5);  // gini() is a template: doubles here, floats in signal()
    CHECK(std::fabs(C::gini(eq)) < 1e-12, "Gini of equal intensities is %g", C::gini(eq));
    for (size_t n : {2u, 5u, 40u})
    {
      std::vector<double> one(n, 0.0);
      one[n / 2] = 7.0;
      const double g = C::gini(one);
      CHECK(std::fabs(g - (1.0 - 1.0 / double(n))) < 1e-12, "Gini of one non-zero peak among %zu is %g", n, g);
    }
    std::vector<double> lin = {1, 2, 3, 4};  // (2*(1+4+9+16))/(4*10) - 5/4 = 0.25
    CHECK(std::fabs(C::gini(lin) - 0.25) < 1e-12, "Gini of 1..4 is %g", C::gini(lin));
    // Through signal(): zeros are part of the population, NaN and negatives are not.
    MSSpectrum s;
    s.emplace_back(100, 0.0f); s.emplace_back(200, 0.0f); s.emplace_back(300, 9.0f);
    s.emplace_back(400, std::numeric_limits<float>::quiet_NaN()); s.emplace_back(500, -1.0f);
    const C::Signal sig = C::signal(s);
    CHECK(sig.n_peaks == 1, "positive peaks %zu", sig.n_peaks);
    CHECK(sig.has_gini && std::fabs(sig.gini - 2.0 / 3.0) < 1e-12, "signal Gini %g", sig.gini);
    MSSpectrum z;
    z.emplace_back(100, 0.0f);
    CHECK(!C::signal(z).has_gini, "an all-zero spectrum has a Gini");
    // The radix sort equals std::sort, ties, zeros (-0.0 stored as +0.0),
    // denormals and the full float range included, above and below its cutoff.
    std::mt19937 rng(3);
    for (size_t n : {5u, 127u, 128u, 1000u, 4099u})
    {
      std::vector<float> v(n);
      std::uniform_real_distribution<float> u(0.0f, 1e6f);
      for (size_t i = 0; i < n; ++i)
        v[i] = i % 9 == 0 ? 0.0f : i % 13 == 0 ? 1e-40f : i % 17 == 0 ? 3.0e38f : i % 5 == 0 ? 42.0f : u(rng);
      std::vector<float> want = v;
      std::sort(want.begin(), want.end());
      C::sortNonNegative(v);
      CHECK(v == want, "sortNonNegative differs from std::sort at n = %zu", n);
      std::vector<double> d(want.begin(), want.end());
      std::vector<float> f = want;
      std::shuffle(f.begin(), f.end(), rng);
      CHECK(C::gini(f) == C::gini(d), "float and double Gini differ at n = %zu", n);
    }
    MSSpectrum negz;
    for (int i = 0; i < 300; ++i) negz.emplace_back(100 + i, i % 2 ? -0.0f : float(i));
    std::vector<double> ref;
    for (int i = 0; i < 300; ++i) ref.push_back(i % 2 ? 0.0 : double(i));
    CHECK(C::signal(negz).gini == C::gini(ref), "-0.0 intensities break the Gini");
    std::printf("3. Gini\n");
  }

  // 4. bestTag: the minimum E-value, ties to the first output position, the
  //    rows themselves untouched.
  {
    auto tv = [](double e, size_t len, double lo) {
      C::TagView t;
      t.evalue = e; t.n_res = len; t.low_mz = lo; t.high_mz = lo + 100; t.peak_tic = 1;
      return t;
    };
    // -tag_lengths 3,5: the length-3 rows come first, a length-5 row is best.
    const std::vector<C::TagView> rows = {tv(0.5, 3, 200), tv(0.02, 3, 300), tv(0.9, 3, 250),
                                          tv(0.001, 5, 400), tv(0.3, 5, 220)};
    CHECK(C::bestTag(rows) == 3, "best tag is row %zu, not the length-5 row 3", C::bestTag(rows));
    const std::vector<C::TagView> tie = {tv(0.1, 3, 200), tv(0.01, 3, 300), tv(0.01, 5, 100)};
    CHECK(C::bestTag(tie) == 1, "a tie went to row %zu, not the first (1)", C::bestTag(tie));
    CHECK(C::bestTag({}) == C::NO_INDEX, "no rows has a best tag");
    CHECK(rows[0].evalue == 0.5 && rows[3].n_res == 5, "bestTag reordered its input");
    std::printf("4. best tag by minimum E-value\n");
  }

  // 5. tag_cover: the union of [low_mz, high_mz].
  {
    CHECK(std::fabs(C::tagCover({{100, 200}, {300, 350}}) - 150) < 1e-9, "disjoint cover");
    CHECK(std::fabs(C::tagCover({{100, 200}, {150, 260}}) - 160) < 1e-9, "overlapping cover");
    CHECK(std::fabs(C::tagCover({{100, 400}, {150, 260}, {120, 130}}) - 300) < 1e-9, "nested cover");
    CHECK(std::fabs(C::tagCover({{300, 350}, {100, 200}, {190, 210}}) - 160) < 1e-9, "unsorted cover");
    CHECK(C::tagCover({}) == 0.0, "empty cover");
    std::vector<C::TagView> rows(3);
    rows[0].low_mz = 300; rows[0].high_mz = 350;
    rows[1].low_mz = 100; rows[1].high_mz = 200;
    rows[2].low_mz = 190; rows[2].high_mz = 210;
    CHECK(std::fabs(C::tagCoverOf(rows) - 160) < 1e-9 && std::fabs(C::tagCoverOf(rows) - 160) < 1e-9,
          "tagCoverOf the rows (twice: the scratch list is reset)");
    std::printf("5. tag_cover\n");
  }

  // 6. Rows: 20 fields, tab escaping, empty fields where nothing was computed.
  {
    auto fields = [](const std::string& line) {
      std::vector<std::string> f(1);
      for (char c : line)
      {
        if (c == '\t') f.emplace_back();
        else if (c != '\n') f.back() += c;
      }
      return f;
    };
    const auto hdr = fields(C::header());
    CHECK(hdr.size() == 20, "header has %zu fields", hdr.size());
    CHECK(hdr[0] == "index" && hdr[1] == "spectrum" && hdr[11] == "status" && hdr[19] == "tag_cover",
          "header columns out of place");

    double pmz = 0;
    const MSSpectrum clean = ladder("VGAHAGEYGAEALER", pmz);
    C::Row r = census(clean, pmz, true, 2, p, tab);
    r.index = 17; r.has_precursor = true; r.precursor_mz = pmz; r.charge_given = 0; r.charge_used = 2;
    std::string line;
    C::appendRow(line, r, "scan=1\tx\ny");
    const auto f = fields(line);
    CHECK(line.back() == '\n' && std::count(line.begin(), line.end(), '\n') == 1, "row is not one line");
    CHECK(f.size() == 20, "row has %zu fields", f.size());
    CHECK(f[1] == "scan=1 x y", "native id not escaped: '%s'", f[1].c_str());
    CHECK(f[0] == "17" && f[4] == "0" && f[5] == "2" && f[11] == "tagged", "row values wrong");
    CHECK(f[14].empty(), "best_evalue written without a best tag");

    C::Row e;
    e.status = C::Status::NO_PRECURSOR;
    e.index = 3;
    std::string le;
    C::appendRow(le, e, "s");
    const auto fe = fields(le);
    CHECK(fe.size() == 20 && fe[3].empty() && fe[4].empty() && fe[5].empty() && fe[7].empty()
              && fe[12].empty() && fe[13].empty(),
          "no_precursor row writes precursor or tagger fields");
    std::printf("6. rows\n");
  }

  // 7. Tally: counts, the processed sum, shares and quantiles in the summary.
  {
    C::Tally a, b;
    auto row = [](C::Status s, int charge, double best) {
      C::Row r;
      r.status = s;
      r.has_precursor = s != C::Status::NO_PRECURSOR;
      r.charge_given = charge;
      r.prepared = C::processed(s) && s != C::Status::BAD_PRECURSOR && s != C::Status::NO_SIGNAL;
      r.n_kept = 10;
      r.has_gini = C::processed(s);
      r.gini = 0.5;
      r.has_best = s == C::Status::TAGGED || s == C::Status::PLACED;
      r.best.evalue = best;
      return r;
    };
    a.add(row(C::Status::EMPTY, 2, 0));
    a.add(row(C::Status::TAGGED, 0, 0.1));
    b.add(row(C::Status::PLACED, 2, 0.3));
    b.add(row(C::Status::NO_TAGS, 3, 0));
    b.add(row(C::Status::NO_PRECURSOR, 0, 0));
    a.merge(b);
    CHECK(a.ms2_seen == 5 && a.n_processed() == 3 && a.no_charge == 1, "tally seen %llu processed %llu no_charge %llu",
          (unsigned long long)a.ms2_seen, (unsigned long long)a.n_processed(), (unsigned long long)a.no_charge);
    const auto rows = C::summaryRows(a, 12, false);
    auto find = [&](const std::string& key) -> const FASTag::Digest::Row* {
      for (const auto& r : rows) if (r.key == key) return &r;
      return nullptr;
    };
    for (const auto& r : rows) CHECK(r.section == "census", "row %s not in section census", r.key.c_str());
    CHECK(find("census_version") && find("census_version")->value == "1", "census_version");
    CHECK(find("input_spectra") && find("input_spectra")->value == "12", "input_spectra");
    CHECK(find("ms2_seen") && find("ms2_seen")->value == "5", "ms2_seen");
    CHECK(find("ms2_processed") && find("ms2_processed")->value == "3", "ms2_processed");
    CHECK(find("ms2_total") && find("ms2_total")->value == "5", "ms2_total without subsampling");
    CHECK(find("subsampled") && find("subsampled")->value == "0", "subsampled");
    for (size_t i = 0; i < C::STATUS_COUNT; ++i)
    {
      const std::string nm = C::name(static_cast<C::Status>(i));
      CHECK(find("count_" + nm) && find("share_" + nm), "status %s missing", nm.c_str());
    }
    CHECK(find("count_tagged")->value == "1" && find("share_tagged")->value == "0.2", "tagged count/share %s %s",
          find("count_tagged")->value.c_str(), find("share_tagged")->value.c_str());
    // p50 of best E-values {0.1, 0.3} is 0.2 (linear interpolation).
    CHECK(find("best_evalue_p50") && std::fabs(std::atof(find("best_evalue_p50")->value.c_str()) - 0.2) < 1e-12,
          "best_evalue_p50");
    CHECK(find("best_evalue_p50")->n == "2", "best_evalue_p50 n");
    const auto sub = C::summaryRows(a, 12, true);
    for (const auto& r : sub)
    {
      if (r.key == "ms2_total") CHECK(r.value.empty(), "ms2_total written while subsampled");
      if (r.key == "subsampled") CHECK(r.value == "1", "subsampled not 1");
    }
    std::vector<double> q = {5, 1, 4, 2, 3};
    CHECK(C::quantile(q, 0.5) == 3 && std::fabs(C::quantile(q, 0.1) - 1.4) < 1e-12 && C::quantile(q, 0.9) == 4.6,
          "quantile (type 7)");
    std::printf("7. tally and summary\n");
  }

  std::printf(failures ? "\n%d FAILURES\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
