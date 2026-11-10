// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// Compiled with -ffp-contract=off (CMakeLists.txt) to match the reference's
// floating-point results: it evaluates (1 - s) * p + s * bg as two products
// and a sum, and a fused multiply-add would land a unit in the last place
// away from it.

#include "Digest.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <fstream>
#include <istream>
#include <limits>
#include <locale>
#include <map>
#include <numeric>
#include <sstream>

namespace FASTag::Digest
{
  int aaIndex(char c)
  {
    if (c == 'I') c = 'L';
    const std::size_t k = kAAs.find(c);
    return k == std::string_view::npos ? -1 : static_cast<int>(k);
  }

  void PySum::add(double x)
  {
    if (!any_)
    {
      f_ = 0.0 + x;  // sum()'s start value is the int 0
      any_ = true;
      return;
    }
    const double t = f_ + x;
    if (std::fabs(f_) >= std::fabs(x)) c_ += (f_ - t) + x;
    else c_ += (x - t) + f_;
    f_ = t;
  }

  double PySum::value() const
  {
    if (!any_) return 0.0;
    double r = f_;
    if (c_ != 0.0 && std::isfinite(c_)) r += c_;
    return r;
  }

  const std::array<ResidueKey, kNumKeys>& residueKeys()
  {
    // The residue masses (C carbamidomethylated) and the labelled K/R, whose
    // masses are sums computed in double as the reference computes them.
    static const std::array<ResidueKey, kNumKeys> keys = [] {
      constexpr double K = 128.09496, R = 156.10111;
      return std::array<ResidueKey, kNumKeys>{{
          {"G", 57.02146, 0},      {"A", 71.03711, 1},       {"S", 87.03203, 2},
          {"P", 97.05276, 3},      {"V", 99.06841, 4},       {"T", 101.04768, 5},
          {"C", 160.03065, 6},     {"L", 113.08406, 7},      {"N", 114.04293, 8},
          {"D", 115.02694, 9},     {"Q", 128.05858, 10},     {"K", K, 11},
          {"E", 129.04259, 12},    {"M", 131.04049, 13},     {"H", 137.05891, 14},
          {"F", 147.06841, 15},    {"R", R, 16},             {"Y", 163.06333, 17},
          {"W", 186.07931, 18},
          {"K+TMT", K + 229.162932, 11},  {"K+TMTpro", K + 304.207146, 11},
          {"K+iTRAQ4", K + 144.102063, 11}, {"K+8", K + 8.014199, 11},
          {"R+10", R + 10.008269, -1}}};
    }();
    return keys;
  }

  const std::array<LabelKey, kNumLabels>& labelKeys()
  {
    static const std::array<LabelKey, kNumLabels> keys{{
        {"TMT", 229.162932}, {"TMTpro", 304.207146}, {"iTRAQ4", 144.102063}}};
    return keys;
  }

  void TerminusCounter::add(double nterm, double cterm, std::string_view seq)
  {
    add_(nterm, cterm, seq, nullptr);
  }

  void TerminusCounter::add(double nterm, double cterm, std::string_view seq, double reversed_offset)
  {
    add_(nterm, cterm, seq, &reversed_offset);
  }

  void TerminusCounter::add_(double nterm, double cterm, std::string_view seq, const double* reversed_offset)
  {
    // The tag's reversed-read offset: 1.11's water for b/y (no offset given,
    // the same double), offC - offN for c/z-dot. Named kH2O on purpose: it
    // shadows Digest::kH2O in this body, so every nterm expression below --
    // also one written against the b/y constant by a later item (#3d's
    // two-residue dip, "nterm - kH2O") -- takes the tag's series (PLAN-
    // INTEGRATION 2.3/2). Do not rename it or use Digest::kH2O here.
    const double kH2O = reversed_offset ? *reversed_offset : FASTag::Digest::kH2O;
    ++tags;
    // P2..P4 from the residues next to the counted end: the tag's last three
    // for a y tag (cterm_mass), its first three for a reversed b tag
    // (nterm_mass + H2O) and for the N end (nterm_mass).
    auto head = [&](std::array<std::array<std::uint64_t, kNumAA>, 4>& pos) {
      for (std::size_t j = 0; j < 3 && j < seq.size(); ++j)
        if (const int a = aaIndex(seq[j]); a >= 0) ++pos[j + 1][static_cast<std::size_t>(a)];
    };
    auto tail = [&](std::array<std::array<std::uint64_t, kNumAA>, 4>& pos) {
      for (std::size_t j = 0; j < 3 && j < seq.size(); ++j)
        if (const int a = aaIndex(seq[seq.size() - 1 - j]); a >= 0) ++pos[j + 1][static_cast<std::size_t>(a)];
    };
    // 1.13 digqual: the same residues, by the residue at P1 (P1').
    auto qhead = [&](std::array<std::uint64_t, kNumAA>& row) {
      for (std::size_t j = 0; j < 3 && j < seq.size(); ++j)
        if (const int a = aaIndex(seq[j]); a >= 0) ++row[static_cast<std::size_t>(a)];
    };
    auto qtail = [&](std::array<std::uint64_t, kNumAA>& row) {
      for (std::size_t j = 0; j < 3 && j < seq.size(); ++j)
        if (const int a = aaIndex(seq[seq.size() - 1 - j]); a >= 0) ++row[static_cast<std::size_t>(a)];
    };
    const auto& keys = residueKeys();
    for (std::size_t k = 0; k < keys.size(); ++k)
    {
      const double m = keys[k].mass;
      const int a = keys[k].merged;
      if (near_(cterm, m))
      {
        ++c_near[k];
        if (a >= 0) { ++cpos[0][static_cast<std::size_t>(a)]; tail(cpos); qtail(cq[static_cast<std::size_t>(a)]); }
      }
      // b/y (no offset given): 1.11's m + kH2O; c/z-dot: m + offC - offN.
      if (near_(nterm, m + kH2O))
      {
        ++n_h2o[k];
        if (a >= 0) { ++cpos[0][static_cast<std::size_t>(a)]; head(cpos); qhead(cq[static_cast<std::size_t>(a)]); }
      }
      if (near_(nterm, m))
      {
        ++n_near[k];
        if (a >= 0) { ++npos[0][static_cast<std::size_t>(a)]; head(npos); qhead(nq[static_cast<std::size_t>(a)]); }
      }
    }
    const auto& labs = labelKeys();
    for (std::size_t l = 0; l < labs.size(); ++l)
    {
      const double m = labs[l].mass, mb = labs[l].mass + 0.5;
      lab_n[l] += near_(nterm, m);
      lab_c[l] += near_(cterm, m);
      lab_bg_n[l] += near_(nterm, mb);
      lab_bg_c[l] += near_(cterm, mb);
    }
    // 1.12 D #3d: one count per flank that is a two-residue sum.
    if (bins_)
    {
      if (const int b = bins_->find(cterm); b >= 0) ++dip[static_cast<std::size_t>(b)];
      if (const int b = bins_->find(nterm - kH2O); b >= 0) ++dip[static_cast<std::size_t>(b)];
    }
  }

