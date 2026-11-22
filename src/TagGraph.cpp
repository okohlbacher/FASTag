// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
//
// Port of gui/src/spectrum/{ladder,graph,stepScore}.ts (GUI 38b5da63); the
// comments name the TypeScript function each part follows. Arithmetic is
// written in the TypeScript's operation order (the build has
// -ffp-contract=off), so equal inputs give equal doubles and the same ties.

#include "TagGraph.h"

#include "NumFormat.h"

#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <memory>
#include <set>
#include <stdexcept>
#include <unordered_map>

namespace FASTag::TagGraph
{
  namespace
  {
    constexpr double INF = std::numeric_limits<double>::infinity();
    using E = std::optional<double>;

    // ---- JavaScript semantics ----
    /// A comparator result as JS sort reads (a - b): NaN is equal.
    int jsCmp(double a, double b)
    {
      const double d = a - b;
      return d < 0 ? -1 : d > 0 ? 1 : 0;
    }
    double jsMin(double a, double b) { return std::isnan(a) || std::isnan(b) ? std::nan("") : std::min(a, b); }
    double jsMax(double a, double b) { return std::isnan(a) || std::isnan(b) ? std::nan("") : std::max(a, b); }
    /// Math.round: half up.
    double jsRound(double x)
    {
      const double f = std::floor(x);
      return x - f >= 0.5 ? f + 1 : f;
    }
    /// A string a la String.prototype.localeCompare (ICU root collation) for
    /// the labels compared here: punctuation and symbols before digits before
    /// letters, letters by their case-folded value first, then lower case
    /// before upper case.
    int collateClass(unsigned char c, int& w)
    {
      static const std::string punct = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
      if (std::isalpha(c)) { w = std::tolower(c); return 2; }
      if (std::isdigit(c)) { w = c; return 1; }
      const size_t at = punct.find(static_cast<char>(c));
      w = at == std::string::npos ? 1000 + c : static_cast<int>(at);
      return 0;
    }
    int localeCompare(const std::string& a, const std::string& b)
    {
      const size_t n = std::min(a.size(), b.size());
      for (size_t i = 0; i < n; ++i)
      {
        int wa = 0, wb = 0;
        const int ca = collateClass(static_cast<unsigned char>(a[i]), wa);
        const int cb = collateClass(static_cast<unsigned char>(b[i]), wb);
        if (ca != cb) return ca < cb ? -1 : 1;
        if (wa != wb) return wa < wb ? -1 : 1;
      }
      if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;
      for (size_t i = 0; i < n; ++i)
        if (a[i] != b[i])
        {
          const bool la = std::islower(static_cast<unsigned char>(a[i])) != 0;
          return la ? -1 : 1;
        }
      return 0;
    }
    std::string il(std::string s)
    {
      for (char& c : s) if (c == 'I') c = 'L';
      return s;
    }

    double tolAt(const Peaks& s, double x) { return s.ppm ? (x * s.tolerance) / 1e6 : s.tolerance; }
    int byE(const E& a, const E& b) { return jsCmp(a.value_or(INF), b.value_or(INF)); }
    E minE(const E& a, const E& b)
    {
      if (!a) return b;
      if (!b) return a;
      return jsMin(*a, *b);
    }
    bool nTerminal(char s) { return s == 'b' || s == 'c'; }
    template <typename T>
    long indexOf(const std::vector<T>& v, const T& x)
    {
      const auto it = std::find(v.begin(), v.end(), x);
      return it == v.end() ? -1 : static_cast<long>(it - v.begin());
    }

    // ---- ladder.ts ----
    /// nearest: the peak nearest @p x within @p tol, or -1.
    int nearest(const std::vector<double>& mz, double x, double tol)
    {
      const long lo = static_cast<long>(std::lower_bound(mz.begin(), mz.end(), x) - mz.begin());
      long best = -1;
      for (long i : {lo - 1, lo})
      {
        if (i < 0 || i >= static_cast<long>(mz.size())) continue;
        if (std::fabs(mz[i] - x) <= tol && (best < 0 || std::fabs(mz[i] - x) < std::fabs(mz[best] - x))) best = i;
      }
      return static_cast<int>(best);
    }

    double complementTol(const Peaks& s, double x) { return tolAt(s, x) + (s.precursor ? tolAt(s, *s.precursor) : 0); }
    E complementOf(const Peaks& s, int k, int z)
    {
      if (!s.precursor || !(s.charge > 0)) return std::nullopt;
      return *s.precursor * s.charge - s.charge * PROTON - (s.mz[k] * z - z * PROTON);
    }

    SeriesCall seriesCall(const std::vector<int>& peaks, int z, char flank, const Peaks& s, const Residues& res)
    {
      if (flank == 'c' || flank == 'z') return {flank, Level::OPEN};
      if (s.ppm ? s.tolerance > SERIES_MAX_PPM : s.tolerance > SERIES_MAX_DA) return {flank, Level::OPEN};
      const auto neutral = [&](int k) { return s.mz[k] * z - z * PROTON; };
      const auto at = [&](double m) {
        const double x = (m + z * PROTON) / z;
        return nearest(s.mz, x, tolAt(s, x));
      };
      int aSelf = 0;
      for (int k : peaks) if (at(neutral(k) - CO) >= 0) ++aSelf;
      int aMirror = 0;
      for (int k : peaks)
      {
        const E m = complementOf(s, k, z);
        const int q = m ? at(*m) : -1;
        if (q >= 0 && at(neutral(q) - CO) >= 0) ++aMirror;
      }
      const double below = neutral(peaks[0]) - WATER;
      bool kr = false;
      for (char r : {'K', 'R'})
      {
        const auto it = res.base.find(r);
        if (it != res.base.end() && std::fabs(below - it->second) <= 2 * tolAt(s, below)) { kr = true; break; }
      }
      if (aSelf >= 2 && aMirror < 2) return {'b', Level::SURE};
      if (aSelf == 0 && aMirror >= 2) return {'y', Level::SURE};
      if (aSelf == 0 && kr) return {'y', Level::SURE};
      if (aSelf == 1 && aMirror == 0) return {'b', Level::LIKELY};
      if (aMirror == 1 && aSelf == 0) return {'y', Level::LIKELY};
      return {flank, Level::OPEN};
    }

    bool isComplement(const std::vector<int>& a, const std::vector<int>& b, int z, const Peaks& s)
    {
      int n = 0;
      for (int k : b)
      {
        const E m = complementOf(s, k, z);
        if (!m) continue;
        for (int j : a)
          if (std::fabs(s.mz[j] * z - z * PROTON - *m) <= complementTol(s, s.mz[j]) * z) { ++n; break; }
      }
      return n >= std::min<int>(2, static_cast<int>(b.size()));
    }

    char flip(char c) { return c == 'b' ? 'y' : c == 'y' ? 'b' : c == 'c' ? 'z' : 'c'; }
    std::pair<SeriesCall, SeriesCall> pairCalls(const SeriesCall& a, const SeriesCall& b)
    {
      if (a.level != Level::OPEN && b.level == Level::OPEN) return {a, {flip(a.series), a.level}};
      if (b.level != Level::OPEN && a.level == Level::OPEN) return {{flip(b.series), b.level}, b};
      if (a.level != Level::OPEN && b.level != Level::OPEN && a.series == b.series)
        return {{a.series, Level::OPEN}, {b.series, Level::OPEN}};
      return {a, b};
    }

