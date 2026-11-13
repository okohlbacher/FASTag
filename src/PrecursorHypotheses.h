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
// header-charged precursor is checked twice (checkHeaderCharge). First the
// isotope spacing of the precursor in the preceding MS1 scan (ms1Charge):
// a spacing of 1/z at the precursor m/z calls z; a call equal to the header
// agrees, any other disagrees. Without an MS1 call the infer call decides,
// over -charge_min .. -charge_max plus the header charge, with complement
// pairs counted charge-aware (1+/1+ and, from 3+, 1+/(z-1)+): the header
// disagrees when the call differs from it and its complement pairs (both
// charges' of an ambiguous call) beat the header's by at least the check
// margin, or the 1+ test calls 1. Peaks above the header's fragment ceiling
// are reported but are no ground to disagree. warn counts and reports the
// verdicts and tags as before; both tags a disagreeing spectrum under the
// header charge and the check's charge (charge_src `header` and
// `check_call`), the header charge staying the selected one.
//
// At the defaults (assume2, isotope 0) there is exactly one hypothesis, the
// 1.11 one (header charge or <= 0, the given m/z, H = 1), and nothing here
// runs in the tool: isDefault() gates it.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /**
    @brief Charge candidates of a precursor without a charge (-unknown_charge).
  */
  enum class ChargeMode
  {
    ASSUME2,    ///< 2, as FASTag 1.11; the default
    ENUMERATE,  ///< possible charges, else charge_min .. charge_max
    INFER,      ///< inferCharge()
  };

  /**
    @brief Where a hypothesis' charge came from (TSV column charge_src).

    The values index the SourceCounts arrays.
  */
  enum class ChargeSource : std::uint8_t
  {
    HEADER = 0,      ///< the precursor's charge
    POSSIBLE = 1,    ///< a listed possible charge
    INFERRED = 2,    ///< inferCharge()'s unambiguous call
    AMBIGUOUS = 3,   ///< one of the two charges of an ambiguous call
    ASSUMED = 4,     ///< 2 without evidence (assume2, or infer without a call)
    ENUMERATED = 5,  ///< one of charge_min .. charge_max under enumerate
    CHECK_CALL = 6,   ///< 1.13: the check's charge of a disagreeing header (tagged beside the header charge)
  };
  inline constexpr std::size_t kChargeSources = 7;  ///< number of ChargeSource values

  /**
    @brief The TSV name of a charge source (column charge_src).

    @param[in] s the charge source
    @return "header", "possible", "inferred", "ambiguous", "assumed",
            "enumerated" or "check_call"
  */
  inline const char* sourceName(ChargeSource s)
  {
    switch (s)
    {
      case ChargeSource::HEADER: return "header";
      case ChargeSource::POSSIBLE: return "possible";
      case ChargeSource::INFERRED: return "inferred";
      case ChargeSource::AMBIGUOUS: return "ambiguous";
      case ChargeSource::ASSUMED: return "assumed";
      case ChargeSource::ENUMERATED: return "enumerated";
      case ChargeSource::CHECK_CALL: return "check_call";
    }
    return "assumed";
  }

  /**
    @brief Parse an -unknown_charge value.

    @param[in] s the value: assume2, enumerate or infer
    @param[out] out the mode; set only when the value is known
    @return false for an unknown value
  */
  inline bool parseMode(std::string_view s, ChargeMode& out)
  {
    if (s == "assume2") { out = ChargeMode::ASSUME2; return true; }
    if (s == "enumerate") { out = ChargeMode::ENUMERATE; return true; }
    if (s == "infer") { out = ChargeMode::INFER; return true; }
    return false;
  }

  /**
    @brief What the header-charge check does (-check_header_charge, 1.13).
  */
  enum class HeaderCheck
  {
    OFF,       ///< no check; the default
    WARN,      ///< check and report, tag at the header charge
    BOTH,      ///< check and report, tag a disagreeing spectrum at the header charge and at the check's charge
  };

  /**
    @brief Parse a -check_header_charge value.

    @param[in] s the value: off, warn or both
    @param[out] out the mode; set only when the value is known
    @return false for an unknown value
  */
  inline bool parseHeaderCheck(std::string_view s, HeaderCheck& out)
  {
    if (s == "off") { out = HeaderCheck::OFF; return true; }
    if (s == "warn") { out = HeaderCheck::WARN; return true; }
    if (s == "both") { out = HeaderCheck::BOTH; return true; }
    return false;
  }
  inline constexpr const char* kHeaderCheckDefault = "off";
  inline constexpr const char* kHeaderCheckValues = "off,warn,both";
  /// -check_header_margin default: the complement-pair excess by which the
  /// call must beat the header charge's own. Chosen on DEV (PXD003531,
  /// PXD001819 against a Sage charge truth; output/backlog-1.13/hdrcharge):
  /// at 2 a third of the disagreements on real headers were false.
  inline constexpr double kHeaderMarginDefault = 6.0;
  // ms1Charge() constants (chosen on DEV; output/backlog-1.13/hdrcharge).
  inline constexpr double kMs1TolPpm = 10.0;      ///< m/z window of the precursor and its isotope peaks
  inline constexpr double kMs1FirstMin = 0.15;    ///< +1/z peak, as a share of the precursor peak
  inline constexpr double kMs1SupportMin = 0.05;  ///< -1/z or +2/z peak, as a share of the precursor peak

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

  /**
    @brief The precursor-hypothesis options of a run (#6, and the 1.13 header check).
  */
  struct HypParam
  {
    ChargeMode mode = ChargeMode::ASSUME2;      ///< -unknown_charge
    int charge_min = kChargeMinDefault;         ///< -charge_min
    int charge_max = kChargeMaxDefault;         ///< -charge_max
    double infer_margin = kInferMarginDefault;  ///< -charge_infer_margin
    std::vector<int> isotope_errors{0};         ///< -isotope_error: the isotope offsets k
    HeaderCheck header_check = HeaderCheck::OFF;  ///< 1.13 -check_header_charge
    double header_margin = kHeaderMarginDefault;  ///< 1.13 -check_header_margin

    /**
      @brief Whether these options give the 1.11 behaviour.

      @return true at assume2, the isotope list {0} and no second hypothesis
              from the header check (-check_header_charge warn tags as 1.11
              does)
    */
    bool isDefault() const
    {
      return mode == ChargeMode::ASSUME2 && isotope_errors.size() == 1 && isotope_errors[0] == 0
          && header_check != HeaderCheck::BOTH;
    }
  };

  /**
    @brief Check a HypParam as the tool reads it.

    Checks the charge range, the infer margin, the isotope range and
    duplicates, and the high-resolution guard against the effective fragment
    tolerance.

    @param[in] hp the options
    @param[in] frag_tol the run's fragment tolerance
    @param[in] tol_ppm true when @p frag_tol is in ppm, false for Da
    @return empty when valid, else the message
  */
  std::string validate(const HypParam& hp, double frag_tol, bool tol_ppm);

  /**
    @brief One (charge, isotope) hypothesis of one spectrum.
  */
  struct Hypothesis
  {
    int charge = 2;      ///< the charge tagged (for the 1.11 hypothesis: the header value, may be <= 0)
    int iso = 0;         ///< isotope offset k
    double mz = 0;       ///< precursor m/z handed to the tagger (shifted by -k*C13/charge)
    ChargeSource src = ChargeSource::ASSUMED;  ///< where the charge came from
    bool selected = false;  ///< feeds the reports that aggregate over spectra
  };

  /**
    @brief What an infer call rests on (1.13; ChargeCall::basis).
  */
  enum class CallBasis : std::uint8_t
  {
    NONE = 0,        ///< no evidence (assumed)
    ONE_PLUS = 1,     ///< the 1+ test
    RANGE = 2,       ///< range evidence alone (no complement excess above 0)
    COMPLEMENT = 3,  ///< the complement-pair excess
    MS1_ISOTOPE = 4,  ///< header check only: the precursor's isotope spacing in the preceding MS1 scan
  };
  inline constexpr std::size_t kCallBases = 5;  ///< number of CallBasis values

  /**
    @brief What inferCharge() saw: the call and its evidence.
  */
  struct ChargeCall
  {
    CallBasis basis = CallBasis::NONE;  ///< what the call rests on
    int charge = 2;               ///< the call, one of the candidates (2, else the lowest, when assumed)
    ChargeSource src = ChargeSource::ASSUMED;  ///< Inferred, Ambiguous or Assumed
    int runner_up = 0;            ///< the second charge of an ambiguous call, else 0
    double above_share = 0;       ///< intensity share above the precursor (1+ test)
    int range_min = 0;            ///< lowest charge the range evidence leaves (0 = none ruled out)
    /// Per charge tried: (charge, best excess, the isotope k it was found at).
    std::vector<std::pair<int, std::pair<double, int>>> excess;
  };

  /**
    @brief Complement-pair excess of a spectrum for a precursor of neutral mass @p M.

    Pairs of the strongest kInferTopPeaks peaks (intensity desc, m/z desc)
    whose m/z sum to M + 2p (plus the series' pair delta, ComplementSpec::
    pair_deltas: c/z-dot M + H + 2p) within ComplementSpec::tol, minus the
    mean count at the kOffTargetShifts sums. Independent of the input peak
    order.

    @param[in] spec fragment spectrum
    @param[in] M precursor neutral mass (Da)
    @param[in] cs the complement test (tolerance, pair deltas)
    @return the pair count in excess of chance
  */
  double complementExcess(const OpenMS::MSSpectrum& spec, double M, const ComplementSpec& cs);

  /**
    @brief The isotope offset with the largest complementExcess.

    Ties go to the smaller |k|, then the smaller k.

    @param[in] spec fragment spectrum
    @param[in] prec_mz precursor m/z
    @param[in] charge precursor charge
    @param[in] isotopes the isotope offsets k to try
    @param[in] cs the complement test
    @param[out] excess optional; the excess at the returned k
    @return the best k
  */
  int bestIsotope(const OpenMS::MSSpectrum& spec, double prec_mz, int charge,
                  const std::vector<int>& isotopes, const ComplementSpec& cs, double* excess = nullptr);

  /**
    @brief The infer call for a spectrum without a usable charge.

    The 1+ test, range evidence and the complement-pair excess, as described
    at the top of this file.

    @param[in] spec fragment spectrum
    @param[in] prec_mz precursor m/z
    @param[in] charges the candidates, ascending (charge_min .. charge_max,
               or the possible charges)
    @param[in] hp the options (isotope list, infer margin)
    @param[in] cs the complement test
    @return the call; its charge is one of @p charges
  */
  ChargeCall inferCharge(const OpenMS::MSSpectrum& spec, double prec_mz, const std::vector<int>& charges,
                         const HypParam& hp, const ComplementSpec& cs);

  /**
    @brief The verdict on one header charge (1.13 -check_header_charge).
  */
  enum class HeaderVerdict : std::uint8_t
  {
    AGREE = 0,      ///< the call is the header charge (one of two, when ambiguous)
    DISAGREE = 1,   ///< evidence against the header: see checkHeaderCharge()
    AMBIGUOUS = 2,  ///< two close charges, neither the header, no evidence against it
    NO_CALL = 3,     ///< no evidence either way
  };
  inline constexpr std::size_t kHeaderVerdicts = 4;  ///< number of HeaderVerdict values

  /**
    @brief The report name of a header verdict.

    @param[in] v the verdict
    @return "agree", "disagree", "ambiguous" or "nocall"
  */
  inline const char* verdictName(HeaderVerdict v)
  {
    switch (v)
    {
      case HeaderVerdict::AGREE: return "agree";
      case HeaderVerdict::DISAGREE: return "disagree";
      case HeaderVerdict::AMBIGUOUS: return "ambiguous";
      case HeaderVerdict::NO_CALL: return "nocall";
    }
    return "nocall";
  }

  /**
    @brief The report name of a call basis.

    @param[in] b the basis
    @return "none", "one_plus", "range", "complement" or "ms1_isotope"
  */
  inline const char* basisName(CallBasis b)
  {
    switch (b)
    {
      case CallBasis::NONE: return "none";
      case CallBasis::ONE_PLUS: return "one_plus";
      case CallBasis::RANGE: return "range";
      case CallBasis::COMPLEMENT: return "complement";
      case CallBasis::MS1_ISOTOPE: return "ms1_isotope";
    }
    return "none";
  }

  /**
    @brief The result of checkHeaderCharge() for one precursor.
  */
  struct HeaderCheckResult
  {
    int header = 0;                  ///< the header charge (> 0)
    HeaderVerdict verdict = HeaderVerdict::NO_CALL;  ///< the verdict
    ChargeCall call;                 ///< the infer call over the check's candidates (complement pairs counted charge-aware)
    bool header_ruled_out = false;   ///< peaks above the header's fragment ceiling (reported; no ground to disagree)
    int header_peaks_above = 0;      ///< strongest peaks above the header's fragment ceiling (b/y)
    double header_excess = 0;        ///< complement excess at the header charge (also when ruled out or above the cap; 0 under the 1+ test)
    double call_excess = 0;          ///< complement excess at the call (0 without complement basis)
    int ms1_charge = 0;              ///< ms1Charge() of the preceding MS1 scan (0 = no call or no scan)
    int ms1_peaks = 0;               ///< isotope positions (-1/z, +1/z, +2/z) found for ms1_charge
    CallBasis flag_basis = CallBasis::NONE;  ///< what the verdict rests on (Ms1Isotope, or the call's basis)
    int flag_charge = 0;             ///< the charge the verdict rests on (the MS1 charge, or the call)
    /// @brief The check's charge of a disagreeing header (tagged beside the
    /// header under both); else the header.
    /// @return flag_charge when the verdict is Disagree, else header
    int replacement() const { return verdict == HeaderVerdict::DISAGREE ? flag_charge : header; }
  };

  /**
    @brief The candidates of a header check.

    @param[in] header the header charge
    @param[in] hp the options (charge_min, charge_max)
    @return -charge_min .. -charge_max plus the header charge (when it is in
            1 .. kChargeLimit), ascending
  */
  std::vector<int> headerCheckCandidates(int header, const HypParam& hp);

  /**
    @brief The precursor charge read from the isotope spacing in an MS1 scan.

    The highest z in 1 .. kChargeLimit with a peak at prec_mz + C13/z of at
    least kMs1FirstMin of the precursor peak and one at prec_mz - C13/z or
    prec_mz + 2*C13/z of at least kMs1SupportMin (all within kMs1TolPpm).

    @param[in] ms1 the MS1 scan
    @param[in] prec_mz precursor m/z
    @param[out] peaks optional; how many of the three positions the call has
                (0 without a call)
    @return the charge; 0 = no call: a profile or empty scan, no precursor
            peak, no spacing
  */
  int ms1Charge(const OpenMS::MSSpectrum& ms1, double prec_mz, int* peaks = nullptr);

  /**
    @brief The verdict on a header-charged precursor (1.13 -check_header_charge).

    With an MS1 call (ms1Charge of @p ms1): Agree when it is the header or
    the header's own peak at prec_mz + C13/header reaches kMs1FirstMin of
    the precursor peak, else Disagree at the MS1 charge. Without one, the infer call over
    headerCheckCandidates() (the 1+ test where 1 is one; complement pairs
    counted charge-aware) decides: Disagree when the call is not ambiguous,
    is not the header, and its complement-pair excess is above 0 and beats
    the header's by at least hp.header_margin (and the runner-up by
    -charge_infer_margin, as infer), or the 1+ test calls 1. Agree when the
    call (or one charge of an ambiguous call) is the header and is not
    assumed. Two close charges that exclude the header: Disagree (the call
    is the better one) when both beat its excess by hp.header_margin, else
    Ambiguous. Else NoCall. `call` is the infer call in every case;
    flag_basis and flag_charge say what the verdict rests on.
    A precursor without a header charge gives NoCall with header 0.

    @param[in] spec fragment spectrum
    @param[in] prec the precursor (header charge, m/z)
    @param[in] hp the options (charge range, margins)
    @param[in] cs the complement test
    @param[in] ms1 optional; the preceding MS1 scan
    @return the verdict and the evidence it rests on
  */
  HeaderCheckResult checkHeaderCharge(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                      const HypParam& hp, const ComplementSpec& cs,
                                      const OpenMS::MSSpectrum* ms1 = nullptr);

  /**
    @brief The hypotheses of one spectrum, in ascending charge, exactly one of them selected.

    At hp.isDefault() this is the single 1.11 hypothesis
    {prec.getCharge(), 0, prec.getMZ(), header or assumed}.

    @param[in] spec fragment spectrum
    @param[in] prec the precursor (charge, possible charges, m/z)
    @param[in] hp the options
    @param[in] cs the complement test
    @param[out] call optional; the infer call when one was computed
    @param[in] header_check optional (1.13); under -check_header_charge both,
               a Disagree verdict adds a hypothesis at the check's charge
               (ChargeSource::CHECK_CALL); the header charge stays selected
    @return the hypotheses
  */
  std::vector<Hypothesis> precursorHypotheses(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                              const HypParam& hp, const ComplementSpec& cs,
                                              ChargeCall* call = nullptr,
                                              const HeaderCheckResult* header_check = nullptr);

  /**
    @brief Per-run counts of the header check (1.13; warn and both).
  */
  struct HeaderCheckCounts
  {
    std::size_t checked = 0;                       ///< header-charged MS2 spectra checked
    std::size_t verdict[kHeaderVerdicts] = {};     ///< by verdict
    std::size_t disagree_by[kCallBases] = {};      ///< Disagree by flag_basis
    std::size_t both = 0;                          ///< tagged at both charges (both)
    /// Disagree by (header, check's charge), both 1 .. kChargeLimit.
    std::size_t moves[kChargeLimit + 1][kChargeLimit + 1] = {};

    /**
      @brief Count one check result; results without a header charge are ignored.

      @param[in] r the check result
      @param[in] both_on true under -check_header_charge both
    */
    void add(const HeaderCheckResult& r, bool both_on)
    {
      if (r.header <= 0) return;
      ++checked;
      ++verdict[static_cast<std::size_t>(r.verdict)];
      if (r.verdict == HeaderVerdict::DISAGREE)
      {
        ++disagree_by[static_cast<std::size_t>(r.flag_basis)];
        if (r.header <= kChargeLimit && r.flag_charge >= 1 && r.flag_charge <= kChargeLimit)
          ++moves[r.header][r.flag_charge];
        if (both_on && r.flag_charge >= 1 && r.flag_charge != r.header) ++both;
      }
    }

    /**
      @brief Add another set of counts (e.g. of another thread) to these.

      @param[in] o the counts to add
    */
    void merge(const HeaderCheckCounts& o)
    {
      checked += o.checked;
      for (std::size_t i = 0; i < kHeaderVerdicts; ++i) verdict[i] += o.verdict[i];
      for (std::size_t i = 0; i < kCallBases; ++i) disagree_by[i] += o.disagree_by[i];
      both += o.both;
      for (int a = 0; a <= kChargeLimit; ++a)
        for (int b = 0; b <= kChargeLimit; ++b) moves[a][b] += o.moves[a][b];
    }
  };

  /**
    @brief Merge the rows of several hypotheses of one spectrum.

    Merged by (corrected) E-value -- stable, so ties keep hypothesis order --
    and capped at @p cap rows.

    @param[in] per_hyp per hypothesis, its rows sorted best first
    @param[in] cap the maximum number of rows; 0 = no cap
    @return the rows, each paired with the index of its hypothesis
  */
  std::vector<std::pair<Tag, std::uint8_t>> mergeHypotheses(std::vector<std::vector<Tag>> per_hyp, std::size_t cap);

  /**
    @brief Per-run counts of the hypotheses tagged, by source, and of the selected ones.

    Used for the RunMeta rows and the end-of-run warning.
  */
  struct SourceCounts
  {
    std::size_t tagged[kChargeSources] = {};    ///< hypotheses tagged
    std::size_t selected[kChargeSources] = {};  ///< spectra whose selected hypothesis has this source
    std::size_t iso_shifted = 0;                ///< spectra whose selected hypothesis has k != 0
    std::size_t multi = 0;                      ///< spectra tagged under more than one hypothesis

    /**
      @brief Count the hypotheses of one spectrum.

      @param[in] h the spectrum's hypotheses
    */
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

    /**
      @brief Add another set of counts (e.g. of another thread) to these.

      @param[in] o the counts to add
    */
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