  void TerminusCounter::merge(const TerminusCounter& o)
  {
    tags += o.tags;
    auto add = [](auto& a, const auto& b) { for (std::size_t i = 0; i < a.size(); ++i) a[i] += b[i]; };
    add(c_near, o.c_near);
    add(n_h2o, o.n_h2o);
    add(n_near, o.n_near);
    add(lab_n, o.lab_n);
    add(lab_c, o.lab_c);
    add(lab_bg_n, o.lab_bg_n);
    add(lab_bg_c, o.lab_bg_c);
    for (std::size_t p = 0; p < 4; ++p) { add(cpos[p], o.cpos[p]); add(npos[p], o.npos[p]); }
    for (std::size_t a = 0; a < cq.size(); ++a) { add(cq[a], o.cq[a]); add(nq[a], o.nq[a]); }  // 1.13 digqual
    if (o.bins_)
    {
      if (!bins_) { bins_ = o.bins_; dip.assign(o.dip.size(), 0); }
      if (dip.size() == o.dip.size()) add(dip, o.dip);
    }
  }

  std::uint64_t TerminusCounter::tot() const
  {
    std::uint64_t t = 0;
    for (int k = 0; k < kNumKeys; ++k) t += res(k);
    return t;
  }

  // ---- model table ------------------------------------------------------

  namespace
  {
    std::vector<std::string> splitTabs(const std::string& line)
    {
      std::vector<std::string> f;
      std::size_t s = 0;
      while (true)
      {
        const std::size_t t = line.find('\t', s);
        f.push_back(line.substr(s, t == std::string::npos ? std::string::npos : t - s));
        if (t == std::string::npos) break;
        s = t + 1;
      }
      return f;
    }

    /// A whole-field decimal in the "C" locale, whatever the process locale.
    bool parseDouble(const std::string& s, double& v)
    {
      if (s.empty()) return false;
      std::istringstream in(s);
      in.imbue(std::locale::classic());
      in >> v;
      return !in.fail() && in.peek() == std::char_traits<char>::eof();
    }

    bool fail(std::string* err, const std::string& msg)
    {
      if (err) *err = msg;
      return false;
    }

    /// Lines without their CR, '#' lines to @p header, the column header
    /// checked against @p cols; calls @p row with each data row's fields.
    template <typename Row>
    bool readTable(std::istream& in, const std::vector<std::string>& cols, std::vector<std::string>* header,
                   std::string* err, Row&& row)
    {
      std::string line;
      bool have_cols = false;
      std::size_t ln = 0;
      while (std::getline(in, line))
      {
        ++ln;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        if (line[0] == '#')
        {
          if (header) header->push_back(line.substr(1));
          continue;
        }
        const std::vector<std::string> f = splitTabs(line);
        if (!have_cols)
        {
          if (f != cols)
          {
            std::string want;
            for (const auto& c : cols) want += (want.empty() ? "" : " ") + c;
            return fail(err, "line " + std::to_string(ln) + ": expected the columns " + want);
          }
          have_cols = true;
          continue;
        }
        if (f.size() != cols.size())
          return fail(err, "line " + std::to_string(ln) + ": " + std::to_string(f.size()) + " fields, expected " +
                               std::to_string(cols.size()));
        if (!row(f, ln)) return false;
      }
      if (!have_cols) return fail(err, "no column header");
      return true;
    }
  }

