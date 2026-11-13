// SearchConfig, MSFragger renderer (1.13, backlog #18).
//
// The references are MSFragger 4.4.1's own files, not FASTag's reading of
// its documentation:
//   - msfragger_4.4.1_closed.params: `java -jar MSFragger-4.4.1.jar --config
//     closed`. The rendered key set must equal its active key set (plus the
//     used variable_mod_NN slots).
//   - msfragger_4.4.1_echo.txt: the "Parameters:" block MSFragger 4.4.1
//     printed when it ran the golden plan's file (rendered by
//     `msfragger_config_test --emit <file>`), and the <aminoacid_modification>
//     and <terminal_modification> elements of the pepXML it wrote. Every
//     managed value must equal what MSFragger read, and every modification
//     must be read on the site OpenMS's ResidueModification gives it.
// See test/fixtures/README.md for how both were made.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "SearchConfig.h"
#include "Shortlist.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/FORMAT/FASTAFile.h>

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace SC = FASTag::SearchConfig;
using OpenMS::ResidueModification;

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
  const ResidueModification* mod(const char* name)
  {
    return OpenMS::ModificationsDB::getInstance()->getModification(name);
  }
  std::string trim(const std::string& s)
  {
    const auto b = s.find_first_not_of(" \t\r");
    if (b == std::string::npos) return std::string();
    const auto e = s.find_last_not_of(" \t\r");
    return s.substr(b, e - b + 1);
  }
  std::string slurp(const std::string& path)
  {
    std::ifstream f(path, std::ios::binary);
    std::ostringstream os;
    os << f.rdbuf();
    return os.str();
  }

  /// The plan the echo fixture was recorded from. Changing it needs a new
  /// MSFragger run (fixtures README).
  SC::SearchPlan goldenPlan()
  {
    SC::SearchPlan p;
    p.database = "golden_td.fasta";
    p.spectra = "run.mzML";
    p.fixed = {mod("Carbamidomethyl (C)"), mod("Methyl (C-term)")};
    p.variable = {mod("Oxidation (M)"),         mod("Acetyl (Protein N-term)"), mod("Gln->pyro-Glu (N-term Q)"),
                  mod("Deamidated (N)"),        mod("Amidated (Protein C-term)"), mod("Carbamyl (N-term)"),
                  mod("Met-loss (Protein N-term M)")};
    p.mass_offsets = {79.9663, -18.0106};
    p.isotope_errors = 2;
    p.missed_cleavages = 2;
    p.fragment_tolerance = 20.0;
    p.fragment_ppm = true;
    p.precursor_tolerance = 10.0;
    p.precursor_ppm = true;
    p.fastag_version = "test";
    return p;
  }

  using Keys = std::vector<std::pair<std::string, std::string>>;
  std::map<std::string, std::string> asMap(const Keys& k)
  {
    std::map<std::string, std::string> m;
    for (const auto& kv : k) m[kv.first] = kv.second;
    return m;
  }

  /// "key = value" lines of a fragger.params, comments after the value cut
  /// at '#' (the --config file separates them by tabs or spaces).
  std::map<std::string, std::string> readParams(const std::string& text, bool cut_comment)
  {
    std::map<std::string, std::string> m;
    std::istringstream is(text);
    std::string l;
    while (std::getline(is, l))
    {
      const std::string t = trim(l);
      if (t.empty() || t[0] == '#') continue;
      const auto eq = t.find(" = ");
      if (eq == std::string::npos)
      {
        if (t.size() >= 2 && t.compare(t.size() - 2, 2, " =") == 0) m[trim(t.substr(0, t.size() - 2))] = "";
        continue;
      }
      std::string v = t.substr(eq + 3);
      if (cut_comment)
      {
        const auto h = v.find('#');
        if (h != std::string::npos) v = v.substr(0, h);
      }
      m[trim(t.substr(0, eq))] = trim(v);
    }
    return m;
  }

  bool sameNumberList(const std::string& a, const std::string& b, char sep)
  {
    std::vector<double> x, y;
    const std::pair<const std::string*, std::vector<double>*> both[] = {{&a, &x}, {&b, &y}};
    for (const auto& pr : both)
    {
      std::istringstream is(*pr.first);
      std::string tok;
      while (std::getline(is, tok, sep))
      {
        char* end = nullptr;
        const double d = std::strtod(tok.c_str(), &end);
        if (end == tok.c_str()) return false;
        pr.second->push_back(d);
      }
    }
    if (x.size() != y.size()) return false;
    for (std::size_t i = 0; i < x.size(); ++i)
      if (std::fabs(x[i] - y[i]) > 1e-9 * std::max(1.0, std::fabs(x[i]))) return false;
    return true;
  }

  /// Attribute @p name of an XML element line, "" if absent.
  std::string attr(const std::string& line, const std::string& name)
  {
    const std::string k = " " + name + "=\"";
    const auto b = line.find(k);
    if (b == std::string::npos) return std::string();
    const auto e = line.find('"', b + k.size());
    return line.substr(b + k.size(), e - b - k.size());
  }
}

