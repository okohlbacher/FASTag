// Ion series and activation (FASTag 1.12, item #15).
//
// PHASE A (this file today): detection only. Every tagged MS2 spectrum is put
// in one activation class -- collisional, electron, hybrid or unknown -- from
// its first precursor's dissociation methods (the PSI-MS <activation> terms
// both mzML readers fill, step 0), or, when none of them is classified, from
// the Thermo filter string's @<method> tokens. The tool counts the classes per
// run and warns when more than 1% of the MS2 spectra are electron or hybrid
// activated, because tagging reads b/y ions only and electron activation
// yields mostly c/z ions. Nothing here changes a tag or an output file.
//
// PHASE B (later, -ion_series by|cz|auto) adds the c/z ion pairs here.
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
//                that classifies. MGF and mzPeak input carry no activation.
// A method of no class never hides one that has a class.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <array>
#include <cstddef>
#include <set>
#include <string>
#include <string_view>

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
}
