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
  /// The activation class of one MS2 spectrum. The values index
  /// ActivationCounts::n.
  enum class Activation : std::size_t
  {
    Collisional = 0,
    Electron = 1,
    Hybrid = 2,
    Unknown = 3,
  };
  inline constexpr std::size_t kActivationClasses = 4;

  inline const char* activationName(Activation a)
  {
    switch (a)
    {
      case Activation::Collisional: return "collisional";
      case Activation::Electron: return "electron";
      case Activation::Hybrid: return "hybrid";
      case Activation::Unknown: break;
    }
    return "unknown";
  }

  namespace detail
  {
    /// What one method or filter token says.
    struct Seen
    {
      bool collisional = false, electron = false, hybrid = false;
      Activation result() const
      {
        if (hybrid || (electron && collisional)) return Activation::Hybrid;
        if (electron) return Activation::Electron;
        if (collisional) return Activation::Collisional;
        return Activation::Unknown;
      }
    };
  }

  /// The class of a precursor's dissociation methods.
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

  /// The class of a Thermo filter string's @<method><energy> tokens
  /// ("...@etd50.00@hcd25.00 [..]" is EThcD). A token is the run of letters
  /// after an '@', compared case-insensitively: cid, hcd, pqd are collisional;
  /// etd, ecd electron; ethcd, etcid hybrid; any other token has no class.
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

  /// The class of one MS2 spectrum: its first precursor's methods (the one
  /// tagging uses), else the "filter string" meta value the mzML readers set.
  inline Activation activationClass(const OpenMS::MSSpectrum& spec)
  {
    if (!spec.getPrecursors().empty())
    {
      const Activation a = activationClass(spec.getPrecursors().front().getActivationMethods());
      if (a != Activation::Unknown) return a;
    }
    if (spec.metaValueExists("filter string"))
      return activationClassFromFilter(spec.getMetaValue("filter string").toString());
    return Activation::Unknown;
  }

  /// Per-run (or per-thread) counts of the activation classes.
  struct ActivationCounts
  {
    std::array<std::size_t, kActivationClasses> n{};

    void add(Activation a) { ++n[static_cast<std::size_t>(a)]; }
    void merge(const ActivationCounts& o)
    {
      for (std::size_t i = 0; i < kActivationClasses; ++i) n[i] += o.n[i];
    }
    std::size_t of(Activation a) const { return n[static_cast<std::size_t>(a)]; }
    std::size_t total() const
    {
      std::size_t t = 0;
      for (std::size_t v : n) t += v;
      return t;
    }
    /// Tagging reads b/y ions: warn when more than 1% of the MS2 spectra are
    /// electron or hybrid activated.
    bool warnUnderBy() const
    {
      const std::size_t e = of(Activation::Electron) + of(Activation::Hybrid);
      return e > 0 && 100 * e > total();
    }
  };

  /// The one-line warning for a run that warnUnderBy(). It starts with
  /// "Electron activation:", so it can never match gate.sh's summary-line
  /// pattern ^[0-9]+ MS2 spectra, [0-9]+ tags.
  inline std::string byModeWarning(const ActivationCounts& c)
  {
    const auto s = [](std::size_t v) { return std::to_string(v); };
    return "Electron activation: " + s(c.of(Activation::Electron) + c.of(Activation::Hybrid)) + " of " + s(c.total())
         + " MS2 spectra were activated by electron transfer or capture (ETD, ECD) or by a hybrid method (EThcD, "
           "ETciD), but tags are read as b/y ions only; electron activation yields mostly c/z ions, so tags and "
           "flanks from these spectra are unreliable. Activation per MS2 spectrum: "
         + s(c.of(Activation::Collisional)) + " collisional, " + s(c.of(Activation::Electron)) + " electron, "
         + s(c.of(Activation::Hybrid)) + " hybrid, " + s(c.of(Activation::Unknown)) + " unknown.";
  }

  // ------------------------------------------------------------ phase B

  /// The ion series a tag was read as. The values are stable (Tag::ion_series).
  enum class Series : std::uint8_t
  {
    BY = 0,  ///< b/y: FASTag 1.11, collisional activation
    CZ = 1,  ///< c/z-dot (z+1 radical): electron activation (ETD, ECD)
    // 2 was a/x (1.13 item 11), removed in 1.14.
  };

  inline const char* seriesName(Series s)
  {
    switch (s)
    {
      case Series::CZ: return "cz";
      case Series::BY: break;
    }
    return "by";
  }

  /// One N-/C-terminal ion pair (see the file comment); ionPair() fills it.
  /// The b/y consumers (tagger flanks, TagRecon, Digest) keep FASTag 1.11's
  /// own expressions and constants and never read these offsets, so b/y stays
  /// bit-identical; a default-constructed pair has NaN offsets, so a consumer
  /// that wrongly reads them shows it.
  struct IonPair
  {
    Series kind = Series::BY;
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
    /// What a reversed read (the low peak an N-terminal ion) adds to the
    /// residue sum it reports: N-side residues = cterm_mass + this, C-side
    /// residues = nterm_mass - this. b/y: +H2O; c/z-dot: -15.034708.
    double reversedOffset() const { return offC - offN; }
  };

  /// The ion pair of @p s, from OpenMS's residue-to-ion formulas.
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

  /// -ion_series: which series the spectra are read as.
  enum class Mode
  {
    By,    ///< every spectrum as b/y (FASTag 1.11; the default)
    Cz,    ///< every spectrum as c/z-dot
    Auto,  ///< electron-activated spectra as c/z-dot, all others as b/y
  };
  inline constexpr const char* kModeDefault = "by";
  /// The valid strings: ax (1.13 item 11) was removed in 1.14 and stays
  /// valid so that 1.13 command lines and INI files load; FASTag reads it as
  /// the default (TOPPFASTag::kRemovedValues).
  inline constexpr const char* kModeValues = "by,cz,auto,ax";

  inline Mode modeFromString(std::string_view s)
  {
    if (s == "cz") return Mode::Cz;
    if (s == "auto") return Mode::Auto;
    return Mode::By;
  }

  inline const char* modeName(Mode m)
  {
    switch (m)
    {
      case Mode::Cz: return "cz";
      case Mode::Auto: return "auto";
      case Mode::By: break;
    }
    return "by";
  }

  /// -ion_series_hybrid (1.13 item 10): what -ion_series auto does with a
  /// hybrid (EThcD, ETciD) spectrum: by (the default, 1.12's auto) or both
  /// (a b/y and a c/z-dot pass, merged per row).
  inline constexpr const char* kHybridDefault = "by";
  inline constexpr const char* kHybridValues = "by,both";
  /// The E-value factor of a two-pass hybrid reading: two series tested.
  inline constexpr double kHybridPasses = 2.0;

  /// Whether a spectrum of class @p a is read in two passes (b/y and c/z-dot)
  /// in a run under @p m with -ion_series_hybrid both (@p hybrid_both) whose
  /// tag TSV carries the ion_series column iff @p run_column. As with
  /// seriesInRun(), c/z rows only in a run with the column.
  inline bool hybridTwoPass(Mode m, Activation a, bool run_column, bool hybrid_both)
  {
    return m == Mode::Auto && hybrid_both && a == Activation::Hybrid && run_column;
  }

  /// The series a spectrum of activation class @p a is read as under @p m.
  /// auto reads electron activation as c/z-dot and everything else -- hybrid
  /// (unless -ion_series_hybrid both: hybridTwoPass()), collisional and
  /// unknown -- as b/y.
  inline Series seriesFor(Mode m, Activation a)
  {
    if (m == Mode::Cz) return Series::CZ;
    if (m == Mode::Auto && a == Activation::Electron) return Series::CZ;
    return Series::BY;
  }

  /// Whether a run under @p m can tag any spectrum of class counts @p c as
  /// c/z: then the tag TSV (and the census) carry an ion_series column. Under
  /// by never; under cz always; under auto when some spectrum is electron
  /// activated, so a collisional run's outputs stay those of by.
  /// 1.13 item 10: under auto with -ion_series_hybrid both (@p hybrid_both)
  /// also when some spectrum is hybrid activated.
  inline bool seriesColumn(Mode m, const ActivationCounts& c, bool hybrid_both = false)
  {
    if (m == Mode::Cz) return true;
    return m == Mode::Auto
        && (c.of(Activation::Electron) > 0 || (hybrid_both && c.of(Activation::Hybrid) > 0));
  }

  /// Whether -ion_series auto reads the activation of an input: mzML yes;
  /// MGF and mzPeak no (the file comment), so auto reads them as b/y and
  /// writes no ion_series column, whatever activation a reader may deliver.
  inline bool autoReadsActivation(bool mzpeak_in, bool mgf_in) { return !mzpeak_in && !mgf_in; }

  /// The series a spectrum of class @p a is read as in a run under @p m whose
  /// tag TSV carries the ion_series column iff @p run_column: seriesFor(),
  /// but c/z only in a run with the column. The tagging loop and the column
  /// rule thus cannot disagree: a c/z row always says so. Under cz the column
  /// is always written, so this is seriesFor(); under auto a spectrum the
  /// column rule did not foresee (an input auto does not read the activation
  /// of, autoReadsActivation()) is read as b/y and counted (SeriesCounts::
  /// auto_by_no_column).
  inline Series seriesInRun(Mode m, Activation a, bool run_column)
  {
    const Series s = seriesFor(m, a);
    return s != Series::BY && !run_column ? Series::BY : s;
  }

  /// Per-run (or per-thread) phase B counts: MS2 spectra tagged per series,
  /// and the c/z tags a consumer that reads b/y only left out (PLAN-
  /// INTEGRATION 2.3, contract 2).
  struct SeriesCounts
  {
    std::size_t ms2_by = 0, ms2_cz = 0;
    /// 1.13 item 10: MS2 read in two passes (b/y and c/z-dot), counted in
    /// neither ms2_by nor ms2_cz.
    std::size_t ms2_hybrid = 0;
    std::size_t species_excluded = 0;  ///< c/z rows -species did not count
    /// MS2 that seriesFor() reads as c/z but seriesInRun() read as b/y: the
    /// run writes no ion_series column (auto on mzPeak or MGF input).
    std::size_t auto_by_no_column = 0;
    void merge(const SeriesCounts& o)
    {
      ms2_by += o.ms2_by;
      ms2_cz += o.ms2_cz;
      ms2_hybrid += o.ms2_hybrid;
      species_excluded += o.species_excluded;
      auto_by_no_column += o.auto_by_no_column;
    }
  };

  /// The stderr INFO line of a run under auto or cz. It starts with "Ion
  /// series", so it can never match gate.sh's summary-line pattern.
  inline std::string seriesInfo(Mode m, const SeriesCounts& s, const ActivationCounts& c, bool hybrid_both = false)
  {
    const auto n = [](std::size_t v) { return std::to_string(v); };
    return std::string("Ion series (-ion_series ") + modeName(m) + "): " + n(s.ms2_cz)
         + " MS2 spectra tagged as c/z-dot ions, " + n(s.ms2_by) + " as b/y ions"
         // 1.13 item 10: only under auto with -ion_series_hybrid both.
         + (m == Mode::Auto && hybrid_both ? ", " + n(s.ms2_hybrid) + " as b/y and c/z-dot ions (hybrid, two passes)"
                                           : std::string())
         + " (activation: "
         + n(c.of(Activation::Collisional)) + " collisional, " + n(c.of(Activation::Electron)) + " electron, "
         + n(c.of(Activation::Hybrid)) + " hybrid, " + n(c.of(Activation::Unknown)) + " unknown).";
  }

  /// auto reads hybrid spectra as b/y: warn when more than 1% are hybrid.
  inline bool warnHybridUnderAuto(const ActivationCounts& c)
  {
    const std::size_t h = c.of(Activation::Hybrid);
    return h > 0 && 100 * h > c.total();
  }

  inline std::string hybridAutoWarning(const ActivationCounts& c)
  {
    return "Hybrid activation: " + std::to_string(c.of(Activation::Hybrid)) + " of " + std::to_string(c.total())
         + " MS2 spectra were activated by a hybrid method (EThcD, ETciD) and were tagged as b/y ions under "
           "-ion_series auto; reading them as b/y and c/z ions together is not supported yet.";
  }

  /// cz reads every spectrum as c/z-dot: warn when more than 1% are
  /// collisional.
  inline bool warnCollisionalUnderCz(const ActivationCounts& c)
  {
    const std::size_t k = c.of(Activation::Collisional);
    return k > 0 && 100 * k > c.total();
  }

  inline std::string collisionalCzWarning(const ActivationCounts& c)
  {
    return "Collisional activation: " + std::to_string(c.of(Activation::Collisional)) + " of "
         + std::to_string(c.total())
         + " MS2 spectra were activated by collision (CID, HCD), which yields b/y ions, but -ion_series cz reads "
           "every spectrum as c/z-dot ions; use -ion_series auto or by for them.";
  }

  /// The warning for SeriesCounts::auto_by_no_column > 0.
  inline std::string autoNoColumnWarning(std::size_t n)
  {
    return "Ion series: " + std::to_string(n)
         + " electron-activated MS2 spectra were tagged as b/y ions: -ion_series auto reads the activation of mzML "
           "input only and writes no ion_series column here; use -ion_series cz to read them as c/z-dot ions.";
  }

  /// A c/z tag that -species left out (it reads b/y tags only): the warning.
  inline std::string speciesExcludedWarning(std::size_t n)
  {
    return "Ion series: " + std::to_string(n)
         + " tag rows read as c/z-dot ions were left out of -species, which counts b/y tags only.";
  }
}
