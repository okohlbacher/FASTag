// Search-engine configuration from a FASTag run (FASTag 1.12, items #5/#17).
// See SearchConfig.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "SearchConfig.h"

#include "NumFormat.h"

#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <sstream>

using OpenMS::ResidueModification;

namespace FASTag::SearchConfig
{
  namespace
  {
    constexpr int kCometVariableSlots = 15;

    /// Comet's residue mass keys, in the order `comet -p` writes them.
    const std::vector<std::pair<char, const char*>>& cometResidueKeys()
    {
      static const std::vector<std::pair<char, const char*>> keys = {
          {'G', "add_G_glycine"},         {'A', "add_A_alanine"},       {'S', "add_S_serine"},
          {'P', "add_P_proline"},         {'V', "add_V_valine"},        {'T', "add_T_threonine"},
          {'C', "add_C_cysteine"},        {'L', "add_L_leucine"},       {'I', "add_I_isoleucine"},
          {'N', "add_N_asparagine"},      {'D', "add_D_aspartic_acid"}, {'Q', "add_Q_glutamine"},
          {'K', "add_K_lysine"},          {'E', "add_E_glutamic_acid"}, {'M', "add_M_methionine"},
          {'H', "add_H_histidine"},       {'F', "add_F_phenylalanine"}, {'U', "add_U_selenocysteine"},
          {'R', "add_R_arginine"},        {'Y', "add_Y_tyrosine"},      {'W', "add_W_tryptophan"},
          {'O', "add_O_pyrrolysine"},     {'B', "add_B_user_amino_acid"}, {'J', "add_J_user_amino_acid"},
          {'X', "add_X_user_amino_acid"}, {'Z', "add_Z_user_amino_acid"}};
      return keys;
    }

    std::string shortest(double v)
    {
      std::string s;
      appendShortest(s, v);
      return s;
    }
    std::string fixed(double v, int prec)
    {
      std::string s;
      appendNum(s, v, std::chars_format::fixed, prec);
      if (s == "-0.000000" || s == "-0.0000") s.erase(0, 1);
      return s;
    }
    std::string jsonString(const std::string& v)
    {
      std::string out = "\"";
      for (char c : v)
      {
        if (c == '"' || c == '\\') out += '\\';
        if (c == '\n') { out += "\\n"; continue; }
        if (c == '\t') { out += "\\t"; continue; }
        out += c;
      }
      return out + "\"";
    }
    std::string trim(const std::string& s)
    {
      const auto b = s.find_first_not_of(" \t\r");
      if (b == std::string::npos) return std::string();
      const auto e = s.find_last_not_of(" \t\r");
      return s.substr(b, e - b + 1);
    }
  }

  std::string decoyPrefix(const SearchPlan& p, const std::string& engine)
  {
    if (!p.decoy_prefix.empty()) return p.decoy_prefix;
    return engine == "comet" ? "DECOY_" : "rev_";
  }

  std::string sageModKey(const ResidueModification& mod)
  {
    std::string key;
    switch (mod.getTermSpecificity())
    {
      case ResidueModification::N_TERM: key = "^"; break;
      case ResidueModification::C_TERM: key = "$"; break;
      case ResidueModification::PROTEIN_N_TERM: key = "["; break;
      case ResidueModification::PROTEIN_C_TERM: key = "]"; break;
      default: break;
    }
    const char o = mod.getOrigin();
    if (o != 'X' && o != '\0') key += o;
    return key;
  }