  bool parseModelTable(std::istream& in, ModelTable& out, std::string* err)
  {
    out = ModelTable();
    std::array<bool, kNumAA> bgc_seen{}, bgn_seen{};
    // per model and end: rows given, '*' given
    std::map<std::string, std::array<int, 4>> state;  // c_rows, c_star, n_rows, n_star
    // per model: residue rows seen at the C (first) and N (second) end
    std::map<std::string, std::pair<std::array<bool, kNumAA>, std::array<bool, kNumAA>>> res_seen;
    auto model_of = [&](const std::string& name, const std::string& cls) -> Model* {
      for (Model& m : out.models)
        if (m.name == name) return m.cls == cls ? &m : nullptr;
      out.models.push_back(Model{name, cls, {}, {}, true, true});
      return &out.models.back();
    };
    // 1.12 D (#3c, #3e): the v2 rows, read only below the v2 marker.
    std::map<std::string, std::pair<std::array<bool, kNumAA>, std::array<bool, kNumAA>>> det_seen;
    bool ref_seen[2] = {false, false}, spec_seen[2] = {false, false};
    auto is_v2 = [&]() {
      for (const std::string& h : out.header)
      {
        const std::size_t a = h.find_first_not_of(" \t");
        const std::size_t b = h.find_last_not_of(" \t");
        if (a != std::string::npos && h.compare(a, b - a + 1, kModelsV2Marker) == 0) return true;
      }
      return false;
    };
    const bool ok = readTable(
        in, {"model", "class", "end", "residue", "freq"}, &out.header, err,
        [&](const std::vector<std::string>& f, std::size_t ln) {
          const std::string at = "line " + std::to_string(ln) + ": ";
          const std::string &name = f[0], &cls = f[1], &end = f[2], &res = f[3];
          if (name.empty()) return fail(err, at + "empty model name");
          if ((name == "detection" || name == "reference" || name == "specificity") && is_v2())
          {
            out.version = 2;
            double v = 0;
            if (!parseDouble(f[4], v) || !(v >= 0) || !std::isfinite(v))
              return fail(err, at + "'" + name + "' value '" + f[4] + "' is not a non-negative number");
            if (name == "specificity")
            {
              const int k = cls == "trypsin" ? 0 : cls == "nontryptic" ? 1 : -1;
              if (k < 0) return fail(err, at + "specificity class must be trypsin or nontryptic, not '" + cls + "'");
              if (end != "-" || res != "-") return fail(err, at + "a specificity row has end and residue '-'");
              if (!(v < 1)) return fail(err, at + "a specificity must be below 1");
              if (spec_seen[k]) return fail(err, at + "specificity " + cls + " given twice");
              spec_seen[k] = true;
              (k == 0 ? out.s_trypsin : out.s_nontryptic) = v;
              out.has_specificity = true;
              return true;
            }
            if (name == "reference")
            {
              const int k = res == "K" ? 0 : res == "R" ? 1 : -1;
              if (cls != "-" || end != "C" || k < 0) return fail(err, at + "a reference row is 'reference - C K|R <freq>'");
              if (!(v <= 1)) return fail(err, at + "a reference share must be at most 1");
              if (ref_seen[k]) return fail(err, at + "reference " + res + " given twice");
              ref_seen[k] = true;
              (k == 0 ? out.ref_k : out.ref_r) = v;
              out.has_reference = true;
              return true;
            }
            if (std::find(kInstrumentClasses.begin(), kInstrumentClasses.end(), cls) == kInstrumentClasses.end())
              return fail(err, at + "detection class must be orbitrap_hcd, timstof or other, not '" + cls + "'");
            if (end != "C" && end != "N") return fail(err, at + "end must be C or N, not '" + end + "'");
            if (res.size() != 1 || aaIndex(res[0]) < 0 || res[0] == 'I')
              return fail(err, at + "residue '" + res + "' is none of " + std::string(kAAs));
            Detection* d = nullptr;
            for (Detection& x : out.detection)
              if (x.cls == cls) d = &x;
            if (!d)
            {
              out.detection.push_back(Detection{cls, {}, {}});
              d = &out.detection.back();
              d->c.fill(1.0);
              d->n.fill(1.0);
            }
            const std::size_t a = static_cast<std::size_t>(aaIndex(res[0]));
            auto& seen = end == "C" ? det_seen[cls].first : det_seen[cls].second;
            if (seen[a]) return fail(err, at + "detection " + cls + " " + end + " " + res + " given twice");
            seen[a] = true;
            (end == "C" ? d->c : d->n)[a] = v;
            return true;
          }
          if (end != "C" && end != "N") return fail(err, at + "end must be C or N, not '" + end + "'");
          const bool cend = end == "C";
          if (res == "*")
          {
            if (name == "background") return fail(err, at + "the background cannot be '*'");
            Model* m = model_of(name, cls);
            if (!m) return fail(err, at + "model '" + name + "' has two classes");
            auto& s = state[name];
            if (s[cend ? 0 : 2]) return fail(err, at + "'*' and residue rows for one end of '" + name + "'");
            s[cend ? 1 : 3] = 1;
            return true;
          }
          if (res.size() != 1 || aaIndex(res[0]) < 0 || res[0] == 'I')
            return fail(err, at + "residue '" + res + "' is none of " + std::string(kAAs) + " or '*'");
          const std::size_t a = static_cast<std::size_t>(aaIndex(res[0]));
          double v = 0;
          if (!parseDouble(f[4], v) || !(v >= 0) || !std::isfinite(v))
            return fail(err, at + "freq '" + f[4] + "' is not a non-negative number");
          if (name == "background")
          {
            auto& seen = cend ? bgc_seen : bgn_seen;
            if (seen[a]) return fail(err, at + "background " + end + " " + res + " given twice");
            seen[a] = true;
            (cend ? out.bg_c : out.bg_n)[a] = v;
            out.has_bg = true;
            return true;
          }
          Model* m = model_of(name, cls);
          if (!m) return fail(err, at + "model '" + name + "' has two classes");
          auto& s = state[name];
          if (s[cend ? 1 : 3]) return fail(err, at + "'*' and residue rows for one end of '" + name + "'");
          s[cend ? 0 : 2] = 1;
          auto& rs = res_seen[name];
          auto& seen = cend ? rs.first : rs.second;
          // As for the background: a repeated row silently replaced the first.
          if (seen[a]) return fail(err, at + "'" + name + "' " + end + " " + res + " given twice");
          seen[a] = true;
          (cend ? m->c : m->n)[a] = v;
          (cend ? m->c_bg : m->n_bg) = false;
          return true;
        });
    if (!ok) return false;
    if (is_v2()) out.version = 2;
    if (out.has_reference && !(ref_seen[0] && ref_seen[1]))
      return fail(err, "a reference needs both its K and its R row");
    if (out.has_specificity && !(spec_seen[0] && spec_seen[1]))
      return fail(err, "the specificity needs both its trypsin and its nontryptic row");
    for (const Detection& d : out.detection)
      if (std::accumulate(d.c.begin(), d.c.end(), 0.0) <= 0.0 || std::accumulate(d.n.begin(), d.n.end(), 0.0) <= 0.0)
        return fail(err, "detection " + d.cls + " has an end whose weights are all 0");
    if (out.has_bg)
      for (int a = 0; a < kNumAA; ++a)
        if (!bgc_seen[a] || !bgn_seen[a])
          return fail(err, std::string("the background has no row for ") + kAAs[a] + " at the " +
                               (bgc_seen[a] ? "N" : "C") + " end; it needs all 19 residues at both ends");
    if (out.models.empty()) return fail(err, "no model");
    // An end with no mass makes loglik log(0/0) = NaN once mixed with an
    // all-zero background or a background share of 0, and the report then
    // blamed "a residue ... has probability 0".
    const auto massless = [](const Dist& d) {
      return std::accumulate(d.begin(), d.end(), 0.0) <= 0.0;
    };
    if (out.has_bg && (massless(out.bg_c) || massless(out.bg_n)))
      return fail(err, "the background has an end whose frequencies are all 0");
    for (const Model& m : out.models)
      if ((!m.c_bg && massless(m.c)) || (!m.n_bg && massless(m.n)))
        return fail(err, "model '" + m.name + "' has an end whose frequencies are all 0");
    return true;
  }

