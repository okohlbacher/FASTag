// Ion series and activation (FASTag 1.12, item #15).
//
// PHASE A: detection. Every tagged MS2 spectrum is put in one activation
// class -- collisional, electron, hybrid or unknown -- from its first
// precursor's dissociation methods (the PSI-MS <activation> terms both mzML
// readers fill, step 0), or, when none of them is classified, from the Thermo
// filter string's @<method> tokens. The tool counts the classes per run and,
// under -ion_series by, warns when more than 1% of the MS2 spectra are
// electron or hybrid activated.
//
// PHASE B: the ion series a spectrum is read as (-ion_series by|cz|auto).
// An IonPair holds the terminal offsets of one series pair: an N-terminal ion
// of residues r has neutral mass r + offN, a C-terminal one r + offC (OpenMS
// Residue::getInternalTo*Ion). b/y: offN 0, offC H2O. c/z-dot: offN NH3,
// offC H2O - NH2 (OpenMS Zp1, the z+1 radical that ETD/ECD yield). Their
// neutral masses sum to M + compl_delta, compl_delta = offN + offC - H2O
// (b/y 0, c/z-dot +H = 1.007825). A tag is spelled from residue differences,
// which do not depend on the series; only its flanking masses, the complement
// partner and the reversed-read offset offC - offN (+18.0106 for b/y,
// -15.0347 for c/z-dot) do. Hybrid by+cz: see 1.13 item 10 below.
//
// a/x (1.13 backlog item 11: -ion_series ax, -ion_series_photo) was removed
// in 1.14: it failed its held-out test. -ion_series ax is read as by.
//
// Hybrid EThcD/ETciD (1.13 backlog item 10, -ion_series_hybrid both): a
// hybrid spectrum carries b/y and c/z-dot ions together, and no one ion pair
// gives its tags the right flanks. Under auto with -ion_series_hybrid both,
// each hybrid spectrum is tagged twice, once as b/y and once as c/z-dot, with
// every E-value multiplied by kHybridPasses (two readings were tested, as for
// precursor hypotheses), and the two row lists are merged by E-value under one
// cap (FASTag::mergeSeriesPasses). Every row keeps the series it was read as
// (Tag::ion_series), and every consumer takes its offsets from that row. The
// default -ion_series_hybrid by keeps 1.12's auto (hybrid as b/y, a WARN).
//
// Classes:
//   collisional  CID (MS:1000133), HCD (MS:1000422), trap-type CID
//                (MS:1002472), PQD (MS:1000599), low/high-energy CID, SORI;
//   electron     ETD (MS:1000598), ECD (MS:1000250);
//   hybrid       EThcD (MS:1002631, or ETD + MS:1002678), ETciD (MS:1003182,
//                or ETD + MS:1002679), or an electron and a collisional
//                method listed together;
//   unknown      no method, or only methods that are neither (photo, IR,
//                surface, post-source, in-source, LIFT), and no filter token
//                that classifies. MGF and mzPeak input carry no activation;
//                -ion_series auto never reads one from them
//                (autoReadsActivation, seriesInRun).
// A method of no class never hides one that has a class.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace FASTag::IonSeries
{
  /**
    @brief The activation class of one MS2 spectrum.

    The values index ActivationCounts::n.
  */
  enum class Activation : std::size_t
  {
    COLLISIONAL = 0,  ///< CID, HCD, trap-type CID, PQD, low/high-energy CID, SORI
    ELECTRON = 1,     ///< ETD, ECD
    HYBRID = 2,       ///< EThcD, ETciD, or electron and collisional methods together
    UNKNOWN = 3,      ///< no classified method or filter token
  };
  /// Number of Activation values.
  inline constexpr std::size_t kActivationClasses = 4;

  /**
    @brief The name of an activation class.

    @param[in] a Activation class.
    @return "collisional", "electron", "hybrid" or "unknown".
  */
  inline const char* activationName(Activation a)
  {
    switch (a)
    {
      case Activation::COLLISIONAL: return "collisional";
      case Activation::ELECTRON: return "electron";
      case Activation::HYBRID: return "hybrid";
      case Activation::UNKNOWN: break;
    }
    return "unknown";
  }

  namespace detail
  {
    /**
      @brief What one method or filter token says.
    */
    struct Seen
    {
      bool collisional = false, electron = false, hybrid = false;  ///< classes seen
      /// @brief The class of what was seen (electron and collisional together is hybrid).
      /// @return The activation class.
      Activation result() const
      {
        if (hybrid || (electron && collisional)) return Activation::HYBRID;
        if (electron) return Activation::ELECTRON;
        if (collisional) return Activation::COLLISIONAL;
        return Activation::UNKNOWN;
      }
    };
  }

  /**
    @brief The class of a precursor's dissociation methods.

    A method of no class never hides one that has a class.

    @param[in] methods The precursor's activation methods.
    @return The activation class.
  */
  inline Activation activationClass(const std::set<OpenMS::Precursor::ActivationMethod>& methods)
  {
    using AM = OpenMS::Precursor::ActivationMethod;
    detail::Seen s;
    for (AM m : methods)
    {
      switch (m)
      {
        case AM::CID:
        case AM::HCD:
        case AM::TRAP:
        case AM::PQD:
        case AM::HCID:
        case AM::LCID:
        case AM::SORI: s.collisional = true; break;
        case AM::ETD:
        case AM::ECD: s.electron = true; break;
        case AM::EThcD:
        case AM::ETciD: s.hybrid = true; break;
        default: break;
      }
    }
    return s.result();
  }

  /**
    @brief The class of a Thermo filter string's @<method><energy> tokens.

    ("...@etd50.00@hcd25.00 [..]" is EThcD). A token is the run of letters
    after an '@', compared case-insensitively: cid, hcd, pqd are collisional;
    etd, ecd electron; ethcd, etcid hybrid; any other token has no class.

    @param[in] filter Thermo filter string.
    @return The activation class.
  */
  inline Activation activationClassFromFilter(std::string_view filter)
  {
    detail::Seen s;
    for (std::size_t at = filter.find('@'); at != std::string_view::npos; at = filter.find('@', at + 1))
    {
      std::string tok;
      for (std::size_t i = at + 1; i < filter.size(); ++i)
      {
        char c = filter[i];
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        if (c < 'a' || c > 'z') break;
        tok += c;
      }
      if (tok == "cid" || tok == "hcd" || tok == "pqd") s.collisional = true;
      else if (tok == "etd" || tok == "ecd") s.electron = true;
      else if (tok == "ethcd" || tok == "etcid") s.hybrid = true;
    }
    return s.result();
  }

  /**
    @brief The class of one MS2 spectrum.

    Its first precursor's methods (the one tagging uses), else the "filter
    string" meta value the mzML readers set.

    @param[in] spec MS2 spectrum.
    @return The activation class; Unknown when neither source classifies.
  */
  inline Activation activationClass(const OpenMS::MSSpectrum& spec)
  {
    if (!spec.getPrecursors().empty())
    {
      const Activation a = activationClass(spec.getPrecursors().front().getActivationMethods());
      if (a != Activation::UNKNOWN) return a;
    }
    if (spec.metaValueExists("filter string"))
      return activationClassFromFilter(spec.getMetaValue("filter string").toString());
    return Activation::UNKNOWN;
  }

  /**
    @brief Per-run (or per-thread) counts of the activation classes.
  */
  struct ActivationCounts
  {
    std::array<std::size_t, kActivationClasses> n{};  ///< spectra per Activation value

    /// @brief Counts one spectrum of class @p a.
    /// @param[in] a Activation class.
    void add(Activation a) { ++n[static_cast<std::size_t>(a)]; }
    /**
      @brief Adds the counts of another instance.

      @param[in] o Counts to add.
    */
    void merge(const ActivationCounts& o)
    {
      for (std::size_t i = 0; i < kActivationClasses; ++i) n[i] += o.n[i];
    }
    /// @brief The count of one class.
    /// @param[in] a Activation class.
    /// @return Spectra counted with class @p a.
    std::size_t of(Activation a) const { return n[static_cast<std::size_t>(a)]; }
    /// @brief The count over all classes.
    /// @return Spectra counted.
    std::size_t total() const
    {
      std::size_t t = 0;
      for (std::size_t v : n) t += v;
      return t;
    }
    /**
      @brief Whether to warn about electron activation under -ion_series by.

      Tagging reads b/y ions: warn when more than 1% of the MS2 spectra are
      electron or hybrid activated.

      @return True when the warning applies.
    */
    bool warnUnderBy() const
    {
      const std::size_t e = of(Activation::ELECTRON) + of(Activation::HYBRID);
      return e > 0 && 100 * e > total();
    }
  };

  /**
    @brief The one-line warning for a run that warnUnderBy().

    It starts with "Electron activation:", so it can never match gate.sh's
    summary-line pattern ^[0-9]+ MS2 spectra, [0-9]+ tags.

    @param[in] c Activation counts of the run.
    @return The warning text.
  */
  inline std::string byModeWarning(const ActivationCounts& c)
  {
    const auto s = [](std::size_t v) { return std::to_string(v); };
    return "Electron activation: " + s(c.of(Activation::ELECTRON) + c.of(Activation::HYBRID)) + " of " + s(c.total())
         + " MS2 spectra were activated by electron transfer or capture (ETD, ECD) or by a hybrid method (EThcD, "
           "ETciD), but tags are read as b/y ions only; electron activation yields mostly c/z ions, so tags and "
           "flanks from these spectra are unreliable. Activation per MS2 spectrum: "
         + s(c.of(Activation::COLLISIONAL)) + " collisional, " + s(c.of(Activation::ELECTRON)) + " electron, "
         + s(c.of(Activation::HYBRID)) + " hybrid, " + s(c.of(Activation::UNKNOWN)) + " unknown.";
  }

  // ------------------------------------------------------------ phase B

  /**
    @brief The ion series a tag was read as.

    The values are stable (Tag::ion_series).
  */
  enum class Series : std::uint8_t
  {
    BY = 0,  ///< b/y: FASTag 1.11, collisional activation
    CZ = 1,  ///< c/z-dot (z+1 radical): electron activation (ETD, ECD)
    // 2 was a/x (1.13 item 11), removed in 1.14.
  };

  /**
    @brief The name of an ion series.

    @param[in] s Ion series.
    @return "cz" or "by".
  */
  inline const char* seriesName(Series s)
  {
    switch (s)
    {
      case Series::CZ: return "cz";
      case Series::BY: break;
    }
    return "by";
  }

  /**
    @brief One N-/C-terminal ion pair (see the file comment); ionPair() fills it.

    The b/y consumers (tagger flanks, TagRecon, Digest) keep FASTag 1.11's
    own expressions and constants and never read these offsets, so b/y stays
    bit-identical; a default-constructed pair has NaN offsets, so a consumer
    that wrongly reads them shows it.
  */
  struct IonPair
  {
    Series kind = Series::BY;  ///< the series of the pair
    double offN = std::numeric_limits<double>::quiet_NaN();  ///< N-terminal ion neutral mass minus its residues
    double offC = std::numeric_limits<double>::quiet_NaN();  ///< C-terminal ion neutral mass minus its residues
    double compl_delta = 0.0;   ///< offN + offC - H2O: the even-electron ions' neutral masses sum to M + this
    /// The complement test's partner sums (ComplementSpec::pair_deltas): a
    /// cleavage pair's neutral masses sum to M + one of these. b/y {0} and
    /// c/z-dot {+H} are {compl_delta}.
    std::vector<double> compl_deltas{0.0};
    /// Charges the precursor loses on the way to the pair: 0 for b/y; 1 for
    /// c/z-dot, since [M+cH]^c+ takes up one electron and its c and z-dot
    /// fragments share c - 1 charges (the complement's precursor rule).
    int charge_loss = 0;
    /**
      @brief The reversed-read offset offC - offN.

      What a reversed read (the low peak an N-terminal ion) adds to the
      residue sum it reports: N-side residues = cterm_mass + this, C-side
      residues = nterm_mass - this. b/y: +H2O; c/z-dot: -15.034708.

      @return offC - offN (Da).
    */
    double reversedOffset() const { return offC - offN; }
  };

  /**
    @brief The ion pair of a series, from OpenMS's residue-to-ion formulas.

    @param[in] s Ion series.
    @return The filled ion pair.
  */
  inline IonPair ionPair(Series s)
  {
    using OpenMS::Residue;
    static const double kWater = OpenMS::EmpiricalFormula("H2O").getMonoWeight();
    IonPair p;
    p.kind = s;
    if (s == Series::CZ)
    {
      p.offN = Residue::getInternalToCIon().getMonoWeight();
      p.offC = Residue::getInternalToZp1Ion().getMonoWeight();
      p.charge_loss = 1;
    }
    else
    {
      p.offN = Residue::getInternalToBIon().getMonoWeight();
      p.offC = Residue::getInternalToYIon().getMonoWeight();
    }
    p.compl_delta = s == Series::BY ? 0.0 : p.offN + p.offC - kWater;
    p.compl_deltas = {p.compl_delta};
    return p;
  }

  /**
    @brief -ion_series: which series the spectra are read as.
  */
  enum class Mode
  {
    BY,    ///< every spectrum as b/y (FASTag 1.11; the default)
    CZ,    ///< every spectrum as c/z-dot
    AUTO,  ///< electron-activated spectra as c/z-dot, all others as b/y
  };
  /// Default value of -ion_series.
  inline constexpr const char* MODE_DEFAULT = "by";
  /// The valid strings: ax (1.13 item 11) was removed in 1.14 and stays
  /// valid so that 1.13 command lines and INI files load; FASTag reads it as
  /// the default (TOPPFASTag::kRemovedValues).
  inline constexpr const char* MODE_VALUES = "by,cz,auto,ax";

  /**
    @brief Parses an -ion_series value.

    @param[in] s Option value.
    @return Cz for "cz", Auto for "auto", By for anything else (including the removed "ax").
  */
  inline Mode modeFromString(std::string_view s)
  {
    if (s == "cz") return Mode::CZ;
    if (s == "auto") return Mode::AUTO;
    return Mode::BY;
  }

  /**
    @brief The -ion_series value of a mode.

    @param[in] m Mode.
    @return "by", "cz" or "auto".
  */
  inline const char* modeName(Mode m)
  {
    switch (m)
    {
      case Mode::CZ: return "cz";
      case Mode::AUTO: return "auto";
      case Mode::BY: break;
    }
    return "by";
  }

  /// -ion_series_hybrid (1.13 item 10): what -ion_series auto does with a
  /// hybrid (EThcD, ETciD) spectrum: by (the default, 1.12's auto) or both
  /// (a b/y and a c/z-dot pass, merged per row).
  inline constexpr const char* kHybridDefault = "by";
  /// The valid -ion_series_hybrid strings.
  inline constexpr const char* kHybridValues = "by,both";
  /// The E-value factor of a two-pass hybrid reading: two series tested.
  inline constexpr double kHybridPasses = 2.0;

  /**
    @brief Whether a spectrum is read in two passes (b/y and c/z-dot).

    Whether a spectrum of class @p a is read in two passes in a run under
    @p m with -ion_series_hybrid both (@p hybrid_both) whose tag TSV carries
    the ion_series column iff @p run_column. As with seriesInRun(), c/z rows
    only in a run with the column.

    @param[in] m -ion_series mode.
    @param[in] a Activation class of the spectrum.
    @param[in] run_column Whether the run's tag TSV carries the ion_series column.
    @param[in] hybrid_both Whether -ion_series_hybrid is both.
    @return True for a hybrid spectrum under auto with hybrid_both and the column.
  */
  inline bool hybridTwoPass(Mode m, Activation a, bool run_column, bool hybrid_both)
  {
    return m == Mode::AUTO && hybrid_both && a == Activation::HYBRID && run_column;
  }

  /**
    @brief The series a spectrum of an activation class is read as under a mode.

    auto reads electron activation as c/z-dot and everything else -- hybrid
    (unless -ion_series_hybrid both: hybridTwoPass()), collisional and
    unknown -- as b/y.

    @param[in] m -ion_series mode.
    @param[in] a Activation class of the spectrum.
    @return The ion series.
  */
  inline Series seriesFor(Mode m, Activation a)
  {
    if (m == Mode::CZ) return Series::CZ;
    if (m == Mode::AUTO && a == Activation::ELECTRON) return Series::CZ;
    return Series::BY;
  }

  /**
    @brief Whether a run writes the ion_series column.

    Whether a run under @p m can tag any spectrum of class counts @p c as
    c/z: then the tag TSV (and the census) carry an ion_series column. Under
    by never; under cz always; under auto when some spectrum is electron
    activated, so a collisional run's outputs stay those of by.
    1.13 item 10: under auto with -ion_series_hybrid both (@p hybrid_both)
    also when some spectrum is hybrid activated.

    @param[in] m -ion_series mode.
    @param[in] c Activation counts of the run.
    @param[in] hybrid_both Whether -ion_series_hybrid is both.
    @return True when the ion_series column is written.
  */
  inline bool seriesColumn(Mode m, const ActivationCounts& c, bool hybrid_both = false)
  {
    if (m == Mode::CZ) return true;
    return m == Mode::AUTO
        && (c.of(Activation::ELECTRON) > 0 || (hybrid_both && c.of(Activation::HYBRID) > 0));
  }

  /**
    @brief Whether -ion_series auto reads the activation of an input.

    mzML yes; MGF and mzPeak no (the file comment), so auto reads them as
    b/y and writes no ion_series column, whatever activation a reader may
    deliver.

    @param[in] mzpeak_in Whether the input is mzPeak.
    @param[in] mgf_in Whether the input is MGF.
    @return True for neither mzPeak nor MGF input.
  */
  inline bool autoReadsActivation(bool mzpeak_in, bool mgf_in) { return !mzpeak_in && !mgf_in; }

  /**
    @brief The series a spectrum is read as in a run, given the run's column rule.

    The series a spectrum of class @p a is read as in a run under @p m whose
    tag TSV carries the ion_series column iff @p run_column: seriesFor(),
    but c/z only in a run with the column. The tagging loop and the column
    rule thus cannot disagree: a c/z row always says so. Under cz the column
    is always written, so this is seriesFor(); under auto a spectrum the
    column rule did not foresee (an input auto does not read the activation
    of, autoReadsActivation()) is read as b/y and counted (SeriesCounts::
    auto_by_no_column).

    @param[in] m -ion_series mode.
    @param[in] a Activation class of the spectrum.
    @param[in] run_column Whether the run's tag TSV carries the ion_series column.
    @return The ion series.
  */
  inline Series seriesInRun(Mode m, Activation a, bool run_column)
  {
    const Series s = seriesFor(m, a);
    return s != Series::BY && !run_column ? Series::BY : s;
  }

  /**
    @brief Per-run (or per-thread) phase B counts.

    MS2 spectra tagged per series, and the c/z tags a consumer that reads
    b/y only left out (PLAN-INTEGRATION 2.3, contract 2).
  */
  struct SeriesCounts
  {
    std::size_t ms2_by = 0, ms2_cz = 0;  ///< MS2 tagged as b/y and as c/z-dot
    /// 1.13 item 10: MS2 read in two passes (b/y and c/z-dot), counted in
    /// neither ms2_by nor ms2_cz.
    std::size_t ms2_hybrid = 0;
    std::size_t species_excluded = 0;  ///< c/z rows -species did not count
    /// MS2 that seriesFor() reads as c/z but seriesInRun() read as b/y: the
    /// run writes no ion_series column (auto on mzPeak or MGF input).
    std::size_t auto_by_no_column = 0;
    /**
      @brief Adds the counts of another instance.

      @param[in] o Counts to add.
    */
    void merge(const SeriesCounts& o)
    {
      ms2_by += o.ms2_by;
      ms2_cz += o.ms2_cz;
      ms2_hybrid += o.ms2_hybrid;
      species_excluded += o.species_excluded;
      auto_by_no_column += o.auto_by_no_column;
    }
  };

  /**
    @brief The stderr INFO line of a run under auto or cz.

    It starts with "Ion series", so it can never match gate.sh's
    summary-line pattern.

    @param[in] m -ion_series mode.
    @param[in] s Series counts of the run.
    @param[in] c Activation counts of the run.
    @param[in] hybrid_both Whether -ion_series_hybrid is both (adds the two-pass count under auto).
    @return The INFO line.
  */
  inline std::string seriesInfo(Mode m, const SeriesCounts& s, const ActivationCounts& c, bool hybrid_both = false)
  {
    const auto n = [](std::size_t v) { return std::to_string(v); };
    return std::string("Ion series (-ion_series ") + modeName(m) + "): " + n(s.ms2_cz)
         + " MS2 spectra tagged as c/z-dot ions, " + n(s.ms2_by) + " as b/y ions"
         // 1.13 item 10: only under auto with -ion_series_hybrid both.
         + (m == Mode::AUTO && hybrid_both ? ", " + n(s.ms2_hybrid) + " as b/y and c/z-dot ions (hybrid, two passes)"
                                           : std::string())
         + " (activation: "
         + n(c.of(Activation::COLLISIONAL)) + " collisional, " + n(c.of(Activation::ELECTRON)) + " electron, "
         + n(c.of(Activation::HYBRID)) + " hybrid, " + n(c.of(Activation::UNKNOWN)) + " unknown).";
  }

  /**
    @brief Whether to warn about hybrid spectra under -ion_series auto.

    auto reads hybrid spectra as b/y: warn when more than 1% are hybrid.

    @param[in] c Activation counts of the run.
    @return True when the warning applies.
  */
  inline bool warnHybridUnderAuto(const ActivationCounts& c)
  {
    const std::size_t h = c.of(Activation::HYBRID);
    return h > 0 && 100 * h > c.total();
  }

  /**
    @brief The warning for a run that warnHybridUnderAuto().

    @param[in] c Activation counts of the run.
    @return The warning text.
  */
  inline std::string hybridAutoWarning(const ActivationCounts& c)
  {
    return "Hybrid activation: " + std::to_string(c.of(Activation::HYBRID)) + " of " + std::to_string(c.total())
         + " MS2 spectra were activated by a hybrid method (EThcD, ETciD) and were tagged as b/y ions under "
           "-ion_series auto; reading them as b/y and c/z ions together is not supported yet.";
  }

  /**
    @brief Whether to warn about collisional spectra under -ion_series cz.

    cz reads every spectrum as c/z-dot: warn when more than 1% are
    collisional.

    @param[in] c Activation counts of the run.
    @return True when the warning applies.
  */
  inline bool warnCollisionalUnderCz(const ActivationCounts& c)
  {
    const std::size_t k = c.of(Activation::COLLISIONAL);
    return k > 0 && 100 * k > c.total();
  }

  /**
    @brief The warning for a run that warnCollisionalUnderCz().

    @param[in] c Activation counts of the run.
    @return The warning text.
  */
  inline std::string collisionalCzWarning(const ActivationCounts& c)
  {
    return "Collisional activation: " + std::to_string(c.of(Activation::COLLISIONAL)) + " of "
         + std::to_string(c.total())
         + " MS2 spectra were activated by collision (CID, HCD), which yields b/y ions, but -ion_series cz reads "
           "every spectrum as c/z-dot ions; use -ion_series auto or by for them.";
  }

  /**
    @brief The warning for SeriesCounts::auto_by_no_column > 0.

    @param[in] n SeriesCounts::auto_by_no_column.
    @return The warning text.
  */
  inline std::string autoNoColumnWarning(std::size_t n)
  {
    return "Ion series: " + std::to_string(n)
         + " electron-activated MS2 spectra were tagged as b/y ions: -ion_series auto reads the activation of mzML "
           "input only and writes no ion_series column here; use -ion_series cz to read them as c/z-dot ions.";
  }

  /**
    @brief The warning for c/z tags that -species left out (it reads b/y tags only).

    @param[in] n Number of c/z tag rows left out.
    @return The warning text.
  */
  inline std::string speciesExcludedWarning(std::size_t n)
  {
    return "Ion series: " + std::to_string(n)
         + " tag rows read as c/z-dot ions were left out of -species, which counts b/y tags only.";
  }
}
