// 1.13 item 20: protease-aware shortlist placement. The cleavage rules
// against OpenMS ProteaseDB, the rule choice, the window filter, windows by
// flank mass against brute force, placements by mass, and the engine
// configurations for a non-tryptic rule.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Cleavage.h"
#include "ProteomeIndex.h"
#include "SearchConfig.h"
#include "Shortlist.h"
#include "TagRecon.h"

#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>

#include <cmath>
#include <fstream>
#include <iostream>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

using namespace FASTag;
using namespace OpenMS;
namespace FC = FASTag::Cleavage;
namespace SC = FASTag::SearchConfig;
using Verdict = FASTag::Shortlist::ProteaseVerdict;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok)
    {
      std::cerr << "FAIL: " << what << "\n";
      ++failures;
    }
  }
  double resMass(char c)
  {
    return ResidueDB::getInstance()->getResidue(std::string(1, c))->getMonoWeight(Residue::Internal);
  }
  double sumMass(const std::string& s)
  {
    double m = 0;
    for (char c : s) m += resMass(c);
    return m;
  }
  Verdict verdict(Verdict::Kind k, const std::string& model)
  {
    Verdict v;
    v.kind = k;
    v.model = model;
    return v;
  }
  bool contains(const std::string& s, const std::string& what) { return s.find(what) != std::string::npos; }
  const std::string AA = "ACDEFGHKLMNPQRSTVWY";
}

