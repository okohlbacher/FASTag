// Census (src/Census.h): the per-spectrum status, its precedence on synthetic
// spectra run through the real tagger, the Gini coefficient, the best tag
// (minimum E-value, not the first row), the interval-union tag_cover, the row
// and summary formatting, tab escaping and the tally invariant; census 2's
// max_len and res_cover (residues of the reported tags placed through the
// precursor mass) and the run row max_tags; census 3's orientation-aware
// res_cover (complementary b/y and c/z-dot ladders over the same residues
// count once).
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
#include "IonSeries.h"
#include "SpectrumSampler.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
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

  // 6. Rows: 22 fields, tab escaping, empty fields where nothing was computed.
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
    CHECK(hdr.size() == 23, "header has %zu fields", hdr.size());
    CHECK(hdr[0] == "index" && hdr[1] == "spectrum" && hdr[11] == "status" && hdr[19] == "tag_cover"
              && hdr[20] == "max_len" && hdr[21] == "res_cover" && hdr[22] == "res_cover_exact",
          "header columns out of place");
    const auto hion = fields(C::header(true, true));
    CHECK(hion.size() == 28 && hion[21] == "res_cover" && hion[22] == "res_cover_exact"
              && hion[23] == "best_ion_series",
          "max_len/res_cover/res_cover_exact are not before best_ion_series");

    double pmz = 0;
    const MSSpectrum clean = ladder("VGAHAGEYGAEALER", pmz);
    C::Row r = census(clean, pmz, true, 2, p, tab);
    r.index = 17; r.has_precursor = true; r.precursor_mz = pmz; r.charge_given = 0; r.charge_used = 2;
    std::string line;
    C::appendRow(line, r, "scan=1\tx\ny");
    const auto f = fields(line);
    CHECK(line.back() == '\n' && std::count(line.begin(), line.end(), '\n') == 1, "row is not one line");
    CHECK(f.size() == 23, "row has %zu fields", f.size());
    CHECK(f[1] == "scan=1 x y", "native id not escaped: '%s'", f[1].c_str());
    CHECK(f[0] == "17" && f[4] == "0" && f[5] == "2" && f[11] == "tagged", "row values wrong");
    CHECK(f[14].empty() && f[20].empty() && f[21].empty() && f[22].empty(),
          "best tag fields written without a best tag");
    r.has_best = true;
    r.best.n_res = 4;
    r.max_len = 7;
    r.res_cover = 11;
    std::string lb;
    C::appendRow(lb, r, "s");
    const auto fb = fields(lb);
    CHECK(fb.size() == 23 && fb[15] == "4" && fb[20] == "7" && fb[21] == "11" && fb[22] == "1",
          "max_len/res_cover/res_cover_exact: '%s' '%s'",
          fb.size() == 23 ? fb[20].c_str() : "?", fb.size() == 23 ? fb[21].c_str() : "?");
    r.res_cover_exact = false;
    std::string lx;
    C::appendRow(lx, r, "s");
    const auto fx = fields(lx);
    CHECK(fx.size() == 23 && fx[22] == "0", "res_cover_exact 0 not written");

    C::Row e;
    e.status = C::Status::NO_PRECURSOR;
    e.index = 3;
    std::string le;
    C::appendRow(le, e, "s");
    const auto fe = fields(le);
    CHECK(fe.size() == 23 && fe[3].empty() && fe[4].empty() && fe[5].empty() && fe[7].empty()
              && fe[12].empty() && fe[13].empty() && fe[22].empty(),
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
    CHECK(find("census_version") && find("census_version")->value == "3", "census_version");
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

  // 8. Census 2: residue cover by hand, then on real tags of a y-only ladder.
  {
    using Spans = std::vector<std::pair<double, double>>;
    // Tag A: nterm 0, 1+, path 100..400 in steps of 100 -> residues [0,100],
    // [100,200], [200,300] from the N-terminus.
    Spans sp;
    C::addResidueSpans(sp, 0, {100, 200, 300, 400}, {1, 1, 1}, 1, 3, 300);
    CHECK(sp.size() == 3 && sp[0] == std::make_pair(0.0, 100.0) && sp[2] == std::make_pair(200.0, 300.0),
          "tag A spans");
    // Tag B: nterm 100, two of A's residues read elsewhere in m/z -> nothing new.
    C::addResidueSpans(sp, 100, {500, 600, 700}, {1, 1}, 1, 2, 200);
    // Tag D: A read 1.5 Da off -> the same three residues (midpoints inside A's).
    C::addResidueSpans(sp, 1.5, {100, 200, 300, 400}, {}, 1, 3, 300);
    // Tag C: nterm 260, 2+, steps of 50 m/z = 100 Da -> [260,360], [360,460]:
    // midpoints 310 and 410, both new (310 is past A's last residue, 300).
    C::addResidueSpans(sp, 260, {100, 150, 200}, {1, 1}, 2, 2, 200);
    // Tag G: one gap step of two residues, nterm 1000: where the two meet is
    // not known, so no span (codex6 review n7: an even split made up a
    // boundary), and the tag is not resolved.
    CHECK(!C::addResidueSpans(sp, 1000, {100, 300}, {2}, 1, 2, 200), "a gap tag counts as resolved");
    // Tag E: no path: no boundaries either.
    CHECK(!C::addResidueSpans(sp, 2000, {}, {}, 1, 2, 100), "a tag without a path counts as resolved");
    CHECK(C::addResidueSpans(sp, 5000, {100, 200}, {1}, 1, 1, 100) && sp.back() == std::make_pair(5000.0, 5100.0),
          "a one-step tag is resolved");
    sp.pop_back();
    CHECK(sp.size() == 3 + 2 + 3 + 2, "spans %zu", sp.size());
    Spans copy = sp;
    const std::size_t n = C::residueCover(sp);
    CHECK(n == 3 + 2, "res_cover %zu, want 5", n);
    std::reverse(copy.begin(), copy.end());
    CHECK(C::residueCover(copy) == n, "res_cover depends on the order");
    Spans none;
    CHECK(C::residueCover(none) == 0, "empty res_cover");

    // A y-only ladder: every tag is a y read, so every residue boundary the
    // tags give must be a prefix (b) residue sum of the peptide: the tags
    // are placed through the precursor mass, not by their m/z.
    const std::string pep = "VGAHAGEYGAEALER";
    const AASequence aa = AASequence::fromString(pep);
    const double pmz = (aa.getMonoWeight() + 2 * Constants::PROTON_MASS_U) / 2;
    MSSpectrum y;
    for (size_t i = 1; i < aa.size(); ++i) y.emplace_back(aa.getSuffix(i).getMonoWeight(Residue::YIon, 1), 1.0);
    y.sortByPosition();
    std::vector<double> prefix(1, 0.0);
    for (size_t i = 1; i <= aa.size(); ++i)
      prefix.push_back(aa.getPrefix(i).getMonoWeight(Residue::Internal));
    const std::vector<FASTag::Tag> tags = FASTag::tagSpectrum(y, pmz, 2, p, tab);
    CHECK(!tags.empty(), "no tags on the y ladder");
    Spans ys;
    std::size_t max_len = 0, bad = 0;
    for (const FASTag::Tag& t : tags)
    {
      max_len = std::max(max_len, t.n_res);
      Spans one;
      const bool resolved = C::addResidueSpans(one, t.nterm_mass, t.path_mz, t.step_res, t.charge, t.n_res, t.res_mass);
      std::size_t in_gaps = 0;
      for (const std::uint8_t r : t.step_res)
        if (r > 1) in_gaps += r;
      CHECK(one.size() + in_gaps == t.n_res && resolved == (in_gaps == 0), "tag %s gave %zu residues (%zu in gaps)",
            t.seq.c_str(), one.size(), in_gaps);
      for (const auto& [lo, hi] : one)
      {
        bool lo_ok = false, hi_ok = false;
        for (const double m : prefix)
        {
          lo_ok = lo_ok || std::fabs(lo - m) < 0.02;
          hi_ok = hi_ok || std::fabs(hi - m) < 0.02;
        }
        // Every span is a resolved residue: both ends are boundaries (a gap adds none).
        if (!(lo_ok && hi_ok)) ++bad;
      }
      ys.insert(ys.end(), one.begin(), one.end());
    }
    CHECK(bad == 0, "%zu residues of the y tags are not at prefix masses", bad);
    // y1..y14 bound residues 2..14 (13), and the tags cover them all.
    const std::size_t yc = C::residueCover(ys);
    CHECK(yc == 13 && yc >= max_len, "y-ladder res_cover %zu (max_len %zu)", yc, max_len);
    std::printf("   y ladder: %zu tags, max_len %zu, res_cover %zu\n", tags.size(), max_len, yc);

    // codex6 review n7: an ungapped GWKA and an overlapping S(GW)K (a gap of
    // G + W) of the peptide SGWKA cover its five residues. Splitting the gap
    // evenly put a boundary at S + (G + W) / 2 between G's and W's: six
    // counted intervals for five residues. The gap adds no span now, and
    // res_cover is a lower bound (inexact), at least the longest tag.
    {
      const auto m = [](const char* r) { return ResidueDB::getInstance()->getResidue(r)->getMonoWeight(Residue::Internal); };
      const double S = m("S"), G = m("G"), Wt = m("W"), K = m("K"), A = m("A");
      const double h = 900.0;
      Spans u;
      // GWKA: nterm = S, path ascending, one residue per step (A, K, W, G from the low end).
      const bool r1 = C::addResidueSpans(u, S, {h - (G + Wt + K + A), h - (G + Wt + K), h - (G + Wt), h - G, h}, {1, 1, 1, 1}, 1, 4,
                                         G + Wt + K + A);
      // S(GW)K: nterm 0, steps from the low end K, the gap GW, S.
      const bool r2 = C::addResidueSpans(u, 0.0, {h - (S + G + Wt + K), h - (S + G + Wt), h - S, h}, {1, 2, 1}, 1, 4,
                                         S + G + Wt + K);
      CHECK(r1 && !r2, "GWKA resolved, S(GW)K not (%d %d)", r1, r2);
      Spans v = u;
      CHECK(C::residueCover(v) == 5, "GWKA + S(GW)K: res_cover %zu, want 5", C::residueCover(v));
      CHECK(C::resCoverLowerBound(u, 4) == 5, "GWKA + S(GW)K: lower bound %zu, want 5", C::resCoverLowerBound(u, 4));
      // S(GW)K alone: S and K resolved, the longest tag (4) the bound.
      Spans w;
      C::addResidueSpans(w, 0.0, {h - (S + G + Wt + K), h - (S + G + Wt), h - S, h}, {1, 2, 1}, 1, 4, S + G + Wt + K);
      CHECK(w.size() == 2 && C::resCoverLowerBound(w, 4) == 4, "S(GW)K alone: %zu spans, bound %zu", w.size(),
            C::resCoverLowerBound(w, 4));
    }

    // census 3: complementary ladders over the same residues (E P T of
    // PEPTIDEK, residues 2..4, precursor 1+) count once. Each tag is built
    // as FASTagger writes it: path_mz the 1+ ions ascending, one residue per
    // step, and nterm_mass under the y (z-dot) assumption,
    // nterm = M - (high_mz - H+) [- (H2O - offC) under c/z].
    {
      const AASequence pt = AASequence::fromString("PEPTIDEK");
      const double M = pt.getMonoWeight();
      const double H = Constants::PROTON_MASS_U;
      const double W = EmpiricalFormula("H2O").getMonoWeight();
      std::vector<double> pre(1, 0.0);
      for (size_t i = 1; i <= pt.size(); ++i) pre.push_back(pt.getPrefix(i).getMonoWeight(Residue::Internal));
      const double mres = pre.back();
      for (const auto series : {FASTag::IonSeries::Series::BY, FASTag::IonSeries::Series::CZ})
      {
        const FASTag::IonSeries::IonPair ip = FASTag::IonSeries::ionPair(series);
        const bool cz = series == FASTag::IonSeries::Series::CZ;
        const char* nm = cz ? "c/z" : "b/y";
        // N-terminal ions n_1..n_4 (P, PE, PEP, PEPT), C-terminal ions of the
        // suffixes from residue 2..5 on (EPTIDEK .. IDEK).
        std::vector<double> nmz, cmz;
        for (size_t i = 1; i <= 4; ++i) nmz.push_back(pre[i] + ip.offN + H);
        for (size_t i = 5; i >= 2; --i) cmz.push_back(mres - pre[i - 1] + ip.offC + H);
        const double corr = cz ? (W - ip.offC) : 0.0;
        const double n_nterm = M - (nmz.back() - H) - corr;  // the N-series tag, read as if C-series
        const double c_nterm = M - (cmz.back() - H) - corr;
        const double axis = M - W + ip.reversedOffset();
        CHECK(std::fabs(c_nterm - pre[1]) < 1e-6, "%s: the C-series tag's nterm %.6f, want %.6f", nm, c_nterm, pre[1]);
        const std::vector<std::uint8_t> one3 = {1, 1, 1};
        const auto spans = [&](double nterm, const std::vector<double>& mz, C::Orientation o) {
          Spans v;
          C::addResidueSpans(v, nterm, mz, one3, 1, 3, mz.back() - mz.front(), o, axis);
          return v;
        };
        // The 1.15 placement (every tag a C-series read) counts them twice.
        Spans fw = spans(n_nterm, nmz, C::Orientation::Forward);
        Spans fy = spans(c_nterm, cmz, C::Orientation::Forward);
        fw.insert(fw.end(), fy.begin(), fy.end());
        CHECK(C::residueCover(fw) == 6, "%s: both forward: res_cover %zu, want 6 (the mirror)", nm, C::residueCover(fw));
        // Known orientation: the N-series tag reversed lands on the true residues.
        Spans rb = spans(n_nterm, nmz, C::Orientation::Reversed);
        const Spans ry = spans(c_nterm, cmz, C::Orientation::Forward);
        std::sort(rb.begin(), rb.end());
        Spans rys = ry;
        std::sort(rys.begin(), rys.end());
        bool same = rb.size() == 3 && rys.size() == 3;
        for (size_t i = 0; same && i < 3; ++i)
          same = std::fabs(rb[i].first - rys[i].first) < 1e-6 && std::fabs(rb[i].second - rys[i].second) < 1e-6
              && std::fabs(rys[i].first - pre[i + 1]) < 1e-6 && std::fabs(rys[i].second - pre[i + 2]) < 1e-6;
        CHECK(same, "%s: the reversed N-series spans are not the C-series spans at residues 2..4", nm);
        Spans known = rb;
        known.insert(known.end(), ry.begin(), ry.end());
        CHECK(C::residueCover(known) == 3, "%s: known orientation: res_cover %zu, want 3", nm, C::residueCover(known));
        // Unresolved: both folded onto the lower half, the lower bound.
        Spans ub = spans(n_nterm, nmz, C::Orientation::Unresolved);
        const Spans uy = spans(c_nterm, cmz, C::Orientation::Unresolved);
        ub.insert(ub.end(), uy.begin(), uy.end());
        CHECK(C::residueCover(ub) == 3, "%s: unresolved: res_cover %zu, want 3", nm, C::residueCover(ub));
        // Mixed known and unresolved reads, on residues 5..7 (I D E) in the
        // upper half, where a known Forward read and a folded one do not
        // coincide. One spectrum's tags as FASTagger adds them: each block
        // placed by its orientation, then, while any orientation is
        // unresolved, every block folded (the known ones too).
        {
          std::vector<double> nmz5, cmz5;
          for (size_t i = 4; i <= 7; ++i) nmz5.push_back(pre[i] + ip.offN + H);
          for (size_t i = 8; i >= 5; --i) cmz5.push_back(mres - pre[i - 1] + ip.offC + H);
          const double n5 = M - (nmz5.back() - H) - corr;
          const double c5 = M - (cmz5.back() - H) - corr;
          CHECK(std::fabs(c5 - pre[4]) < 1e-6, "%s: the C-series tag on 5..7 has nterm %.6f, want %.6f", nm, c5, pre[4]);
          CHECK(0.5 * (pre[4] + pre[7]) > 0.5 * axis, "%s: residues 5..7 not in the upper half", nm);
          struct Read
          {
            double nterm;
            const std::vector<double>* mz;
            C::Orientation o;
          };
          const auto spectrum = [&](const std::vector<Read>& reads, bool fold_known) {
            Spans v;
            std::vector<std::pair<size_t, size_t>> blk;
            bool exact = true;
            for (const Read& r : reads)
            {
              const size_t first = v.size();
              C::addResidueSpans(v, r.nterm, *r.mz, one3, 1, 3, r.mz->back() - r.mz->front(), r.o, axis);
              blk.emplace_back(first, v.size());
              if (r.o == C::Orientation::Unresolved) exact = false;
            }
            if (!exact && fold_known)
              for (const auto& [a, b] : blk) C::foldResidueSpans(v, a, b, axis);
            return v;
          };
          using O = C::Orientation;
          // y read Forward, b read Unresolved: folding per tag alone counts
          // the stretch and its mirror image (over 3 residues).
          const std::vector<Read> yb = {{c5, &cmz5, O::Forward}, {n5, &nmz5, O::Unresolved}};
          Spans m1 = spectrum(yb, false);
          CHECK(C::residueCover(m1) > 3, "%s: y fwd + b unresolved, per tag: res_cover %zu, want > 3", nm,
                C::residueCover(m1));
          Spans m2 = spectrum(yb, true);
          CHECK(C::residueCover(m2) == 3, "%s: y fwd + b unresolved: res_cover %zu, want 3", nm, C::residueCover(m2));
          // b read Reversed, y read Unresolved.
          const std::vector<Read> by = {{n5, &nmz5, O::Reversed}, {c5, &cmz5, O::Unresolved}};
          Spans m3 = spectrum(by, true);
          CHECK(C::residueCover(m3) == 3, "%s: b rev + y unresolved: res_cover %zu, want 3", nm, C::residueCover(m3));
          // Folding again (an already folded block) changes nothing.
          Spans m4 = m2;
          C::foldResidueSpans(m4, 0, m4.size() / 2, axis);
          C::foldResidueSpans(m4, m4.size() / 2, m4.size(), axis);
          CHECK(m4 == m2, "%s: folding a folded spectrum changed it", nm);
          // Every orientation known: exact and unfolded, on the true residues.
          Spans k = spectrum({{n5, &nmz5, O::Reversed}, {c5, &cmz5, O::Forward}}, true);
          CHECK(C::residueCover(k) == 3, "%s: known on 5..7: res_cover %zu, want 3", nm, C::residueCover(k));
          std::sort(k.begin(), k.end());
          bool on_true = k.size() == 6;
          for (size_t i = 0; on_true && i < 6; ++i)
            on_true = std::fabs(k[i].first - pre[4 + i / 2]) < 1e-6 && std::fabs(k[i].second - pre[5 + i / 2]) < 1e-6;
          CHECK(on_true, "%s: known reads on 5..7 were moved off the true residues", nm);
        }
        // A tag across the centre: its residues fold each on its own, so two
        // that mirror each other share an image; the tag's length is the
        // other lower bound, and res_cover is never below it.
        Spans mid;
        C::addResidueSpans(mid, 0.5 * axis - 150, {100, 200, 300, 400}, one3, 1, 3, 300, C::Orientation::Unresolved,
                           axis);
        CHECK(C::resCoverLowerBound(mid, 3) == 3, "%s: a centred tag folded to %zu residues", nm,
              C::resCoverLowerBound(mid, 3));
        // Codex Earlier 4: two overlapping unresolved reads (y ions) whose own
        // midpoints straddle the centre. Folded as wholes, one stayed and the
        // other was mirrored, and their shared residues counted twice (10 for
        // 9 with realistic masses). Folded per residue, each residue has one
        // image: no more than the distinct residues, no fewer than the longest.
        {
          const AASequence lp = AASequence::fromString("SAMPLERGLYTWEK");
          const double LM = lp.getMonoWeight();
          std::vector<double> lpre(1, 0.0);
          for (size_t i = 1; i <= lp.size(); ++i) lpre.push_back(lp.getPrefix(i).getMonoWeight(Residue::Internal));
          const double laxis = LM - W + ip.reversedOffset();
          // A y-read tag of residues i..j (1-based): its spans [P(k-1), P(k)].
          const auto read = [&](size_t i, size_t j) {
            std::vector<double> mz;
            for (size_t k = j + 1; k-- > i - 1;) mz.push_back(lpre.back() - lpre[k] + ip.offC + H);
            std::vector<std::uint8_t> ones(j - i + 1, 1);
            Spans v;
            C::addResidueSpans(v, lpre[i - 1], mz, ones, 1, j - i + 1, lpre[j] - lpre[i - 1],
                               C::Orientation::Unresolved, laxis);
            return v;
          };
          // Residues 3..9 and 6..11: 9 distinct residues, 7 the longest (the
          // whole-tag fold counted 10).
          const double ma = 0.5 * (lpre[2] + lpre[9]), mb = 0.5 * (lpre[5] + lpre[11]);
          CHECK(ma < 0.5 * laxis && mb > 0.5 * laxis, "%s: the overlapping reads do not straddle the centre (%.1f %.1f %.1f)",
                nm, ma, mb, 0.5 * laxis);
          Spans both = read(3, 9);
          const Spans b2 = read(6, 11);
          both.insert(both.end(), b2.begin(), b2.end());
          const std::size_t got = C::resCoverLowerBound(both, 7);
          CHECK(got <= 9 && got >= 7, "%s: overlapping reads across the centre: res_cover %zu, want 7..9", nm, got);
          // The same reads in the other order: the same count.
          Spans rev = read(6, 11);
          const Spans r2 = read(3, 9);
          rev.insert(rev.end(), r2.begin(), r2.end());
          CHECK(C::resCoverLowerBound(rev, 7) == got, "%s: res_cover depends on the order of the reads", nm);
          // Each shared residue has one image: its folded span in either tag
          // is its span read alone.
          for (size_t r = 6; r <= 9; ++r)
          {
            const Spans alone = read(r, r);
            for (const Spans& t : {read(3, 9), read(6, 11)})
            {
              bool one = false;
              for (const auto& sp : t)
                one = one || (std::fabs(sp.first - alone[0].first) < 1e-6 && std::fabs(sp.second - alone[0].second) < 1e-6);
              CHECK(one, "%s: residue %zu has another image in an overlapping tag", nm, r);
            }
          }
        }
      }
      std::printf("   complementary ladders: b/y and c/z-dot count once\n");
    }

    const FASTag::Digest::Row mt = C::maxTagsRow(50, 2);
    CHECK(mt.section == "run" && mt.key == "max_tags" && mt.value == "50" && mt.description.find("at most 100") != std::string::npos,
          "max_tags row: %s %s '%s'", mt.section.c_str(), mt.value.c_str(), mt.description.c_str());
    CHECK(C::maxTagsRow(0, 1).value == "0", "max_tags 0");
    std::printf("8. census 2: max_len, res_cover, max_tags\n");
  }

  std::printf(failures ? "\n%d FAILURES\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
