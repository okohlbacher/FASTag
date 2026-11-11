// SearchConfig (#5): golden Sage and Comet output for one SearchPlan, term
// symbols, ppm and Da tolerances, Comet fragment bins, the template merge
// (managed keys replaced, comments and the version header kept, missing keys
// inserted before [COMET_ENZYME_INFO], variable_mod01 vs variable_mod010,
// foreign chemistry reset, enzyme number set to trypsin or refused), and the
// key names against the keys OpenMS's SageAdapter and CometAdapter write.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "SearchConfig.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <cctype>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>

namespace SC = FASTag::SearchConfig;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok)
    {
      ++failures;
      std::cerr << "FAIL: " << what << "\n";
    }
  }
  const OpenMS::ResidueModification* mod(const char* name)
  {
    return OpenMS::ModificationsDB::getInstance()->getModification(name);
  }

  /// A minimal JSON well-formedness check (RFC 8259 grammar, no semantics).
  struct Json
  {
    const std::string& s;
    std::size_t i = 0;
    void ws() { while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i; }
    bool lit(const char* l)
    {
      const std::string t(l);
      if (s.compare(i, t.size(), t) != 0) return false;
      i += t.size();
      return true;
    }
    bool str()
    {
      if (i >= s.size() || s[i] != '"') return false;
      for (++i; i < s.size(); ++i)
      {
        if (s[i] == '\\') { ++i; continue; }
        if (s[i] == '"') { ++i; return true; }
      }
      return false;
    }
    bool num()
    {
      const std::size_t b = i;
      if (i < s.size() && s[i] == '-') ++i;
      while (i < s.size() && (std::isdigit(static_cast<unsigned char>(s[i])) || s[i] == '.' || s[i] == 'e' ||
                              s[i] == 'E' || s[i] == '+' || s[i] == '-'))
        ++i;
      return i > b;
    }
    bool value()
    {
      ws();
      if (i >= s.size()) return false;
      bool ok;
      if (s[i] == '{')
      {
        ++i;
        ws();
        if (i < s.size() && s[i] == '}') { ++i; return true; }
        do
        {
          ws();
          if (!str()) return false;
          ws();
          if (i >= s.size() || s[i++] != ':') return false;
          if (!value()) return false;
          ws();
        } while (i < s.size() && s[i] == ',' && ++i);
        ok = i < s.size() && s[i++] == '}';
      }
      else if (s[i] == '[')
      {
        ++i;
        ws();
        if (i < s.size() && s[i] == ']') { ++i; return true; }
        do
        {
          if (!value()) return false;
          ws();
        } while (i < s.size() && s[i] == ',' && ++i);
        ok = i < s.size() && s[i++] == ']';
      }
      else if (s[i] == '"') ok = str();
      else if (lit("true") || lit("false") || lit("null")) ok = true;
      else ok = num();
      return ok;
    }
    bool parse() { const bool ok = value(); ws(); return ok && i == s.size(); }
  };

  std::map<std::string, std::string> kv(const std::string& text)
  {
    std::map<std::string, std::string> m;
    std::istringstream is(text);
    std::string l;
    while (std::getline(is, l))
    {
      if (l.empty() || l[0] == '#' || l[0] == '[') continue;
      const auto eq = l.find(" = ");
      if (eq == std::string::npos) continue;
      std::string v = l.substr(eq + 3);
      const auto h = v.find('#');
      if (h != std::string::npos) v = v.substr(0, h);
      while (!v.empty() && v.back() == ' ') v.pop_back();
      m[l.substr(0, eq)] = v;
    }
    return m;
  }

  SC::SearchPlan plan()
  {
    SC::SearchPlan p;
    p.database = "reduced.fasta";
    p.spectra = "run.mzML";
    p.fixed = {mod("Carbamidomethyl (C)")};
    p.variable = {mod("Oxidation (M)"), mod("Acetyl (Protein N-term)"), mod("Gln->pyro-Glu (N-term Q)")};
    p.missed_cleavages = 1;
    p.fragment_tolerance = 20.0;
    p.fragment_ppm = true;
    p.precursor_tolerance = 10.0;
    p.precursor_ppm = true;
    p.fastag_version = "test";
    return p;
  }

  // ---- #17 mass shifts: synthetic gap results ------------------------------
  namespace FD = FASTag::Digest;
  struct ShiftFixture
  {
    std::vector<FD::GapMod> mods;
    std::vector<FD::Combo> combos;
    double tol = 0.02;
    ShiftFixture()
    {
      std::ifstream f(std::string(FASTAG_FIXTURES) + "/../../data/digest/massgap_mods.tsv");
      std::string err;
      if (!FD::parseGapMods(f, mods, &err)) std::cerr << "massgap_mods.tsv: " << err << "\n";
      for (FD::GapMod& m : mods) m.mass = mod(m.site.c_str())->getDiffMonoMass();
      combos = FD::combinations(mods, 3);
    }
    FD::GapPeak peak(double d, std::uint64_t n) const
    {
      FD::GapPeak p{d, n, {}, {}, {}, {}};
      const auto ex = FD::explain(combos, mods, d, tol);
      if (!ex.empty()) p.explained_by = ex.front();
      return p;
    }
    FD::GapResult result(const std::vector<std::pair<double, std::uint64_t>>& peaks) const
    {
      FD::GapResult r;
      for (const auto& [d, n] : peaks)
      {
        r.peaks.push_back(peak(d, n));
        r.placed += n;
        r.shifted += n;
      }
      return r;
    }
  };
  SC::SearchPlan shiftPlan(std::vector<const OpenMS::ResidueModification*> fixed = {},
                           std::vector<const OpenMS::ResidueModification*> variable = {})
  {
    SC::SearchPlan p = plan();
    p.fixed = std::move(fixed);
    p.variable = std::move(variable);
    return p;
  }
  SC::ShiftSettings shiftSettings(const char* engine = "comet", SC::ShiftMode m = SC::ShiftMode::Both)
  {
    SC::ShiftSettings s;
    s.engine = engine;
    s.mode = m;
    return s;
  }
  bool hasMod(const std::vector<const OpenMS::ResidueModification*>& v, const std::string& id)
  {
    for (const auto* m : v)
      if (m->getFullId() == id) return true;
    return false;
  }
  const SC::ShiftDecision* decisionAt(const SC::ShiftOutcome& o, double d)
  {
    for (const auto& x : o.decisions)
      if (std::abs(x.delta - d) < 1e-9) return &x;
    static const SC::ShiftDecision none{};  // a missing decision fails the checks, never crashes
    return &none;
  }
  std::string actionAt(const SC::ShiftOutcome& o, double d)
  {
    const auto* x = decisionAt(o, d);
    return x->action.empty() ? std::string("<none>") : x->action;
  }

  void shiftTests()
  {
    const ShiftFixture fx;
    check(fx.mods.size() > 30, "shifts: massgap_mods.tsv loaded");
    const auto* cam = mod("Carbamidomethyl (C)");
    // 1. Oxidation peak -> variable Oxidation (M)
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{15.9949, 100}}), {}, fx.mods, fx.combos, shiftSettings(), p);
      check(o.decisions.size() == 1 && actionAt(o, 15.9949) == "variable" && decisionAt(o, 15.9949)->mod_id == "Oxidation (M)",
            "shifts 1: an Oxidation peak is variable Oxidation (M)");
      check(hasMod(p.variable, "Oxidation (M)") && p.variable.size() == 1 && p.mass_offsets.empty(),
            "shifts 1: the plan gains Oxidation (M) as its only variable modification");
      check(decisionAt(o, 15.9949)->peak == 1, "shifts 1: peaks are numbered from 1 as -massgap_out numbers them");
    }
    // 2./3. combination and unexplained -> Comet offsets at the 4-decimal gap
    {
      const double combo = 15.994915 + 42.010565;  // Oxidation + Acetyl
      check(fx.peak(combo, 1).explained_by.size() == 2, "shifts 2: the combination is a two-modification explanation");
      check(fx.peak(123.4567, 1).explained_by.empty(), "shifts 3: 123.4567 has no explanation");
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{combo, 80}, {123.45671, 50}}), {}, fx.mods, fx.combos, shiftSettings(), p);
      check(actionAt(o, combo) == "offset" && actionAt(o, 123.45671) == "offset", "shifts 2/3: combination and unexplained are offsets");
      check(p.mass_offsets.size() == 2 && std::abs(p.mass_offsets[0] - 58.0055) < 1e-9 && std::abs(p.mass_offsets[1] - 123.4567) < 1e-9,
            "shifts 2/3: offsets at the 4-decimal centroid, by spectra");
      check(p.variable.empty(), "shifts 2/3: no variable modification from offsets");
    }
    // 4. fixed Carbamidomethyl (C)
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{57.0215, 100}, {-57.0215, 40}}), {}, fx.mods, fx.combos, shiftSettings(), p);
      check(actionAt(o, 57.0215) == "variable", "shifts 4: +57.021 with fixed CAM is variable");
      check(hasMod(p.variable, "Carbamidomethyl (K)") && hasMod(p.variable, "Carbamidomethyl (H)") &&
                hasMod(p.variable, "Carbamidomethyl (N-term)") && !hasMod(p.variable, "Carbamidomethyl (C)"),
            "shifts 4: overalkylation on K, H and N-term, not C");
      check(actionAt(o, -57.0215) == "fixed_mod_questionable" && !o.warnings.empty(),
            "shifts 4: -57.021 with fixed CAM is fixed_mod_questionable with a warning");
      check(p.fixed.size() == 1, "shifts 4: the fixed CAM stays the only fixed modification");
      // no fixed Cys modification, a dominant CAM peak -> suggest_fixed
      auto q = shiftPlan();
      auto s = shiftSettings();
      s.c_placements = 100;
      SC::PeakEvidence c60;
      c60.spectra = 60;
      c60.with_c = 60;
      const auto o2 = SC::shiftsToPlan(fx.result({{57.0215, 60}}), {c60}, fx.mods, fx.combos, s, q);
      check(actionAt(o2, 57.0215) == "fixed" && hasMod(q.fixed, "Carbamidomethyl (C)") && q.variable.empty() && !o2.warnings.empty(),
            "shifts 4: no fixed CAM and a dominant CAM peak -> fixed Carbamidomethyl (C) with a warning");
      auto q2 = shiftPlan();
      SC::PeakEvidence c30;
      c30.spectra = 30;
      c30.with_c = 30;
      const auto o3 = SC::shiftsToPlan(fx.result({{57.0215, 30}}), {c30}, fx.mods, fx.combos, s, q2);
      check(actionAt(o3, 57.0215) == "variable" && hasMod(q2.variable, "Carbamidomethyl (C)") && q2.fixed.empty(),
            "shifts 4: a CAM peak below half the C placements is variable");
      // the numerator is the peak's C-containing samples, not all its spectra
      // (K, N-term or Gly-isobaric +57 placements do not count)
      SC::PeakEvidence c10;
      c10.spectra = 100;
      c10.with_c = 10;
      auto q3 = shiftPlan();
      const auto o4 = SC::shiftsToPlan(fx.result({{57.0215, 100}}), {c10}, fx.mods, fx.combos, s, q3);
      check(actionAt(o4, 57.0215) == "variable" && q3.fixed.empty(),
            "shifts 4: 100 spectra but 10 of 100 C-containing placements is not a suggested fixed CAM");
      SC::PeakEvidence ec;
      ec.add(c10);
      ec.add(c30);
      check(ec.with_c == 40 && ec.spectra == 130, "shifts 4: RowEvidence::add sums the C-containing samples");
    }
    // 5. caps with ties
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(
          fx.result({{79.9663, 30}, {42.0106, 50}, {28.0313, 40}, {15.9949, 100}, {14.0157, 50}}), {}, fx.mods, fx.combos,
          shiftSettings(), p);
      check(actionAt(o, 15.9949) == "variable" && actionAt(o, 14.0157) == "variable" && actionAt(o, 42.0106) == "variable",
            "shifts 5: the top 3 by spectra, the tie at 50 by |delta|");
      check(actionAt(o, 28.0313) == "dropped_cap" && actionAt(o, 79.9663) == "dropped_cap" && p.variable.size() == 3,
            "shifts 5: the rest dropped_cap");
      check(o.decisions.size() == 5 && !o.decisions.empty() && o.decisions[0].delta == 79.9663, "shifts 5: decisions in GapResult order");
      auto q = shiftPlan({cam});
      auto s = shiftSettings();
      s.max_offsets = 2;
      const auto o2 = SC::shiftsToPlan(fx.result({{150.1234, 20}, {123.4567, 20}, {200.5555, 20}}), {}, fx.mods, fx.combos, s, q);
      check(actionAt(o2, 123.4567) == "offset" && actionAt(o2, 150.1234) == "offset" && actionAt(o2, 200.5555) == "dropped_cap" &&
                q.mass_offsets.size() == 2,
            "shifts 5: offsets capped, the tie broken by |delta|");
    }
    // 6. Sage drops offsets
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{123.4567, 50}, {15.9949, 40}}), {}, fx.mods, fx.combos,
                                      shiftSettings("sage"), p);
      check(actionAt(o, 123.4567) == "dropped_engine" && p.mass_offsets.empty() && actionAt(o, 15.9949) == "variable",
            "shifts 6: Sage drops offsets, keeps variable modifications");
    }
    // 7. Comet: offsets list, negative dropped, slot numbering after the user's
    {
      auto p = shiftPlan({cam}, {mod("Oxidation (M)")});
      auto s = shiftSettings();
      s.max_offsets = 1;
      const auto o = SC::shiftsToPlan(fx.result({{123.4567, 50}, {-77.7777, 60}, {42.0106, 40}, {15.9949, 30}}), {}, fx.mods,
                                      fx.combos, s, p);
      check(actionAt(o, -77.7777) == "dropped_engine", "shifts 7: a negative Comet offset is dropped_engine");
      check(actionAt(o, 123.4567) == "offset", "shifts 7: 0 is not counted against -shift_max_offsets 1");
      check(actionAt(o, 15.9949) == "already_searched" && p.variable.size() == 2, "shifts 7: a searched modification is not added twice");
      const auto m = kv(SC::renderComet(p));
      check(m.at("mass_offsets") == "0.0 123.4567", "shifts 7: mass_offsets space-separated, 0 first");
      check(m.at("variable_mod01").rfind("15.994915 M", 0) == 0 && m.at("variable_mod02").rfind("42.010565 K", 0) == 0,
            "shifts 7: the shift modification follows the user's in variable_mod02");
    }
    // 7m. 1.13 #18, MSFragger: the same peaks, negative offsets kept, '/' list with 0 first
    {
      auto p = shiftPlan({cam}, {mod("Oxidation (M)")});
      auto s = shiftSettings("msfragger");
      s.max_offsets = 2;
      const auto o = SC::shiftsToPlan(fx.result({{123.4567, 50}, {-77.7777, 60}, {42.0106, 40}, {15.9949, 30}}), {}, fx.mods,
                                      fx.combos, s, p);
      check(actionAt(o, -77.7777) == "offset", "shifts 7m: a negative MSFragger offset is exported");
      check(actionAt(o, 123.4567) == "offset", "shifts 7m: the positive offset is exported");
      check(actionAt(o, 42.0106) == "variable" && actionAt(o, 15.9949) == "already_searched", "shifts 7m: rules 3 as for Comet");
      SC::SearchPlan q = p;
      q.database = "x.fasta";
      std::vector<std::pair<std::string, std::string>> keys;
      check(SC::msfraggerKeys(q, keys).empty(), "shifts 7m: the plan renders for MSFragger");
      std::map<std::string, std::string> m(keys.begin(), keys.end());
      check(m["mass_offsets"] == "0/-77.7777/123.4567", "shifts 7m: mass_offsets '/'-separated, 0 first, then by spectra");
      check(m["localize_delta_mass"] == "1", "shifts 7m: localize_delta_mass on with offsets");
      check(m["variable_mod_02"].rfind("42.010565 K 3", 0) == 0, "shifts 7m: the shift modification in variable_mod_02");
      // Comet's 15-slot cap does not apply; MSFragger's 16 does.
      auto r = shiftPlan({cam}, std::vector<const OpenMS::ResidueModification*>(15, mod("Deamidated (N)")));
      const auto o2 = SC::shiftsToPlan(fx.result({{15.9949, 100}, {42.0106, 40}}), {}, fx.mods, fx.combos,
                                       shiftSettings("msfragger"), r);
      check(actionAt(o2, 15.9949) == "variable" && r.variable.size() == 16, "shifts 7m: slot 16 is used");
      check(actionAt(o2, 42.0106) == "dropped_cap" &&
                decisionAt(o2, 42.0106)->reason.find("MSFragger's 16 variable modification slots") != std::string::npos,
            "shifts 7m: a 17th modification is dropped_cap at MSFragger's 16 slots");
      // A Da precursor window: MSFragger 4.4.1 exits 1 on mass offsets, so
      // none is exported; the variable modifications are.
      auto d = shiftPlan({cam}, {mod("Oxidation (M)")});
      d.precursor_ppm = false;
      d.precursor_tolerance = 0.02;
      auto sd = shiftSettings("msfragger");
      const auto o3 = SC::shiftsToPlan(fx.result({{123.4567, 50}, {-77.7777, 60}, {42.0106, 40}}), {}, fx.mods,
                                       fx.combos, sd, d);
      check(actionAt(o3, 123.4567) == "dropped_engine" && actionAt(o3, -77.7777) == "dropped_engine" &&
                decisionAt(o3, 123.4567)->reason.find("Da precursor window") != std::string::npos,
            "shifts 7m: Da precursor window -> offsets dropped_engine");
      check(d.mass_offsets.empty() && actionAt(o3, 42.0106) == "variable", "shifts 7m: Da window keeps the variable mod");
      d.database = "x.fasta";
      check(SC::msfraggerKeys(d, keys).empty(), "shifts 7m: the Da plan renders for MSFragger");
    }
    // 8. isotope vs Deamidated
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{1.0034, 100}, {2.0067, 40}, {0.9841, 60}}), {}, fx.mods, fx.combos,
                                      shiftSettings(), p);
      check(actionAt(o, 1.0034) == "skipped_isotope" && actionAt(o, 2.0067) == "skipped_isotope", "shifts 8: isotope peaks skipped");
      check(o.isotope_max == 2 && p.isotope_errors == 2, "shifts 8: the isotope range covers the largest multiple");
      check(actionAt(o, 0.9841) == "variable" && hasMod(p.variable, "Deamidated (N)"), "shifts 8: 0.9841 is Deamidated");
    }
    // 9. fixed TMT N-term label
    {
      const auto* tmt = mod("TMT6plex (N-term)");
      const double L = tmt->getDiffMonoMass();
      auto p = shiftPlan({cam, tmt});
      const auto o = SC::shiftsToPlan(fx.result({{L, 300}, {L + 15.994915, 80}, {-L, 30}}), {}, fx.mods, fx.combos,
                                      shiftSettings(), p);
      check(actionAt(o, L) == "expected_label", "shifts 9: a peak at the label is expected_label");
      check(actionAt(o, L + 15.994915) == "variable" && decisionAt(o, L + 15.994915)->mod_id == "Oxidation (M)",
            "shifts 9: label + Oxidation exports Oxidation");
      check(actionAt(o, -L) == "label_incomplete" && !o.warnings.empty(), "shifts 9: -label is label_incomplete with a warning");
      bool tmt_var = false;
      for (const auto* v : p.variable) tmt_var = tmt_var || v->getId() == "TMT6plex";
      check(!tmt_var && p.variable.size() == 1 && p.fixed.size() == 2, "shifts 9: the label is not exported again");
    }
    // 9b. label + n x 13C is an isotope error, not an offset
    {
      const auto* tmt = mod("TMT6plex (N-term)");
      const double L = tmt->getDiffMonoMass();
      auto p = shiftPlan({cam, tmt});
      const auto o = SC::shiftsToPlan(fx.result({{L, 300}, {L + 1.0049, 90}, {L + 2.0039, 40}}), {}, fx.mods, fx.combos,
                                      shiftSettings(), p);
      check(actionAt(o, L + 1.0049) == "skipped_isotope" && actionAt(o, L + 2.0039) == "skipped_isotope",
            "shifts 9b: label + n x 13C is skipped_isotope");
      check(o.isotope_max == 2 && p.isotope_errors == 2 && o.offsets == 0, "shifts 9b: the isotope range is raised, no offset exported");
    }
    // 10. substitution-dominated -> offset
    {
      auto p = shiftPlan({cam});
      SC::PeakEvidence ev;
      ev.spectra = 100;
      ev.substitution = 60;
      const auto o = SC::shiftsToPlan(fx.result({{15.9949, 100}}), {ev}, fx.mods, fx.combos, shiftSettings(), p);
      check(actionAt(o, 15.9949) == "offset" && p.variable.empty() && std::abs(decisionAt(o, 15.9949)->substitution_share - 0.6) < 1e-12,
            "shifts 10: a substitution-dominated peak is an offset, not a variable modification");
    }
    // 11. member rows are counted once
    {
      FD::GapSettings gs;
      gs.window = 0.02;
      gs.min_spectra = 2;
      gs.min_share = 0.0;
      gs.min_bin = 1;
      const std::vector<FD::GapRow> rows = {{15.9949, 100}, {15.9999, 20}, {16.0099, 5}, {16.0249, 60}, {16.0349, 7}};
      const auto res = FD::gapResult(rows, fx.mods, fx.combos, gs);
      std::vector<SC::RowEvidence> rev(rows.size());
      for (std::size_t i = 0; i < rows.size(); ++i)
      {
        rev[i].spectra = rows[i].spectra;
        rev[i].substitution = i;
        rev[i].sites['S'] = rows[i].spectra;
      }
      std::set<std::size_t> seen;
      bool disjoint = true;
      std::uint64_t total = 0;
      for (const auto& pk : res.peaks)
      {
        for (std::size_t m : pk.members) disjoint = disjoint && seen.insert(m).second;
        const auto ev = SC::peakEvidence(pk, rev);
        total += ev.spectra;
        disjoint = disjoint && ev.spectra == pk.spectra && ev.sites.at('S') == pk.spectra;
      }
      check(res.peaks.size() == 2 && disjoint && total == 192, "shifts 11: overlapping windows, each row in one peak's evidence");
      check(res.peaks.size() == 2 && res.peaks[1].delta > 16.0249 && res.peaks[1].delta < 16.0349,
            "shifts 11: the second centroid lies between bins");
    }
    // 12. site expansion
    {
      check(SC::siteSampleCounts('S', 3, 1, 4, 2) && !SC::siteSampleCounts('S', 0, 1, 4, 0) && !SC::siteSampleCounts('S', 3, 2, 4, 2) &&
                !SC::siteSampleCounts('S', 3, 1, 1, 2) && !SC::siteSampleCounts('S', 1, 1, 4, 2) && !SC::siteSampleCounts(0, 3, 1, 4, 2),
            "shifts 12: only unique, scored sites in multi-residue regions count");
      SC::PeakEvidence ev;
      ev.spectra = 100;
      ev.site_counted = 100;
      ev.sites = {{'S', 60}, {'T', 30}, {'Y', 10}};
      auto p = shiftPlan({cam});
      SC::shiftsToPlan(fx.result({{79.9663, 100}}), {ev}, fx.mods, fx.combos, shiftSettings(), p);
      check(p.variable.size() == 1 && hasMod(p.variable, "Phospho (S)"), "shifts 12: no site expansion by default");
      auto q = shiftPlan({cam});
      auto s = shiftSettings();
      s.expand_sites = true;
      const auto o = SC::shiftsToPlan(fx.result({{79.9663, 100}}), {ev}, fx.mods, fx.combos, s, q);
      check(q.variable.size() == 2 && hasMod(q.variable, "Phospho (S)") && hasMod(q.variable, "Phospho (T)") &&
                decisionAt(o, 79.9663)->sites == "S,T",
            "shifts 12: S:60 T:30 Y:10 expands to S, T");
      SC::PeakEvidence sparse;
      sparse.spectra = 100;
      sparse.site_counted = 10;
      sparse.sites = {{'S', 6}, {'T', 3}, {'Y', 1}};
      auto q2 = shiftPlan({cam});
      SC::shiftsToPlan(fx.result({{79.9663, 100}}), {sparse}, fx.mods, fx.combos, s, q2);
      check(q2.variable.size() == 1, "shifts 12: sparse support does not expand");
      bool g_known = true;
      try { OpenMS::ModificationsDB::getInstance()->getModification("Phospho", "G", OpenMS::ResidueModification::ANYWHERE); }
      catch (...) { g_known = false; }
      check(!g_known, "shifts 12: the test assumes ModificationsDB has no Phospho (G)");
      SC::PeakEvidence unknown;
      unknown.spectra = 100;
      unknown.site_counted = 100;
      unknown.sites = {{'S', 50}, {'G', 50}};
      auto q3 = shiftPlan({cam});
      SC::shiftsToPlan(fx.result({{79.9663, 100}}), {unknown}, fx.mods, fx.combos, s, q3);
      check(q3.variable.size() == 1, "shifts 12: a residue ModificationsDB does not know is excluded");
    }
    // 13. SILAC only when called
    {
      const double k8 = mod("Label:13C(6)15N(2) (K)")->getDiffMonoMass();
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{k8, 100}}), {}, fx.mods, fx.combos, shiftSettings(), p);
      check(actionAt(o, k8) == "skipped_silac" && p.variable.empty(), "shifts 13: no SILAC call, no label exported");
      auto gr = fx.result({{k8, 100}});
      gr.silac = "SILAC (Lys8/Arg10)";
      auto q = shiftPlan({cam});
      const auto o2 = SC::shiftsToPlan(gr, {}, fx.mods, fx.combos, shiftSettings(), q);
      check(actionAt(o2, k8) == "variable" && hasMod(q.variable, "Label:13C(6)15N(2) (K)"), "shifts 13: called SILAC is exported");
    }
    // 15. calibration: the offsets lose the run's precursor bias (PXD003531:
    // every explained peak about +0.007 Da above its mass)
    {
      const double b = 0.0072;
      const double ox = mod("Oxidation (M)")->getDiffMonoMass(), ph = mod("Phospho (S)")->getDiffMonoMass();
      const double cb = mod("Carbamyl (N-term)")->getDiffMonoMass();
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(
          fx.result({{ph + b + 0.001, 510}, {ox + b, 378}, {cb + b - 0.0005, 154}, {ox + ph + b, 42}, {123.4567 + b, 50}}), {},
          fx.mods, fx.combos, shiftSettings(), p);
      check(actionAt(o, ox + ph + b) == "offset" && actionAt(o, 123.4567 + b) == "offset" && p.mass_offsets.size() == 2,
            "shifts 15: the combination and the unexplained peak are offsets");
      check(o.bias_peaks == 3 && std::abs(o.bias - b) < 1e-3, "shifts 15: the bias is the weighted median single-modification error");
      // the configured precursor tolerance: 10 ppm at the offset's own mass
      const double ptol = p.precursor_tolerance * 1e-6 * 100.0;
      bool within = p.mass_offsets.size() == 2;
      for (double v : p.mass_offsets)
        within = within && (std::abs(v - (ox + ph)) <= ptol || std::abs(v - 123.4567) <= ptol);
      check(within, "shifts 15: each offset lands within 10 ppm at 100 Da of its true mass");
      check(decisionAt(o, ox + ph + b)->reason.find("calibration bias") != std::string::npos,
            "shifts 15: the row says it was corrected");
      bool warned = false;
      for (const auto& w : o.warnings) warned = warned || w.find("known to +/-") != std::string::npos;
      check(!warned && o.residual < 0.002, "shifts 15: a small residual gives no tolerance warning");
      // no single-modification peak: uncorrected, known to the window (0.02 Da > 10 ppm at 1000 Da)
      auto q = shiftPlan({cam});
      const auto o2 = SC::shiftsToPlan(fx.result({{123.4567 + b, 50}}), {}, fx.mods, fx.combos, shiftSettings(), q);
      bool warned2 = false;
      for (const auto& w : o2.warnings) warned2 = warned2 || w.find("known to +/-") != std::string::npos;
      check(o2.bias_peaks == 0 && o2.bias == 0.0 && q.mass_offsets.size() == 1 && std::abs(q.mass_offsets[0] - 123.4639) < 1e-9 &&
                warned2,
            "shifts 15: no calibration peak leaves the offset uncorrected, with a tolerance warning");
    }
    // 15b. an in-silico run (digest_cli_test's fixture): the centroids sit on
    // the 0.0005 Da grid, so the single-modification errors are the binning's
    // (Oxidation +0.00009, Acetyl -0.00007); the 13C peak (1.0035, within the
    // window of Deamidated 0.98402) is rule 0's and not a calibration peak.
    // The exact offset is exported at its centroid.
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(
          fx.result({{15.9950, 300}, {42.0105, 120}, {1.0035, 200}, {123.4565, 50}}), {}, fx.mods, fx.combos,
          shiftSettings(), p);
      check(actionAt(o, 1.0035) == "skipped_isotope", "shifts 15b: the 13C peak is skipped_isotope");
      check(o.bias_peaks == 2, "shifts 15b: the isotope peak is not a calibration peak (" + std::to_string(o.bias_peaks) + ")");
      check(o.bias == 0.0 && std::abs(o.measured_bias) <= 0.0001,
            "shifts 15b: a bias within the centroid resolution is measured, not applied");
      check(o.residual < 0.0002, "shifts 15b: the residual is the binning's, not the 13C peak's 0.0195 Da");
      check(p.mass_offsets.size() == 1 && p.mass_offsets[0] == 123.4565, "shifts 15b: the exact offset is its centroid");
      check(decisionAt(o, 123.4565)->reason.find("calibration bias") == std::string::npos,
            "shifts 15b: the row claims no correction");
      // just beyond the resolution the bias is applied
      auto q = shiftPlan({cam});
      const auto o3 =
          SC::shiftsToPlan(fx.result({{15.9950 + 0.0005, 300}, {123.4565, 50}}), {}, fx.mods, fx.combos, shiftSettings(), q);
      check(o3.bias_peaks == 1 && o3.bias > 0.00025 && q.mass_offsets.size() == 1 && q.mass_offsets[0] == 123.4559,
            "shifts 15b: a bias beyond the resolution comes off the offset");
    }
    // 16. a called SILAC channel is one unit (PXD014764: triplex, Lys4 was dropped_cap)
    {
      const auto idx = [&](const char* name) {
        for (std::size_t m = 0; m < fx.mods.size(); ++m)
          if (fx.mods[m].name == name) return static_cast<int>(m);
        return -1;
      };
      const int k4 = idx("Label:2H(4)"), r6 = idx("Label:13C(6)"), k8 = idx("Label:13C(6)15N(2)"), r10 = idx("Label:13C(6)15N(4)");
      check(k4 >= 0 && r6 >= 0 && k8 >= 0 && r10 >= 0, "shifts 16: the four SILAC labels are in massgap_mods.tsv");
      const auto m = [&](int i) { return fx.mods[static_cast<std::size_t>(i)].mass; };
      const auto pk = [&](std::vector<int> ex, std::uint64_t n) {
        double d = 0;
        for (int i : ex) d += m(i);
        return FD::GapPeak{d, n, ex, {}, {}, {}};
      };
      FD::GapResult gr;
      gr.peaks = {pk({k8}, 114), pk({r10}, 101), pk({r6}, 118), pk({k4}, 61), pk({k8, r10}, 39), pk({k4, k4}, 27),
                  pk({k4, r6}, 41), pk({idx("Oxidation")}, 50)};
      gr.silac = "SILAC triplex (Lys4/Arg6, Lys8/Arg10)";
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(gr, {}, fx.mods, fx.combos, shiftSettings(), p);
      check(hasMod(p.variable, "Label:2H(4) (K)") && hasMod(p.variable, "Label:13C(6) (R)") &&
                hasMod(p.variable, "Label:13C(6)15N(2) (K)") && hasMod(p.variable, "Label:13C(6)15N(4) (R)"),
            "shifts 16: all four triplex labels are exported");
      check(actionAt(o, m(k4)) == "variable" && actionAt(o, m(r6)) == "variable", "shifts 16: Lys4 is not dropped_cap under -shift_max_variable 3");
      check(actionAt(o, m(k8) + m(r10)) == "already_searched" && actionAt(o, 2 * m(k4)) == "already_searched" &&
                actionAt(o, m(k4) + m(r6)) == "already_searched" && p.mass_offsets.empty(),
            "shifts 16: label-only combinations take no offset slot");
      check(actionAt(o, mod("Oxidation (M)")->getDiffMonoMass()) == "variable" && p.variable.size() == 5,
            "shifts 16: the labels do not count against -shift_max_variable");
      // the channel does not fit Comet's slots: none of its labels, with a warning
      std::vector<const OpenMS::ResidueModification*> many;
      for (const auto& g : fx.mods)
      {
        if (many.size() == 12) break;
        if (g.name.rfind("Label:", 0) == 0) continue;
        const auto* r = mod(g.site.c_str());
        bool dup = false;
        for (const auto* x : many) dup = dup || x == r;
        if (!dup) many.push_back(r);
      }
      auto q = shiftPlan({cam}, many);
      const auto o2 = SC::shiftsToPlan(gr, {}, fx.mods, fx.combos, shiftSettings(), q);
      bool lab = false;
      for (const auto* v : q.variable) lab = lab || v->getId().rfind("Label:", 0) == 0;
      bool warned = false;
      for (const auto& w : o2.warnings) warned = warned || w.find("no label of the channel") != std::string::npos;
      check(many.size() == 12 && !lab && warned && actionAt(o2, m(k4)) == "dropped_cap" && actionAt(o2, m(k8)) == "dropped_cap",
            "shifts 16: a channel that does not fit is dropped as a whole, with a warning");
    }
    // 17. #3g's alkylation call decides the fixed Cys modification
    {
      auto s = shiftSettings();
      s.c_placements = 100;
      SC::PeakEvidence c60;
      c60.spectra = 60;
      c60.with_c = 60;
      auto p = shiftPlan();
      s.alkylation_call = "Carbamidomethyl";
      const auto o = SC::shiftsToPlan(fx.result({{57.0215, 60}}), {c60}, fx.mods, fx.combos, s, p);
      check(hasMod(p.fixed, "Carbamidomethyl (C)") && p.fixed.size() == 1 && o.fixed == 1 && actionAt(o, 57.0215) == "variable" &&
                !hasMod(p.variable, "Carbamidomethyl (C)") && hasMod(p.variable, "Carbamidomethyl (K)"),
            "shifts 17: a reagent call is the fixed modification; the +57 peak is re-sited");
      auto q = shiftPlan();
      s.alkylation_call = "none";
      const auto o2 = SC::shiftsToPlan(fx.result({{57.0215, 60}}), {c60}, fx.mods, fx.combos, s, q);
      check(q.fixed.empty() && q.variable.empty() && actionAt(o2, 57.0215) == "deferred_alkylation_call" && !o2.warnings.empty(),
            "shifts 17: a none call overrides the suggested fixed CAM");
      auto r = shiftPlan({mod("Propionamide (C)")});
      s.alkylation_call = "Carbamidomethyl";
      SC::shiftsToPlan(FD::GapResult{}, {}, fx.mods, fx.combos, s, r);
      check(r.fixed.size() == 1 && hasMod(r.fixed, "Propionamide (C)"), "shifts 17: a fixed Cys modification given by the user stays");
    }
    // 14. empty gap result
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(FD::GapResult{}, {}, fx.mods, fx.combos, shiftSettings(), p);
      check(o.decisions.empty() && !o.info.empty() && p.variable.empty() && p.mass_offsets.empty() && p.isotope_errors == 0,
            "shifts 14: an empty gap result exports nothing and says so");
    }
    // modes
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{15.9949, 100}, {123.4567, 50}}), {}, fx.mods, fx.combos,
                                      shiftSettings("comet", SC::ShiftMode::Variable), p);
      check(actionAt(o, 15.9949) == "variable" && actionAt(o, 123.4567) == "dropped_mode" && p.mass_offsets.empty(),
            "shifts mode variable: no offsets");
      auto q = shiftPlan({cam});
      const auto o2 = SC::shiftsToPlan(fx.result({{15.9949, 100}, {123.4567, 50}}), {}, fx.mods, fx.combos,
                                       shiftSettings("comet", SC::ShiftMode::Offsets), q);
      check(actionAt(o2, 15.9949) == "offset" && actionAt(o2, 123.4567) == "offset" && q.variable.empty() && q.mass_offsets.size() == 2,
            "shifts mode offsets: every exported shift is an offset");
      SC::ShiftMode m;
      check(SC::parseShiftMode("both", m) && m == SC::ShiftMode::Both && !SC::parseShiftMode("all", m), "parseShiftMode");
    }
    // the TSV
    {
      auto p = shiftPlan({cam});
      const auto o = SC::shiftsToPlan(fx.result({{15.9949, 100}, {123.4567, 50}}), {}, fx.mods, fx.combos, shiftSettings(), p);
      const std::string path = "search_config_test_shifts.tsv";
      std::string err;
      check(SC::writeShiftDecisions(path, {"a header"}, o.decisions, &err) && err.empty(), "writeShiftDecisions");
      std::ifstream f(path);
      std::string l1, l2, l3, l4;
      std::getline(f, l1);
      std::getline(f, l2);
      std::getline(f, l3);
      std::getline(f, l4);
      check(l1 == "# a header" &&
                l2 == "peak\tdelta\tspectra\texplanation\taction\tmod_id\tsites\texported\tsubstitution_share\tlocalized\treason" &&
                l3.rfind("1\t15.9949\t100\tOxidation\tvariable\tOxidation (M)\tM\t15.9949\t", 0) == 0 &&
                l4.rfind("2\t123.4567\t50\tnone\toffset\t-\t-\t123.4567\t", 0) == 0,
            "the -search_shifts_out rows");
      std::remove(path.c_str());
    }
  }
}

