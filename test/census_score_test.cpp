// Census identifiability score (src/CensusScore.h, 1.16 item 4): feature
// parsing and missing values, per-run mid-ranks (ties, -inf), the logistic,
// the table pass (a score for every status, rank invariance to feature
// scale, refusals), the sorted list (order and ties) and the pre-filter
// census columns.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Census.h"
#include "CensusScore.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

namespace C = FASTag::Census;
namespace S = FASTag::CensusScore;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  std::vector<std::vector<std::string>> table(const std::string& path)
  {
    std::ifstream f(path, std::ios::binary);
    std::vector<std::vector<std::string>> rows;
    std::string line;
    while (std::getline(f, line))
    {
      std::vector<std::string> fs;
      std::size_t s = 0;
      for (std::size_t i = 0; i <= line.size(); ++i)
        if (i == line.size() || line[i] == '\t') { fs.push_back(line.substr(s, i - s)); s = i + 1; }
      rows.push_back(fs);
    }
    return rows;
  }

  /// A census row of each kind: unprocessed, processed without tags, tagged.
  C::Row row(std::size_t i, C::Status st, double e = 0, std::size_t len = 0, std::size_t peaks = 0)
  {
    C::Row r;
    r.index = i;
    r.rt = 10.0 * static_cast<double>(i);
    r.status = st;
    if (st != C::Status::NO_PRECURSOR && st != C::Status::EMPTY)
    {
      r.has_precursor = true;
      r.precursor_mz = 400 + static_cast<double>(i);
      r.charge_given = 2;
      r.charge_used = 2;
      r.n_peaks = peaks;
      r.has_gini = peaks > 0;
      r.gini = 0.5;
      r.prepared = st != C::Status::NO_SIGNAL && st != C::Status::BAD_PRECURSOR;
      r.n_kept = peaks / 2;
      r.n_edges = peaks / 3;
      r.n_compl = peaks / 4;
      r.n_found = len > 0 ? 3 : 0;
    }
    if (len > 0)
    {
      r.has_pre = true;
      r.pre_best.evalue = e;
      r.pre_best.n_res = len;
      r.pre_best.mean_conf = 0.8f;
      r.pre_tag_cover = 100.0 * static_cast<double>(len);
    }
    return r;
  }

  const S::Model TEST_MODEL{"test", -1.0, {2.0, 0.5, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0}};
}