int main()
{
  // --- 1. every rule's residues are its ProteaseDB enzyme's sites ---
  {
    for (const FC::Rule& r : FC::rules())
    {
      if (r.unspecific()) continue;
      ProteaseDigestion d;
      d.setEnzyme(r.openms);
      d.setSpecificity(EnzymaticDigestion::SPEC_FULL);
      int mismatches = 0;
      for (char a : AA)
        for (char b : AA)
        {
          // "GGGGa|bGGGG": the peptide GGGGa ends at the a|b site or not (G
          // is no rule's residue); its start is the protein's N-terminus.
          const std::string prot = std::string("GGGG") + a + b + "GGGG";
          const bool openms_site = d.isValidProduct(prot, 0, 5, true, false, false);
          const bool rule_site = r.c_terminal ? (r.cut.find(a) != std::string::npos &&
                                                 (r.nocut.empty() || r.nocut.find(b) == std::string::npos))
                                              : r.cut.find(b) != std::string::npos;
          if (openms_site != rule_site)
          {
            ++mismatches;
            std::cerr << r.name << ": " << a << "|" << b << " OpenMS " << openms_site << " rule " << rule_site << "\n";
          }
        }
      check(mismatches == 0, r.name + ": rule residues == " + r.openms + " sites over all residue pairs");
    }
    std::cout << "1. " << FC::rules().size() - 1 << " rules match their ProteaseDB enzymes\n";
  }

  // --- 2. names: every -shortlist_protease value but trypsin/auto resolves ---
  {
    for (const char* n : {"unspecific", "lys-c", "arg-c", "asp-n", "glu-c", "chymotrypsin", "lys-n", "Trypsin"})
      check(FC::findRule(n) != nullptr, std::string("findRule(") + n + ")");
    check(FC::findRule("CHYMOTRYPSIN") == FC::findRule("Chymotrypsin"), "findRule is case-insensitive");
    check(FC::findRule("auto") == nullptr && FC::findRule("pepsin") == nullptr, "no rule for auto or pepsin");
    FC::Specificity s;
    check(FC::parseSpecificity("semi", s) && s == FC::Specificity::Semi, "parse semi");
    check(!FC::parseSpecificity("partial", s), "parse rejects partial");
    std::cout << "2. rule names\n";
  }

  // --- 3. the rule choice ---
  {
    const auto full = FC::Specificity::Full;
    auto c = FC::choose("auto", full, verdict(Verdict::NonTryptic, "Chymotrypsin"));
    check(c.rule->name == "Chymotrypsin" && !c.refuse, "auto follows a non-tryptic call");
    c = FC::choose("auto", full, verdict(Verdict::Compatible, "Lys-C"));
    check(c.rule->name == "Lys-C" && !c.refuse, "auto follows a trypsin-compatible call");
    c = FC::choose("auto", full, verdict(Verdict::Inconclusive, "Chymotrypsin"));
    check(c.rule->name == "Trypsin" && !c.refuse, "auto: inconclusive is Trypsin, whatever the top model");
    c = FC::choose("auto", full, verdict(Verdict::NonTryptic, "unspecific"));
    check(c.rule->unspecific() && c.specificity == FC::Specificity::None, "auto: an unspecific call");
    check(c.auto_unspecific, "auto: an unspecific call is flagged for the export warning");
    check(!FC::choose("auto", full, verdict(Verdict::NonTryptic, "Asp-N")).auto_unspecific &&
              !FC::choose("unspecific", full, verdict(Verdict::NonTryptic, "unspecific")).auto_unspecific,
          "a called protease or a named unspecific rule is not flagged");
    // post-1.13.1 (aspn): an Asp-N call under auto is semi-specific unless
    // the user gave -shortlist_specificity; no other call and no named rule is.
    c = FC::choose("auto", full, verdict(Verdict::NonTryptic, "Asp-N"), false);
    check(c.rule->name == "Asp-N" && c.specificity == FC::Specificity::Semi && c.auto_semi && !c.refuse,
          "auto: an Asp-N call is semi-specific when the specificity is not given");
    c = FC::choose("auto", full, verdict(Verdict::NonTryptic, "Asp-N"), true);
    check(c.specificity == full && !c.auto_semi, "auto: an Asp-N call keeps a given full specificity");
    check(FC::choose("auto", FC::Specificity::None, verdict(Verdict::NonTryptic, "Asp-N"), true).specificity ==
              FC::Specificity::None, "auto: an Asp-N call keeps a given none specificity");
    check(FC::choose("asp-n", full, verdict(Verdict::NonTryptic, "Asp-N"), false).specificity == full,
          "a named asp-n stays full");
    check(FC::choose("auto", full, verdict(Verdict::NonTryptic, "Chymotrypsin"), false).specificity == full &&
              FC::choose("auto", full, verdict(Verdict::Compatible, "Lys-C"), false).specificity == full &&
              FC::choose("auto", full, verdict(Verdict::Inconclusive, "Asp-N"), false).specificity == full &&
              FC::choose("auto", full, verdict(Verdict::NonTryptic, "unspecific"), false).specificity ==
                  FC::Specificity::None,
          "auto: only a confident Asp-N call becomes semi");
    c = FC::choose("chymotrypsin", full, verdict(Verdict::Compatible, "Trypsin"));
    check(c.rule->name == "Chymotrypsin" && c.refuse, "a named rule is refused on a contradicting trypsin call");
    c = FC::choose("chymotrypsin", full, verdict(Verdict::NonTryptic, "Chymotrypsin"));
    check(!c.refuse, "a named rule the call agrees with");
    c = FC::choose("asp-n", FC::Specificity::Semi, verdict(Verdict::NonTryptic, "Chymotrypsin"));
    check(c.refuse && c.specificity == FC::Specificity::Semi, "semi: refused on another non-tryptic call");
    c = FC::choose("lys-c", full, verdict(Verdict::Compatible, "Trypsin"));
    check(c.rule->name == "Lys-C" && !c.refuse && c.mismatch, "Lys-C on a trypsin call: nested, kept with a WARN");
    // Lys-C (after K) and Arg-C (after R) are disjoint: a confident call of
    // one contradicts a rule of the other, although both are trypsin-compatible.
    c = FC::choose("arg-c", full, verdict(Verdict::Compatible, "Lys-C"));
    check(c.rule->name == "Arg-C" && c.refuse, "Arg-C on a Lys-C call is refused (disjoint sites)");
    c = FC::choose("lys-c", full, verdict(Verdict::Compatible, "Arg-C"));
    check(c.rule->name == "Lys-C" && c.refuse, "Lys-C on an Arg-C call is refused (disjoint sites)");
    c = FC::choose("lys-c", FC::Specificity::Semi, verdict(Verdict::Compatible, "Arg-C"));
    check(c.refuse, "semi: Lys-C on an Arg-C call is refused");
    c = FC::choose("arg-c", full, verdict(Verdict::Compatible, "Trypsin"));
    check(!c.refuse && c.mismatch, "Arg-C on a trypsin call: nested, kept with a WARN");
    c = FC::choose("lys-c", full, verdict(Verdict::Compatible, "Lys-C"));
    check(!c.refuse && !c.mismatch, "Lys-C on a Lys-C call: no WARN");
    c = FC::choose("lys-n", full, verdict(Verdict::Compatible, "Lys-C"));
    check(c.refuse, "Lys-N (before K) on a Lys-C call (after K) is refused");
    c = FC::choose("glu-c", full, verdict(Verdict::NonTryptic, "Asp-N"));
    check(c.refuse, "Glu-C on an Asp-N call is refused");
    check(FC::nested(*FC::findRule("Trypsin"), *FC::findRule("Lys-C")) &&
              FC::nested(*FC::findRule("Arg-C"), *FC::findRule("Trypsin")),
          "nested: Trypsin with Lys-C and Arg-C");
    check(!FC::nested(*FC::findRule("Lys-C"), *FC::findRule("Arg-C")) &&
              !FC::nested(*FC::findRule("Lys-C"), *FC::findRule("Lys-N")) &&
              !FC::nested(*FC::findRule("unspecific"), *FC::findRule("unspecific")),
          "nested: not Lys-C/Arg-C, Lys-C/Lys-N or unspecific");
    c = FC::choose("chymotrypsin", FC::Specificity::None, verdict(Verdict::Compatible, "Trypsin"));
    check(!c.refuse, "specificity none is never refused");
    c = FC::choose("chymotrypsin", full, verdict(Verdict::Inconclusive, "Trypsin"));
    check(!c.refuse, "an inconclusive call does not refuse");
    c = FC::choose("chymotrypsin", full, verdict(Verdict::NonTryptic, "unspecific"));
    check(c.rule->name == "Chymotrypsin" && !c.refuse && c.specificity == full,
          "an unspecific call does not contradict a named rule");
    c = FC::choose("unspecific", full, verdict(Verdict::NonTryptic, "Chymotrypsin"));
    check(c.rule->unspecific() && !c.refuse && c.specificity == FC::Specificity::None, "unspecific");
    std::cout << "3. rule choice\n";
  }

  // --- 4. the window filter ---
  {
    //                0123456789012345678901234
    const std::string p = "MAGFSTWKGYPAGLSTDAGEKGRSA";
    const FC::Rule& ch = *FC::findRule("Chymotrypsin");
    const FC::WindowFilter f0(ch, FC::Specificity::Full, 0), f1(ch, FC::Specificity::Full, 1);
    const FC::WindowFilter fs(ch, FC::Specificity::Semi, 0), fn(ch, FC::Specificity::None, 0);
    check(f0.accepts(p, 4, 3), "STW: after F, ends at W");
    check(!f0.accepts(p, 4, 4), "STWK: does not end at a site");
    check(f0.accepts(p, 7, 7), "KGYPAGL: Y before P is no site, so no missed cleavage");
    check(f0.accepts(p, 0, 4) && f0.accepts(p, 1, 3), "protein N-terminus and after the initiator Met");
    check(!f0.accepts(p, 4, 10) && f1.accepts(p, 4, 10), "STWKGYPAGL: one missed cleavage (W)");
    check(!f0.accepts(p, 5, 2) && fs.accepts(p, 5, 2) && !fs.accepts(p, 5, 3), "semi: TW yes, TWK no");
    check(fn.accepts(p, 5, 3), "none: any window");
    check(!f0.accepts(p, 20, 10), "a window past the protein end");
    const FC::WindowFilter fa(*FC::findRule("Asp-N"), FC::Specificity::Full, 0);
    check(fa.accepts(p, 16, 9) && fa.accepts(p, 0, 16) && !fa.accepts(p, 14, 11) && !fa.accepts(p, 16, 4),
          "Asp-N: cuts before D only");
    const FC::WindowFilter fu(*FC::findRule("unspecific"), FC::Specificity::Full, 0);
    check(fu.accepts(p, 3, 5), "an unspecific rule accepts any window");
    std::cout << "4. window filter\n";
  }

  // --- 5. windows by mass == brute force ---
  {
    std::mt19937 rng(20261109);
    std::uniform_int_distribution<int> aa(0, 18);
    std::vector<FASTAFile::FASTAEntry> entries;
    for (int i = 0; i < 5; ++i)
    {
      std::string s;
      for (int k = 0; k < 120; ++k) s += AA[static_cast<std::size_t>(aa(rng))];
      if (i == 2) s[60] = 'X';  // an ambiguity residue: a hard barrier
      entries.emplace_back("P" + std::to_string(i), "", s);
    }
    ProteomeIndex idx;
    idx.build(entries, {}, 0);
    int windows = 0, compared = 0;
    for (int trial = 0; trial < 400; ++trial)
    {
      const int prot = trial % 5;
      const std::string& seq = entries[static_cast<std::size_t>(prot)].sequence;
      std::uniform_int_distribution<int> at(0, 115);
      const int pos = at(rng), len = 4;
      // A true window around it, and its masses.
      std::uniform_int_distribution<int> ext(0, 12);
      const int s0 = std::max(0, pos - ext(rng)), e0 = std::min(120, pos + len + ext(rng));
      const double tol = trial % 2 ? 0.02 : 0.6;
      // Every fourth query asks for masses 0.8 tol away from the true ones,
      // so the true window sits near the tolerance edge on both sides.
      const double off = trial % 4 >= 2 ? 0.8 * tol : 0.0;
      const double wn = sumMass(seq.substr(static_cast<std::size_t>(s0), static_cast<std::size_t>(pos - s0))) + off;
      const double wc = sumMass(seq.substr(static_cast<std::size_t>(pos + len), static_cast<std::size_t>(e0 - pos - len))) - off;
      // text position: proteins are '#'-separated, 121 characters each
      const uint32_t tpos = static_cast<uint32_t>(prot * 121 + pos);
      std::vector<ProteomeIndex::Window> got;
      idx.windowsByMass(tpos, len, {wn}, {wc}, tol, got);
      std::set<std::pair<uint32_t, uint32_t>> want;
      const bool tag_ok = seq.substr(static_cast<std::size_t>(pos), len).find('X') == std::string::npos;
      for (int s = 0; s <= pos && tag_ok; ++s)
        for (int e = pos + len; e <= 120; ++e)
        {
          const std::string sub = seq.substr(static_cast<std::size_t>(s), static_cast<std::size_t>(e - s));
          if (sub.find('X') != std::string::npos) continue;
          const double n = sumMass(seq.substr(static_cast<std::size_t>(s), static_cast<std::size_t>(pos - s)));
          const double c = sumMass(seq.substr(static_cast<std::size_t>(pos + len), static_cast<std::size_t>(e - pos - len)));
          if (std::fabs(n - wn) <= tol && std::fabs(c - wc) <= tol)
            want.insert({static_cast<uint32_t>(prot * 121 + s), static_cast<uint32_t>(prot * 121 + e)});
        }
      std::set<std::pair<uint32_t, uint32_t>> have;
      for (const auto& w : got) have.insert({w.start, w.end});
      // tolerance edges: sums in another order differ in the last bits; the
      // brute force agrees except for windows within 1e-9 of the edge.
      check(have == want, "windowsByMass == brute force, trial " + std::to_string(trial));
      check(have.size() == got.size(), "no duplicate windows");
      if (tag_ok && (s0 > 60 || e0 <= 60 || prot != 2))
        check(have.count({static_cast<uint32_t>(prot * 121 + s0), static_cast<uint32_t>(prot * 121 + e0)}) == 1,
              "the true window is found, trial " + std::to_string(trial));
      windows += static_cast<int>(got.size());
      ++compared;
    }
    check(idx.proteinText(2).size() == 120 && idx.proteinText(2)[60] == 'X' &&
              idx.proteinText(1) == entries[1].sequence,
          "proteinText: the database sequence, ambiguity residues as X");
    std::cout << "5. windowsByMass == brute force over " << compared << " queries (" << windows << " windows)\n";
  }

  // --- 6. placements by mass: a chymotryptic peptide ---
  {
    // Chymotryptic peptide GSTAVNEGQKF after "...W", followed by "PL...": the
    // tryptic windows around it (cut after K/R) never reproduce it.
    const std::string pep = "GSTAVNEGQKF";
    std::vector<FASTAFile::FASTAEntry> entries;
    entries.emplace_back("CHY1", "", "MAEGW" + pep + "AVDNTSLW");
    ProteomeIndex idx;
    idx.build(entries, {}, 0);
    TagReconciler r(10.0, /*ppm=*/true, true);
    r.attach(&idx, 1, 4);
    const std::size_t pos = 3;
    const std::string tag = pep.substr(pos, 4);  // AVNE
    const double nflank = sumMass(pep.substr(0, pos));
    const double cflank = sumMass(pep.substr(pos + 4));
    bool tryptic = false;
    for (const auto& x : r.reconcile(tag, nflank, cflank))
      if (x.nterm_match && x.cterm_match) tryptic = true;
    check(!tryptic, "no exact tryptic placement of a chymotryptic peptide");
    const auto bm = r.reconcileByMass(tag, nflank, cflank);
    bool found = false;
    for (const auto& x : bm)
      if (x.peptide == pep && x.start == 5 && x.nterm_match && x.cterm_match && x.pos == pos) found = true;
    check(found, "reconcileByMass places it exactly, at protein offset 5");
    const FC::WindowFilter f(*FC::findRule("Chymotrypsin"), FC::Specificity::Full, 0);
    check(f.accepts(idx.proteinText(0), 5, static_cast<uint32_t>(pep.size())), "and the chymotrypsin rule keeps it");
    const FC::WindowFilter ft(*FC::findRule("Trypsin"), FC::Specificity::Full, 1);
    check(!ft.accepts(idx.proteinText(0), 5, static_cast<uint32_t>(pep.size())), "the trypsin rule does not");
    // A fixed N-terminal label rides on the spectrum's N flank: label-exact.
    const double label = 229.162932;
    r.setFixedTermMods(label, 0.0);
    bool labelled = false;
    for (const auto& x : r.reconcileByMass(tag, nflank + label, cflank))
      if (x.peptide == pep && !x.nterm_match && x.cterm_match &&
          FASTag::Shortlist::classifyPlacement(x.nterm_match, x.cterm_match, x.delta_mass, label, 0.0, 0.01) ==
              FASTag::Shortlist::Placement::LabelExact)
        labelled = true;
    check(labelled, "a labelled peptide's window is found and counts as label-exact");
    r.setFixedTermMods(0.0, 0.0);
    // Reversed reading (b ions): cterm_mass = N-side - H2O, nterm_mass = C-side + H2O.
    const double water = 18.0105646863;
    bool rev = false;
    std::string rtag(tag.rbegin(), tag.rend());
    for (const auto& x : r.reconcileByMass(rtag, cflank + water, nflank - water))
      if (x.peptide == pep && x.reversed && x.nterm_match && x.cterm_match) rev = true;
    check(rev, "a reversed (b-ion) tag is placed by mass as well");
    std::cout << "6. placements by mass\n";
  }

  // --- 7. engine configurations ---
  {
    SC::SearchPlan p;
    p.database = "db.fasta";
    p.spectra = "run.mzML";
    p.fastag_version = "test";
    const std::string tryp = SC::renderSage(p);
    check(contains(tryp, "\"cleave_at\": \"KR\",\n      \"restrict\": \"P\",\n      \"c_terminal\": true\n    },"),
          "Sage: the default enzyme block is 1.12's");
    check(!contains(tryp, "semi_enzymatic"), "Sage: no semi key by default");
    p.enzyme = FC::engineEnzyme(*FC::findRule("Chymotrypsin"), FC::Specificity::Semi);
    const std::string ch = SC::renderSage(p);
    check(contains(ch, "\"cleave_at\": \"FWYL\"") && contains(ch, "\"restrict\": \"P\"") &&
              contains(ch, "\"c_terminal\": true,\n      \"semi_enzymatic\": true\n    },"),
          "Sage: semi-specific chymotrypsin");
    p.enzyme = FC::engineEnzyme(*FC::findRule("Asp-N"), FC::Specificity::Full);
    const std::string an = SC::renderSage(p);
    check(contains(an, "\"cleave_at\": \"D\"") && contains(an, "\"restrict\": null") &&
              contains(an, "\"c_terminal\": false\n"),
          "Sage: Asp-N cuts before D, no restriction");
    std::string err;
    check(SC::renderComet(p, &err).empty() && contains(err, "-search_config_template"),
          "Comet without a template: Asp-N has no default entry");
    p.enzyme = FC::engineEnzyme(*FC::findRule("Chymotrypsin"), FC::Specificity::Full);
    check(FC::engineEnzyme(*FC::findRule("Chymotrypsin"), FC::Specificity::None).unspecific(),
          "specificity none is an unspecific engine digestion");
    const std::string cf = SC::renderComet(p, &err);
    check(contains(cf, "search_enzyme_number = 10\n") && contains(cf, "num_enzyme_termini = 2\n"),
          "Comet fragment: chymotrypsin is 10 in comet -p's table");
    p.enzyme = FC::engineEnzyme(*FC::findRule("unspecific"), FC::Specificity::Full);
    check(contains(SC::renderSage(p), "\"cleave_at\": \"\",\n      \"restrict\": null,"), "Sage: unspecific");
    // Template merge: the fixture's comet -p table (10. Chymotrypsin 1 FWYL P).
    std::ifstream tf(std::string(FASTAG_FIXTURES) + "/comet_template.params", std::ios::binary);
    std::stringstream ts;
    ts << tf.rdbuf();
    const std::string tmpl = ts.str();
    check(!tmpl.empty(), "the Comet template fixture");
    std::vector<std::pair<std::string, std::string>> keys;
    p.enzyme = FC::engineEnzyme(*FC::findRule("Chymotrypsin"), FC::Specificity::Semi);
    check(SC::cometKeys(p, keys).empty(), "Comet keys for chymotrypsin");
    auto m = SC::mergeKeyValueTemplate(tmpl, keys, p.enzyme);
    check(m.error.empty() && contains(m.text, "\nsearch_enzyme_number = 10") &&
              contains(m.text, "\nsample_enzyme_number = 10") && contains(m.text, "\nnum_enzyme_termini = 1"),
          "Comet merge: chymotrypsin by its rule, semi = 1 terminus");
    p.enzyme = FC::engineEnzyme(*FC::findRule("unspecific"), FC::Specificity::Full);
    SC::cometKeys(p, keys);
    m = SC::mergeKeyValueTemplate(tmpl, keys, p.enzyme);
    check(m.error.empty() && contains(m.text, "\nsearch_enzyme_number = 0"), "Comet merge: unspecific is Cut_everywhere");
    p.enzyme = FC::engineEnzyme(*FC::findRule("Asp-N"), FC::Specificity::Full);
    SC::cometKeys(p, keys);
    m = SC::mergeKeyValueTemplate(tmpl, keys, p.enzyme);
    check(!m.error.empty() && contains(m.error, "Asp-N"), "Comet merge: no D-only Asp-N entry is an error");
    // The default enzyme through the new overload is the 1.12 merge, byte for byte.
    p.enzyme = SC::Enzyme();
    SC::cometKeys(p, keys);
    check(SC::mergeKeyValueTemplate(tmpl, keys, SC::Enzyme()).text == SC::mergeKeyValueTemplate(tmpl, keys).text,
          "Comet merge: the default Enzyme is the 1.12 merge");
    std::cout << "7. engine configurations\n";
  }

  if (failures)
  {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "cleavage_test: all checks passed\n";
  return 0;
}