int main(int argc, char** argv)
{
  if (argc == 3 && std::string(argv[1]) == "--emit")
  {
    std::string err;
    const std::string text = SC::renderMSFragger(goldenPlan(), &err);
    if (!err.empty())
    {
      std::cerr << err << "\n";
      return 1;
    }
    std::ofstream(argv[2], std::ios::binary) << text;
    return 0;
  }
  const std::string fx = FASTAG_FIXTURES;

  // ---- sites (fragger.params: [ ] protein termini, n c peptide termini)
  check(SC::msfraggerSite(*mod("Oxidation (M)")) == "M", "residue: M");
  check(SC::msfraggerSite(*mod("Acetyl (Protein N-term)")) == "[^", "protein N-term: [^");
  check(SC::msfraggerSite(*mod("Amidated (Protein C-term)")) == "]^", "protein C-term: ]^");
  check(SC::msfraggerSite(*mod("Carbamyl (N-term)")) == "n^", "peptide N-term: n^");
  check(SC::msfraggerSite(*mod("Methyl (C-term)")) == "c^", "peptide C-term: c^");
  check(SC::msfraggerSite(*mod("Gln->pyro-Glu (N-term Q)")) == "nQ", "peptide N-term Q: nQ");
  check(SC::msfraggerSite(*mod("Met-loss (Protein N-term M)")) == "[M", "protein N-term M: [M");
  check(SC::decoyPrefix(SC::SearchPlan(), "msfragger") == "rev_", "MSFragger default decoy prefix rev_");

  // ---- golden plan: keys against MSFragger's --config closed file
  const SC::SearchPlan p = goldenPlan();
  Keys keys;
  check(SC::msfraggerKeys(p, keys).empty(), "the golden plan renders");
  const auto mine = asMap(keys);
  check(mine.size() == keys.size(), "no key written twice");
  const std::string closed_text = slurp(fx + "/msfragger_4.4.1_closed.params");
  check(closed_text.rfind("# MSFragger-4.4.1", 0) == 0, "fixture is MSFragger 4.4.1's --config closed output");
  const auto closed = readParams(closed_text, true);
  for (const auto& kv : closed)
    if (kv.first.compare(0, 13, "variable_mod_") != 0)
      check(mine.count(kv.first) == 1, "MSFragger key '" + kv.first + "' is written");
  for (const auto& kv : mine)
    check(closed.count(kv.first) == 1 || kv.first.compare(0, 13, "variable_mod_") == 0,
          "'" + kv.first + "' is a key of MSFragger 4.4.1's file");
  // Key order follows the --config file (variable slots where its slots are).
  {
    std::vector<std::string> order;
    std::istringstream is(closed_text);
    std::string l;
    while (std::getline(is, l))
    {
      const std::string t = trim(l);
      if (t.empty() || t[0] == '#') continue;
      const auto eq = t.find(" =");
      if (eq == std::string::npos) continue;
      const std::string k = t.substr(0, eq);
      if (k.compare(0, 13, "variable_mod_") != 0) order.push_back(k);
    }
    std::vector<std::string> got;
    for (const auto& kv : keys)
      if (kv.first.compare(0, 13, "variable_mod_") != 0) got.push_back(kv.first);
    check(got == order, "keys in the order of MSFragger's --config file");
  }
  // Values that are not FASTag's keep MSFragger's defaults, except the few
  // the renderer documents.
  const std::set<std::string> changed = {"database_name", "num_threads", "precursor_mass_lower",
                                         "precursor_mass_upper", "precursor_mass_units", "precursor_true_tolerance",
                                         "precursor_true_units", "fragment_mass_tolerance", "fragment_mass_units",
                                         "calibrate_mass", "isotope_error", "mass_offsets", "localize_delta_mass",
                                         "labile_fragment_ion_series", "search_enzyme_name_1", "search_enzyme_nocut_1",
                                         "allowed_missed_cleavage_1", "decoy_prefix"};
  for (const auto& kv : closed)
    if (!changed.count(kv.first) && kv.first.compare(0, 4, "add_") != 0 && kv.first.compare(0, 13, "variable_mod_") != 0)
      check(mine.count(kv.first) && mine.at(kv.first) == kv.second,
            "'" + kv.first + "' keeps MSFragger's default '" + kv.second + "' (got '" +
                (mine.count(kv.first) ? mine.at(kv.first) : std::string("?")) + "')");
  check(mine.at("add_C_cysteine") == "57.021464", "fixed CAM written");
  check(mine.at("add_Cterm_peptide") == "14.015650", "fixed peptide C-term methyl written");
  check(mine.at("add_M_methionine") == "0.0", "an unset add_ key is 0.0");
  check(mine.at("mass_offsets").rfind("0/", 0) == 0, "mass_offsets starts with 0");
  check(mine.at("mass_offsets") == "0/79.9663/-18.0106", "mass_offsets: 0 first, then the plan's, '/'-separated");
  check(mine.at("isotope_error") == "0/1/2", "isotope_error 0/1/2");
  check(mine.at("precursor_mass_lower") == "-10" && mine.at("precursor_mass_upper") == "10" &&
            mine.at("precursor_mass_units") == "1",
        "separate precursor_mass_lower/upper/units");
  check(mine.at("precursor_true_tolerance") == "10" && mine.at("precursor_true_units") == "1",
        "precursor_true_tolerance and units follow the precursor window");

  // ---- the golden plan against what MSFragger 4.4.1 read from it
  const std::string echo_text = slurp(fx + "/msfragger_4.4.1_echo.txt");
  check(!echo_text.empty(), "echo fixture present");
  std::string params_part, pepxml_part;
  {
    const auto cut = echo_text.find("# pepXML");
    params_part = echo_text.substr(0, cut);
    if (cut != std::string::npos) pepxml_part = echo_text.substr(cut);
  }
  const auto echo = readParams(params_part, false);
  // Keys MSFragger echoes under its own name.
  const std::map<std::string, std::string> alias = {{"search_enzyme_name_1", "search_enzyme_name"}};
  const char* numeric[] = {"precursor_mass_lower", "precursor_mass_upper", "precursor_mass_units",
                           "precursor_true_tolerance", "precursor_true_units", "fragment_mass_tolerance",
                           "fragment_mass_units", "calibrate_mass", "allowed_missed_cleavage_1",
                           "num_enzyme_termini", "localize_delta_mass", "clip_nTerm_M"};
  for (const char* k : numeric)
    check(echo.count(k) && sameNumberList(mine.at(k), echo.at(k), ' '),
          std::string("MSFragger read ") + k + " = " + (echo.count(k) ? echo.at(k) : "?") + ", FASTag wrote " + mine.at(k));
  for (const char* k : {"isotope_error", "mass_offsets"})
    check(echo.count(k) && sameNumberList(mine.at(k), echo.at(k), '/'),
          std::string("MSFragger read ") + k + " = " + (echo.count(k) ? echo.at(k) : "?") + ", FASTag wrote " + mine.at(k));
  for (const char* k : {"database_name", "decoy_prefix", "search_enzyme_name_1", "search_enzyme_cut_1",
                        "search_enzyme_nocut_1", "search_enzyme_sense_1", "labile_search_mode", "fragment_ion_series"})
  {
    const std::string ek = alias.count(k) ? alias.at(k) : k;
    std::string got = echo.count(ek) ? echo.at(ek) : "?";
    std::string want = mine.at(k);
    for (std::string* s : {&got, &want})
      for (char& c : *s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    check(got == want, std::string("MSFragger read ") + ek + " = " + got + ", FASTag wrote " + want);
  }
  for (const auto& kv : mine)
  {
    if (kv.first.compare(0, 4, "add_") == 0)
    {
      // MSFragger echoes add_O and add_U with a trailing comment.
      std::string e = echo.count(kv.first) ? echo.at(kv.first) : "?";
      const auto h = e.find('#');
      if (h != std::string::npos) e = trim(e.substr(0, h));
      check(sameNumberList(kv.second, e, ' '), "MSFragger read " + kv.first + " = " + e + ", FASTag wrote " + kv.second);
    }
    if (kv.first.compare(0, 13, "variable_mod_") == 0)
    {
      std::istringstream a(kv.second), b(echo.count(kv.first) ? echo.at(kv.first) : std::string());
      double ma = 0, mb = 1e9;
      std::string sa, sb, na, nb;
      a >> ma >> sa >> na;
      b >> mb >> sb >> nb;
      check(std::fabs(ma - mb) < 1e-6 && sa == sb && na == nb,
            "MSFragger read " + kv.first + " = '" + (echo.count(kv.first) ? echo.at(kv.first) : "?") + "', FASTag wrote '" +
                kv.second + "'");
    }
  }
  check(echo.count("variable_mod_08") == 0, "no slot beyond the plan's in MSFragger's reading");
  // Each variable modification as MSFragger modelled it in the pepXML, against
  // the site OpenMS gives the modification.
  {
    std::vector<std::string> lines;
    std::istringstream is(pepxml_part);
    std::string l;
    while (std::getline(is, l))
      if (l.find("_modification ") != std::string::npos) lines.push_back(l);
    check(!lines.empty(), "pepXML modification elements in the echo fixture");
    for (const ResidueModification* m : p.variable)
    {
      const double dm = m->getDiffMonoMass();
      const auto ts = m->getTermSpecificity();
      const char o = m->getOrigin();
      const bool any = o == 'X';
      bool found = false;
      for (const std::string& x : lines)
      {
        if (attr(x, "variable") != "Y" || std::fabs(std::atof(attr(x, "massdiff").c_str()) - dm) > 1e-4) continue;
        const bool term_el = x.find("<terminal_modification") != std::string::npos;
        const std::string pterm = attr(x, "peptide_terminus"), prot = attr(x, "protein_terminus"),
                          terminus = attr(x, "terminus");
        bool ok = false;
        switch (ts)
        {
          case ResidueModification::ANYWHERE:
            ok = !term_el && attr(x, "aminoacid") == std::string(1, o) && pterm.empty();
            break;
          case ResidueModification::N_TERM:
          case ResidueModification::C_TERM:
          {
            const std::string t = ts == ResidueModification::N_TERM ? "n" : "c";
            ok = any ? term_el && prot == "N" && (terminus == "N" || terminus == "n") == (t == "n") &&
                           (terminus == "C" || terminus == "c") == (t == "c")
                     : !term_el && attr(x, "aminoacid") == std::string(1, o) && pterm == t;
            break;
          }
          case ResidueModification::PROTEIN_N_TERM:
          case ResidueModification::PROTEIN_C_TERM:
          {
            const bool n = ts == ResidueModification::PROTEIN_N_TERM;
            ok = any ? term_el && prot == "Y" && (terminus == "N" || terminus == "n") == n
                     : !term_el && attr(x, "aminoacid") == std::string(1, o) && pterm.empty() &&
                           prot == (n ? "n" : "c");  // pepXML: protein_terminus="n" on the residue
            break;
          }
          default: break;
        }
        if (ok) found = true;
      }
      check(found, "MSFragger modelled '" + m->getFullId() + "' on its site");
    }
    // The fixed CAM, as MSFragger reports it.
    bool cam = false;
    for (const std::string& x : lines)
      if (attr(x, "aminoacid") == "C" && attr(x, "variable") == "N" &&
          std::fabs(std::atof(attr(x, "massdiff").c_str()) - 57.021464) < 1e-4)
        cam = true;
    check(cam, "MSFragger applied Carbamidomethyl (C) as fixed");
  }

  // ---- refusals
  {
    SC::SearchPlan q = p;
    Keys k;
    q.missed_cleavages = 6;
    check(!SC::msfraggerKeys(q, k).empty(), "6 missed cleavages refused");
    q = p;
    q.isotope_errors = 4;
    check(!SC::msfraggerKeys(q, k).empty(), "isotope errors 4 refused");
    q = p;
    q.variable.assign(17, mod("Oxidation (M)"));
    check(!SC::msfraggerKeys(q, k).empty(), "17 variable modifications refused");
    q.variable.assign(16, mod("Oxidation (M)"));
    check(SC::msfraggerKeys(q, k).empty(), "16 variable modifications accepted");
    q = p;
    q.fixed = {mod("Gln->pyro-Glu (N-term Q)")};
    check(!SC::msfraggerKeys(q, k).empty(), "a fixed terminal modification on one residue refused");
    std::string err;
    check(SC::renderMSFragger(q, &err).empty() && !err.empty(), "renderMSFragger returns the error");
    // MSFragger 4.4.1 exits 1 on mass offsets with a Da precursor window
    // ("Could not find <delta> in the list"), true tolerance or not.
    q = p;
    q.precursor_ppm = false;
    q.precursor_tolerance = 3;
    check(!q.mass_offsets.empty(), "the golden plan has offsets");
    check(SC::msfraggerKeys(q, k).find("Da precursor window") != std::string::npos,
          "mass offsets with a Da precursor window refused");
    q.mass_offsets.clear();
    check(SC::msfraggerKeys(q, k).empty(), "a Da precursor window without offsets accepted");
    q = p;
    q.threads = -1;
    check(!SC::msfraggerKeys(q, k).empty(), "negative threads refused");
  }
  // ---- num_threads follows the plan's threads (FASTag's -threads)
  {
    SC::SearchPlan q = p;
    Keys k;
    check(p.threads == 0 && SC::msfraggerKeys(q, k).empty() && asMap(k).at("num_threads") == "0",
          "threads 0 (FASTag's default) -> num_threads 0");
    q.threads = 16;
    check(SC::msfraggerKeys(q, k).empty() && asMap(k).at("num_threads") == "16", "threads 16 -> num_threads 16");
  }
  // ---- calibrate_mass follows the plan (post-1.15: 2 under the msfragger defaults, else 0)
  {
    SC::SearchPlan q = p;
    Keys k;
    check(p.calibrate_mass == 0 && SC::msfraggerKeys(q, k).empty() && asMap(k).at("calibrate_mass") == "0",
          "a plan's default calibrate_mass is 0");
    q.calibrate_mass = SC::MSFRAGGER_DEFAULT_CALIBRATION;
    check(SC::msfraggerKeys(q, k).empty() && asMap(k).at("calibrate_mass") == "2", "calibrate_mass 2 written");
    q.calibrate_mass = 3;
    check(!SC::msfraggerKeys(q, k).empty(), "calibrate_mass 3 refused");
  }
  // ---- defaults: no offsets -> mass_offsets 0, localize_delta_mass 0; Da units
  {
    SC::SearchPlan q;
    q.database = "x.fasta";
    q.precursor_tolerance = 0.02;
    q.precursor_ppm = false;
    q.fragment_tolerance = 0.5;
    q.fragment_ppm = false;
    Keys k;
    check(SC::msfraggerKeys(q, k).empty(), "a plain plan renders");
    const auto m = asMap(k);
    check(m.at("mass_offsets") == "0" && m.at("localize_delta_mass") == "0" && m.at("isotope_error") == "0",
          "no offsets: mass_offsets 0, localize_delta_mass 0, isotope_error 0");
    check(m.at("precursor_mass_units") == "0" && m.at("precursor_true_units") == "0" &&
              m.at("fragment_mass_units") == "0" && m.at("precursor_mass_lower") == "-0.02" &&
              m.at("fragment_mass_tolerance") == "0.5",
          "Da units are 0 (MSFragger: 0 for Da, 1 for ppm)");
    check(m.at("add_C_cysteine") == "0.0", "the default file's CAM is reset without a fixed CAM");
    std::size_t slots = 0;
    for (const auto& kv : k) slots += kv.first.compare(0, 13, "variable_mod_") == 0;
    check(slots == 0, "no variable slot without variable modifications (the default file's two are not kept)");
    const std::string text = SC::renderMSFragger(q);
    check(text.find('\t') == std::string::npos, "no tab-separated inline comments");
    std::istringstream is(text);
    std::string l;
    bool comment_after_value = false;
    while (std::getline(is, l))
      if (!l.empty() && l[0] != '#' && l.find('#') != std::string::npos) comment_after_value = true;
    check(!comment_after_value, "no inline comments (MSFragger 4.4.1 reads them as values)");
  }
  // ---- 1.13 item 20: a -shortlist_protease rule reaches fragger.params;
  // the default plan (trypsin) keeps the 1.12/#18 enzyme keys.
  {
    const auto enzKeys = [](const SC::Enzyme& e) {
      SC::SearchPlan q = goldenPlan();
      q.enzyme = e;
      Keys k;
      const std::string err = SC::msfraggerKeys(q, k);
      check(err.empty(), "enzyme plan renders: " + err);
      return asMap(k);
    };
    const auto tryp = enzKeys(SC::Enzyme());
    check(tryp.at("search_enzyme_name_1") == "trypsin" && tryp.at("search_enzyme_cut_1") == "KR" &&
              tryp.at("search_enzyme_nocut_1") == "P" && tryp.at("search_enzyme_sense_1") == "C" &&
              tryp.at("num_enzyme_termini") == "2",
          "default enzyme: trypsin KR/P, C, fully specific");
    SC::Enzyme chymo;
    chymo.name = "Chymotrypsin";
    chymo.cut = "FWYL";
    chymo.nocut = "P";
    chymo.termini = 1;
    const auto ch = enzKeys(chymo);
    check(ch.at("search_enzyme_name_1") == "chymotrypsin" && ch.at("search_enzyme_cut_1") == "FWYL" &&
              ch.at("search_enzyme_nocut_1") == "P" && ch.at("search_enzyme_sense_1") == "C" &&
              ch.at("num_enzyme_termini") == "1",
          "semi-specific chymotrypsin: cut FWYL, nocut P, C, num_enzyme_termini 1");
    SC::Enzyme aspn;
    aspn.name = "Asp-N";
    aspn.cut = "D";
    aspn.nocut = "";
    aspn.c_terminal = false;
    const auto an = enzKeys(aspn);
    check(an.at("search_enzyme_name_1") == "asp-n" && an.at("search_enzyme_cut_1") == "D" &&
              an.at("search_enzyme_nocut_1").empty() && an.at("search_enzyme_sense_1") == "N" &&
              an.at("num_enzyme_termini") == "2",
          "Asp-N: cut D, no nocut, N-terminal sense");
    SC::Enzyme none;
    none.name = "unspecific";
    none.cut.clear();
    none.nocut.clear();
    const auto ns = enzKeys(none);
    check(ns.at("search_enzyme_name_1") == "nonspecific" && ns.at("search_enzyme_cut_1") == "@" &&
              ns.at("search_enzyme_nocut_1").empty() && ns.at("num_enzyme_termini") == "0",
          "unspecific: nonspecific, cut '@' (MSFragger ignores the block on an empty cut), num_enzyme_termini 0");
  }
  // ---- the reversed decoys of -fasta_out
  {
    const std::string db = "msfragger_config_test_db.fasta", out = "msfragger_config_test_out.fasta";
    std::ofstream(db) << ">P1 first protein\nMKLLVR\n>P2 second\nACDEFGHIK\n>P3 third\nWWPK\n";
    OpenMS::FASTAFile::FASTAEntry bg("B1", "background", "MSTV");
    const auto r = FASTag::Shortlist::writeReducedFasta(db, {true, false, true}, {bg}, out, "rev_");
    check(r.ok && r.entries == 3 && r.decoys == 3, "3 entries and 3 decoys written");
    std::vector<OpenMS::FASTAFile::FASTAEntry> e;
    OpenMS::FASTAFile().load(out, e);
    check(e.size() == 6, "6 entries in the target-decoy FASTA");
    if (e.size() == 6)
    {
      check(e[0].identifier == "P1" && e[1].identifier == "P3" && e[2].identifier == "B1", "targets first, database order, then background");
      check(e[3].identifier == "rev_P1" && e[3].sequence == "RVLLKM" && e[3].description == "first protein", "rev_P1 reversed");
      check(e[4].identifier == "rev_P3" && e[4].sequence == "KPWW", "rev_P3 reversed");
      check(e[5].identifier == "rev_B1" && e[5].sequence == "VTSM", "background decoy reversed");
    }
    const auto r2 = FASTag::Shortlist::writeReducedFasta(db, {true, false, true}, {bg}, out);
    check(r2.ok && r2.entries == 3 && r2.decoys == 0, "no prefix: no decoys");
    e.clear();
    OpenMS::FASTAFile().load(out, e);
    check(e.size() == 3, "no prefix: the targets only");
    std::remove(db.c_str());
    std::remove(out.c_str());
  }

  if (failures == 0) std::cout << "msfragger_config_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
