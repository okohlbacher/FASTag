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

  if (failures)
  {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "search_config_test: all checks passed\n";
  return 0;
}