  std::string renderSage(const SearchPlan& p)
  {
    // Static mods on one key add up; variable mods on one key form a list,
    // both in first-appearance order.
    std::vector<std::pair<std::string, double>> stat;
    for (const ResidueModification* m : p.fixed)
    {
      const std::string k = sageModKey(*m);
      auto it = std::find_if(stat.begin(), stat.end(), [&](const auto& e) { return e.first == k; });
      if (it == stat.end()) stat.emplace_back(k, m->getDiffMonoMass());
      else it->second += m->getDiffMonoMass();
    }
    std::vector<std::pair<std::string, std::vector<double>>> var;
    for (const ResidueModification* m : p.variable)
    {
      const std::string k = sageModKey(*m);
      auto it = std::find_if(var.begin(), var.end(), [&](const auto& e) { return e.first == k; });
      if (it == var.end()) var.push_back({k, {m->getDiffMonoMass()}});
      else it->second.push_back(m->getDiffMonoMass());
    }
    const auto tol = [](double t, bool ppm) {
      return std::string("{\n    \"") + (ppm ? "ppm" : "da") + "\": [" + shortest(-t) + ", " + shortest(t) + "]\n  }";
    };
    std::ostringstream os;
    os << "{\n"
       << "  \"database\": {\n"
       << "    \"bucket_size\": 8192,\n"
       << "    \"enzyme\": {\n"
       << "      \"missed_cleavages\": " << p.missed_cleavages << ",\n"
       << "      \"min_len\": 5,\n"
       << "      \"max_len\": 50,\n"
       << "      \"cleave_at\": \"KR\",\n"
       << "      \"restrict\": \"P\",\n"
       << "      \"c_terminal\": true\n"
       << "    },\n"
       << "    \"fragment_min_mz\": 150.0,\n"
       << "    \"fragment_max_mz\": 2000.0,\n"
       << "    \"peptide_min_mass\": 500.0,\n"
       << "    \"peptide_max_mass\": 5000.0,\n"
       << "    \"ion_kinds\": [\"b\", \"y\"],\n"
       << "    \"min_ion_index\": 2,\n"
       << "    \"static_mods\": {";
    for (std::size_t i = 0; i < stat.size(); ++i)
      os << (i ? ",\n" : "\n") << "      " << jsonString(stat[i].first) << ": " << fixed(stat[i].second, 6);
    os << (stat.empty() ? "},\n" : "\n    },\n") << "    \"variable_mods\": {";
    for (std::size_t i = 0; i < var.size(); ++i)
    {
      os << (i ? ",\n" : "\n") << "      " << jsonString(var[i].first) << ": [";
      for (std::size_t j = 0; j < var[i].second.size(); ++j) os << (j ? ", " : "") << fixed(var[i].second[j], 6);
      os << "]";
    }
    os << (var.empty() ? "},\n" : "\n    },\n")
       << "    \"max_variable_mods\": 2,\n"
       << "    \"decoy_tag\": " << jsonString(decoyPrefix(p, "sage")) << ",\n"
       << "    \"generate_decoys\": true,\n"
       << "    \"fasta\": " << jsonString(p.database) << "\n"
       << "  },\n"
       << "  \"precursor_tol\": " << tol(p.precursor_tolerance, p.precursor_ppm) << ",\n"
       << "  \"fragment_tol\": " << tol(p.fragment_tolerance, p.fragment_ppm) << ",\n"
       << "  \"isotope_errors\": [0, " << std::max(0, p.isotope_errors) << "],\n"
       << "  \"deisotope\": false,\n"
       << "  \"chimera\": false,\n"
       << "  \"wide_window\": false,\n"
       << "  \"predict_rt\": false,\n"
       << "  \"min_peaks\": 15,\n"
       << "  \"max_peaks\": 150,\n"
       << "  \"min_matched_peaks\": 4,\n"
       << "  \"report_psms\": 1,\n"
       << "  \"mzml_paths\": [" << jsonString(p.spectra) << "]\n"
       << "}\n";
    return os.str();
  }

  CometBins cometFragmentBins(double tolerance, bool ppm)
  {
    CometBins b;
    const double da = ppm ? tolerance * 1000.0 * 1e-6 : tolerance;
    if (ppm || tolerance <= 0.1)
    {
      b.tol = std::max(0.01, 2.0 * da);
      b.offset = 0.0;
      b.theoretical = 0;
    }
    return b;
  }