  bool loadModelTable(const std::string& path, ModelTable& out, std::string* err)
  {
    std::ifstream in(path);
    if (!in) return fail(err, "cannot read " + path);
    return parseModelTable(in, out, err);
  }

  void addResidues(const std::string& seq, std::array<std::uint64_t, kNumAA>& cnt)
  {
    for (char c : seq)
    {
      if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
      if (const int a = aaIndex(c); a >= 0) ++cnt[static_cast<std::size_t>(a)];
    }
  }

  Dist composition(std::array<std::uint64_t, kNumAA> cnt, bool pseudocount, bool* added)
  {
    const bool add = pseudocount && std::find(cnt.begin(), cnt.end(), std::uint64_t{0}) != cnt.end();
    if (add)
      for (auto& x : cnt) ++x;
    if (added) *added = add;
    const std::uint64_t total = std::accumulate(cnt.begin(), cnt.end(), std::uint64_t{0});
    Dist d{};
    for (int a = 0; a < kNumAA; ++a)
      d[a] = total ? static_cast<double>(cnt[a]) / static_cast<double>(total) : 0.0;
    return d;
  }

  Dist composition(const std::vector<std::string>& sequences)
  {
    std::array<std::uint64_t, kNumAA> cnt{};
    for (const std::string& s : sequences) addResidues(s, cnt);
    return composition(cnt, false);
  }

  namespace
  {
    /// Multinomial log-likelihood of the counts under p, normalised by p's
    /// sum.
    double loglik(const std::array<std::uint64_t, kNumAA>& cnt, const Dist& p)
    {
      PySum z;
      for (double x : p) z.add(x);
      const double zz = z.value();
      PySum s;
      for (int a = 0; a < kNumAA; ++a)
        if (cnt[a]) s.add(static_cast<double>(cnt[a]) * std::log(p[a] / zz));
      return s.value();
    }

    Dist mix(const Dist& p, const Dist& bg, double share)
    {
      Dist out{};
      for (int a = 0; a < kNumAA; ++a) out[a] = (1 - share) * p[a] + share * bg[a];
      return out;
    }
  }

  /// Ranks r.scores: top, runner_up (best of another class), nonfinite, tied
  /// and margin, as the 1.11 classifier did.
  void rankScores(Classification& r);

