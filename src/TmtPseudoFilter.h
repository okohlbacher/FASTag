// Experimental TMT6/10 pseudo-residue filtering. Defaults never invoke it.
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "FASTagger.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace FASTag::TmtPseudo
{
  inline constexpr double kLabel = 229.162932, kProLabel = 304.207146;
  inline constexpr double kWater = 18.010564684, kProton = 1.007276466621;
  inline constexpr double kG = 57.021463735, kA = 71.037113805, kK = 128.094963015;
  inline constexpr double kWindowN = 0.020, kWindowC = 0.006;
  inline constexpr std::size_t kProbeCount = 1024, kMinEligible = 100;
  inline constexpr std::array<double, 10> kReporters = {
    126.127726, 127.124761, 127.131081, 128.128116, 128.134436,
    129.131471, 129.137790, 130.134825, 130.141145, 131.138180};

  inline bool near(double observed, double expected, double window)
  {
    return std::isfinite(observed) && std::fabs(observed - expected) <= window;
  }

  /// An inline-modified endpoint is not a bare residue. Fixed modifications
  /// are tested separately because FASTag omits them from the tag spelling.
  inline char bareEndpoint(std::string_view seq, bool first)
  {
    char last = 0;
    bool bracket = false;
    for (std::size_t i = 0; i < seq.size(); ++i)
    {
      if (seq[i] == '[') { bracket = true; continue; }
      if (seq[i] == ']') { bracket = false; continue; }
      if (bracket) continue;
      const char residue = i + 1 < seq.size() && seq[i + 1] == '[' ? 0 : seq[i];
      if (first) return residue;
      last = residue;
    }
    return last;
  }

  class Filter
  {
  public:
    explicit Filter(const Param& p) : enabled_(p.tmt_pseudo_filter), reporters_(p.tmt_reporter_filter)
    {
      if (!enabled_) return;
      for (const ModSpec& mod : p.mods)
      {
        if (mod.variable) continue;
        if (mod.residue == 'G') fixed_[0] += mod.delta;
        if (mod.residue == 'A') fixed_[1] += mod.delta;
        if (mod.residue == 'K') fixed_[2] += mod.delta;
      }
    }
    bool rejects(const Tag& tag) const
    {
      if (!enabled_ || tag.ion_series != IonSeries::Series::BY) return false;
      const char first = bareEndpoint(tag.seq, true), last = bareEndpoint(tag.seq, false);
      for (std::size_t i = 0; i < 2; ++i)
      {
        if (std::fabs(fixed_[i]) > 1e-8) continue;
        const char residue = i == 0 ? 'G' : 'A';
        const double mass = i == 0 ? kG : kA;
        if (first == residue && near(tag.nterm_mass, kLabel - mass, kWindowN)) return true;
        if (last == residue && near(tag.cterm_mass, kLabel - kWater - mass, kWindowC)) return true;
      }
      if (last == 'K' && std::fabs(fixed_[2]) <= 1e-8 && near(tag.cterm_mass, kLabel, kWindowC)) return true;
      if (reporters_ && tag.charge == 1)
        for (const double reporter : kReporters)
          if (near(tag.cterm_mass + kWater + kProton, reporter, kWindowC)) return true;
      return false;
    }
  private:
    bool enabled_, reporters_;
    std::array<double, 3> fixed_{};
  };

  /// Four tag-flank images, excluding the ambiguous raw-C bare-label peak.
  inline std::array<bool, 4> anchors(const Tag& tag, double label)
  {
    return {near(tag.nterm_mass, label, kWindowN),
            near(tag.cterm_mass, label - kWater, kWindowC),
            near(tag.cterm_mass, kK + label, kWindowC),
            near(tag.nterm_mass, kK + label + kWater, kWindowN)};
  }

  struct ProbeCounts
  {
    std::size_t eligible = 0;
    std::array<std::size_t, 4> tmt{}, pro{};
    std::size_t tmt_n = 0, tmt_k = 0, pro_n = 0, pro_k = 0;
    void add(const std::vector<Tag>& tags)
    {
      bool any = false;
      std::array<bool, 4> a{}, b{};
      for (const Tag& tag : tags)
      {
        if (tag.ion_series != IonSeries::Series::BY || tag.gapped || !(tag.evalue <= 1.0)) continue;
        any = true;
        const auto ta = anchors(tag, kLabel), tb = anchors(tag, kProLabel);
        for (std::size_t i = 0; i < 4; ++i) { a[i] = a[i] || ta[i]; b[i] = b[i] || tb[i]; }
      }
      if (!any) return;
      ++eligible;
      for (std::size_t i = 0; i < 4; ++i) { tmt[i] += a[i]; pro[i] += b[i]; }
      tmt_n += a[0] || a[1]; tmt_k += a[2] || a[3];
      pro_n += b[0] || b[1]; pro_k += b[2] || b[3];
    }
    std::size_t threshold() const { return std::max<std::size_t>(20, (eligible + 99) / 100); }
    std::string reason(bool high_resolution) const
    {
      if (!high_resolution) return "Da_tolerance";
      if (eligible < kMinEligible) return "few_eligible_spectra";
      const auto limit = threshold();
      if (pro_n >= limit && pro_k >= limit) return "TMTpro_or_mixed_evidence";
      if (tmt_n < limit || tmt_k < limit) return "insufficient_two_site_TMT_evidence";
      return "TMT6_10_two_site_evidence";
    }
    bool detected(bool high_resolution) const { return reason(high_resolution) == "TMT6_10_two_site_evidence"; }
    std::string summary() const
    {
      return "eligible=" + std::to_string(eligible) + ", threshold=" + std::to_string(threshold())
        + ", TMT_N=" + std::to_string(tmt_n) + ", TMT_K=" + std::to_string(tmt_k)
        + ", TMTpro_N=" + std::to_string(pro_n) + ", TMTpro_K=" + std::to_string(pro_k);
    }
  };
}