int main()
{
  // ---- term symbols (SageAdapter::getModDetails)
  check(SC::sageModKey(*mod("Carbamidomethyl (C)")) == "C", "residue mod: the residue");
  check(SC::sageModKey(*mod("Acetyl (Protein N-term)")) == "[", "protein N-term: [");
  check(SC::sageModKey(*mod("Gln->pyro-Glu (N-term Q)")) == "^Q", "peptide N-term on Q: ^Q");
  check(SC::sageModKey(*mod("Amidated (Protein C-term)")) == "]", "protein C-term: ]");
  check(SC::sageModKey(*mod("TMT6plex (N-term)")) == "^", "peptide N-term on any: ^");
  check(SC::sageModKey(*mod("Methyl (C-term)")) == "$", "peptide C-term on any: $");

  // ---- golden Sage
  const SC::SearchPlan p = plan();
  const std::string sage = SC::renderSage(p);
  const std::string sage_golden =
      "{\n"
      "  \"database\": {\n"
      "    \"bucket_size\": 8192,\n"
      "    \"enzyme\": {\n"
      "      \"missed_cleavages\": 1,\n"
      "      \"min_len\": 5,\n"
      "      \"max_len\": 50,\n"
      "      \"cleave_at\": \"KR\",\n"
      "      \"restrict\": \"P\",\n"
      "      \"c_terminal\": true\n"
      "    },\n"
      "    \"fragment_min_mz\": 150.0,\n"
      "    \"fragment_max_mz\": 2000.0,\n"
      "    \"peptide_min_mass\": 500.0,\n"
      "    \"peptide_max_mass\": 5000.0,\n"
      "    \"ion_kinds\": [\"b\", \"y\"],\n"
      "    \"min_ion_index\": 2,\n"
      "    \"static_mods\": {\n"
      "      \"C\": 57.021464\n"
      "    },\n"
      "    \"variable_mods\": {\n"
      "      \"M\": [15.994915],\n"
      "      \"[\": [42.010565],\n"
      "      \"^Q\": [-17.026549]\n"
      "    },\n"
      "    \"max_variable_mods\": 2,\n"
      "    \"decoy_tag\": \"rev_\",\n"
      "    \"generate_decoys\": true,\n"
      "    \"fasta\": \"reduced.fasta\"\n"
      "  },\n"
      "  \"precursor_tol\": {\n"
      "    \"ppm\": [-10, 10]\n"
      "  },\n"
      "  \"fragment_tol\": {\n"
      "    \"ppm\": [-20, 20]\n"
      "  },\n"
      "  \"isotope_errors\": [0, 0],\n"
      "  \"deisotope\": false,\n"
      "  \"chimera\": false,\n"
      "  \"wide_window\": false,\n"
      "  \"predict_rt\": false,\n"
      "  \"min_peaks\": 15,\n"
      "  \"max_peaks\": 150,\n"
      "  \"min_matched_peaks\": 4,\n"
      "  \"report_psms\": 1,\n"
      "  \"mzml_paths\": [\"run.mzML\"]\n"
      "}\n";
  check(sage == sage_golden, "golden Sage configuration");
  if (sage != sage_golden) std::cerr << sage;
  {
    Json j{sage};
    check(j.parse(), "the Sage configuration is well-formed JSON");
  }
  {
    SC::SearchPlan q = p;
    q.fragment_tolerance = 0.5;
    q.fragment_ppm = false;
    q.precursor_tolerance = 0.02;
    q.precursor_ppm = false;
    q.isotope_errors = 2;
    q.decoy_prefix = "XXX_";
    q.database = "C:\\db \"x\".fasta";
    q.fixed = {mod("Carbamidomethyl (C)"), mod("Carbamidomethyl (C)")};
    q.variable = {mod("Oxidation (M)"), mod("Dioxidation (M)")};
    const std::string s = SC::renderSage(q);
    check(s.find("\"da\": [-0.5, 0.5]") != std::string::npos, "Da fragment tolerance");
    check(s.find("\"precursor_tol\": {\n    \"da\": [-0.02, 0.02]") != std::string::npos, "Da precursor tolerance");
    check(s.find("\"isotope_errors\": [0, 2]") != std::string::npos, "isotope errors 0..2");
    check(s.find("\"decoy_tag\": \"XXX_\"") != std::string::npos, "custom decoy prefix");
    check(s.find("\"C\": 114.042928") != std::string::npos, "two static mods on one key add up");
    check(s.find("\"M\": [15.994915, 31.989829]") != std::string::npos, "variable mods on one key form a list");
    check(s.find("\"fasta\": \"C:\\\\db \\\"x\\\".fasta\"") != std::string::npos, "paths are JSON-escaped");
    Json j{s};
    check(j.parse(), "the Da configuration is well-formed JSON");
  }

  // ---- Comet bins (CometAdapter.cpp:444-474)
  {
    const auto hi = SC::cometFragmentBins(20.0, true);
    check(std::abs(hi.tol - 0.04) < 1e-12 && hi.offset == 0.0 && hi.theoretical == 0, "20 ppm: high-res bins");
    const auto lo = SC::cometFragmentBins(0.5, false);
    check(lo.tol == 1.0005 && lo.offset == 0.4 && lo.theoretical == 1, "0.5 Da: ion-trap bins");
    const auto tiny = SC::cometFragmentBins(2.0, true);
    check(tiny.tol == 0.01, "the bin width is floored at 0.01");
    const auto da_hi = SC::cometFragmentBins(0.02, false);
    check(std::abs(da_hi.tol - 0.04) < 1e-12 && da_hi.offset == 0.0, "0.02 Da is high resolution");
  }

  // ---- golden Comet fragment
  std::string err;
  const std::string comet = SC::renderComet(p, &err);
  check(err.empty(), "Comet keys render");
  {
    const auto m = kv(comet);
    const std::map<std::string, std::string> want = {
        {"database_name", "reduced.fasta"},
        {"decoy_search", "1"},
        {"decoy_prefix", "DECOY_"},
        {"peptide_mass_tolerance_upper", "10"},
        {"peptide_mass_tolerance_lower", "-10"},
        {"peptide_mass_units", "2"},
        {"isotope_error", "0"},
        {"search_enzyme_number", "1"},
        {"search_enzyme2_number", "0"},
        {"sample_enzyme_number", "1"},
        {"num_enzyme_termini", "2"},
        {"allowed_missed_cleavage", "1"},
        {"variable_mod01", "15.994915 M 0 3 -1 0 0 0.0"},
        {"variable_mod02", "42.010565 n 0 3 0 0 0 0.0"},
        {"variable_mod03", "-17.026549 Q 0 3 0 2 0 0.0"},
        {"fragment_bin_tol", "0.04"},
        {"fragment_bin_offset", "0"},
        {"theoretical_fragment_ions", "0"},
        {"mass_offsets", ""},
        {"add_C_cysteine", "57.021464"},
        {"add_Nterm_peptide", "0.0"},
        {"add_K_lysine", "0.0"},
    };
    for (const auto& [k, v] : want)
    {
      const auto it = m.find(k);
      check(it != m.end() && it->second == v, "Comet " + k + " = " + v + " (got " + (it == m.end() ? "nothing" : it->second) + ")");
    }
    for (int slot = 4; slot <= 15; ++slot)
    {
      const std::string k = std::string("variable_mod") + (slot < 10 ? "0" : "") + std::to_string(slot);
      check(m.count(k) && m.at(k) == "0.0 X 0 3 -1 0 0 0.0", k + " reset");
    }
    std::size_t add = 0;
    for (const auto& e : m) add += e.first.compare(0, 4, "add_") == 0;
    check(add == 30, "all 30 add_* keys are written");
    check(comet.rfind("# Comet parameters written by FASTag test", 0) == 0, "the fragment says what it is");
    check(comet.find("[COMET_ENZYME_INFO]") == std::string::npos, "a fragment has no enzyme table");
  }
  {
    SC::SearchPlan q = p;
    q.fragment_tolerance = 0.5;
    q.fragment_ppm = false;
    q.precursor_tolerance = 0.02;
    q.precursor_ppm = false;
    q.isotope_errors = 3;
    q.mass_offsets = {28.0313, 0.0};
    const auto m = kv(SC::renderComet(q));
    check(m.at("fragment_bin_tol") == "1.0005" && m.at("fragment_bin_offset") == "0.4" &&
              m.at("theoretical_fragment_ions") == "1",
          "0.5 Da writes the ion-trap bins");
    check(m.at("peptide_mass_units") == "0" && m.at("peptide_mass_tolerance_upper") == "0.02", "Da precursor");
    check(m.at("isotope_error") == "3", "isotope_error 3");
    check(m.at("mass_offsets") == "0.0 28.0313", "offsets start with 0, given 0 not repeated");
    q.missed_cleavages = 6;
    err.clear();
    check(SC::renderComet(q, &err).empty() && !err.empty(), "more than 5 missed cleavages refused for Comet");
    q.missed_cleavages = 1;
    q.fixed = {mod("Gln->pyro-Glu (N-term Q)")};
    err.clear();
    check(SC::renderComet(q, &err).empty() && !err.empty(), "a fixed terminal mod on one residue is refused");
  }

  // ---- template merge
  std::vector<std::pair<std::string, std::string>> keys;
  check(SC::cometKeys(p, keys).empty(), "cometKeys");
  {
    const std::string t =
        "# comet_version 2026.03 rev. 0\n"
        "# a comment\n"
        "\n"
        "database_name = old.fasta   # the database\n"
        "num_threads = 4\n"
        "variable_mod010 = 1.0 X 0 3 -1 0 0 0.0\n"
        "variable_mod01 = 79.966331 STY 0 3 -1 0 0 0.0\n"
        "add_Nterm_peptide = 229.162932\n"
        "add_C_cysteine = 57.021464\n"
        "search_enzyme_number = 1\n"
        "[COMET_ENZYME_INFO]\n"
        "0.  Cut_everywhere         0      -           -\n"
        "1.  Trypsin                1      KR          P\n"
        "3.  Lys_C                  1      K           P\n";
    const auto r = SC::mergeKeyValueTemplate(t, keys);
    check(r.error.empty() && r.warnings.empty(), "merge succeeds without warnings");
    check(r.text.rfind("# comet_version 2026.03 rev. 0\n# a comment\n\n", 0) == 0, "version header, comment, blank kept");
    check(r.text.find("database_name = reduced.fasta    # the database\n") != std::string::npos,
          "a managed key is replaced and keeps its inline comment");
    check(r.text.find("num_threads = 4\n") != std::string::npos, "an unmanaged key is kept");
    check(r.text.find("variable_mod010 = 1.0 X 0 3 -1 0 0 0.0\n") != std::string::npos,
          "variable_mod010 is not variable_mod01 (kept as an unmanaged key)");
    check(r.text.find("variable_mod01 = 15.994915 M 0 3 -1 0 0 0.0\n") != std::string::npos, "variable_mod01 replaced");
    check(r.text.find("add_Nterm_peptide = 0.0\n") != std::string::npos, "a template's TMT on add_Nterm_peptide is reset");
    check(r.text.find("add_C_cysteine = 57.021464\n") != std::string::npos, "the plan's CAM is written");
    const auto ins = r.text.find("allowed_missed_cleavage = 1\n");
    const auto tab = r.text.find("[COMET_ENZYME_INFO]");
    check(ins != std::string::npos && tab != std::string::npos && ins < tab, "missing keys are inserted before the enzyme table");
    check(r.text.find("variable_mod15 = 0.0 X 0 3 -1 0 0 0.0\n") < tab, "slot 15 inserted before the table");
    check(r.text.find("1.  Trypsin                1      KR          P\n") > tab, "the enzyme table is kept after the keys");
    check(r.text.find("[COMET_ENZYME_INFO]") == r.text.rfind("[COMET_ENZYME_INFO]"), "one enzyme table");
    // An empty plan resets the template's CAM and TMT, and every variable slot.
    SC::SearchPlan empty = p;
    empty.fixed.clear();
    empty.variable.clear();
    std::vector<std::pair<std::string, std::string>> ek;
    SC::cometKeys(empty, ek);
    const auto r2 = SC::mergeKeyValueTemplate(t, ek);
    check(r2.text.find("add_C_cysteine = 0.0\n") != std::string::npos && r2.text.find("add_Nterm_peptide = 0.0\n") != std::string::npos,
          "an empty plan resets add_C_cysteine and add_Nterm_peptide");
    check(r2.text.find("variable_mod01 = 0.0 X 0 3 -1 0 0 0.0\n") != std::string::npos, "an empty plan zeroes slot 01");
    // enzyme number: rewritten to trypsin, or refused without one
    std::string t3 = t;
    t3.replace(t3.find("search_enzyme_number = 1"), 24, "search_enzyme_number = 3");
    const auto r3 = SC::mergeKeyValueTemplate(t3, keys);
    check(r3.error.empty() && r3.warnings.size() == 1 && r3.text.find("search_enzyme_number = 1\n") != std::string::npos,
          "a non-trypsin enzyme number is rewritten with a warning");
    std::string t4 = t;
    t4.replace(t4.find("1.  Trypsin"), 11, "1.  Pepsin ");
    t4.replace(t4.find("KR          P"), 13, "FL          P");
    check(!SC::mergeKeyValueTemplate(t4, keys).error.empty(), "a table without trypsin is refused");
    check(!SC::mergeKeyValueTemplate("database_name = x\n", keys).error.empty(), "a template without a table is refused");
    // trypsin under another number in the table: that number is written
    const std::string t5 = "search_enzyme_number = 7\nsample_enzyme_number = 7\n[COMET_ENZYME_INFO]\n"
                           "1.  Lys_C                  1      K           P\n"
                           "7.  Trypsin                1      RK          P\n";
    const auto r5 = SC::mergeKeyValueTemplate(t5, keys);
    check(r5.error.empty() && r5.warnings.empty() && r5.text.find("search_enzyme_number = 7\n") != std::string::npos &&
              r5.text.find("sample_enzyme_number = 7\n") != std::string::npos,
          "the table's trypsin number (7, cut RK) is written, not Comet's default 1");
    // a managed-family key the plan does not set is dropped
    const auto r6 = SC::mergeKeyValueTemplate(
        "variable_mod16 = 1.0 K 0 3 -1 0 0 0.0\nadd_K_lysine_old = 8.0\nkeep_me = 1\n[COMET_ENZYME_INFO]\n"
        "1.  Trypsin                1      KR          P\n",
        keys);
    check(r6.text.find("variable_mod16") == std::string::npos && r6.text.find("add_K_lysine_old") == std::string::npos &&
              r6.text.find("keep_me = 1\n") != std::string::npos,
          "family keys outside the plan (variable_mod16, add_K_lysine_old) are dropped, others kept");
    // CRLF template
    std::string crlf;
    for (char c : t)
    {
      if (c == '\n') crlf += '\r';
      crlf += c;
    }
    check(SC::mergeKeyValueTemplate(crlf, keys).text == r.text, "a CRLF template merges as the LF one");
  }
  // ---- the checked-in template fixture
  {
    std::ifstream f(std::string(FASTAG_FIXTURES) + "/comet_template.params");
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string t = ss.str();
    check(!t.empty(), "fixture comet_template.params readable");
    const auto r = SC::mergeKeyValueTemplate(t, keys);
    check(r.error.empty() && r.warnings.size() == 1, "fixture: Lys_C enzyme number rewritten with a warning");
    const auto m = kv(r.text);
    check(m.count("peptide_mass_units") && m.count("isotope_error") && m.count("allowed_missed_cleavage"),
          "fixture: the removed keys are added");
    check(m.at("add_Nterm_peptide") == "0.0" && m.at("add_K_lysine") == "0.0", "fixture: TMT reset");
    check(m.at("variable_mod02") == "42.010565 n 0 3 0 0 0 0.0", "fixture: phospho slot replaced");
    check(m.at("mass_offsets").empty(), "fixture: the template's mass offsets do not survive");
    check(m.at("search_enzyme_number") == "1" && m.at("sample_enzyme_number") == "1", "fixture: trypsin is 1");
    check(m.at("num_threads") == "0" && m.at("use_B_ions") == "1", "fixture: unmanaged keys kept");
    check(r.text.rfind("# comet_version 2026.03 rev. 0\n", 0) == 0, "fixture: version header first");
  }

  // ---- key names against OpenMS's adapters (SageAdapter.cpp config_template
  // plus Sage's input keys fasta/mzml_paths/report_psms; CometAdapter.cpp
  // createParamFile_ plus the variable slots 10..15 Comet 2024+ has)
  {
    const std::set<std::string> sage_keys = {
        "database", "bucket_size", "enzyme", "missed_cleavages", "min_len", "max_len", "cleave_at", "restrict",
        "c_terminal", "fragment_min_mz", "fragment_max_mz", "peptide_min_mass", "peptide_max_mass", "ion_kinds",
        "min_ion_index", "static_mods", "variable_mods", "max_variable_mods", "generate_decoys", "decoy_tag",
        "precursor_tol", "fragment_tol", "precursor_charge", "isotope_errors", "deisotope", "chimera",
        "predict_rt", "min_peaks", "max_peaks", "min_matched_peaks", "report_psms", "wide_window", "fasta",
        "mzml_paths", "ppm", "da"};
    std::size_t pos = 0;
    bool all = true;
    while ((pos = sage.find('"', pos)) != std::string::npos)
    {
      const auto end = sage.find('"', pos + 1);
      const std::string tok = sage.substr(pos + 1, end - pos - 1);
      if (sage.compare(end + 1, 1, ":") == 0 && tok.size() > 2 && !sage_keys.count(tok))
      {
        all = false;
        std::cerr << "unknown Sage key " << tok << "\n";
      }
      pos = end + 1;
    }
    check(all, "every Sage key is one SageAdapter or Sage documents");
    const std::set<std::string> comet_keys = {
        "database_name", "decoy_search", "decoy_prefix", "peptide_mass_tolerance_upper",
        "peptide_mass_tolerance_lower", "peptide_mass_units", "isotope_error", "search_enzyme_number",
        "search_enzyme2_number", "sample_enzyme_number", "num_enzyme_termini", "allowed_missed_cleavage",
        "fragment_bin_tol", "fragment_bin_offset", "theoretical_fragment_ions", "mass_offsets"};
    for (const auto& e : kv(comet))
      check(comet_keys.count(e.first) || SC::cometManagedFamily(e.first), "Comet key known: " + e.first);
  }

  shiftTests();

  if (failures)
  {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "search_config_test: all checks passed\n";
  return 0;
}