  Classification classify(const std::array<std::uint64_t, kNumAA>& cterm,
                          const std::array<std::uint64_t, kNumAA>& nterm,
                          const ModelTable& table, double share, int tag_min)
  {
    Classification r;
    for (int a = 0; a < kNumAA; ++a) { r.n_c += cterm[a]; r.n_n += nterm[a]; }
    const std::uint64_t min = static_cast<std::uint64_t>(std::max(0, tag_min));
    if (r.n_c < min) return r;
    r.scored = true;
    r.uses_nterm = r.n_n >= min;
    for (const Model& m : table.models)
    {
      const Dist pc = mix(m.c_bg ? table.bg_c : m.c, table.bg_c, share);
      double sc = loglik(cterm, pc);
      if (r.uses_nterm) sc = sc + loglik(nterm, mix(m.n_bg ? table.bg_n : m.n, table.bg_n, share));
      else sc = sc + 0.0;
      r.scores.push_back({m.name, m.cls, sc});
    }
    rankScores(r);
    return r;
  }

  void rankScores(Classification& r)
  {
    std::vector<int> rk(r.scores.size());
    std::iota(rk.begin(), rk.end(), 0);
    // NaN ranks last, so the order stays a strict weak ordering.
    auto key = [&](int x) {
      const double v = r.scores[x].loglik;
      return std::isnan(v) ? std::numeric_limits<double>::infinity() : -v;
    };
    std::stable_sort(rk.begin(), rk.end(), [&](int x, int y) { return key(x) < key(y); });
    r.top = rk.front();
    for (int k : rk)
      if (r.scores[k].cls != r.scores[r.top].cls) { r.runner_up = k; break; }
    const double best = r.scores[r.top].loglik;
    r.nonfinite = !std::isfinite(best) || (r.runner_up >= 0 && !std::isfinite(r.scores[r.runner_up].loglik));
    if (r.runner_up >= 0 && !r.nonfinite && r.scores[r.runner_up].loglik == best)
      for (const ModelScore& m : r.scores)
        if (m.loglik == best) r.tied.push_back(m.name);
    if (r.runner_up >= 0)
      r.margin = (best - r.scores[r.runner_up].loglik) /
                 static_cast<double>(r.n_c + (r.uses_nterm ? r.n_n : 0));
  }

  // ---- 1.12 D: detection, specificity, flank2, calibration (#3c-#3f) ----

  const Detection* ModelTable::detectionFor(std::string_view cls) const
  {
    for (const Detection& d : detection)
      if (d.cls == cls) return &d;
    return nullptr;
  }

  namespace
  {
    /// e * p rescaled to the sum of p (p as is when e is null or the product
    /// is 0). Keeping p's scale makes unit weights the 1.11 ends bit for bit:
    /// the factor is then exactly 1 (mix() does not normalise, so a table
    /// whose background does not sum to 1 keeps its 1.11 scores too).
    Dist weigh(const Dist& p, const Dist* e)
    {
      if (!e) return p;
      Dist out{};
      PySum z, zp;
      for (int a = 0; a < kNumAA; ++a)
      {
        out[a] = (*e)[a] * p[a];
        z.add(out[a]);
        zp.add(p[a]);
      }
      const double zz = z.value();
      if (!(zz > 0)) return p;
      const double k = zp.value() / zz;
      for (double& x : out) x *= k;
      return out;
    }

    double shareOf(const Model& m, double share, const ClassifyOptions& opt)
    {
      if (!opt.specificity) return share;
      return m.cls == "Trypsin" ? opt.s_trypsin : opt.s_nontryptic;
    }

    /// The model's C (or N) end as classify() scores it under @p opt.
    Dist endOf(const Model& m, bool cend, const ModelTable& t, double share, const ClassifyOptions& opt)
    {
      const Dist* e = opt.detection ? (cend ? &opt.detection->c : &opt.detection->n) : nullptr;
      const Dist& bg = cend ? t.bg_c : t.bg_n;
      const Dist& p = cend ? (m.c_bg ? t.bg_c : m.c) : (m.n_bg ? t.bg_n : m.n);
      return mix(weigh(p, e), weigh(bg, e), shareOf(m, share, opt));
    }

    /// loglik() over any number of bins.
    double loglikV(const std::vector<std::uint64_t>& cnt, const std::vector<double>& p)
    {
      PySum z;
      for (double x : p) z.add(x);
      const double zz = z.value();
      PySum s;
      for (std::size_t b = 0; b < cnt.size(); ++b)
        if (cnt[b]) s.add(static_cast<double>(cnt[b]) * std::log(p[b] / zz));
      return s.value();
    }
  }

  Classification classify(const std::array<std::uint64_t, kNumAA>& cterm,
                          const std::array<std::uint64_t, kNumAA>& nterm,
                          const ModelTable& table, double share, int tag_min,
                          const ClassifyOptions& opt)
  {
    if (!opt.active()) return classify(cterm, nterm, table, share, tag_min);
    Classification r;
    for (int a = 0; a < kNumAA; ++a) { r.n_c += cterm[a]; r.n_n += nterm[a]; }
    const std::uint64_t min = static_cast<std::uint64_t>(std::max(0, tag_min));
    if (r.n_c < min) return r;
    r.scored = true;
    r.uses_nterm = r.n_n >= min;
    for (const Model& m : table.models)
    {
      double sc = loglik(cterm, endOf(m, true, table, share, opt));
      if (r.uses_nterm) sc = sc + loglik(nterm, endOf(m, false, table, share, opt));
      else sc = sc + 0.0;  // as the 1.11 classifier (-0 reads 0)
      r.scores.push_back({m.name, m.cls, sc});
    }
    rankScores(r);
    return r;
  }