    struct Pos
    {
      double expected = 0;
      int peak = -1;  ///< -1: off the peaks
      double dppm = 0, dmz = 0;
    };
    Pos atPeak(const Peaks& s, double x, int p) { return {x, p, ((s.mz[p] - x) / x) * 1e6, s.mz[p] - x}; }
    Pos off(double x) { return {x, -1, 0, 0}; }

    struct Chain
    {
      std::vector<Pos> positions;
      int matched = 0;
      bool end = false;
      double err = 0;
    };

    /// chainFrom: the best chain from peak @p p0 (position 0) over @p steps.
    Chain chainFrom(double x0, int p0, const std::vector<double>& steps, const Peaks& s, bool gaps)
    {
      const size_t n = steps.size();
      std::unordered_map<size_t, Chain> memo;
      const size_t np = s.mz.size();
      std::function<const Chain&(size_t, int)> tail = [&](size_t k, int p) -> const Chain& {
        static const Chain done{{}, 0, true, 0};
        if (k == n) return done;
        const size_t key = k * np + static_cast<size_t>(p);
        const auto hit = memo.find(key);
        if (hit != memo.end()) return hit->second;
        Chain best;
        bool have = false;
        const auto consider = [&](Chain&& c) {
          if (!have || int(c.end) > int(best.end)
              || (c.end == best.end && (c.matched > best.matched || (c.matched == best.matched && c.err < best.err))))
          {
            best = std::move(c);
            have = true;
          }
        };
        const double x1 = s.mz[p] + steps[k];
        const int q1 = nearest(s.mz, x1, tolAt(s, x1));
        if (q1 >= 0)
        {
          const Chain& t = tail(k + 1, q1);
          Chain c;
          c.positions.reserve(t.positions.size() + 1);
          c.positions.push_back(atPeak(s, x1, q1));
          c.positions.insert(c.positions.end(), t.positions.begin(), t.positions.end());
          c.matched = t.matched + 1;
          c.end = t.end;
          c.err = t.err + std::fabs(s.mz[q1] - x1);
          consider(std::move(c));
        }
        if (gaps && k + 2 <= n)
        {
          const double x2 = s.mz[p] + steps[k] + steps[k + 1];
          const int q2 = nearest(s.mz, x2, tolAt(s, x2));
          if (q2 >= 0)
          {
            const Chain& t = tail(k + 2, q2);
            Chain c;
            c.positions.reserve(t.positions.size() + 2);
            c.positions.push_back(off(x1));
            c.positions.push_back(atPeak(s, x2, q2));
            c.positions.insert(c.positions.end(), t.positions.begin(), t.positions.end());
            c.matched = t.matched + 1;
            c.end = t.end;
            c.err = t.err + std::fabs(s.mz[q2] - x2);
            consider(std::move(c));
          }
        }
        if (!have)
        {
          double x = s.mz[p];
          for (size_t j = k; j < n; ++j) best.positions.push_back(off((x += steps[j])));
          best.matched = 0;
          best.end = false;
          best.err = 0;
        }
        return memo.emplace(key, std::move(best)).first->second;
      };
      const Chain& t = tail(0, p0);
      Chain out;
      out.positions.reserve(t.positions.size() + 1);
      out.positions.push_back(atPeak(s, x0, p0));
      out.positions.insert(out.positions.end(), t.positions.begin(), t.positions.end());
      out.matched = t.matched + 1;
      out.end = t.end;
      out.err = t.err;
      return out;
    }

    struct Ladder
    {
      char series = 'b';
      int charge = 1;
      std::vector<Pos> positions;
      std::vector<std::string> residues;  ///< labels
      std::vector<double> masses;         ///< residue masses (between positions)
      int matched = 0;
      bool complete = false;
      bool has_call = false;
      SeriesCall call;
      char walked = 0;
    };

    /// walk: one series from the flank @p start.
    Ladder walk(char series, double start, const std::vector<double>& residues, const std::vector<std::string>& labels,
                int z, const Peaks& s, bool gapped)
    {
      const double x0 = (start + z * PROTON) / z;
      std::vector<double> steps;
      steps.reserve(residues.size());
      for (double m : residues) steps.push_back(m / z);
      const double window = (static_cast<double>(steps.size()) + 1) * tolAt(s, x0) + FLANK_SLACK / z;
      bool have = false;
      Chain best;
      double best_dist = 0;
      const double lo_x = x0 - window;
      size_t lo = 0;
      while (lo < s.mz.size() && !(s.mz[lo] >= lo_x)) ++lo;
      for (size_t i = lo; i < s.mz.size() && s.mz[i] <= x0 + window; ++i)
      {
        Chain c = chainFrom(x0, static_cast<int>(i), steps, s, gapped);
        const double dist = std::fabs(s.mz[i] - x0);
        const bool better = !have || int(c.end) > int(best.end)
            || (c.end == best.end
                && (c.matched > best.matched
                    || (c.matched == best.matched && (c.err < best.err || (c.err == best.err && dist < best_dist)))));
        if (better)
        {
          best = std::move(c);
          best_dist = dist;
          have = true;
        }
      }
      Ladder l;
      l.series = series;
      l.charge = z;
      l.residues = labels;
      l.masses = residues;
      if (have)
      {
        l.positions = std::move(best.positions);
        l.matched = best.matched;
      }
      else
      {
        l.positions.push_back(off(x0));
        double x = x0;
        for (double st : steps) l.positions.push_back(off((x += st)));
        l.matched = 0;
      }
      const size_t n = l.positions.size();
      l.complete = l.positions[0].peak >= 0 && l.positions[n - 1].peak >= 0 && (gapped || l.matched == static_cast<int>(n));
      return l;
    }

    std::vector<int> onPeaks(const Ladder& l)
    {
      std::vector<int> out;
      for (const Pos& p : l.positions) if (p.peak >= 0) out.push_back(p.peak);
      return out;
    }

    /// called: the ladder relabelled with the series its peaks are judged to be.
    void called(Ladder& l, const Peaks& s, const Residues& res)
    {
      const std::vector<int> peaks = onPeaks(l);
      if (peaks.empty()) return;
      l.call = seriesCall(peaks, l.charge, l.series, s, res);
      l.has_call = true;
      l.walked = l.series;
      l.series = l.call.series;
    }

    struct TagResidue
    {
      char residue;
      std::string mod;
      bool has_mod;
    };
    /// parseTag: /([A-Z])(?:\[([^\]]*)\])?/y over the whole string.
    std::optional<std::vector<TagResidue>> parseTag(const std::string& tag)
    {
      std::vector<TagResidue> out;
      size_t at = 0;
      while (at < tag.size())
      {
        const char c = tag[at];
        if (c < 'A' || c > 'Z') return std::nullopt;
        TagResidue r{c, "", false};
        ++at;
        if (at < tag.size() && tag[at] == '[')
        {
          const size_t close = tag.find(']', at + 1);
          if (close != std::string::npos)
          {
            r.mod = tag.substr(at + 1, close - at - 1);
            r.has_mod = true;
            at = close + 1;
          }
        }
        out.push_back(std::move(r));
      }
      if (out.empty()) return std::nullopt;
      return out;
    }

