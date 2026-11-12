// Protease-aware placement windows for the shortlist (FASTag 1.13, item 20).
// See Cleavage.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "Cleavage.h"

#include "Shortlist.h"

#include <OpenMS/DATASTRUCTURES/StringUtils.h>

#include <cctype>

namespace FASTag::Cleavage
{
  namespace
  {
    bool trypsinCompatible(const std::string& name)
    {
      return name == "Trypsin" || name == "Lys-C" || name == "Arg-C";
    }
  }

  const std::vector<Rule>& rules()
  {
    // OpenMS ProteaseDB (Enzymes.xml) names; regexes as of OpenMS 3.5:
    //   Trypsin (?<=[KRX])(?!P), Lys-C (?<=[KX])(?!P), Arg-C (?<=[RX])(?!P),
    //   Asp-N/B (?=[DX]), glutamyl endopeptidase (?<=[DBEZX]),
    //   Chymotrypsin (?<=[FYWLJX])(?!P), Lys-N (?=[KX]).
    // Glu-C: FASTag's model cuts after E only (bicarbonate); ProteaseDB has
    // no E-only entry, so the window test and the engines use D and E, a
    // superset (a window is never lost, a few more are kept). Comet numbers:
    // `comet -p` of Comet 2026.03.0 (0 Cut_everywhere, 1 Trypsin, 3 Lys_C,
    // 4 Lys_N, 5 Arg_C, 8 Asp-N_ambic = after D/E, no restriction,
    // 10 Chymotrypsin); its 6 Asp_N cuts before D and N, not this rule.
    static const std::vector<Rule> table = {
        {"Trypsin", "Trypsin", true, "KR", "P", 1},
        {"Lys-C", "Lys-C", true, "K", "P", 3},
        {"Arg-C", "Arg-C", true, "R", "P", 5},
        {"Asp-N", "Asp-N/B", false, "D", "", -1},
        {"Glu-C", "glutamyl endopeptidase", true, "DE", "", 8},
        {"Chymotrypsin", "Chymotrypsin", true, "FWYL", "P", 10},
        {"Lys-N", "Lys-N", false, "K", "", 4},
        {"unspecific", "", true, "", "", 0},
    };
    return table;
  }

  const Rule* findRule(const std::string& name)
  {
    const std::string n = OpenMS::StringUtils::toLowered(name);
    for (const Rule& r : rules())
      if (OpenMS::StringUtils::toLowered(r.name) == n) return &r;
    return nullptr;
  }

  bool nested(const Rule& a, const Rule& b)
  {
    if (a.unspecific() || b.unspecific()) return false;
    if (a.c_terminal != b.c_terminal || a.nocut != b.nocut) return false;
    const auto within = [](const std::string& x, const std::string& y) {
      for (char ch : x)
        if (y.find(ch) == std::string::npos) return false;
      return true;
    };
    return within(a.cut, b.cut) || within(b.cut, a.cut);
  }

  const char* specificityName(Specificity s)
  {
    switch (s)
    {
      case Specificity::Full: return "full";
      case Specificity::Semi: return "semi";
      case Specificity::None: return "none";
    }
    return "full";
  }

  bool parseSpecificity(const std::string& s, Specificity& out)
  {
    if (s == "full") out = Specificity::Full;
    else if (s == "semi") out = Specificity::Semi;
    else if (s == "none") out = Specificity::None;
    else return false;
    return true;
  }

