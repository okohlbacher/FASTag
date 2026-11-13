// Experimental TMT6/10 pseudo-residue filtering. Defaults never invoke it.
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /// TMT6/10 label mass and TMTpro label mass (Da).
  inline constexpr double kLabel = 229.162932, kProLabel = 304.207146;
  /// Water and proton masses (Da).
  inline constexpr double WATER_MASS = 18.010564684, PROTON_MASS = 1.007276466621;
  /// Residue masses of G, A and K (Da).
  inline constexpr double kG = 57.021463735, kA = 71.037113805, kK = 128.094963015;
  /// Mass windows for the N-terminal and C-terminal tag flanks (Da).
  inline constexpr double kWindowN = 0.020, kWindowC = 0.006;
  /// Number of spectra probed, and minimum eligible spectra for a label call.
  inline constexpr std::size_t kProbeCount = 1024, kMinEligible = 100;
  /// TMT10 reporter ion m/z values (Th).
  inline constexpr std::array<double, 10> kReporters = {
    126.127726, 127.124761, 127.131081, 128.128116, 128.134436,
    129.131471, 129.137790, 130.134825, 130.141145, 131.138180};

  /**
    @brief Tests whether a finite observed mass lies within a window of an expected mass.
    @param[in] observed Observed mass (Da).
    @param[in] expected Expected mass (Da).
    @param[in] window Absolute tolerance (Da).
    @return True when @p observed is finite and |observed - expected| <= @p window.
  */
  inline bool near(double observed, double expected, double window)
  {
    return std::isfinite(observed) && std::fabs(observed - expected) <= window;
  }

  /**
    @brief Returns the first or last residue of a tag spelling if it is unmodified.

    An inline-modified endpoint is not a bare residue. Fixed modifications
    are tested separately because FASTag omits them from the tag spelling.

    @param[in] seq Tag spelling, with inline modifications in brackets.
    @param[in] first True for the first residue, false for the last.
    @return The residue, or 0 when it carries an inline modification (or @p seq is empty).
  */
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

  /**
    @brief Rejects b/y tags whose terminal G or A is a TMT label image (-tmt_pseudo_filter).

    Optionally (-tmt_reporter_filter) also rejects charge-1 tags whose C flank
    matches a TMT reporter ion.
  */
  class Filter
  {
  public:
    /**
      @brief Reads the filter options and the fixed G/A modifications.
      @param[in] p Tagging parameters.
    */
    explicit Filter(const Param& p) : enabled_(p.tmt_pseudo_filter), reporters_(p.tmt_reporter_filter)
    {
      if (!enabled_) return;
      for (const ModSpec& mod : p.mods)
      {
        if (mod.variable) continue;
        if (mod.residue == 'G') fixed_[0] += mod.delta;
        if (mod.residue == 'A') fixed_[1] += mod.delta;
      }
    }
    /**
      @brief Tests whether a tag is a TMT pseudo-residue artefact.

      A terminal G or A without a fixed modification is rejected when its
      flank matches the TMT label minus the residue; with reporter filtering,
      a charge-1 tag whose C flank plus water and proton matches a reporter.

      @param[in] tag The tag.
      @return True when the tag is rejected; always false when disabled or
        for non-b/y tags.
    */
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
        if (last == residue && near(tag.cterm_mass, kLabel - WATER_MASS - mass, kWindowC)) return true;
      }
      // A terminal K can carry its TMT mass in the C flank while preserving
      // the correct sequence. That mass allocation is not a pseudo-residue.
      if (reporters_ && tag.charge == 1)
        for (const double reporter : kReporters)
          if (near(tag.cterm_mass + WATER_MASS + PROTON_MASS, reporter, kWindowC)) return true;
      return false;
    }
  private:
    bool enabled_, reporters_;
    std::array<double, 2> fixed_{};
  };

  /**
    @brief Tests the four tag-flank images of a label.

    Excludes the ambiguous raw-C bare-label peak.

    @param[in] tag The tag.
    @param[in] label Label mass (Da).
    @return Matches of: N flank = label, C flank = label - water,
      C flank = K + label, N flank = K + label + water.
  */
  inline std::array<bool, 4> anchors(const Tag& tag, double label)
  {
    return {near(tag.nterm_mass, label, kWindowN),
            near(tag.cterm_mass, label - WATER_MASS, kWindowC),
            near(tag.cterm_mass, kK + label, kWindowC),
            near(tag.nterm_mass, kK + label + WATER_MASS, kWindowN)};
  }

  /**
    @brief Counts of TMT and TMTpro flank images over probed spectra, and the label call.
  */
  struct ProbeCounts
  {
    std::size_t eligible = 0;                ///< spectra with at least one eligible tag
    std::array<std::size_t, 4> tmt{}, pro{}; ///< spectra per anchor image, TMT and TMTpro
    std::size_t tmt_n = 0, tmt_k = 0, pro_n = 0, pro_k = 0;  ///< spectra with an N-site or K-site image
    /**
      @brief Adds the tags of one spectrum.

      Only ungapped b/y tags with E-value <= 1 are eligible; a spectrum
      without eligible tags is not counted.

      @param[in] tags The tags of the spectrum.
    */
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
    /// @brief Minimum spectra per site for a TMT call.
    /// @return max(20, ceil(eligible / 100)).
    std::size_t threshold() const { return std::max<std::size_t>(20, (eligible + 99) / 100); }
    /// @brief Minimum spectra per site for the TMTpro/iTRAQ8 veto.
    /// @return max(5, ceil(eligible / 100)).
    std::size_t vetoThreshold() const { return std::max<std::size_t>(5, (eligible + 99) / 100); }
    /**
      @brief Reason of the label call.
      @param[in] high_resolution The fragment tolerance is in ppm (not Da).
      @return "Da_tolerance", "few_eligible_spectra",
        "conflicting_304Da_label_evidence", "insufficient_two_site_TMT_evidence"
        or "TMT6_10_two_site_evidence".
    */
    std::string reason(bool high_resolution) const
    {
      if (!high_resolution) return "Da_tolerance";
      if (eligible < kMinEligible) return "few_eligible_spectra";
      const auto limit = threshold();
      // TMTpro and iTRAQ8 fit these windows; this veto does not identify either.
      if (pro_n >= vetoThreshold() && pro_k >= vetoThreshold()) return "conflicting_304Da_label_evidence";
      if (tmt_n < limit || tmt_k < limit) return "insufficient_two_site_TMT_evidence";
      return "TMT6_10_two_site_evidence";
    }
    /**
      @brief Whether TMT6/10 labelling is detected.
      @param[in] high_resolution The fragment tolerance is in ppm (not Da).
      @return True when reason() is "TMT6_10_two_site_evidence".
    */
    bool detected(bool high_resolution) const { return reason(high_resolution) == "TMT6_10_two_site_evidence"; }
    /// @brief One-line summary of the counts and thresholds for the log.
    /// @return Comma-separated key=value pairs.
    std::string summary() const
    {
      return "eligible=" + std::to_string(eligible) + ", threshold=" + std::to_string(threshold())
        + ", veto_min=" + std::to_string(vetoThreshold())
        + ", TMT_N=" + std::to_string(tmt_n) + ", TMT_K=" + std::to_string(tmt_k)
        + ", TMTpro_N=" + std::to_string(pro_n) + ", TMTpro_K=" + std::to_string(pro_k);
    }
  };
}