    /// laddersFor(...).both: the b/c walk then the y/z walk; empty when none can be built.
    std::vector<Ladder> laddersFor(const TagIn& row, const Peaks& s, const Residues& res)
    {
      const int z = row.charge;
      const auto parsed = parseTag(row.seq);
      if (!parsed) return {};
      std::vector<double> masses;
      std::vector<std::string> labels;
      for (const TagResidue& r : *parsed)
      {
        // An empty [] names no modification the GUI knows: no ladder.
        if (r.has_mod && r.mod.empty()) return {};
        const auto m = res.mass(r.residue, r.has_mod ? r.mod : std::string());
        if (!m) return {};
        masses.push_back(*m);
        labels.push_back(r.has_mod ? std::string(1, r.residue) + "[" + r.mod + "]" : std::string(1, r.residue));
      }
      if (s.mz.empty()) return {};
      const bool cz = row.cz;
      Ladder b = walk(cz ? 'c' : 'b', row.nterm_mass + (cz ? C_OFFSET : 0), masses, labels, z, s, row.gapped);
      called(b, s, res);
      std::vector<double> rm(masses.rbegin(), masses.rend());
      std::vector<std::string> rl(labels.rbegin(), labels.rend());
      Ladder y = walk(cz ? 'z' : 'y', row.cterm_mass + (cz ? Z_DOT_OFFSET : WATER), rm, rl, z, s, row.gapped);
      called(y, s, res);
      if (b.has_call && y.has_call && isComplement(onPeaks(b), onPeaks(y), z, s))
      {
        const auto [cb, cy] = pairCalls(b.call, y.call);
        b.call = cb;
        b.series = cb.series;
        y.call = cy;
        y.series = cy.series;
      }
      return {std::move(b), std::move(y)};
    }

    // ---- graph.ts ----
    std::string layerOfP(const Placement& p) { return layerOf(p.series, p.charge); }
    bool sameLabel(const Reading& a, const Reading& b) { return il(a.label) == il(b.label); }
    bool compatible(const Step& a, const Step& b)
    {
      for (const Reading& x : a.readings)
        for (const Reading& y : b.readings)
          if (sameLabel(x, y)) return true;
      return false;
    }
    void sortReadings(std::vector<Reading>& rs)
    {
      std::stable_sort(rs.begin(), rs.end(), [](const Reading& a, const Reading& b) {
        int c = byE(a.evalue, b.evalue);
        if (c == 0) c = localeCompare(il(a.label), il(b.label));
        return c < 0;
      });
    }
    std::string joinNum(double v)
    {
      // String(number) equality is double equality (NaN equals NaN).
      if (std::isnan(v)) return "NaN";
      std::string out;
      appendShortest(out, v);
      return out;
    }
    std::string peaksKey(const std::vector<int>& peaks)
    {
      std::string out;
      for (size_t i = 0; i < peaks.size(); ++i)
      {
        if (i) out += ',';
        out += std::to_string(peaks[i]);
      }
      return out;
    }

    /// place: the rows' placements in canonical order, and the rows off the peaks.
    void place(const std::vector<TagIn>& tags_in, const Peaks& s, const Residues& res, Graph& g)
    {
      struct Cand
      {
        const TagIn* t;
        Ladder l;
        std::string family;
        bool full;
      };
      std::vector<const TagIn*> tags;
      for (const TagIn& t : tags_in) tags.push_back(&t);
      std::stable_sort(tags.begin(), tags.end(), [](const TagIn* a, const TagIn* b) { return a->index < b->index; });
      std::vector<Cand> cands;
      for (const TagIn* t : tags)
      {
        const auto parsed = parseTag(t->seq);
        std::string comp;
        if (parsed)
        {
          std::vector<std::string> parts;
          for (const TagResidue& r : *parsed) parts.push_back(il(std::string(1, r.residue)) + (r.has_mod && !r.mod.empty() ? "[" + r.mod + "]" : ""));
          std::sort(parts.begin(), parts.end());
          for (const std::string& x : parts) comp += x;
        }
        else comp = t->seq;
        const std::string family = std::to_string(t->charge) + "|" + joinNum(t->nterm_mass) + "|" + joinNum(t->cterm_mass)
            + "|" + (t->cz ? "cz" : "by") + "|" + (t->evalue ? joinNum(*t->evalue) : std::string()) + "|" + comp;
        bool any = false;
        for (Ladder& l : laddersFor(*t, s, res))
        {
          if (!l.complete) continue;
          any = true;
          bool full = true;
          for (const Pos& p : l.positions) if (p.peak < 0) full = false;
          const char walked = l.walked ? l.walked : l.series;
          cands.push_back({t, std::move(l), family + "|" + walked, full});
        }
        if (!any) g.off_peaks.push_back(t->index);
      }
      std::set<std::string> with_gap;
      for (const Cand& c : cands) if (c.t->gapped && !c.full) with_gap.insert(c.family);
      std::vector<Placement> placements;
      std::unordered_map<std::string, size_t> by_chain;
      std::unordered_map<std::string, std::string> gap_of;
      std::vector<const Cand*> dropped;
      for (const Cand& c : cands)
      {
        if (c.t->gapped && c.full && with_gap.count(c.family)) { dropped.push_back(&c); continue; }
        const Ladder& l = c.l;
        const TagIn& t = *c.t;
        std::vector<int> peaks;
        std::vector<Step> steps;
        size_t from = 0;
        for (size_t k = 0; k < l.positions.size(); ++k)
        {
          const Pos& p = l.positions[k];
          if (p.peak < 0) continue;
          peaks.push_back(p.peak);
          if (k > 0)
          {
            std::vector<std::string> rs(l.residues.begin() + static_cast<long>(from), l.residues.begin() + static_cast<long>(k));
            double mass = 0;
            for (size_t j = from; j < k; ++j) mass += l.masses[j];
            const bool gap = rs.size() > 1;
            std::string label;
            if (gap)
            {
              std::stable_sort(rs.begin(), rs.end(), [](const std::string& x, const std::string& y) {
                int c = localeCompare(il(x), il(y));
                if (c == 0) c = localeCompare(x, y);
                return c < 0;
              });
              label = "[";
              for (const std::string& r : rs) label += r;
              label += "]";
            }
            else label = rs[0];
            Step st;
            st.u = l.positions[from].peak;
            st.v = p.peak;
            st.readings.push_back({label, gap, t.evalue, p.dmz, p.dppm, mass});
            steps.push_back(std::move(st));
          }
          from = k;
        }
        const std::string key = layerOf(l.series, l.charge) + "|" + peaksKey(peaks);
        if (t.gapped && !c.full && !gap_of.count(c.family)) gap_of.emplace(c.family, key);
        const auto have_it = by_chain.find(key);
        if (have_it == by_chain.end())
        {
          Placement pl;
          pl.call = l.has_call ? l.call : seriesCall(peaks, l.charge, l.series, s, res);
          pl.series = pl.call.series;
          pl.flank = l.walked ? l.walked : l.series;
          pl.flank_e = {t.evalue.value_or(INF), static_cast<double>(t.index)};
          pl.charge = l.charge;
          pl.peaks = std::move(peaks);
          pl.steps = std::move(steps);
          pl.rows = {t.index};
          pl.tags = {t.seq};
          pl.evalue = t.evalue;
          pl.gap_unresolved = t.gapped && c.full;
          by_chain.emplace(key, placements.size());
          placements.push_back(std::move(pl));
          continue;
        }
        Placement& have = placements[have_it->second];
        const std::pair<double, double> e{t.evalue.value_or(INF), static_cast<double>(t.index)};
        if (e.first < have.flank_e.first || (e.first == have.flank_e.first && e.second < have.flank_e.second))
        {
          have.flank = l.walked ? l.walked : l.series;
          have.flank_e = e;
          if (l.has_call)
          {
            have.call = l.call;
            have.series = l.call.series;
          }
        }
        if (std::find(have.rows.begin(), have.rows.end(), t.index) == have.rows.end())
        {
          have.rows.push_back(t.index);
          have.tags.push_back(t.seq);
        }
        have.evalue = minE(have.evalue, t.evalue);
        have.gap_unresolved = have.gap_unresolved && t.gapped && c.full;
        for (size_t k = 0; k < steps.size(); ++k)
        {
          const Reading& r = steps[k].readings[0];
          auto& hr = have.steps[k].readings;
          const auto same = std::find_if(hr.begin(), hr.end(), [&](const Reading& x) { return sameLabel(x, r); });
          if (same != hr.end()) same->evalue = minE(same->evalue, r.evalue);
          else hr.push_back(r);
        }
      }
      for (const Cand* c : dropped)
      {
        const auto go = gap_of.find(c->family);
        if (go == gap_of.end()) continue;
        const auto it = by_chain.find(go->second);
        if (it == by_chain.end()) continue;
        Placement& p = placements[it->second];
        if (std::find(p.rows.begin(), p.rows.end(), c->t->index) == p.rows.end())
        {
          p.rows.push_back(c->t->index);
          p.tags.push_back(c->t->seq);
        }
      }
      for (Placement& p : placements)
      {
        std::stable_sort(p.rows.begin(), p.rows.end());
        for (Step& st : p.steps) sortReadings(st.readings);
      }
      std::stable_sort(placements.begin(), placements.end(), [](const Placement& a, const Placement& b) {
        int c = localeCompare(layerOfP(a), layerOfP(b));
        if (c == 0) c = a.peaks[0] < b.peaks[0] ? -1 : a.peaks[0] > b.peaks[0] ? 1 : 0;
        if (c == 0) c = localeCompare(peaksKey(a.peaks), peaksKey(b.peaks));
        return c < 0;
      });
      g.placements = std::move(placements);
    }