  std::string cometKeys(const SearchPlan& p, std::vector<std::pair<std::string, std::string>>& keys)
  {
    keys.clear();
    if (p.missed_cleavages > 5) return "Comet allows at most 5 missed cleavages (allowed_missed_cleavage)";
    if (p.isotope_errors < 0 || p.isotope_errors > 3) return "Comet's isotope_error covers at most 0..3";
    if (static_cast<int>(p.variable.size()) > kCometVariableSlots)
      return "Comet has " + std::to_string(kCometVariableSlots) + " variable modification slots";
    keys.emplace_back("database_name", p.database);
    keys.emplace_back("decoy_search", "1");
    keys.emplace_back("decoy_prefix", decoyPrefix(p, "comet"));
    keys.emplace_back("peptide_mass_tolerance_upper", shortest(p.precursor_tolerance));
    keys.emplace_back("peptide_mass_tolerance_lower", shortest(-p.precursor_tolerance));
    keys.emplace_back("peptide_mass_units", p.precursor_ppm ? "2" : "0");
    keys.emplace_back("isotope_error", std::to_string(p.isotope_errors));
    keys.emplace_back("search_enzyme_number", "1");
    keys.emplace_back("search_enzyme2_number", "0");
    keys.emplace_back("sample_enzyme_number", "1");
    keys.emplace_back("num_enzyme_termini", "2");
    keys.emplace_back("allowed_missed_cleavage", std::to_string(p.missed_cleavages));
    for (int slot = 1; slot <= kCometVariableSlots; ++slot)
    {
      std::string name = "variable_mod";
      if (slot < 10) name += '0';
      name += std::to_string(slot);
      std::string value = "0.0 X 0 3 -1 0 0 0.0";
      if (slot <= static_cast<int>(p.variable.size()))
      {
        // CometModification.cpp: terminus encoding of a variable mod.
        const ResidueModification& m = *p.variable[static_cast<std::size_t>(slot - 1)];
        std::string residues(1, m.getOrigin());
        int term_distance = -1, nc_term = 0;
        switch (m.getTermSpecificity())
        {
          case ResidueModification::C_TERM:
            if (m.getOrigin() == 'X') residues = "c";
            term_distance = 0; nc_term = 3; break;
          case ResidueModification::N_TERM:
            if (m.getOrigin() == 'X') residues = "n";
            term_distance = 0; nc_term = 2; break;
          case ResidueModification::PROTEIN_N_TERM:
            if (m.getOrigin() == 'X') residues = "n";
            term_distance = 0; nc_term = 0; break;
          case ResidueModification::PROTEIN_C_TERM:
            if (m.getOrigin() == 'X') residues = "c";
            term_distance = 0; nc_term = 1; break;
          default: break;
        }
        value = fixed(m.getDiffMonoMass(), 6) + " " + residues + " 0 3 " + std::to_string(term_distance) + " " +
                std::to_string(nc_term) + " 0 0.0";
      }
      keys.emplace_back(name, value);
    }
    const CometBins bins = cometFragmentBins(p.fragment_tolerance, p.fragment_ppm);
    keys.emplace_back("fragment_bin_tol", shortest(bins.tol));
    keys.emplace_back("fragment_bin_offset", shortest(bins.offset));
    keys.emplace_back("theoretical_fragment_ions", std::to_string(bins.theoretical));
    std::string offsets;
    if (!p.mass_offsets.empty())
    {
      offsets = "0.0";
      for (double o : p.mass_offsets)
        if (o != 0.0) offsets += " " + fixed(o, 4);
    }
    keys.emplace_back("mass_offsets", offsets);
    // Fixed mods: every add_* key is written, 0.0 unless the plan sets it, so
    // Comet's implicit Carbamidomethyl and a template's chemistry are reset.
    std::map<std::string, double> add;
    for (const ResidueModification* m : p.fixed)
    {
      const auto ts = m->getTermSpecificity();
      const char o = m->getOrigin();
      std::string key;
      if (ts == ResidueModification::ANYWHERE && o != 'X')
      {
        for (const auto& rk : cometResidueKeys())
          if (rk.first == o) key = rk.second;
      }
      else if (o == 'X' || o == '\0')
      {
        if (ts == ResidueModification::N_TERM) key = "add_Nterm_peptide";
        else if (ts == ResidueModification::C_TERM) key = "add_Cterm_peptide";
        else if (ts == ResidueModification::PROTEIN_N_TERM) key = "add_Nterm_protein";
        else if (ts == ResidueModification::PROTEIN_C_TERM) key = "add_Cterm_protein";
      }
      if (key.empty())
        return "Comet cannot apply '" + m->getFullId() + "' as a fixed modification (a terminal mod on one residue)";
      add[key] += m->getDiffMonoMass();
    }
    const auto addv = [&](const char* k) {
      const auto it = add.find(k);
      return it == add.end() ? std::string("0.0") : fixed(it->second, 6);
    };
    for (const char* k : {"add_Cterm_peptide", "add_Nterm_peptide", "add_Cterm_protein", "add_Nterm_protein"})
      keys.emplace_back(k, addv(k));
    for (const auto& rk : cometResidueKeys()) keys.emplace_back(rk.second, addv(rk.second));
    return std::string();
  }

