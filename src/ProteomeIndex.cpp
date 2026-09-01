// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "ProteomeIndex.h"

#include "FastaFilter.h"  // MAX_FILTER_LEN

#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>
#include <tuple>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    // Sort depth for the suffix comparator. Must exceed the longest pattern
    // locate can ask about: a 25-residue tag whose every residue is collapse-
    // respelled as a pair is 50 database chars. Beyond this depth suffix order
    // is arbitrary (tie on position), which is fine BECAUSE locate refines
    // character-by-character and never compares past the pattern.
    constexpr size_t SORT_DEPTH = 64;

    // Interval-refinement steps per locateTag call. Generous: real tags spend
    // one step per character plus one per viable collapse branch, and dead
    // branches die on their first absent character. Only a pathological rule
    // set could approach it. Exhaustion silently returns the PARTIAL result
    // -- nobody logs it (a per-tag log in the hot loop would be spam), and
    // the forward and reversed searches share the one budget.
    constexpr size_t LOCATE_BUDGET = 10000;
  }

  void ProteomeIndex::build(const std::vector<FASTAFile::FASTAEntry>& entries,
                            const std::vector<std::pair<char, double>>& fixed_mods,
                            double isobaric_tol)
  {
    // Residue masses with fixed mods folded in, exactly as TagRecon has
    // always computed database flanks.
    double mass[128] = {0};
    for (const Residue* r : ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
    {
      const char c = r->getOneLetterCode()[0];
      mass[static_cast<unsigned char>(c)] = r->getMonoWeight(Residue::Internal);
    }
    for (const auto& m : fixed_mods)
      if (m.first >= 0) mass[static_cast<unsigned char>(m.first)] += m.second;

    // Rebuildable: a second build() must fully replace the first.
    text_.clear(); orig_.clear(); sa_.clear(); prefix_.clear();
    starts_.clear(); acc_.clear(); bounds_.clear(); rules_.clear();
    residues_ = 0;

    if (isobaric_tol > 0) rules_ = deriveCollapseRules(isobaric_tol, fixed_mods);

    // Concatenate: folded text for matching, original for reporting, one '#'
    // after every protein (also a hard barrier -- locate can never match
    // across it because '#' is never a pattern character).
    size_t total = 1;
    for (const auto& e : entries) total += e.sequence.size() + 1;
    if (total > std::numeric_limits<uint32_t>::max())
      throw Exception::InvalidValue(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION,
                                    "Database exceeds the index's 4 GiB text limit.",
                                    String(total));
    text_.reserve(total);
    orig_.reserve(total);
    for (const auto& e : entries)
    {
      starts_.push_back(static_cast<uint32_t>(text_.size()));
      acc_.push_back(e.identifier);
      for (char c : e.sequence)
      {
        const char n = normResidue(c);
        if (!n) continue;  // non-letters are dropped, matching FastaFilter
        text_.push_back(n);
        orig_.push_back(n == RESIDUE_AMBIG ? RESIDUE_AMBIG
                                           : (c >= 'a' ? static_cast<char>(c - 32) : c));
        if (n != RESIDUE_AMBIG) ++residues_;
      }
      text_.push_back(RESIDUE_AMBIG);
      orig_.push_back(RESIDUE_AMBIG);
    }

    // Prefix masses; sentinels and ambiguity residues contribute 0. Double is
    // mandatory: float's 24-bit mantissa is ~0.25 Da at a titin-scale
    // cumulative prefix, which would destroy ppm flank checks.
    prefix_.resize(text_.size() + 1);
    prefix_[0] = 0.0;
    for (size_t i = 0; i < text_.size(); ++i)
      prefix_[i + 1] = prefix_[i] + mass[static_cast<unsigned char>(text_[i])];

    // Cleavage boundaries per '#'-free segment: segment start, every
    // after-K/R-not-before-P position, segment end. OpenMS 'Trypsin'
    // semantics exactly (cuts after K or R except before P) -- cross-checked
    // against ProteaseDigestion in the unit test.
    uint32_t seg = 0;
    size_t i = 0;
    const size_t n = text_.size();
    while (i < n)
    {
      if (text_[i] == RESIDUE_AMBIG) { ++i; continue; }
      const size_t seg_start = i;
      while (i < n && text_[i] != RESIDUE_AMBIG) ++i;
      const size_t seg_end = i;
      bounds_.emplace_back(static_cast<uint32_t>(seg_start), seg);
      for (size_t p = seg_start; p + 1 < seg_end; ++p)
        if ((text_[p] == 'K' || text_[p] == 'R') && text_[p + 1] != 'P')
          bounds_.emplace_back(static_cast<uint32_t>(p + 1), seg);
      bounds_.emplace_back(static_cast<uint32_t>(seg_end), seg);
      ++seg;
    }

    // The suffix array. Comparator capped at SORT_DEPTH; ties beyond it order
    // by position for determinism.
    sa_.resize(n);
    for (size_t s = 0; s < n; ++s) sa_[s] = static_cast<uint32_t>(s);
    const char* t = text_.data();
    std::sort(sa_.begin(), sa_.end(), [t, n](uint32_t a, uint32_t b) {
      const size_t la = n - a, lb = n - b;
      const size_t l = std::min(std::min(la, lb), SORT_DEPTH);
      const int c = std::memcmp(t + a, t + b, l);
      if (c) return c < 0;
      if (l == SORT_DEPTH) return a < b;
      return la < lb;
    });
  }

  ProteomeIndex::Range ProteomeIndex::refine(Range r, uint32_t depth, char c) const
  {
    // Within sa_[r.lo, r.hi) every suffix shares the first `depth` chars, so
    // the block is ordered by the char AT depth (valid to SORT_DEPTH); narrow
    // to the sub-block whose next char is c.
    const uint32_t* base = sa_.data();
    const auto lo = std::lower_bound(base + r.lo, base + r.hi, c,
        [this, depth](uint32_t s, char ch) { return charAt(s + depth) < ch; });
    const auto hi = std::upper_bound(lo, base + r.hi, c,
        [this, depth](char ch, uint32_t s) { return ch < charAt(s + depth); });
    return {static_cast<uint32_t>(lo - base), static_cast<uint32_t>(hi - base)};
  }

  void ProteomeIndex::descend(const std::string& tag, size_t i, Range r, uint32_t depth,
                              bool reversed, size_t& budget, std::vector<TagOcc>& out) const
  {
    if (r.lo >= r.hi || budget == 0) return;
    if (i == tag.size())
    {
      for (uint32_t s = r.lo; s < r.hi; ++s)
        out.push_back({sa_[s], static_cast<uint16_t>(depth), reversed});
      return;
    }
    const char c = tag[i];
    --budget;
    descend(tag, i + 1, refine(r, depth, c), depth + 1, reversed, budget, out);
    // Collapse branch: this tag residue may be spelled as a two-residue pair
    // in the database (query-side inversion of FastaFilter's DB-side
    // contraction; coverage-equivalent, established in the unit test).
    for (const CollapseRule& rule : rules_)
    {
      if (rule.one != c) continue;
      if (budget == 0) return;
      --budget;
      const Range ra = refine(r, depth, rule.a);
      if (ra.lo >= ra.hi) continue;
      descend(tag, i + 1, refine(ra, depth + 1, rule.b), depth + 2, reversed, budget, out);
    }
  }

  void ProteomeIndex::locateTag(const std::string& tag_in, bool both,
                                std::vector<TagOcc>& out) const
  {
    // The SA comparator sorts to SORT_DEPTH chars and ties BY POSITION past
    // it, so refine() is only valid to that depth. A collapse branch spends
    // up to two database chars per tag residue -- gate on the worst case, or
    // an over-long public-API query would binary-search position-ordered
    // blocks and silently miss occurrences. (TagReconciler's MAX_FILTER_LEN
    // gate keeps in-pipeline queries far inside this.)
    if (tag_in.size() * 2 > SORT_DEPTH) return;
    std::string tag;
    tag.reserve(tag_in.size());
    for (char c : tag_in)
    {
      const char f = normResidue(c);
      if (!f || f == RESIDUE_AMBIG) return;  // a tag never carries these
      tag.push_back(f);
    }
    if (tag.empty()) return;

    const size_t before = out.size();
    size_t budget = LOCATE_BUDGET;
    const Range all{0, static_cast<uint32_t>(sa_.size())};
    descend(tag, 0, all, 0, /*reversed=*/false, budget, out);
    if (both)
    {
      std::string rev(tag.rbegin(), tag.rend());
      if (rev != tag) descend(rev, 0, all, 0, /*reversed=*/true, budget, out);
    }
    // Dedup: a palindromic pattern or two collapse spellings can land on the
    // same (pos, len, reversed).
    std::sort(out.begin() + before, out.end(), [](const TagOcc& x, const TagOcc& y) {
      return std::tie(x.pos, x.len, x.reversed) < std::tie(y.pos, y.len, y.reversed);
    });
    out.erase(std::unique(out.begin() + before, out.end(),
                          [](const TagOcc& x, const TagOcc& y) {
                            return x.pos == y.pos && x.len == y.len && x.reversed == y.reversed;
                          }),
              out.end());
  }

  void ProteomeIndex::windowsAt(uint32_t pos, uint32_t len, int missed_cleavages,
                                std::vector<Window>& out) const
  {
    // Boundaries at/left of pos and at/right of pos+len, same segment, with
    // the internal-site count = (index distance - 1) capped at MC.
    const auto cmp = [](const std::pair<uint32_t, uint32_t>& b, uint32_t p) {
      return b.first < p;
    };
    if (bounds_.empty()) return;  // a database of only ambiguity residues
    auto it = std::lower_bound(bounds_.begin(), bounds_.end(), pos, cmp);
    // it = first boundary >= pos; the start candidates walk left from here.
    if (it == bounds_.begin() && it->first > pos) return;  // before any segment
    auto sit = (it != bounds_.end() && it->first == pos) ? it : std::prev(it);
    if (sit->first > pos) return;
    const uint32_t seg = sit->second;

    auto eit = std::lower_bound(bounds_.begin(), bounds_.end(), pos + len, cmp);
    if (eit == bounds_.end() || eit->second != seg) return;  // spans a barrier

    const long si = sit - bounds_.begin();
    const long ei = eit - bounds_.begin();
    for (long s = si; s >= 0 && si - s <= missed_cleavages; --s)
    {
      if (bounds_[s].second != seg) break;
      for (long e = ei; e < static_cast<long>(bounds_.size()) && e - ei <= missed_cleavages; ++e)
      {
        if (bounds_[e].second != seg) break;
        // internal cleavage sites strictly inside (s, e)
        if ((e - s - 1) > missed_cleavages) continue;
        if (bounds_[e].first <= bounds_[s].first) continue;
        out.push_back({bounds_[s].first, bounds_[e].first});
      }
    }
  }

  const std::string& ProteomeIndex::proteinAt(uint32_t pos) const
  {
    static const std::string none;
    if (starts_.empty()) return none;
    const size_t i = static_cast<size_t>(
        std::upper_bound(starts_.begin(), starts_.end(), pos) - starts_.begin());
    return i > 0 ? acc_[i - 1] : none;
  }

  int ProteomeIndex::autoMinLen() const
  {
    constexpr double EFF_ALPHABET = 14.7;  // same model as FastaFilter
    if (residues_ == 0) return 1;
    const int k = static_cast<int>(std::ceil(
        std::log(20.0 * 2.0 * static_cast<double>(residues_)) / std::log(EFF_ALPHABET)));
    return std::max(1, std::min(k, MAX_FILTER_LEN));
  }
}
