// Precursor charge and isotope hypotheses (FASTag 1.12, item #6 / E3).
//
// FASTag 1.11 tags every MS2 spectrum once, at its first precursor's charge,
// and tags a precursor without a charge as 2+. This file decides, per
// spectrum, which (charge, isotope) hypotheses are tagged and which ONE of
// them feeds the reports that aggregate over spectra.
//
// Charge candidates (-unknown_charge). A header charge is never replaced and
// is the only candidate. Without one:
//   assume2    2, as FASTag 1.11 (the default);
//   enumerate  the precursor's possible charges (MS:1000633, MGF "2+ and 3+")
//              when it lists any, else -charge_min .. -charge_max;
//   infer      one listed possible charge, else the call of inferCharge()
//              over the candidates (the listed possible charges, else
//              -charge_min .. -charge_max; every call is one of them):
//              1 when 1 is a candidate and less than 5% of the intensity lies
//              above the precursor, else the charge whose 1+ complement pairs
//              (b + y = M + 2p) are most in excess of chance, when that
//              excess is above 0; two charges when the runner-up is within
//              -charge_infer_margin (ambiguous); without any excess above 0,
//              2 when 2 is a candidate, else the lowest candidate (assumed).
//              Range evidence first rules out every charge c whose largest
//              possible fragment m/z (M_c + p, a 1+ ion of the whole peptide)
//              lies below one of the strongest peaks: such a peak cannot be a
//              fragment of a c+ precursor. When that rules out the lowest
//              candidates, the lowest charge left is the call without
//              complement evidence (inferred, not assumed).
//
// Isotope candidates (-isotope_error). Every listed k (-1 .. 3) shifts the
// precursor's neutral mass by -k * (13C - 12C), header-charged precursors
// included; k changes only that mass (the precursor cut, the complements and
// the N-terminal flank). With more than one k, each charge candidate is tagged
// once, at the k whose complement excess is largest (ties to the smaller |k|,
// then the smaller k): the candidate set is the product of the two lists, and
// the complement evidence collapses its isotope dimension per charge.
//
// Selection. The reports that aggregate over spectra (digest, label,
// massgap, species, delta, shortlist, census best tag) read the rows of the
// selected hypothesis only. It is chosen from the charge evidence, never from
// tag E-values: the header or the single possible charge; else the infer call
// (computed in every non-default mode); else 2 (else the smallest candidate).
// The tag TSV, -recon_out and -recon_id_out keep every hypothesis' rows.
//
// Multiplicity. Every row's E-value is multiplied by H, the number of
// hypotheses tagged for its spectrum, before the -max_evalue cut and the
// -max_tags cap (tagSpectrum's multiplicity argument); rows of different
// hypotheses are then merged by corrected E-value and capped together
// (mergeHypotheses). E-values across hypotheses are a heuristic ranking.
//
// Header-charge check (1.13, -check_header_charge; off by default). A
// header-charged precursor is put to the infer call too, over -charge_min ..
// -charge_max plus the header charge (checkHeaderCharge): the header
// disagrees when the call differs from the header and rests on evidence
// against it -- its complement pairs (both charges' of an ambiguous call)
// beat the header's by at least the check margin, or the range evidence rules
// the header out, or the 1+ test calls 1. warn counts and reports the
// verdicts and tags as before;
// override tags a disagreeing spectrum at the call instead (charge_src
// `overridden`). The call itself is the one -unknown_charge infer makes.
//
// At the defaults (assume2, isotope 0) there is exactly one hypothesis, the
// 1.11 one (header charge or <= 0, the given m/z, H = 1), and nothing here
// runs in the tool: isDefault() gates it.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "FASTagger.h"

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace FASTag::Hyp
{
  /// -unknown_charge.
  enum class ChargeMode
  {
    Assume2,    ///< 2, as FASTag 1.11; the default
    Enumerate,  ///< possible charges, else charge_min .. charge_max
    Infer,      ///< inferCharge()
  };

  /// Where a hypothesis' charge came from (TSV column charge_src). The values
  /// index SourceCounts::n.
  enum class ChargeSource : std::uint8_t
  {
    Header = 0,      ///< the precursor's charge
    Possible = 1,    ///< a listed possible charge
    Inferred = 2,    ///< inferCharge()'s unambiguous call
    Ambiguous = 3,   ///< one of the two charges of an ambiguous call
    Assumed = 4,     ///< 2 without evidence (assume2, or infer without a call)
    Enumerated = 5,  ///< one of charge_min .. charge_max under enumerate
    Overridden = 6,  ///< 1.13: the check call replaced a disagreeing header charge
  };
  inline constexpr std::size_t kChargeSources = 7;

  inline const char* sourceName(ChargeSource s)
  {
    switch (s)
    {
      case ChargeSource::Header: return "header";
      case ChargeSource::Possible: return "possible";
      case ChargeSource::Inferred: return "inferred";
      case ChargeSource::Ambiguous: return "ambiguous";
      case ChargeSource::Assumed: return "assumed";
      case ChargeSource::Enumerated: return "enumerated";
      case ChargeSource::Overridden: return "overridden";
    }
    return "assumed";
  }

  /// -unknown_charge value to the mode; false for an unknown value.
  inline bool parseMode(std::string_view s, ChargeMode& out)
  {
    if (s == "assume2") { out = ChargeMode::Assume2; return true; }
    if (s == "enumerate") { out = ChargeMode::Enumerate; return true; }
    if (s == "infer") { out = ChargeMode::Infer; return true; }
    return false;
  }

  /// -check_header_charge (1.13).
  enum class HeaderCheck
  {
    Off,       ///< no check; the default
    Warn,      ///< check and report, tag at the header charge
    Override,  ///< check and report, tag a disagreeing spectrum at the call
  };

  inline bool parseHeaderCheck(std::string_view s, HeaderCheck& out)
  {
    if (s == "off") { out = HeaderCheck::Off; return true; }
    if (s == "warn") { out = HeaderCheck::Warn; return true; }
    if (s == "override") { out = HeaderCheck::Override; return true; }
    return false;
  }
  inline constexpr const char* kHeaderCheckDefault = "off";
  inline constexpr const char* kHeaderCheckValues = "off,warn,override";
  /// -check_header_margin default: the complement-pair excess by which the
  /// call must beat the header charge's own. Chosen on DEV (PXD003531,
  /// PXD001819 against a Sage charge truth; output/backlog-1.13/hdrcharge):
  /// at 2 a third of the disagreements on real headers were false.
  inline constexpr double kHeaderMarginDefault = 6.0;
  /// Range evidence counts against a header charge only when at least this
  /// many of the strongest kInferTopPeaks peaks lie above its fragment
  /// ceiling (M_h + p + kCeilingMargin): one stray peak (a co-isolated
  /// precursor's fragment) is not enough (DEV: DESIGN.md).
  inline constexpr int kHeaderRangeMinPeaks = 3;

  // Registered defaults and limits of the #6 options.
  inline constexpr const char* kModeDefault = "assume2";
  inline constexpr const char* kModeValues = "assume2,enumerate,infer";
  inline constexpr int kChargeMinDefault = 2;
  inline constexpr int kChargeMaxDefault = 4;
  inline constexpr int kChargeLimit = 8;          ///< FASTagger's fragment-charge cap
  inline constexpr double kInferMarginDefault = 2.0;
  inline constexpr int kIsotopeMin = -1;
  inline constexpr int kIsotopeMax = 3;
  /// The isotope hypotheses need a high-resolution fragment tolerance: the
  /// effective fragment tolerance (Da, or ppm at 1000 m/z) must be below this.
  inline constexpr double kIsotopeMaxFragmentTolDa = 0.05;

  // inferCharge() constants (PLAN-data-types item #6).
  inline constexpr double kOnePlusMaxShare = 0.05;  ///< intensity share above the precursor
  /// Peaks within this many Da of the precursor m/z are left out of the 1+
  /// test: the unfragmented precursor and its isotopes are not fragments.
  inline constexpr double kOnePlusPrecursorWindow = 3.5;
  inline constexpr std::size_t kInferTopPeaks = 150;
  /// Off-target pair sums whose mean count estimates chance pairs (Da).
  inline constexpr double kOffTargetShifts[6] = {-11.5, -7.5, -4.5, 4.5, 7.5, 11.5};
  /// Range evidence: a peak of the strongest kInferTopPeaks this far (Da)
  /// above a charge's fragment ceiling M_c + p rules the charge out. Covers
  /// the isotope offsets (k = -1 raises M by 1.003 Da) and a low-resolution
  /// m/z error.
  inline constexpr double kCeilingMargin = 1.5;

  struct HypParam
  {
    ChargeMode mode = ChargeMode::Assume2;
    int charge_min = kChargeMinDefault;
    int charge_max = kChargeMaxDefault;
    double infer_margin = kInferMarginDefault;
    std::vector<int> isotope_errors{0};
    HeaderCheck header_check = HeaderCheck::Off;  ///< 1.13 -check_header_charge
    double header_margin = kHeaderMarginDefault;  ///< 1.13 -check_header_margin

    /// True at the 1.11 behaviour: assume2, the isotope list {0} and no
    /// header override (-check_header_charge warn tags as 1.11 does).
    bool isDefault() const
    {
      return mode == ChargeMode::Assume2 && isotope_errors.size() == 1 && isotope_errors[0] == 0
          && header_check != HeaderCheck::Override;
    }
  };

  /// Checks a HypParam as the tool reads it; empty when valid, else the
  /// message (charge range, isotope range and duplicates, and the
  /// high-resolution guard against the effective fragment tolerance).
  std::string validate(const HypParam& hp, double frag_tol, bool tol_ppm);

  /// One hypothesis of one spectrum.
  struct Hypothesis
  {
    int charge = 2;      ///< the charge tagged (for the 1.11 hypothesis: the header value, may be <= 0)
    int iso = 0;         ///< isotope offset k
    double mz = 0;       ///< precursor m/z handed to the tagger (shifted by -k*C13/charge)
    ChargeSource src = ChargeSource::Assumed;
    bool selected = false;
  };

  /// What an infer call rests on (1.13; ChargeCall::basis).
  enum class CallBasis : std::uint8_t
  {
    None = 0,        ///< no evidence (assumed)
    OnePlus = 1,     ///< the 1+ test
    Range = 2,       ///< range evidence alone (no complement excess above 0)
    Complement = 3,  ///< the complement-pair excess
  };

  /// What inferCharge() saw.
  struct ChargeCall
  {
    CallBasis basis = CallBasis::None;  ///< what the call rests on
    int charge = 2;               ///< the call, one of the candidates (2, else the lowest, when assumed)
    ChargeSource src = ChargeSource::Assumed;  ///< Inferred, Ambiguous or Assumed
    int runner_up = 0;            ///< the second charge of an ambiguous call, else 0
    double above_share = 0;       ///< intensity share above the precursor (1+ test)
    int range_min = 0;            ///< lowest charge the range evidence leaves (0 = none ruled out)
    /// Per charge tried: (charge, best excess, the isotope k it was found at).
    std::vector<std::pair<int, std::pair<double, int>>> excess;
  };

  /// Complement-pair excess of @p spec for a precursor of neutral mass @p M:
  /// pairs of the strongest kInferTopPeaks peaks (intensity desc, m/z desc)
  /// whose m/z sum to M + 2p (plus the series' pair delta, ComplementSpec::
  /// pair_deltas: c/z-dot M + H + 2p; a/x summed over M - H + 2p and M + 2p) within ComplementSpec::tol, minus the mean count
  /// at the kOffTargetShifts sums. Independent of the input peak order.
  double complementExcess(const OpenMS::MSSpectrum& spec, double M, const ComplementSpec& cs);

  /// The isotope k of @p isotopes with the largest complementExcess for a
  /// charge-@p charge precursor at @p prec_mz (ties to the smaller |k|, then
  /// the smaller k); the excess goes to @p excess when given.
  int bestIsotope(const OpenMS::MSSpectrum& spec, double prec_mz, int charge,
                  const std::vector<int>& isotopes, const ComplementSpec& cs, double* excess = nullptr);

  /// The infer call for a spectrum without a usable charge, over @p charges
  /// (ascending; charge_min .. charge_max, or the possible charges) and the
  /// isotope list.
  ChargeCall inferCharge(const OpenMS::MSSpectrum& spec, double prec_mz, const std::vector<int>& charges,
                         const HypParam& hp, const ComplementSpec& cs);

  /// 1.13 -check_header_charge: the verdict on one header charge.
  enum class HeaderVerdict : std::uint8_t
  {
    Agree = 0,      ///< the call is the header charge (one of two, when ambiguous)
    Disagree = 1,   ///< evidence against the header: see checkHeaderCharge()
    Ambiguous = 2,  ///< two close charges, neither the header, no evidence against it
    NoCall = 3,     ///< no evidence either way
  };
  inline constexpr std::size_t kHeaderVerdicts = 4;
  inline const char* verdictName(HeaderVerdict v)
  {
    switch (v)
    {
      case HeaderVerdict::Agree: return "agree";
      case HeaderVerdict::Disagree: return "disagree";
      case HeaderVerdict::Ambiguous: return "ambiguous";
      case HeaderVerdict::NoCall: return "nocall";
    }
    return "nocall";
  }
  inline const char* basisName(CallBasis b)
  {
    switch (b)
    {
      case CallBasis::None: return "none";
      case CallBasis::OnePlus: return "one_plus";
      case CallBasis::Range: return "range";
      case CallBasis::Complement: return "complement";
    }
    return "none";
  }

  struct HeaderCheckResult
  {
    int header = 0;                  ///< the header charge (> 0)
    HeaderVerdict verdict = HeaderVerdict::NoCall;
    ChargeCall call;                 ///< the infer call over the check's candidates
    bool header_ruled_out = false;   ///< the range evidence rules the header charge out
    int header_peaks_above = 0;      ///< strongest peaks above the header's fragment ceiling (b/y)
    double header_excess = 0;        ///< complement excess at the header charge (also when ruled out or above the cap; 0 under the 1+ test)
    double call_excess = 0;          ///< complement excess at the call (0 without complement basis)
    /// The charge a disagreeing header is replaced by under override: the
    /// call; else the header.
    int replacement() const { return verdict == HeaderVerdict::Disagree ? call.charge : header; }
  };

  /// The candidates of a header check: -charge_min .. -charge_max plus the
  /// header charge (when it is in 1 .. kChargeLimit), ascending.
  std::vector<int> headerCheckCandidates(int header, const HypParam& hp);

  /// 1.13 -check_header_charge: the infer call for a header-charged
  /// precursor over headerCheckCandidates() (the 1+ test where 1 is one), and
  /// the verdict. Disagree when the call is not ambiguous, is not the header
  /// and rests on evidence against the header: the complement-pair excess at
  /// the call is above 0 and beats the header's by at least hp.header_margin
  /// (and the runner-up by -charge_infer_margin, as infer); or the range
  /// evidence rules the header out; or the 1+ test calls 1. Agree when the
  /// call (or one charge of an ambiguous call) is the header and is not
  /// assumed. Two close charges that exclude the header: Disagree (the call
  /// is the better one) when the range evidence rules the header out or both
  /// beat its excess by hp.header_margin, else Ambiguous. Else NoCall.
  /// A precursor without a header charge gives NoCall with header 0.
  HeaderCheckResult checkHeaderCharge(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                      const HypParam& hp, const ComplementSpec& cs);

  /// The hypotheses of one spectrum, in ascending charge, exactly one of
  /// them selected. At hp.isDefault() this is the single 1.11 hypothesis
  /// {prec.getCharge(), 0, prec.getMZ(), header or assumed}.
  /// @param call  optional; the infer call when one was computed
  /// @param header_check  optional (1.13); under -check_header_charge
  ///        override, a Disagree verdict tags the spectrum at its call
  ///        (ChargeSource::Overridden) instead of the header charge
  std::vector<Hypothesis> precursorHypotheses(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                              const HypParam& hp, const ComplementSpec& cs,
                                              ChargeCall* call = nullptr,
                                              const HeaderCheckResult* header_check = nullptr);

  /// 1.13: per-run counts of the header check (warn and override).
  struct HeaderCheckCounts
  {
    std::size_t checked = 0;                       ///< header-charged MS2 spectra checked
    std::size_t verdict[kHeaderVerdicts] = {};     ///< by verdict
    std::size_t disagree_by[4] = {};               ///< Disagree by CallBasis
    std::size_t overridden = 0;                    ///< tagged at the call (override)
    /// Disagree by (header, call), both 1 .. kChargeLimit.
    std::size_t moves[kChargeLimit + 1][kChargeLimit + 1] = {};
    void add(const HeaderCheckResult& r, bool override_on)
    {
      if (r.header <= 0) return;
      ++checked;
      ++verdict[static_cast<std::size_t>(r.verdict)];
      if (r.verdict == HeaderVerdict::Disagree)
      {
        ++disagree_by[static_cast<std::size_t>(r.call.basis)];
        if (r.header <= kChargeLimit && r.call.charge >= 1 && r.call.charge <= kChargeLimit)
          ++moves[r.header][r.call.charge];
        if (override_on) ++overridden;
      }
    }
    void merge(const HeaderCheckCounts& o)
    {
      checked += o.checked;
      for (std::size_t i = 0; i < kHeaderVerdicts; ++i) verdict[i] += o.verdict[i];
      for (std::size_t i = 0; i < 4; ++i) disagree_by[i] += o.disagree_by[i];
      overridden += o.overridden;
      for (int a = 0; a <= kChargeLimit; ++a)
        for (int b = 0; b <= kChargeLimit; ++b) moves[a][b] += o.moves[a][b];
    }
  };

  /// Rows of several hypotheses of one spectrum, each list sorted best
  /// first, merged by (corrected) E-value -- stable, so ties keep hypothesis
  /// order -- and capped at @p cap rows (0 = no cap). Entry i of the result
  /// pairs a row with the index of its hypothesis.
  std::vector<std::pair<Tag, std::uint8_t>> mergeHypotheses(std::vector<std::vector<Tag>> per_hyp, std::size_t cap);

  /// Per-run counts of the hypotheses tagged, by source, and of the
  /// selected ones (RunMeta rows, the end-of-run warning).
  struct SourceCounts
  {
    std::size_t tagged[kChargeSources] = {};    ///< hypotheses tagged
    std::size_t selected[kChargeSources] = {};  ///< spectra whose selected hypothesis has this source
    std::size_t iso_shifted = 0;                ///< spectra whose selected hypothesis has k != 0
    std::size_t multi = 0;                      ///< spectra tagged under more than one hypothesis
    void add(const std::vector<Hypothesis>& h)
    {
      for (const Hypothesis& x : h)
      {
        ++tagged[static_cast<std::size_t>(x.src)];
        if (x.selected)
        {
          ++selected[static_cast<std::size_t>(x.src)];
          if (x.iso != 0) ++iso_shifted;
        }
      }
      if (h.size() > 1) ++multi;
    }
    void merge(const SourceCounts& o)
    {
      for (std::size_t i = 0; i < kChargeSources; ++i)
      {
        tagged[i] += o.tagged[i];
        selected[i] += o.selected[i];
      }
      iso_shifted += o.iso_shifted;
      multi += o.multi;
    }
  };
}
