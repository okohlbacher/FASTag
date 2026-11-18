// The census identifiability score (1.16 item 4); see CensusScore.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "CensusScore.h"

#include "NumFormat.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <numeric>

namespace FASTag::CensusScore
{
  const Model& model()
  {
    // FROZEN-MODEL-BEGIN (tools/census_ident.py fit writes this block)
    static const Model m{"unfitted", 0.0, {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}};
    // FROZEN-MODEL-END
    return m;
  }

  namespace
  {
    constexpr double NEG_INF = -std::numeric_limits<double>::infinity();
    /// -log10(E) of an E-value of 0 (below any double's -log10).
    constexpr double ZERO_E = 400.0;

    /// Splits a tab-separated line into @p out (reused).
    void split(const std::string& line, std::vector<std::string>& out)
    {
      out.clear();
      std::size_t start = 0;
      for (;;)
      {
        const std::size_t end = line.find('\t', start);
        out.emplace_back(line, start, end == std::string::npos ? std::string::npos : end - start);
        if (end == std::string::npos) break;
        start = end + 1;
      }
    }

    bool parse(const std::string& s, double& v)
    {
      if (s.empty()) return false;
      char* end = nullptr;
      v = std::strtod(s.c_str(), &end);
      return end == s.c_str() + s.size() && !std::isnan(v);
    }
  }

  double rawFeature(std::size_t k, const std::string& field)
  {
    double v = 0;
    if (!parse(field, v)) return NEG_INF;
    if (k == 0)  // pre_best_evalue
    {
      if (v < 0) return NEG_INF;
      if (v == 0) return ZERO_E;
      return std::min(ZERO_E, -std::log10(v));
    }
    return v;
  }

  void midRanks(std::vector<double>& v)
  {
    const std::size_t n = v.size();
    if (n == 0) return;
    std::vector<std::size_t> ix(n);
    std::iota(ix.begin(), ix.end(), std::size_t{0});
    std::stable_sort(ix.begin(), ix.end(), [&](std::size_t a, std::size_t b) { return v[a] < v[b]; });
    std::vector<double> r(n);
    const double dn = static_cast<double>(n);
    for (std::size_t i = 0; i < n;)
    {
      std::size_t j = i + 1;
      while (j < n && v[ix[j]] == v[ix[i]]) ++j;
      // 1-based ranks i+1 .. j, mean (i + 1 + j) / 2
      const double mid = (static_cast<double>(i + 1) + static_cast<double>(j)) / 2.0;
      for (std::size_t t = i; t < j; ++t) r[ix[t]] = (mid - 0.5) / dn;
      i = j;
    }
    v.swap(r);
  }

  double score(const Model& m, const std::array<double, N_FEATURES>& r)
  {
    double z = m.intercept;
    for (std::size_t k = 0; k < N_FEATURES; ++k) z += m.coef[k] * r[k];
    return 1.0 / (1.0 + std::exp(-z));
  }