  Flank2Bins flank2Bins(double window)
  {
    Flank2Bins b;
    b.window = window;
    const auto& keys = residueKeys();
    struct P { double m; int x, y; };
    std::vector<P> all;
    for (int x = 0; x < kNumAA; ++x)
      for (int y = 0; y < kNumAA; ++y)
        all.push_back({keys[static_cast<std::size_t>(x)].mass + keys[static_cast<std::size_t>(y)].mass, x, y});
    std::stable_sort(all.begin(), all.end(), [](const P& a, const P& c) { return a.m < c.m; });
    for (std::size_t i = 0; i < all.size(); ++i)
    {
      if (i == 0 || all[i].m - all[i - 1].m > window)
      {
        b.lo.push_back(all[i].m);
        b.hi.push_back(all[i].m);
        b.pairs.emplace_back();
      }
      b.hi.back() = all[i].m;
      b.pairs.back().emplace_back(all[i].x, all[i].y);
      b.sums.push_back(all[i].m);
      b.bin_of.push_back(static_cast<int>(b.pairs.size()) - 1);
    }
    return b;
  }

  int Flank2Bins::find(double mass) const
  {
    if (sums.empty() || !std::isfinite(mass)) return -1;
    const auto it = std::lower_bound(sums.begin(), sums.end(), mass);
    std::size_t k = static_cast<std::size_t>(it - sums.begin());
    if (k == sums.size() || (k > 0 && mass - sums[k - 1] <= sums[k] - mass)) --k;
    return std::fabs(sums[k] - mass) <= window ? bin_of[k] : -1;
  }

  void TerminusCounter::enableFlank2()
  {
    bins_ = std::make_shared<const Flank2Bins>(flank2Bins(w_));
    dip.assign(bins_->pairs.size(), 0);
  }

  Classification classify2(const std::vector<std::uint64_t>& dip, const Flank2Bins& bins,
                           const ModelTable& table, double share, int tag_min, const ClassifyOptions& opt)
  {
    Classification r;
    for (std::uint64_t v : dip) r.n_c += v;
    const std::uint64_t min = static_cast<std::uint64_t>(std::max(0, tag_min));
    if (r.n_c < min || dip.size() != bins.pairs.size()) return r;
    r.scored = true;
    for (const Model& m : table.models)
    {
      const Dist p1 = endOf(m, true, table, share, opt);
      std::vector<double> pred(bins.pairs.size(), 0.0);
      for (std::size_t k = 0; k < bins.pairs.size(); ++k)
      {
        PySum s;
        for (const auto& [x, y] : bins.pairs[k]) s.add(table.bg_c[static_cast<std::size_t>(x)] * p1[static_cast<std::size_t>(y)]);
        pred[k] = s.value();
      }
      r.scores.push_back({m.name, m.cls, loglikV(dip, pred)});
    }
    rankScores(r);
    return r;
  }

  bool parseCalibration(std::istream& in, Calibration& out, std::string* err)
  {
    out = Calibration();
    bool seen[4] = {false, false, false, false};
    const bool ok = readTable(in, {"feature", "coef"}, &out.header, err,
                              [&](const std::vector<std::string>& f, std::size_t ln) {
                                const std::string at = "line " + std::to_string(ln) + ": ";
                                static const char* const names[4] = {"intercept", "margin", "log_n", "first_peak"};
                                int k = -1;
                                for (int i = 0; i < 4; ++i)
                                  if (f[0] == names[i]) k = i;
                                if (k < 0) return fail(err, at + "feature '" + f[0] + "' is none of intercept, margin, log_n, first_peak");
                                if (seen[k]) return fail(err, at + "feature '" + f[0] + "' given twice");
                                double v = 0;
                                if (!parseDouble(f[1], v) || !std::isfinite(v)) return fail(err, at + "coef '" + f[1] + "' is not a number");
                                seen[k] = true;
                                (k == 0 ? out.intercept : k == 1 ? out.margin : k == 2 ? out.log_n : out.first_peak) = v;
                                return true;
                              });
    if (!ok) return false;
    for (int i = 0; i < 4; ++i)
      if (!seen[i]) return fail(err, "the calibration needs all four features intercept, margin, log_n and first_peak");
    out.loaded = true;
    return true;
  }

  bool loadCalibration(const std::string& path, Calibration& out, std::string* err)
  {
    std::ifstream in(path);
    if (!in) return fail(err, "cannot read " + path);
    return parseCalibration(in, out, err);
  }

  double pCorrect(const Calibration& cal, double margin, std::uint64_t n, bool first_peak)
  {
    const double z = cal.intercept + cal.margin * margin +
                     cal.log_n * std::log(static_cast<double>(std::max<std::uint64_t>(n, 1))) +
                     cal.first_peak * (first_peak ? 1.0 : 0.0);
    return 1.0 / (1.0 + std::exp(-z));
  }
  // ---- end 1.12 D ----

  // ---- mass gaps --------------------------------------------------------

  bool parseGapMods(std::istream& in, std::vector<GapMod>& out, std::string* err)
  {
    out.clear();
    return readTable(in, {"name", "site", "prior"}, nullptr, err,
                     [&](const std::vector<std::string>& f, std::size_t ln) {
                       double p = 0;
                       if (f[0].empty() || f[1].empty() || !parseDouble(f[2], p))
                         return fail(err, "line " + std::to_string(ln) + ": need a name, a site and a prior");
                       out.push_back(GapMod{f[0], f[1], p, 0.0});
                       return true;
                     });
  }