    /// continues: where @p b continues @p a (the index in a.peaks of b.peaks[0]), or -1.
    long continues(const Placement& a, const Placement& b, bool join, int min_overlap)
    {
      if (layerOfP(a) != layerOfP(b)) return -1;
      const long i = indexOf(a.peaks, b.peaks[0]);
      if (i <= 0) return -1;
      const long over = static_cast<long>(a.peaks.size()) - i;
      if (static_cast<long>(b.peaks.size()) <= over) return -1;
      for (long k = 0; k < over; ++k) if (a.peaks[i + k] != b.peaks[k]) return -1;
      for (long k = 0; k + 1 < over; ++k) if (!compatible(a.steps[i + k], b.steps[k])) return -1;
      if (over == 1)
      {
        if (!join) return -1;
        const auto allGap = [](const Step& st) {
          for (const Reading& r : st.readings) if (!r.gap) return false;
          return true;
        };
        if (allGap(a.steps.back()) && allGap(b.steps.front())) return -1;
      }
      else if (over - 1 < min_overlap) return -1;
      return i;
    }

    /// settleSeries without decide.
    void settleSeries(Graph& g, const Peaks& s)
    {
      auto& paths = g.paths;
      for (Path& p : paths) p.same_as.clear();
      // layerOf(A) == layerOf(B), without building the strings.
      const auto cz = [](char x) { return x == 'c' || x == 'z'; };
      const auto sameLayer = [&](const Path& A, const Path& B) { return cz(A.series) == cz(B.series) && A.charge == B.charge; };
      // The GUI tries every pair. Only a pair where some peak of A is the
      // complement of a peak of B can be complementary, so the pairs are
      // found through the peaks that complement each path, in the same
      // (a, b) order: the calls change pair by pair.
      const auto settle = [&](size_t a, size_t b) {
        Path& A = paths[a];
        Path& B = paths[b];
        if (!sameLayer(A, B) || A.charge != B.charge || !isComplement(A.peaks, B.peaks, A.charge, s)) return;
        const auto [ca, cb] = pairCalls(A.call, B.call);
        A.series = ca.series;
        A.call = ca;
        B.series = cb.series;
        B.call = cb;
      };
      if (!std::is_sorted(s.mz.begin(), s.mz.end()))
      {
        for (size_t a = 0; a < paths.size(); ++a)
          for (size_t b = a + 1; b < paths.size(); ++b) settle(a, b);
      }
      else
      {
        double widest = 0;
        for (double x : s.mz) widest = std::max(widest, complementTol(s, x));
        widest += 1e-6;
        // comp_of[j]: the paths with a peak whose complement peak j may be.
        std::vector<std::vector<size_t>> comp_of(s.mz.size());
        std::vector<size_t> always;  // no peaks: isComplement holds for any A
        for (size_t b = 0; b < paths.size(); ++b)
        {
          const Path& B = paths[b];
          if (B.peaks.empty()) always.push_back(b);
          const int z = B.charge;
          for (int k : B.peaks)
          {
            const E m = complementOf(s, k, z);
            if (!m) continue;
            const double x = (*m + z * PROTON) / z;
            for (auto it = std::lower_bound(s.mz.begin(), s.mz.end(), x - widest); it != s.mz.end() && *it <= x + widest; ++it)
            {
              const size_t j = static_cast<size_t>(it - s.mz.begin());
              if (std::fabs(s.mz[j] * z - z * PROTON - *m) <= complementTol(s, s.mz[j]) * z
                  && (comp_of[j].empty() || comp_of[j].back() != b))
                comp_of[j].push_back(b);
            }
          }
        }
        std::vector<size_t> partners;
        for (size_t a = 0; a < paths.size(); ++a)
        {
          partners.clear();
          for (size_t b : always) if (b > a) partners.push_back(b);
          for (int j : paths[a].peaks)
            for (size_t b : comp_of[static_cast<size_t>(j)]) if (b > a) partners.push_back(b);
          std::sort(partners.begin(), partners.end());
          partners.erase(std::unique(partners.begin(), partners.end()), partners.end());
          for (size_t b : partners) settle(a, b);
        }
      }
      const E M = s.precursor && s.charge > 0 ? E(*s.precursor * s.charge - s.charge * PROTON) : std::nullopt;
      struct Cl { double m, tol; };
      struct Or { Cl a, b; const Step* step; };
      const auto oriented = [&](const Path& p) -> std::optional<std::vector<Or>> {
        std::vector<Cl> c;
        for (int i : p.peaks)
        {
          const double neutral = s.mz[i] * p.charge - p.charge * PROTON;
          const double tol = tolAt(s, s.mz[i]) * p.charge;
          if (p.series == 'b') c.push_back({neutral, tol});
          else if (p.series == 'c') c.push_back({neutral - C_OFFSET, tol});
          else
          {
            if (!M || !s.precursor) return std::nullopt;
            c.push_back({*M - WATER - (neutral - (p.series == 'y' ? WATER : Z_DOT_OFFSET)), tol + tolAt(s, *s.precursor) * s.charge});
          }
        }
        std::vector<Or> st;
        for (size_t k = 0; k < p.steps.size(); ++k)
          st.push_back(nTerminal(p.series) ? Or{c[k], c[k + 1], &p.steps[k]} : Or{c[k + 1], c[k], &p.steps[k]});
        if (!nTerminal(p.series)) std::reverse(st.begin(), st.end());
        return st;
      };
      std::vector<std::optional<std::vector<Or>>> ors;
      for (const Path& p : paths) ors.push_back(oriented(p));
      const auto near = [](const Cl& x, const Cl& y) { return std::fabs(x.m - y.m) <= x.tol + y.tol; };
      for (size_t a = 0; a < paths.size(); ++a)
        for (size_t b = a + 1; b < paths.size(); ++b)
        {
          const auto& A = ors[a];
          const auto& B = ors[b];
          if (!A || !B
              || (sameLayer(paths[a], paths[b]) && paths[a].series == paths[b].series))
            continue;
          int same = 0;
          for (const Or& x : *A)
            for (const Or& y : *B)
              if (near(x.a, y.a) && near(x.b, y.b) && compatible(*x.step, *y.step)) { ++same; break; }
          if (same > 0)
          {
            paths[a].same_as.emplace_back(b, same);
            paths[b].same_as.emplace_back(a, same);
          }
        }
    }
  }