  bool scoreTableAs(const std::string& head, const std::string& in, const std::string& out, const Model& m,
                    Tally& tally, std::string& error)
  {
    tally = Tally{};
    std::vector<std::string> names;
    split(head, names);
    std::array<std::size_t, N_FEATURES> col{};
    for (std::size_t k = 0; k < N_FEATURES; ++k)
    {
      const auto it = std::find(names.begin(), names.end(), FEATURE_COLUMNS[k]);
      if (it == names.end())
      {
        error = std::string("the census header lacks the column ") + FEATURE_COLUMNS[k];
        return false;
      }
      col[k] = static_cast<std::size_t>(it - names.begin());
    }
    const std::size_t nf = names.size();
    std::array<std::vector<double>, N_FEATURES> feat;
    std::string line;
    std::vector<std::string> fs;
    {
      std::ifstream f(in, std::ios::binary);
      if (!f) { error = "cannot read " + in; return false; }
      if (!std::getline(f, line) || line != head) { error = in + " is not a census table with score columns"; return false; }
      while (std::getline(f, line))
      {
        split(line, fs);
        if (fs.size() != nf) { error = in + ": a row has not " + std::to_string(nf) + " fields"; return false; }
        for (std::size_t k = 0; k < N_FEATURES; ++k) feat[k].push_back(rawFeature(k, fs[col[k]]));
        if (!fs[col[0]].empty()) ++tally.pre_tagged;
      }
      if (f.bad()) { error = "failed reading " + in; return false; }
    }
    for (auto& v : feat) midRanks(v);
    std::ifstream f(in, std::ios::binary);
    std::ofstream o(out, std::ios::binary | std::ios::trunc);
    if (!f) { error = "cannot read " + in; return false; }
    if (!o) { error = "cannot write " + out; return false; }
    std::getline(f, line);
    o << head << SCORE_COLUMN << '\n';
    std::string buf;
    std::array<double, N_FEATURES> r{};
    std::size_t i = 0;
    while (std::getline(f, line))
    {
      if (i >= feat[0].size()) { error = in + " changed while it was scored"; return false; }
      for (std::size_t k = 0; k < N_FEATURES; ++k) r[k] = feat[k][i];
      buf.clear();
      buf += line;
      buf += '\t';
      appendNum(buf, score(m, r), std::chars_format::fixed, 6);
      buf += '\n';
      o << buf;
      ++i;
    }
    o.close();
    tally.rows = i;
    if (f.bad()) { error = "failed reading " + in; return false; }
    if (o.fail()) { error = "failed writing " + out + " (disk full?)"; return false; }
    return true;
  }

  bool writeSorted(const std::string& in, const std::string& out, std::string& error)
  {
    std::ifstream f(in, std::ios::binary);
    if (!f) { error = "cannot read " + in; return false; }
    std::string head;
    if (!std::getline(f, head)) { error = in + " is empty"; return false; }
    std::vector<std::string> names;
    split(head, names);
    const auto it = std::find(names.begin(), names.end(), "ident_score");
    if (it == names.end()) { error = in + " has no ident_score column"; return false; }
    const std::size_t sc = static_cast<std::size_t>(it - names.begin()), nf = names.size();
    std::vector<std::string> rows;
    std::vector<double> s;
    std::string line;
    std::vector<std::string> fs;
    while (std::getline(f, line))
    {
      split(line, fs);
      double v = 0;
      if (fs.size() != nf || !parse(fs[sc], v)) { error = in + ": a row cannot be read"; return false; }
      s.push_back(v);
      rows.push_back(std::move(line));
    }
    if (f.bad()) { error = "failed reading " + in; return false; }
    std::vector<std::size_t> ix(rows.size());
    std::iota(ix.begin(), ix.end(), std::size_t{0});
    std::stable_sort(ix.begin(), ix.end(), [&](std::size_t a, std::size_t b) { return s[a] > s[b]; });
    std::ofstream o(out, std::ios::binary | std::ios::trunc);
    if (!o) { error = "cannot write " + out; return false; }
    o << "ident_rank\t" << head << '\n';
    std::string buf;
    for (std::size_t k = 0; k < ix.size(); ++k)
    {
      buf.clear();
      appendNum(buf, k + 1);
      buf += '\t';
      buf += rows[ix[k]];
      buf += '\n';
      o << buf;
    }
    o.close();
    if (o.fail()) { error = "failed writing " + out + " (disk full?)"; return false; }
    return true;
  }

  std::vector<Digest::Row> summaryRows(const Model& m, const Tally& t)
  {
    using Digest::num;
    const std::string sec = "census_score";
    std::vector<Digest::Row> r;
    std::string feats;
    for (const char* c : FEATURE_COLUMNS)
    {
      if (!feats.empty()) feats += ',';
      feats += c;
    }
    r.push_back({sec, "ident_model", m.id, "-",
                 std::string("ident_score is the frozen logistic model ") + m.id +
                     " on per-run mid-ranks of the census features; a ranking score, not a probability."});
    r.push_back({sec, "ident_features", feats, "-",
                 "Features in model order; pre_* are taken before any database filter."});
    r.push_back({sec, "ident_rows", num(t.rows), "-", num(t.rows) + " census rows have an ident_score."});
    r.push_back({sec, "ident_pre_tagged", num(t.pre_tagged), num(t.rows),
                 num(t.pre_tagged) + " of them have a tag before any database filter."});
    return r;
  }
}