  Choice choose(const std::string& option, Specificity spec, const FASTag::Shortlist::ProteaseVerdict& v,
                bool spec_given)
  {
    using Verdict = FASTag::Shortlist::ProteaseVerdict;
    Choice c;
    c.specificity = spec;
    const bool confident = v.kind != Verdict::Inconclusive;
    if (OpenMS::StringUtils::toLowered(option) == "auto")
    {
      const Rule* called = confident ? findRule(v.model) : nullptr;
      if (called)
      {
        c.rule = called;
        c.reason = "auto: the tag ends call " + called->name;
        if (!spec_given && called->name == "Asp-N")
        {
          c.specificity = Specificity::Semi;
          c.auto_semi = true;
          c.reason += "; semi-specific unless -shortlist_specificity is given";
        }
      }
      else
      {
        c.rule = findRule("Trypsin");
        c.reason = confident ? "auto: the called model " + v.model + " has no cleavage rule; Trypsin assumed"
                             : "auto: no confident protease call; Trypsin assumed";
      }
      if (c.rule->unspecific()) c.specificity = Specificity::None;
      c.auto_unspecific = c.rule->unspecific();
      return c;
    }
    c.rule = findRule(option);
    if (!c.rule) c.rule = findRule("unspecific");  // the caller validated the name
    if (c.rule->unspecific())
    {
      c.specificity = Specificity::None;
      c.reason = "unspecific: every window whose flanks match";
      return c;
    }
    c.reason = "-shortlist_protease " + c.rule->name;
    if (!confident || spec == Specificity::None || v.model == c.rule->name) return c;
    // An `unspecific` call says no protease model fits better than the
    // background; it names no other protease, so it does not contradict the
    // named rule (a broad protease such as chymotrypsin often calls it).
    if (v.model == "unspecific")
    {
      c.reason += "; the tag ends call unspecific, which names no other protease";
      return c;
    }
    const Rule* called = findRule(v.model);
    if (called)
    {
      if (!nested(*c.rule, *called))
      {
        c.refuse = true;
        c.reason += ", but the tag ends call " + v.model;
      }
      else
      {
        c.mismatch = true;
        c.reason += "; the tag ends call " + v.model + ", whose cleavage sites " +
                    (called->cut.size() > c.rule->cut.size() ? "include" : "are within") + " the rule's";
      }
      return c;
    }
    const bool rule_tc = trypsinCompatible(c.rule->name);
    if (v.kind == Verdict::NonTryptic || (v.kind == Verdict::Compatible && !rule_tc))
    {
      c.refuse = true;
      c.reason += ", but the tag ends call " + v.model;
    }
    else
      c.reason += "; the tag ends call " + v.model + ", trypsin-compatible as well";
    return c;
  }

  FASTag::SearchConfig::Enzyme engineEnzyme(const Rule& rule, Specificity spec)
  {
    FASTag::SearchConfig::Enzyme e;
    if (rule.unspecific() || spec == Specificity::None)
    {
      e.name = "unspecific";
      e.cut.clear();
      e.nocut.clear();
      e.c_terminal = true;
      e.termini = 2;
      e.comet_default = findRule("unspecific")->comet_default;
      return e;
    }
    e.name = rule.name;
    e.cut = rule.cut;
    e.nocut = rule.nocut;
    e.c_terminal = rule.c_terminal;
    e.termini = spec == Specificity::Semi ? 1 : 2;
    e.comet_default = rule.comet_default;
    return e;
  }

  WindowFilter::WindowFilter(const Rule& rule, Specificity spec, int missed_cleavages)
  {
    all_ = rule.unspecific() || spec == Specificity::None;
    if (all_) return;
    dig_.setEnzyme(rule.openms);
    dig_.setSpecificity(spec == Specificity::Full ? OpenMS::EnzymaticDigestion::SPEC_FULL
                                                  : OpenMS::EnzymaticDigestion::SPEC_SEMI);
    dig_.setMissedCleavages(static_cast<OpenMS::Size>(missed_cleavages < 0 ? 0 : missed_cleavages));
  }

  bool WindowFilter::accepts(const std::string& protein, std::uint32_t start, std::uint32_t len) const
  {
    if (all_) return true;
    if (len == 0 || static_cast<std::size_t>(start) + len > protein.size()) return false;
    return dig_.isValidProduct(protein, static_cast<int>(start), static_cast<int>(len),
                               /*ignore_missed_cleavages=*/false, /*allow_nterm_protein_cleavage=*/true,
                               /*allow_random_asp_pro_cleavage=*/false);
  }
}