  // ---- public ----
  Peaks peaksFrom(const OpenMS::MSSpectrum& prepared, double precursor_mz, int charge, const Param& p)
  {
    Peaks s;
    s.mz.reserve(prepared.size());
    s.intensity.reserve(prepared.size());
    for (const auto& pk : prepared)
    {
      s.mz.push_back(pk.getMZ());
      s.intensity.push_back(pk.getIntensity());
    }
    if (precursor_mz > 0 && std::isfinite(precursor_mz)) s.precursor = precursor_mz;
    s.charge = charge > 0 ? charge : 2;
    s.tolerance = p.frag_tol;
    s.ppm = p.tol_ppm;
    return s;
  }

  std::optional<double> Residues::mass(char residue, const std::string& mod) const
  {
    if (mod.empty())
    {
      const auto it = base.find(residue);
      if (it == base.end()) return std::nullopt;
      return it->second;
    }
    const auto it = variable.find({residue == 'I' ? 'L' : residue, mod});
    if (it == variable.end()) return std::nullopt;
    return it->second;
  }

  Residues residuesFrom(const std::vector<ModSpec>& mods)
  {
    Residues r;
    for (const OpenMS::Residue* res : OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
    {
      const char c = res->getOneLetterCode()[0];
      double m = res->getMonoWeight(OpenMS::Residue::Internal);
      for (const ModSpec& mod : mods)
        if (!mod.variable && mod.residue == c) m += mod.delta;
      r.base[c] = m;
    }
    if (r.base.count('L')) r.base['I'] = r.base['L'];
    for (const ModSpec& mod : mods)
    {
      if (!mod.variable) continue;
      const auto it = r.base.find(mod.residue);
      if (it != r.base.end()) r.variable.emplace(std::make_pair(mod.residue, mod.name), it->second + mod.delta);
    }
    return r;
  }

  const char* levelName(Level l)
  {
    switch (l)
    {
      case Level::SURE: return "sure";
      case Level::LIKELY: return "likely";
      default: return "open";
    }
  }

  Scheme schemeFromString(const std::string& s)
  {
    if (s == "steplogodds") return Scheme::STEPLOGODDS;
    if (s == "evidence") return Scheme::EVIDENCE;
    if (s == "anchor") return Scheme::ANCHOR;
    throw std::invalid_argument("unknown -resolve_score '" + s + "'");
  }

  double evidence(std::optional<double> e)
  {
    if (!e || !(*e >= 0)) return 0;
    return std::max(1.0, jsRound(1000 * (EVIDENCE_REF - std::log10(std::max(*e, 1e-300)))));
  }

  // stepScore.ts models (stepmodel-PXD003531+PXD000001.json and its variant
  // without the mass error), in the coefficient order the sum takes.
  StepModel::StepModel(const Peaks& s) :
    s_(&s), full_(s.ppm && s.tolerance <= STEP_MAX_PPM)
  {
    const size_t n = s.mz.size();
    std::vector<size_t> order(n);
    for (size_t i = 0; i < n; ++i) order[i] = i;
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return s.intensity[b] - s.intensity[a] < 0; });
    rank_.assign(n, 0);
    for (size_t r = 0; r < n; ++r) rank_[order[r]] = static_cast<double>(r) / std::max<double>(1, static_cast<double>(n) - 1);
    if (s.precursor && s.charge > 0) M_ = *s.precursor * s.charge - s.charge * PROTON;
  }

  bool StepModel::comp(int p, int z) const
  {
    if (!M_) return false;
    const Peaks& s = *s_;
    const double x = *M_ - (s.mz[p] * z - z * PROTON) + PROTON;
    const long lo = static_cast<long>(std::lower_bound(s.mz.begin(), s.mz.end(), x) - s.mz.begin());
    for (long k : {lo - 1, lo})
      if (k >= 0 && k < static_cast<long>(s.mz.size()) && std::fabs(s.mz[k] - x) <= tolAt(s, x)) return true;
    return false;
  }

  StepFeatures StepModel::features(const Step& st, int z) const
  {
    const Reading& r = st.readings[0];
    const double ad = std::fabs(r.delta_ppm);
    StepFeatures f;
    f.lE = jsMin(12, -std::log10(jsMax(r.evalue.value_or(1e3), 1e-300)));
    f.abs_dppm = ad;
    const double q = ad / 10;
    f.dppm2 = q * q;
    f.rank_max = std::max(rank_[st.u], rank_[st.v]);
    f.rank_min = std::min(rank_[st.u], rank_[st.v]);
    const double cu = comp(st.u, z) ? 1 : 0, cv = comp(st.v, z) ? 1 : 0;
    f.comp_any = std::max(cu, cv);
    f.comp_both = std::min(cu, cv);
    f.gap = r.gap ? 1 : 0;
    f.amb = st.readings.size() > 1 ? 1 : 0;
    f.log_np = std::log(static_cast<double>(s_->mz.size()));
    return f;
  }

  double StepModel::logit(const StepFeatures& f) const
  {
    double a = 0;
    if (full_)
    {
      a = a + 0.15432 * f.lE;
      a = a + 0.20914 * f.abs_dppm;
      a = a + -2.1797 * f.dppm2;
      a = a + -2.43553 * f.rank_max;
      a = a + -1.16783 * f.rank_min;
      a = a + 0.88343 * f.comp_any;
      a = a + 2.14052 * f.comp_both;
      a = a + -2.97032 * f.gap;
      a = a + 1.94454 * f.amb;
      a = a + -0.25137 * f.log_np;
      return 1.06978 + a;
    }
    a = a + 0.15722 * f.lE;
    a = a + -2.32288 * f.rank_max;
    a = a + -1.02859 * f.rank_min;
    a = a + 0.84074 * f.comp_any;
    a = a + 2.08892 * f.comp_both;
    a = a + -2.97643 * f.gap;
    a = a + 1.69824 * f.amb;
    a = a + -0.21684 * f.log_np;
    return 1.05162 + a;
  }

  double StepModel::logit(const Step& st, int z) const { return logit(features(st, z)); }

  Weight weightOf(const Graph& g, const Peaks& s, const Options& opt)
  {
    if (opt.weight) return opt.weight;
    if (opt.scheme == Scheme::EVIDENCE)
      return [](const Graph& gr, std::size_t p, long) { return evidence(gr.placements[p].evalue); };
    // Each placement step's logit, once (stepScore.ts caches by step).
    auto model = std::make_shared<StepModel>(s);
    auto logits = std::make_shared<std::vector<std::vector<double>>>();
    for (const Placement& p : g.placements)
    {
      std::vector<double> v;
      for (const Step& st : p.steps) v.push_back(model->logit(st, p.charge));
      logits->push_back(std::move(v));
    }
    const double t = opt.threshold;
    const auto steps = [logits, t](const Graph& gr, std::size_t p, long prev) {
      const Placement& P = gr.placements[p];
      size_t shared = 0;
      if (prev >= 0)
      {
        const Placement& Q = gr.placements[static_cast<size_t>(prev)];
        shared = static_cast<size_t>(static_cast<long>(Q.peaks.size()) - indexOf(Q.peaks, P.peaks[0]) - 1);
      }
      double a = 0;
      for (size_t k = shared; k < P.steps.size(); ++k) a = a + (*logits)[p][k] - t;
      return a;
    };
    if (opt.scheme == Scheme::STEPLOGODDS) return steps;
    // ANCHOR: the placement with the lowest E-value (the first on a tie).
    std::optional<size_t> anchor;
    for (size_t i = 0; i < g.placements.size(); ++i)
      if (!anchor || g.placements[i].evalue.value_or(INF) < g.placements[*anchor].evalue.value_or(INF)) anchor = i;
    std::vector<int> anchor_peaks = anchor ? g.placements[*anchor].peaks : std::vector<int>();
    return [steps, anchor_peaks, has = anchor.has_value()](const Graph& gr, std::size_t p, long prev) {
      return ((has && gr.placements[p].peaks == anchor_peaks) ? 1e6 : 0) + steps(gr, p, prev);
    };
  }

  Graph buildGraph(const std::vector<TagIn>& tags, const Peaks& s, const Residues& res, const Options& opt)
  {
    Graph g;
    place(tags, s, res, g);
    auto& placements = g.placements;
    const size_t n = placements.size();
    std::vector<std::string> layer(n);
    for (size_t i = 0; i < n; ++i) layer[i] = layerOfP(placements[i]);
    std::vector<std::vector<size_t>> arcs(n);
    for (size_t a = 0; a < n; ++a)
      for (size_t b = a + 1; b < n && layer[b] == layer[a]; ++b)
      {
        const long i = continues(placements[a], placements[b], opt.join, opt.min_overlap);
        if (i <= 0) continue;
        arcs[b].push_back(a);
        g.arcs.push_back({a, b, static_cast<long>(placements[a].peaks.size()) - i == 1, false});
      }
    const Weight weigh = weightOf(g, s, opt);

    std::vector<char> alive(n, 1);
    // The order in which placements are tried as members inside a path: by
    // E-value, then index. It does not change between rounds.
    std::vector<size_t> byEvalue(n);
    for (size_t i = 0; i < n; ++i) byEvalue[i] = i;
    std::stable_sort(byEvalue.begin(), byEvalue.end(), [&](size_t x, size_t y) {
      int c = byE(placements[x].evalue, placements[y].evalue);
      if (c == 0) c = x < y ? -1 : x > y ? 1 : 0;
      return c < 0;
    });
    // The best chain ending at each placement (the GUI reruns this longest
    // path over all placements each round). Arcs only run a -> b with a < b,
    // and a round only removes placements, so only a placement whose chain
    // runs through a removed or changed one can change: every other
    // candidate of it only got worse or went, and the first best one stays
    // the first best. Those are recomputed, in index order; the rest keep f.
    struct F
    {
      double score;
      size_t first;
      long prev;
      bool operator==(const F& o) const { return score == o.score && first == o.first && prev == o.prev; }
    };
    std::vector<std::optional<F>> f(n);
    std::vector<char> gone(n, 0), changed(n, 0);
    bool first_round = true;
    for (;;)
    {
      long end = -1;
      const auto reach = [&](size_t i) {
        return s.mz[placements[i].peaks.back()] - s.mz[placements[f[i]->first].peaks[0]];
      };
      for (size_t i = 0; i < n; ++i)
      {
        changed[i] = 0;
        if (!alive[i]) continue;
        const long prev = f[i] ? f[i]->prev : -1;
        if (first_round || (prev >= 0 && (gone[static_cast<size_t>(prev)] || changed[static_cast<size_t>(prev)])))
        {
          F best{weigh(g, i, -1), i, -1};
          for (size_t a : arcs[i])
          {
            if (!alive[a] || !f[a]) continue;
            const F c{f[a]->score + weigh(g, i, static_cast<long>(a)), f[a]->first, static_cast<long>(a)};
            if (c.score > best.score || (c.score == best.score && placements[c.first].peaks[0] < placements[best.first].peaks[0]))
              best = c;
          }
          changed[i] = !f[i] || !(*f[i] == best);
          f[i] = best;
        }
        const F& best = *f[i];
        if (end < 0 || best.score > f[static_cast<size_t>(end)]->score
            || (best.score == f[static_cast<size_t>(end)]->score && reach(i) > reach(static_cast<size_t>(end))))
          end = static_cast<long>(i);
      }
      first_round = false;
      std::fill(gone.begin(), gone.end(), 0);
      if (end < 0) break;
      std::vector<size_t> chain;
      for (long i = end; i >= 0; i = f[static_cast<size_t>(i)]->prev) chain.insert(chain.begin(), static_cast<size_t>(i));

      const Placement& head = placements[chain[0]];
      std::vector<int> peaks = head.peaks;
      std::vector<Step> steps = head.steps;
      std::vector<int> joined;
      const auto absorb = [&](const Placement& p) {
        const long at = indexOf(peaks, p.peaks[0]);
        if (at < 0) return false;  // not reached: a link continues the path, a member lies in it
        for (size_t k = 0; k < p.steps.size(); ++k)
        {
          const size_t j = static_cast<size_t>(at) + k;
          if (j < steps.size() && !compatible(p.steps[k], steps[j])) return false;
        }
        for (size_t k = 0; k < p.steps.size(); ++k)
        {
          const Step& st = p.steps[k];
          const size_t j = static_cast<size_t>(at) + k;
          if (j >= steps.size())
          {
            peaks.push_back(st.v);
            steps.push_back(st);
            continue;
          }
          Step& mine = steps[j];
          std::vector<Reading> kept;
          for (const Reading& r : mine.readings)
            if (std::any_of(st.readings.begin(), st.readings.end(), [&](const Reading& x) { return sameLabel(x, r); }))
              kept.push_back(r);
          for (Reading& r : kept)
            r.evalue = minE(r.evalue, std::find_if(st.readings.begin(), st.readings.end(),
                                                   [&](const Reading& x) { return sameLabel(x, r); })->evalue);
          sortReadings(kept);
          mine.readings = std::move(kept);
        }
        return true;
      };
      for (size_t k = 1; k < chain.size(); ++k)
      {
        const Placement& p = placements[chain[k]];
        const bool touching = peaks.back() == p.peaks[0];
        if (!absorb(p))
        {
          chain.resize(k);
          break;
        }
        if (touching) joined.push_back(p.peaks[0]);
      }
      for (size_t i : chain) alive[i] = 0, gone[i] = 1;
      std::vector<size_t> inside;
      const std::string& head_layer = layer[chain[0]];
      for (size_t i : byEvalue)
      {
        if (!alive[i] || layer[i] != head_layer) continue;
        const Placement& p = placements[i];
        const long at = indexOf(peaks, p.peaks[0]);
        if (at < 0) continue;
        bool contained = true;
        for (size_t k = 0; k < p.peaks.size(); ++k)
          if (static_cast<size_t>(at) + k >= peaks.size() || peaks[static_cast<size_t>(at) + k] != p.peaks[k]) { contained = false; break; }
        if (!contained || !absorb(p)) continue;
        inside.push_back(i);
        alive[i] = 0;
        gone[i] = 1;
      }
      // Evidence per step and per junction, from the members' readings that survived.
      std::vector<E> stepE(steps.size());
      struct J { bool spanned = false; E e; };
      std::vector<J> junctionE(steps.empty() ? 0 : steps.size() - 1);
      std::vector<size_t> members = chain;
      members.insert(members.end(), inside.begin(), inside.end());
      for (size_t i : members)
      {
        const Placement& p = placements[i];
        const size_t at = static_cast<size_t>(indexOf(peaks, p.peaks[0]));
        std::vector<E> e;
        for (size_t k = 0; k < p.steps.size(); ++k)
        {
          E m;
          for (const Reading& r : p.steps[k].readings)
          {
            const auto& pr = steps[at + k].readings;
            if (std::any_of(pr.begin(), pr.end(), [&](const Reading& x) { return sameLabel(x, r); })) m = minE(m, r.evalue);
          }
          e.push_back(m);
        }
        for (size_t k = 0; k < e.size(); ++k)
        {
          stepE[at + k] = minE(stepE[at + k], e[k]);
          if (k > 0)
          {
            J& j = junctionE[at + k - 1];
            const E x = !e[k] || !e[k - 1] ? E() : E(jsMax(*e[k], *e[k - 1]));
            j.e = minE(j.spanned ? j.e : E(), x);
            j.spanned = true;
          }
        }
      }
      Path path;
      E best;
      for (const E& x : stepE) best = minE(best, x);
      bool any_null = false;
      double weakest = -INF;
      bool any = false;
      const auto take = [&](const E& x) {
        if (!x) { any_null = true; return; }
        weakest = any ? jsMax(weakest, *x) : *x;
        any = true;
      };
      for (const E& x : stepE) take(x);
      for (const J& j : junctionE) if (j.spanned) take(j.e);
      // Math.max() of nothing is -Infinity.
      path.weakest = any_null ? E() : E(any ? weakest : -INF);
      path.best = best;
      std::vector<const Placement*> lead;
      for (size_t i : members) lead.push_back(&placements[i]);
      std::stable_sort(lead.begin(), lead.end(), [](const Placement* a, const Placement* b) {
        int c = jsCmp(a->flank_e.first, b->flank_e.first);
        if (c == 0) c = jsCmp(a->flank_e.second, b->flank_e.second);
        return c < 0;
      });
      path.call = seriesCall(peaks, head.charge, lead[0]->flank, s, res);
      path.series = path.call.series;
      path.charge = head.charge;
      double score = weigh(g, chain[0], -1);
      for (size_t k = 1; k < chain.size(); ++k) score = score + weigh(g, chain[k], static_cast<long>(chain[k - 1]));
      path.score = score;
      path.peaks = std::move(peaks);
      path.steps = std::move(steps);
      path.chain = std::move(chain);
      path.inside = std::move(inside);
      path.joined = std::move(joined);
      g.paths.push_back(std::move(path));
    }

    // How the resolved tags of a layer meet. Only paths that share a peak
    // can meet; they are found through the peaks, in the order of the GUI's
    // all-pairs loop.
    std::vector<std::vector<size_t>> paths_at(s.mz.size());
    for (size_t r = 0; r < g.paths.size(); ++r)
      for (int p : g.paths[r].peaks) paths_at[static_cast<size_t>(p)].push_back(r);
    std::vector<std::string> path_layer(g.paths.size());
    for (size_t r = 0; r < g.paths.size(); ++r) path_layer[r] = layerOf(g.paths[r].series, g.paths[r].charge);
    // Per pair, the GUI's indexOf scans become lookups: where a peak first
    // stands in A, whether B has shown it already, which step leaves a peak in B.
    std::vector<long> pos_a(s.mz.size(), -1);
    std::vector<size_t> seen_b(s.mz.size(), 0), step_b(s.mz.size(), 0);
    std::vector<int> v_b(s.mz.size(), -1);
    size_t stamp = 0;
    std::vector<size_t> meet;
    for (size_t a = 0; a < g.paths.size(); ++a)
    {
      Path& A = g.paths[a];
      for (size_t k = A.peaks.size(); k-- > 0;) pos_a[static_cast<size_t>(A.peaks[k])] = static_cast<long>(k);
      meet.clear();
      for (int p : A.peaks)
        for (size_t b : paths_at[static_cast<size_t>(p)]) if (b > a) meet.push_back(b);
      std::sort(meet.begin(), meet.end());
      meet.erase(std::unique(meet.begin(), meet.end()), meet.end());
      for (size_t b : meet)
      {
        Path& B = g.paths[b];
        if (path_layer[a] != path_layer[b]) continue;
        ++stamp;
        bool fork = false, touch = false;
        const auto at = [](const std::vector<int>& v, long k) { return k >= 0 && k < static_cast<long>(v.size()) ? v[k] : -1; };
        const auto differ = [](int x, int y) { return x >= 0 && y >= 0 && x != y; };
        // Each peak both share, at its first place in A and in B.
        for (size_t jj = 0; jj < B.peaks.size(); ++jj)
        {
          const size_t p = static_cast<size_t>(B.peaks[jj]);
          if (seen_b[p] == stamp) continue;
          seen_b[p] = stamp;
          const long i = pos_a[p];
          if (i < 0) continue;
          const long j = static_cast<long>(jj);
          if (differ(at(A.peaks, i + 1), at(B.peaks, j + 1)) || differ(at(A.peaks, i - 1), at(B.peaks, j - 1))) fork = true;
          else touch = true;
        }
        if (!fork && !touch) continue;
        // A's steps that B has too.
        bool unique_u = true;
        for (const Step& y : B.steps)
        {
          const size_t u = static_cast<size_t>(y.u);
          if (step_b[u] == stamp && v_b[u] != y.v) unique_u = false;
          step_b[u] = stamp;
          v_b[u] = y.v;
        }
        int shared = 0;
        for (const Step& x : A.steps)
        {
          if (unique_u) shared += step_b[static_cast<size_t>(x.u)] == stamp && v_b[static_cast<size_t>(x.u)] == x.v;
          else if (std::any_of(B.steps.begin(), B.steps.end(), [&](const Step& y) { return x.u == y.u && x.v == y.v; })) ++shared;
        }
        A.relations.push_back({b, fork, shared});
        B.relations.push_back({a, fork, shared});
      }
      for (int p : A.peaks) pos_a[static_cast<size_t>(p)] = -1;
    }

    std::set<std::pair<size_t, size_t>> links;
    for (const Path& p : g.paths)
      for (size_t k = 1; k < p.chain.size(); ++k) links.emplace(p.chain[k - 1], p.chain[k]);
    for (Arc& a : g.arcs) a.used = links.count({a.from, a.to}) > 0;
    settleSeries(g, s);
    return g;
  }

  std::string stepLabel(const Step& st)
  {
    if (st.readings.size() <= 1) return st.readings.empty() ? std::string() : st.readings[0].label;
    std::string out = "{";
    for (size_t i = 0; i < st.readings.size(); ++i)
    {
      if (i) out += '|';
      out += st.readings[i].label;
    }
    return out + "}";
  }

  std::string sequenceOf(char series, const std::vector<Step>& steps)
  {
    std::string out;
    if (nTerminal(series)) for (const Step& st : steps) out += stepLabel(st);
    else for (auto it = steps.rbegin(); it != steps.rend(); ++it) out += stepLabel(*it);
    return out;
  }

  std::string layerOf(char series, int charge)
  {
    return std::string(series == 'c' || series == 'z' ? "cz" : "by") + std::to_string(charge);
  }

  // ---- rows ----
  namespace
  {
    void field(std::string& buf, const std::string& text)
    {
      for (char c : text) buf += (c == '\t' || c == '\r' || c == '\n') ? ' ' : c;
    }
    void evalueField(std::string& buf, const E& e, bool full)
    {
      if (!e) return;
      if (full) appendShortest(buf, *e);
      else appendNum(buf, *e, std::chars_format::general, 6);
    }
    void massField(std::string& buf, double v, bool full)
    {
      if (full) appendShortest(buf, v);
      else appendNum(buf, v, std::chars_format::fixed, 4);
    }
    void mzList(std::string& buf, const Peaks& s, const std::vector<int>& peaks)
    {
      for (size_t i = 0; i < peaks.size(); ++i)
      {
        if (i) buf += ';';
        appendNum(buf, s.mz[static_cast<size_t>(peaks[i])], std::chars_format::fixed, 6);
      }
    }
    void stepList(std::string& buf, const std::vector<Step>& steps, bool full)
    {
      for (size_t k = 0; k < steps.size(); ++k)
      {
        if (k) buf += ';';
        for (size_t r = 0; r < steps[k].readings.size(); ++r)
        {
          if (r) buf += '|';
          buf += steps[k].readings[r].label;
          buf += ':';
          evalueField(buf, steps[k].readings[r].evalue, full);
        }
      }
    }
    template <typename C>
    void indexList(std::string& buf, const C& v)
    {
      bool first = true;
      for (const auto x : v)
      {
        if (!first) buf += ',';
        first = false;
        appendNum(buf, x);
      }
    }
  }

  std::string resolvedHeader()
  {
    return "spectrum\trank\tsequence\tlength\tseries\tcall\tcharge\tnterm_mass\tcterm_mass\tscore\tbest_e"
           "\tweakest_e\tn_tags\tpeaks\tsteps\tmembers\tinside\tjoined\trelations\n";
  }

  std::string graphHeader()
  {
    return "spectrum\tnode\tlayer\tcharge\tseries\tpeaks\tsteps\tevalue\trows\tpath\trole\tnext\n";
  }

  void appendResolvedRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id, bool full)
  {
    const E M = s.precursor && s.charge > 0 ? E(*s.precursor * s.charge - s.charge * PROTON) : std::nullopt;
    for (size_t r = 0; r < g.paths.size(); ++r)
    {
      const Path& p = g.paths[r];
      field(buf, native_id); buf += '\t';
      appendNum(buf, r + 1); buf += '\t';
      buf += sequenceOf(p.series, p.steps); buf += '\t';
      int length = 0;
      double cum = 0;
      for (const Step& st : p.steps)
      {
        length += st.readings[0].gap ? 2 : 1;
        cum += st.readings[0].mass;
      }
      appendNum(buf, length); buf += '\t';
      buf += p.series; buf += '\t';
      buf += levelName(p.call.level); buf += '\t';
      appendNum(buf, p.charge); buf += '\t';
      // The flanks of the called reading, so (sequence, nterm, cterm) is a tag
      // row that lands on its own peaks: a b/c row's ladder walks from nterm
      // (+ C_OFFSET for c) over the sequence, a y/z row's from cterm (+ H2O,
      // or the z-dot offset) over it reversed, as place() reads a row. The
      // low peak is the first ion of that walk; nterm + residues + cterm +
      // H2O = M either way.
      const int z = p.charge;
      const double low = s.mz[static_cast<size_t>(p.peaks.front())];
      double nterm = 0, cterm = 0;
      if (nTerminal(p.series))
      {
        const double n_raw = low * z - PROTON * z - (p.series == 'c' ? C_OFFSET : 0.0);
        nterm = std::max(0.0, n_raw);
        cterm = M ? std::max(0.0, *M - n_raw - cum - WATER) : 0.0;
      }
      else
      {
        // FASTag's own -out convention (FASTagger.cpp scorePath).
        const double offC = p.series == 'z' ? Z_DOT_OFFSET : WATER;
        cterm = std::max(0.0, low * z - PROTON * z - offC);
        nterm = M ? std::max(0.0, *M - ((low + cum / z) * z - PROTON * z) - (WATER - offC)) : 0.0;
      }
      massField(buf, nterm, full); buf += '\t';
      massField(buf, cterm, full); buf += '\t';
      appendShortest(buf, p.score); buf += '\t';
      evalueField(buf, p.best, full); buf += '\t';
      evalueField(buf, p.weakest, full); buf += '\t';
      std::set<size_t> members, inside, all;
      for (size_t i : p.chain) for (size_t row : g.placements[i].rows) { members.insert(row); all.insert(row); }
      for (size_t i : p.inside) for (size_t row : g.placements[i].rows) { inside.insert(row); all.insert(row); }
      appendNum(buf, all.size()); buf += '\t';
      mzList(buf, s, p.peaks); buf += '\t';
      stepList(buf, p.steps, full); buf += '\t';
      indexList(buf, members); buf += '\t';
      indexList(buf, inside); buf += '\t';
      mzList(buf, s, p.joined); buf += '\t';
      for (size_t k = 0; k < p.relations.size(); ++k)
      {
        if (k) buf += ';';
        appendNum(buf, p.relations[k].path + 1);
        buf += p.relations[k].fork ? ":fork:" : ":touch:";
        appendNum(buf, p.relations[k].shared);
      }
      buf += '\n';
    }
  }

  void appendGraphRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id, bool full)
  {
    const size_t n = g.placements.size();
    std::vector<long> path_of(n, -1);
    std::vector<const char*> role(n, "none");
    for (size_t r = 0; r < g.paths.size(); ++r)
    {
      for (size_t i : g.paths[r].chain) { path_of[i] = static_cast<long>(r); role[i] = "chain"; }
      for (size_t i : g.paths[r].inside) { path_of[i] = static_cast<long>(r); role[i] = "inside"; }
    }
    std::vector<std::vector<const Arc*>> next(n);
    for (const Arc& a : g.arcs) next[a.from].push_back(&a);
    for (size_t i = 0; i < n; ++i)
    {
      const Placement& p = g.placements[i];
      field(buf, native_id); buf += '\t';
      appendNum(buf, i); buf += '\t';
      buf += layerOf(p.series, p.charge); buf += '\t';
      appendNum(buf, p.charge); buf += '\t';
      buf += p.series; buf += '\t';
      mzList(buf, s, p.peaks); buf += '\t';
      stepList(buf, p.steps, full); buf += '\t';
      evalueField(buf, p.evalue, full); buf += '\t';
      indexList(buf, p.rows); buf += '\t';
      if (path_of[i] >= 0) appendNum(buf, path_of[i] + 1);
      buf += '\t';
      buf += role[i]; buf += '\t';
      for (size_t k = 0; k < next[i].size(); ++k)
      {
        if (k) buf += ',';
        appendNum(buf, next[i][k]->to);
        if (next[i][k]->touch) buf += '~';
        if (next[i][k]->used) buf += '*';
      }
      buf += '\n';
    }
  }
}