  std::string renderComet(const SearchPlan& p, std::string* err)
  {
    std::vector<std::pair<std::string, std::string>> keys;
    const std::string e = cometKeys(p, keys);
    if (!e.empty())
    {
      if (err) *err = e;
      return std::string();
    }
    std::ostringstream os;
    os << "# Comet parameters written by FASTag " << p.fastag_version << " (-search_config_out).\n"
       << "# A FRAGMENT, not a complete comet.params: merge it into the defaults of `comet -p`\n"
       << "# by passing that file as -search_config_template. Database search-space reduction\n"
       << "# from tag placements, not an identification and not FDR-controlled.\n"
       << "# spectra: " << p.spectra << "\n";
    for (const auto& kv : keys) os << kv.first << " = " << kv.second << "\n";
    return os.str();
  }

  bool cometManagedFamily(const std::string& key)
  {
    if (key.compare(0, 4, "add_") == 0) return true;
    return key.size() == 14 && key.compare(0, 12, "variable_mod") == 0 && std::isdigit(static_cast<unsigned char>(key[12])) &&
           std::isdigit(static_cast<unsigned char>(key[13]));
  }

  MergeResult mergeKeyValueTemplate(const std::string& tmpl,
                                    const std::vector<std::pair<std::string, std::string>>& keys_in)
  {
    MergeResult r;
    std::vector<std::string> lines;
    {
      std::istringstream is(tmpl);
      std::string l;
      while (std::getline(is, l))
      {
        if (!l.empty() && l.back() == '\r') l.pop_back();
        lines.push_back(l);
      }
    }
    // The enzyme table: "<n>.  <name>  <sense>  <cut>  <no cut>".
    std::size_t table = lines.size();
    for (std::size_t i = 0; i < lines.size(); ++i)
      if (trim(lines[i]) == "[COMET_ENZYME_INFO]") { table = i; break; }
    if (table == lines.size())
    {
      r.error = "the template has no [COMET_ENZYME_INFO] section (not a comet.params file?)";
      return r;
    }
    std::string trypsin;
    for (std::size_t i = table + 1; i < lines.size() && trypsin.empty(); ++i)
    {
      std::istringstream ls(lines[i]);
      std::string num, name, sense, cut, nocut;
      if (!(ls >> num >> name >> sense >> cut >> nocut)) continue;
      if (num.empty() || num.back() != '.') continue;
      std::string c = cut;
      std::sort(c.begin(), c.end());
      if ((sense == "1" || sense == "1.") && c == "KR" && nocut == "P") trypsin = num.substr(0, num.size() - 1);
    }
    if (trypsin.empty())
    {
      r.error = "the template's [COMET_ENZYME_INFO] table has no trypsin entry (cut KR, not before P); "
                "FASTag's placements are tryptic";
      return r;
    }
    std::vector<std::pair<std::string, std::string>> keys = keys_in;
    for (auto& kv : keys)
      if (kv.first == "search_enzyme_number" || kv.first == "sample_enzyme_number") kv.second = trypsin;
    std::map<std::string, std::size_t> index;
    for (std::size_t i = 0; i < keys.size(); ++i) index.emplace(keys[i].first, i);
    std::set<std::string> written;

    std::ostringstream os;
    const auto put = [&](const std::string& k, const std::string& v, const std::string& comment) {
      os << k << " = " << v;
      if (!comment.empty()) os << "    " << comment;
      os << "\n";
    };
    for (std::size_t i = 0; i < lines.size(); ++i)
    {
      const std::string& l = lines[i];
      if (i == table)
      {
        for (const auto& kv : keys)
          if (!written.count(kv.first)) put(kv.first, kv.second, std::string());
        for (; i < lines.size(); ++i) os << lines[i] << "\n";
        break;
      }
      const std::string t = trim(l);
      const auto eq = l.find('=');
      if (t.empty() || t[0] == '#' || eq == std::string::npos)
      {
        os << l << "\n";
        continue;
      }
      const std::string key = trim(l.substr(0, eq));
      std::string rest = l.substr(eq + 1);
      const auto hash = rest.find('#');
      const std::string comment = hash == std::string::npos ? std::string() : trim(rest.substr(hash));
      const auto it = index.find(key);
      if (it != index.end())
      {
        if (key == "search_enzyme_number")
        {
          const std::string old = trim(hash == std::string::npos ? rest : rest.substr(0, hash));
          if (old != trypsin)
            r.warnings.push_back("the template's search_enzyme_number " + old + " is not trypsin; set to " + trypsin);
        }
        if (written.insert(key).second) put(key, keys[it->second].second, comment);
        continue;  // a repeated managed line is dropped
      }
      if (cometManagedFamily(key)) continue;  // a slot or residue key the plan does not set
      os << l << "\n";
    }
    r.text = os.str();
    return r;
  }
}