  std::vector<Combo> combinations(const std::vector<GapMod>& mods, int max_mods)
  {
    std::vector<Combo> out;
    const int n = static_cast<int>(mods.size());
    // itertools.combinations_with_replacement: non-decreasing index tuples
    for (int k = 1; k <= max_mods && n > 0; ++k)
    {
      std::vector<int> idx(static_cast<std::size_t>(k), 0);
      while (true)
      {
        PySum s;
        for (int i : idx) s.add(mods[static_cast<std::size_t>(i)].mass);
        out.push_back(Combo{s.value(), idx});
        int j = k - 1;
        while (j >= 0 && idx[static_cast<std::size_t>(j)] == n - 1) --j;
        if (j < 0) break;
        const int v = idx[static_cast<std::size_t>(j)] + 1;
        for (int q = j; q < k; ++q) idx[static_cast<std::size_t>(q)] = v;
      }
    }
    // Python sorts (mass, names) tuples: mass, then the names elementwise.
    std::sort(out.begin(), out.end(), [&](const Combo& a, const Combo& b) {
      if (a.mass != b.mass) return a.mass < b.mass;
      return std::lexicographical_compare(
          a.mods.begin(), a.mods.end(), b.mods.begin(), b.mods.end(),
          [&](int x, int y) { return mods[static_cast<std::size_t>(x)].name < mods[static_cast<std::size_t>(y)].name; });
    });
    return out;
  }

  std::vector<std::vector<int>> explain(const std::vector<Combo>& combos, const std::vector<GapMod>& mods,
                                        double delta, double tol)
  {
    const auto lo = std::lower_bound(combos.begin(), combos.end(), delta - tol,
                                     [](const Combo& c, double v) { return c.mass < v; });
    const auto hi = std::upper_bound(combos.begin(), combos.end(), delta + tol,
                                     [](double v, const Combo& c) { return v < c.mass; });
    std::vector<const Combo*> hits;
    for (auto it = lo; it < hi; ++it) hits.push_back(&*it);
    auto prior = [&](const Combo& c) {
      double p = 1.0;
      for (int i : c.mods) p *= mods[static_cast<std::size_t>(i)].prior;
      return p;
    };
    std::stable_sort(hits.begin(), hits.end(), [&](const Combo* a, const Combo* b) {
      if (a->mods.size() != b->mods.size()) return a->mods.size() < b->mods.size();
      const double pa = -prior(*a), pb = -prior(*b);
      if (pa != pb) return pa < pb;
      return std::fabs(a->mass - delta) < std::fabs(b->mass - delta);
    });
    std::vector<std::vector<int>> out;
    for (const Combo* c : hits) out.push_back(c->mods);
    return out;
  }