int main()
{
  const double ninf = -std::numeric_limits<double>::infinity();

  // 1. Features.
  {
    CHECK(S::rawFeature(0, "") == ninf && S::rawFeature(5, "") == ninf, "empty is -inf");
    CHECK(S::rawFeature(0, "0.001") == 3.0, "-log10(E) %g", S::rawFeature(0, "0.001"));
    CHECK(S::rawFeature(0, "0") == 400.0 && S::rawFeature(0, "-1") == ninf, "E = 0 and negative E");
    CHECK(S::rawFeature(0, "1e-500") == 400.0, "underflow");
    CHECK(S::rawFeature(5, "17") == 17.0 && S::rawFeature(5, "x") == ninf && S::rawFeature(5, "1x") == ninf,
          "plain values and garbage");
    CHECK(S::FEATURE_COLUMNS.size() == S::N_FEATURES, "feature count");
    std::printf("1. features\n");
  }

  // 2. Mid-ranks.
  {
    std::vector<double> v = {3, ninf, 1, 3, ninf};
    S::midRanks(v);
    // sorted: -inf, -inf (ranks 1,2 -> 1.5), 1 (3), 3, 3 (4,5 -> 4.5); (r - 0.5) / 5
    CHECK(v[1] == 0.2 && v[4] == 0.2 && v[2] == 0.5 && v[0] == 0.8 && v[3] == 0.8,
          "mid-ranks %g %g %g %g %g", v[0], v[1], v[2], v[3], v[4]);
    std::vector<double> one = {7};
    S::midRanks(one);
    CHECK(one[0] == 0.5, "one value");
    std::vector<double> none;
    S::midRanks(none);
    CHECK(none.empty(), "empty");
    std::printf("2. mid-ranks\n");
  }

  // 3. Logistic.
  {
    std::array<double, S::N_FEATURES> r{};
    CHECK(std::fabs(S::score(TEST_MODEL, r) - 1.0 / (1.0 + std::exp(1.0))) < 1e-12, "intercept only");
    r[0] = 1;
    r[5] = 0.5;
    CHECK(std::fabs(S::score(TEST_MODEL, r) - 1.0 / (1.0 + std::exp(-1.5))) < 1e-12, "two features");
    CHECK(std::string(S::model().id).size() > 0, "a frozen model");
    std::printf("3. logistic\n");
  }

  // 4. Table: every status scored, rank invariance, sorted list.
  {
    const std::string dir = (std::filesystem::temp_directory_path() / "census_score_test").string();
    std::filesystem::create_directories(dir);
    const std::string head = C::header(false, true).substr(0, C::header(false, true).size() - 1);
    CHECK(head.find("\tpre_best_evalue\tpre_best_len\tpre_best_mean_conf\tpre_tag_cover") != std::string::npos,
          "header with score columns");
    const std::vector<C::Row> rows = {
        row(0, C::Status::EMPTY),          row(1, C::Status::NO_PRECURSOR),   row(2, C::Status::NO_SIGNAL),
        row(3, C::Status::TOO_FEW_PEAKS, 0, 0, 3), row(4, C::Status::NO_TAGS, 0, 0, 40),
        row(5, C::Status::FILTERED, 1e-3, 5, 60), row(6, C::Status::TAGGED, 1e-6, 7, 80),
        row(7, C::Status::TAGGED, 1e-3, 5, 60)};
    auto write = [&](const std::string& p, double escale) {
      std::string buf;
      for (C::Row r : rows)
      {
        if (r.has_pre) r.pre_best.evalue *= escale;
        C::appendRow(buf, r, "scan=" + std::to_string(r.index), false, true);
      }
      std::ofstream f(p, std::ios::binary);
      f << head << '\n' << buf;
    };
    write(dir + "/a.tsv", 1.0);
    write(dir + "/b.tsv", 1000.0);  // a bigger database: every E-value 1000x
    const auto ta = table(dir + "/a.tsv");
    CHECK(ta.size() == rows.size() + 1 && ta[1].size() == ta[0].size(), "appendRow with score: %zu fields",
          ta[1].size());
    CHECK(ta[1][ta[0].size() - 4].empty() && ta[7][ta[0].size() - 4] == "1e-06", "pre_best_evalue field");
    S::Tally t;
    std::string err;
    CHECK(S::scoreTableAs(head, dir + "/a.tsv", dir + "/a.s.tsv", TEST_MODEL, t, err), "score a: %s", err.c_str());
    CHECK(t.rows == rows.size() && t.pre_tagged == 3, "tally %llu %llu", (unsigned long long)t.rows,
          (unsigned long long)t.pre_tagged);
    S::Tally tb;
    CHECK(S::scoreTableAs(head, dir + "/b.tsv", dir + "/b.s.tsv", TEST_MODEL, tb, err), "score b: %s", err.c_str());
    const auto sa = table(dir + "/a.s.tsv"), sb = table(dir + "/b.s.tsv");
    CHECK(sa[0].back() == "ident_score", "ident_score column");
    bool all = true, same = true;
    for (std::size_t i = 1; i < sa.size(); ++i)
    {
      all = all && !sa[i].back().empty();
      same = same && sa[i].back() == sb[i].back();
    }
    CHECK(all, "every status has a score");
    CHECK(same, "per-run ranks: scaling every E-value changes no score");
    CHECK(sa[7].back() > sa[8].back() && sa[8].back() == sa[6].back(), "ordering and ties");
    CHECK(std::stod(sa[1].back()) == std::stod(sa[2].back()), "two unprocessed rows tie");
    // Refusals.
    CHECK(!S::scoreTableAs(C::header(false, false).substr(0, C::header(false, false).size() - 1), dir + "/a.tsv",
                           dir + "/x.tsv", TEST_MODEL, t, err)
              && err.find("pre_best_evalue") != std::string::npos,
          "a table without score columns is refused: %s", err.c_str());
    CHECK(!S::scoreTableAs(head + "\textra", dir + "/a.tsv", dir + "/x.tsv", TEST_MODEL, t, err),
          "a header mismatch is refused");
    // Sorted list.
    CHECK(S::writeSorted(dir + "/a.s.tsv", dir + "/sorted.tsv", err), "sorted: %s", err.c_str());
    const auto so = table(dir + "/sorted.tsv");
    CHECK(so.size() == sa.size() && so[0][0] == "ident_rank" && so[0].size() == sa[0].size() + 1, "sorted layout");
    CHECK(so[1][0] == "1" && so[1][1] == "6", "highest first: index %s", so[1][1].c_str());
    bool desc = true;
    for (std::size_t i = 2; i < so.size(); ++i) desc = desc && std::stod(so[i].back()) <= std::stod(so[i - 1].back());
    CHECK(desc, "non-increasing");
    // ties keep input order: rows 5 and 7 tie (same features but status); 5 first.
    std::size_t p5 = 0, p7 = 0;
    for (std::size_t i = 1; i < so.size(); ++i)
    {
      if (so[i][1] == "5") p5 = i;
      if (so[i][1] == "7") p7 = i;
    }
    CHECK(p5 > 0 && p5 < p7, "ties in input order (%zu %zu)", p5, p7);
    CHECK(!S::writeSorted(dir + "/a.tsv", dir + "/y.tsv", err), "an unscored table is refused");
    const auto sum = S::summaryRows(TEST_MODEL, tb);
    CHECK(sum.size() == 4 && sum[0].value == "test" && sum[2].value == "8", "summary");
    std::filesystem::remove_all(dir);
    std::printf("4. table\n");
  }

  std::printf(failures ? "\n%d FAILURES\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