  GapResult detectGaps(const std::vector<GapRow>& hist, const std::vector<GapMod>& mods,
                       const std::vector<Combo>& combos, double tol, std::uint64_t min_spectra,
                       double min_share, double silac_share, std::uint64_t silac_min)
  {
    GapResult r;
    for (const GapRow& h : hist) r.placed += h.spectra;
    for (const GapRow& h : hist)
      if (std::fabs(h.delta) > 2 * tol) r.shifted += h.spectra;
    if (!r.placed) return r;

    // A peak is the sum of all unclaimed rows within tol of its top row.
    // src[k]: the index in @p hist of bins[k]. Rows equal in (delta, spectra)
    // are interchangeable, so bins is the same sequence a sort of the rows
    // themselves gives.
    std::vector<std::size_t> src(hist.size());
    std::iota(src.begin(), src.end(), std::size_t{0});
    std::stable_sort(src.begin(), src.end(), [&hist](std::size_t a, std::size_t b) {
      const GapRow& x = hist[a];
      const GapRow& y = hist[b];
      return x.delta != y.delta ? x.delta < y.delta : x.spectra < y.spectra;
    });
    std::vector<GapRow> bins;
    bins.reserve(hist.size());
    for (const std::size_t k : src) bins.push_back(hist[k]);
    std::vector<double> deltas;
    for (const GapRow& b : bins) deltas.push_back(b.delta);
    std::vector<char> claimed(bins.size(), 0);
    std::vector<std::size_t> order(bins.size());
    std::iota(order.begin(), order.end(), std::size_t{0});
    std::stable_sort(order.begin(), order.end(),
                     [&](std::size_t a, std::size_t b) { return bins[a].spectra > bins[b].spectra; });
    const double thr = std::max(static_cast<double>(min_spectra), min_share * static_cast<double>(r.placed));
    for (const std::size_t i : order)
    {
      if (claimed[i] || std::fabs(bins[i].delta) <= tol) continue;
      double d = bins[i].delta;
      const std::size_t lo = static_cast<std::size_t>(std::lower_bound(deltas.begin(), deltas.end(), d - tol) - deltas.begin());
      const std::size_t hi = static_cast<std::size_t>(std::upper_bound(deltas.begin(), deltas.end(), d + tol) - deltas.begin());
      std::uint64_t n = 0;
      PySum ds;
      std::vector<std::size_t> members;
      for (std::size_t j = lo; j < hi; ++j)
      {
        if (claimed[j]) continue;
        claimed[j] = 1;
        n += bins[j].spectra;
        ds.add(bins[j].delta * static_cast<double>(bins[j].spectra));
        members.push_back(src[j]);
      }
      d = ds.value() / static_cast<double>(n);
      if (static_cast<double>(n) < thr || std::fabs(d) <= 2 * tol) continue;  // calibration offsets
      const auto ex = explain(combos, mods, d, tol);
      GapPeak p{d, n, {}, {}, {}, {}};
      std::sort(members.begin(), members.end());
      p.members = std::move(members);
      if (!ex.empty())
      {
        p.explained_by = ex.front();
        for (std::size_t k = 1; k < ex.size() && k < 8; ++k) p.alternatives.push_back(ex[k]);
      }
      r.peaks.push_back(std::move(p));
    }

    // Isobaric combinations: prefer the one whose members the run also shows
    // as single-modification peaks.
    std::map<int, std::uint64_t> alone;
    for (const GapPeak& p : r.peaks)
      if (p.explained_by.size() == 1) alone[p.explained_by.front()] += p.spectra;
    auto score = [&](const std::vector<int>& c) {
      std::uint64_t s = std::numeric_limits<std::uint64_t>::max();
      for (int m : c)
      {
        const auto it = alone.find(m);
        s = std::min(s, it == alone.end() ? std::uint64_t{0} : it->second);
      }
      return s;
    };
    for (GapPeak& p : r.peaks)
    {
      if (p.explained_by.empty()) continue;
      std::vector<std::vector<int>> ex{p.explained_by};
      ex.insert(ex.end(), p.alternatives.begin(), p.alternatives.end());
      if (ex.size() < 2 || ex.front().size() < 2) continue;
      const std::size_t k = ex.front().size();
      const std::vector<int>* best = nullptr;
      for (const auto& c : ex)
        if (c.size() == k && (!best || score(c) > score(*best))) best = &c;
      if (score(*best) > score(ex.front()))
      {
        const std::vector<int> b = *best;
        p.alternatives.clear();
        for (const auto& c : ex)
          if (c != b && p.alternatives.size() < 3) p.alternatives.push_back(c);
        p.explained_by = b;
        p.context = "members seen as single-modification peaks";
      }
    }
    // Three modifications explain almost any gap: kept only when each member
    // is also a single-modification peak.
    for (GapPeak& p : r.peaks)
    {
      if (p.explained_by.size() != 3) continue;
      bool all = true;
      for (int m : p.explained_by) all = all && alone.count(m);
      if (all) continue;
      std::vector<std::vector<int>> alt{p.explained_by};
      for (std::size_t k = 0; k < 2 && k < p.alternatives.size(); ++k) alt.push_back(p.alternatives[k]);
      p.alternatives = std::move(alt);
      p.explained_by.clear();
    }

    const double div = static_cast<double>(r.shifted ? r.shifted : 1);
    for (const GapPeak& p : r.peaks)
      for (int m : p.explained_by)
      {
        auto it = std::find_if(r.share.begin(), r.share.end(), [m](const auto& s) { return s.first == m; });
        if (it == r.share.end()) r.share.emplace_back(m, 0.0 + static_cast<double>(p.spectra) / div);
        else it->second = it->second + static_cast<double>(p.spectra) / div;
      }

    // silac_from_gaps
    static const char* const silac_mods[4] = {"Label:2H(4)", "Label:13C(6)", "Label:13C(6)15N(2)", "Label:13C(6)15N(4)"};
    bool seen[4] = {false, false, false, false};
    int n_seen = 0;
    for (int s = 0; s < 4; ++s)
    {
      for (const auto& [m, v] : r.share)
        if (mods[static_cast<std::size_t>(m)].name == silac_mods[s]) r.silac_share[static_cast<std::size_t>(s)] = v;
      seen[s] = r.silac_share[static_cast<std::size_t>(s)] >= silac_share;
      n_seen += seen[s];
    }
    if (n_seen >= 2 && std::max<std::uint64_t>(r.shifted, 1) >= silac_min)
    {
      const bool med = seen[0] || seen[1], heavy = seen[2] || seen[3];
      r.silac = med && heavy ? "SILAC triplex (Lys4/Arg6, Lys8/Arg10)"
              : heavy        ? "SILAC (Lys8/Arg10)"
                             : "SILAC (Lys4/Arg6)";
    }
    return r;
  }

  // ---- report rows ------------------------------------------------------

  std::string num(double v)
  {
    char b[64];
    return std::string(b, std::to_chars(b, b + sizeof b, v).ptr);
  }

  std::string num(std::uint64_t v) { return std::to_string(v); }

  bool writeReport(const std::string& path, const std::vector<Row>& rows)
  {
    std::ofstream out(path, std::ios::binary);
    if (!out) return false;
    auto field = [&](const std::string& s) {
      for (char c : s) out.put(c == '\t' || c == '\n' || c == '\r' ? ' ' : c);
    };
    out << "section\tkey\tvalue\tn\tdescription\n";
    for (const Row& r : rows)
    {
      field(r.section); out << '\t';
      field(r.key); out << '\t';
      field(r.value); out << '\t';
      field(r.n.empty() ? std::string("-") : r.n); out << '\t';
      field(r.description); out << '\n';
    }
    out.close();
    return !out.fail();
  }
}
