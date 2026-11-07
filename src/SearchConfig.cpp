// Search-engine configuration from a FASTag run (FASTag 1.12, items #5/#17).
// See SearchConfig.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "SearchConfig.h"

#include "NumFormat.h"
#include "OutputGuard.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/CONCEPT/Exception.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <limits>
#include <numeric>
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


// ---- #17: mass shifts as search-engine configuration ----------------------
namespace FASTag::SearchConfig
{
  namespace FD = FASTag::Digest;

  void RowEvidence::add(const RowEvidence& o)
  {
    spectra += o.spectra;
    substitution += o.substitution;
    localized += o.localized;
    site_counted += o.site_counted;
    with_c += o.with_c;
    for (const auto& [r, n] : o.sites) sites[r] += n;
  }

  bool siteSampleCounts(char residue, int score, int ties, int region_len, int min_ions)
  {
    return residue != 0 && ties == 1 && score > 0 && score >= min_ions && region_len > 1;
  }

  PeakEvidence peakEvidence(const FD::GapPeak& peak, const std::vector<RowEvidence>& rows)
  {
    PeakEvidence e;
    for (const std::size_t m : peak.members)
      if (m < rows.size()) e.add(rows[m]);
    return e;
  }

  bool parseShiftMode(const std::string& s, ShiftMode& m)
  {
    if (s == "none") m = ShiftMode::None;
    else if (s == "variable") m = ShiftMode::Variable;
    else if (s == "offsets") m = ShiftMode::Offsets;
    else if (s == "both") m = ShiftMode::Both;
    else return false;
    return true;
  }

  namespace
  {
    const ResidueModification* lookup(const std::string& name, const std::string& residue,
                                      ResidueModification::TermSpecificity ts)
    {
      try
      {
        return OpenMS::ModificationsDB::getInstance()->getModification(name, residue, ts);
      }
      catch (const OpenMS::Exception::BaseException&)
      {
        return nullptr;
      }
    }
    const ResidueModification* lookupId(const std::string& site)
    {
      try
      {
        return OpenMS::ModificationsDB::getInstance()->getModification(site);
      }
      catch (const OpenMS::Exception::BaseException&)
      {
        return nullptr;
      }
    }
    /// Where a modification sits, as the TSV's sites column writes it.
    std::string siteOf(const ResidueModification& m)
    {
      std::string t;
      switch (m.getTermSpecificity())
      {
        case ResidueModification::N_TERM: t = "N-term"; break;
        case ResidueModification::C_TERM: t = "C-term"; break;
        case ResidueModification::PROTEIN_N_TERM: t = "Protein N-term"; break;
        case ResidueModification::PROTEIN_C_TERM: t = "Protein C-term"; break;
        default: break;
      }
      const char o = m.getOrigin();
      if (o != 'X' && o != '\0') t += (t.empty() ? "" : " ") + std::string(1, o);
      return t;
    }
    double round4(double v) { return std::round(v * 1e4) / 1e4; }
    std::string f4(double v) { return fixed(v, 4); }
    bool isSilacLabel(const std::string& name)
    {
      return name == "Label:2H(4)" || name == "Label:13C(6)" || name == "Label:13C(6)15N(2)" || name == "Label:13C(6)15N(4)";
    }
    bool isCysAlkylation(const ResidueModification& m)
    {
      static const std::set<std::string> ids = {"Carbamidomethyl", "Propionamide", "Nethylmaleimide", "Methylthio",
                                                "Carboxymethyl"};
      return m.getOrigin() == 'C' && m.getTermSpecificity() == ResidueModification::ANYWHERE && ids.count(m.getId());
    }
    bool listed(const std::vector<const ResidueModification*>& v, const ResidueModification* m)
    {
      for (const ResidueModification* x : v)
        if (x == m || x->getFullId() == m->getFullId()) return true;
      return false;
    }
    /// The smallest value whose cumulative weight reaches @p q of the total
    /// (pairs: value, weight > 0; not empty).
    double weightedQuantile(std::vector<std::pair<double, double>> v, double q)
    {
      std::sort(v.begin(), v.end());
      double total = 0.0;
      for (const auto& x : v) total += x.second;
      double acc = 0.0;
      for (const auto& x : v)
      {
        acc += x.second;
        if (acc >= q * total) return x.first;
      }
      return v.back().first;
    }
  }

  ShiftOutcome shiftsToPlan(const FD::GapResult& gaps, const std::vector<PeakEvidence>& evidence,
                            const std::vector<FD::GapMod>& mods, const std::vector<FD::Combo>& combos,
                            const ShiftSettings& s, SearchPlan& plan)
  {
    ShiftOutcome out;
    // #3g's alkylation call decides the fixed Cys modification: a reagent
    // call becomes it (when the plan has none on C), before the gaps are read
    // against the fixed chemistry.
    const bool alk_call = !s.alkylation_call.empty();
    if (alk_call && s.alkylation_call != "none" && s.alkylation_call != "no_call")
    {
      const ResidueModification* fixed_c = nullptr;
      for (const ResidueModification* F : plan.fixed)
        if (F->getOrigin() == 'C' && F->getTermSpecificity() == ResidueModification::ANYWHERE) fixed_c = F;
      const ResidueModification* rm = lookup(s.alkylation_call, "C", ResidueModification::ANYWHERE);
      if (fixed_c && fixed_c->getId() != s.alkylation_call)
        out.warnings.push_back("the configuration's fixed " + fixed_c->getFullId() + " differs from the alkylation call " +
                               s.alkylation_call + "; the given fixed modification is kept");
      if (!rm)
        out.warnings.push_back("the alkylation call " + s.alkylation_call + " is not a Cys modification ModificationsDB knows");
      else if (!fixed_c)
      {
        plan.fixed.push_back(rm);
        ++out.fixed;
        out.info.push_back("the alkylation call " + s.alkylation_call + " is written as the fixed " + rm->getFullId());
      }
    }
    if (gaps.peaks.empty())
    {
      out.info.push_back("no mass-gap peak in the run; no mass shift is exported");
      return out;
    }
    const bool var_ok = s.mode == ShiftMode::Variable || s.mode == ShiftMode::Both;
    const bool off_ok = s.mode == ShiftMode::Offsets || s.mode == ShiftMode::Both;
    const bool comet = s.engine == "comet";
    const double tol = s.tol;
    const double c13 = OpenMS::Constants::C13C12_MASSDIFF_U;
    // The plan's fixed chemistry the gaps are relative to: terminal labels
    // and residue modifications.
    std::vector<const ResidueModification*> labels, fixed_res;
    for (const ResidueModification* m : plan.fixed)
    {
      if (m->getTermSpecificity() == ResidueModification::ANYWHERE && m->getOrigin() != 'X') fixed_res.push_back(m);
      else labels.push_back(m);
    }
    const auto names = [&](const std::vector<int>& c) {
      std::string x;
      for (int m : c) x += (x.empty() ? "" : " + ") + mods[static_cast<std::size_t>(m)].name;
      return x.empty() ? std::string("none") : x;
    };

    // Calibration: a gap peak's centroid carries the run's precursor mass
    // bias, a modification's mass does not. The bias is the spectra-weighted
    // median of centroid - mass over the peaks one modification explains, and
    // comes off every exported offset.
    {
      std::vector<std::pair<double, double>> err;
      for (const FD::GapPeak& pk : gaps.peaks)
        if (pk.explained_by.size() == 1 && pk.spectra > 0)
          err.emplace_back(pk.delta - mods[static_cast<std::size_t>(pk.explained_by.front())].mass,
                           static_cast<double>(pk.spectra));
      out.bias_peaks = err.size();
      out.residual = tol;
      if (!err.empty())
      {
        out.bias = weightedQuantile(err, 0.5);
        for (auto& e : err) e.first = std::fabs(e.first - out.bias);
        out.residual = weightedQuantile(err, 0.9);
      }
    }
    // A called SILAC channel is one unit: all its labels are variable
    // modifications, outside -shift_max_variable, or none of them. A partial
    // channel (the medium R-peptides searched, its K-peptides not) would bias
    // every channel comparison downstream.
    std::set<int> silac_set;               // mods indices of the channel's labels
    int silac_state = 0;                   // 0 not handled, 1 exported, -1 dropped
    std::string silac_why;
    if (var_ok && gaps.silac != "none")
    {
      std::vector<std::string> want;
      if (gaps.silac.find("Lys4/Arg6") != std::string::npos) want.insert(want.end(), {"Label:2H(4)", "Label:13C(6)"});
      if (gaps.silac.find("Lys8/Arg10") != std::string::npos)
        want.insert(want.end(), {"Label:13C(6)15N(2)", "Label:13C(6)15N(4)"});
      std::vector<const ResidueModification*> add;
      std::string missing;
      for (const std::string& w : want)
      {
        const ResidueModification* rm = nullptr;
        for (std::size_t m = 0; m < mods.size(); ++m)
          if (mods[m].name == w)
          {
            silac_set.insert(static_cast<int>(m));
            if (!rm) rm = lookupId(mods[m].site);
          }
        if (!rm) missing += (missing.empty() ? "" : ", ") + w;
        else if (!listed(plan.variable, rm) && !listed(plan.fixed, rm) && !listed(add, rm)) add.push_back(rm);
      }
      if (!want.empty())
      {
        if (!missing.empty())
          silac_why = "the modification list lacks " + missing;
        else if (comet && plan.variable.size() + add.size() > 15)
          silac_why = "Comet's 15 variable modification slots cannot hold the channel";
        if (silac_why.empty())
        {
          silac_state = 1;
          plan.variable.insert(plan.variable.end(), add.begin(), add.end());
          out.variable += add.size();
        }
        else
        {
          silac_state = -1;
          out.warnings.push_back("the " + gaps.silac + " call is not exported: " + silac_why +
                                 "; no label of the channel is searched");
        }
      }
    }

    out.decisions.resize(gaps.peaks.size());
    std::vector<std::size_t> order(gaps.peaks.size());
    std::iota(order.begin(), order.end(), std::size_t{0});
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
      const FD::GapPeak& x = gaps.peaks[a];
      const FD::GapPeak& y = gaps.peaks[b];
      if (x.spectra != y.spectra) return x.spectra > y.spectra;
      if (std::fabs(x.delta) != std::fabs(y.delta)) return std::fabs(x.delta) < std::fabs(y.delta);
      return x.delta < y.delta;
    });
    std::size_t n_var = 0, n_off = 0;
    for (const std::size_t i : order)
    {
      const FD::GapPeak& pk = gaps.peaks[i];
      const PeakEvidence ev = i < evidence.size() ? evidence[i] : PeakEvidence();
      ShiftDecision& D = out.decisions[i];
      D.peak = i + 1;
      D.delta = pk.delta;
      D.spectra = pk.spectra;
      D.explanation = names(pk.explained_by);
      D.mod_id = D.sites = "-";
      D.exported = std::numeric_limits<double>::quiet_NaN();
      D.substitution_share = ev.spectra ? static_cast<double>(ev.substitution) / static_cast<double>(ev.spectra) : 0.0;
      D.localized = ev.localized;
      const double d = pk.delta;

      // 0. precursor isotope error
      int iso = 0;
      for (int n = 1; n <= 3 && !iso; ++n)
      {
        const double di = std::fabs(d - n * c13);
        if (di > tol) continue;
        bool closer = true;
        for (const FD::GapMod& m : mods)
          if (std::fabs(d - m.mass) <= tol && std::fabs(d - m.mass) <= di) closer = false;
        if (closer) iso = n;
      }
      if (iso)
      {
        D.action = "skipped_isotope";
        D.reason = std::to_string(iso) + " x 13C spacing: a precursor isotope error";
        out.isotope_max = std::max(out.isotope_max, iso);
        continue;
      }
      // 1. fixed terminal labels
      std::vector<int> X = pk.explained_by;
      double base = d;
      std::string label_note;
      bool done = false;
      for (const ResidueModification* L : labels)
      {
        const double lm = L->getDiffMonoMass();
        if (std::fabs(d - lm) <= tol)
        {
          D.action = "expected_label";
          D.reason = "the fixed label " + L->getFullId();
          done = true;
        }
        else if (std::fabs(d + lm) <= tol)
        {
          D.action = "label_incomplete";
          D.reason = "minus the fixed label " + L->getFullId();
          out.warnings.push_back("mass-gap peak " + std::to_string(D.peak) + " at " + f4(d) + " Da (" +
                                 std::to_string(pk.spectra) + " spectra) is minus the fixed label " + L->getFullId() +
                                 ": the labelling looks incomplete");
          done = true;
        }
        if (done) break;
      }
      if (done) continue;
      for (const ResidueModification* L : labels)
      {
        const double lm = L->getDiffMonoMass();
        auto it = std::find_if(X.begin(), X.end(), [&](int m) {
          return std::fabs(mods[static_cast<std::size_t>(m)].mass - lm) <= tol;
        });
        if (it != X.end())
        {
          X.erase(it);
          base = d - lm;
        }
        else if (X.empty())
        {
          const auto ex = FD::explain(combos, mods, d - lm, tol);
          if (ex.empty()) continue;
          X = ex.front();
          base = d - lm;
        }
        else continue;
        label_note = "the fixed label " + L->getFullId() + " plus ";
        break;
      }

      // Classify: questionable, offset (substitution-dominated, combination,
      // unexplained), re-sited fixed modification, single modification.
      enum class Kind { Offset, Resite, Single } kind = Kind::Offset;
      const ResidueModification* fixed_hit = nullptr;
      for (const ResidueModification* F : fixed_res)
        if (std::fabs(base + F->getDiffMonoMass()) <= tol)
        {
          D.action = "fixed_mod_questionable";
          D.reason = "minus the fixed " + F->getFullId();
          out.warnings.push_back("mass-gap peak " + std::to_string(D.peak) + " at " + f4(d) + " Da (" +
                                 std::to_string(pk.spectra) + " spectra) is minus the fixed " + F->getFullId() +
                                 ": is that modification really complete?");
          done = true;
          break;
        }
      if (done) continue;
      std::string why;
      if (D.substitution_share > 0.5)
        why = "substitution share " + fixed(D.substitution_share, 2);
      else
      {
        for (const ResidueModification* F : fixed_res)
          if (std::fabs(base - F->getDiffMonoMass()) <= tol)
          {
            fixed_hit = F;
            break;
          }
        if (fixed_hit) kind = Kind::Resite;
        else if (X.size() == 1) kind = Kind::Single;
        else why = X.empty() ? "unexplained" : "combination";
      }

      // The modifications a variable export would add.
      std::vector<const ResidueModification*> entries;
      if (kind == Kind::Resite)
      {
        for (const auto& [res, ts] : std::vector<std::pair<std::string, ResidueModification::TermSpecificity>>{
                 {"K", ResidueModification::ANYWHERE}, {"H", ResidueModification::ANYWHERE}, {"", ResidueModification::N_TERM}})
        {
          if (!res.empty() && res[0] == fixed_hit->getOrigin()) continue;
          const ResidueModification* m = lookup(fixed_hit->getId(), res, ts);
          if (m && !listed(entries, m)) entries.push_back(m);
        }
        why = label_note + "the fixed " + fixed_hit->getFullId() + " again, on other sites";
        if (entries.empty())
        {
          kind = Kind::Offset;
          why = "the fixed " + fixed_hit->getFullId() + " again, on no other known site";
        }
      }
      else if (kind == Kind::Single)
      {
        const FD::GapMod& gm = mods[static_cast<std::size_t>(X.front())];
        const ResidueModification* rm = lookupId(gm.site);
        if (!rm)
        {
          kind = Kind::Offset;
          why = "ModificationsDB does not know " + gm.site;
        }
        else if (isSilacLabel(gm.name) && gaps.silac == "none")
        {
          D.action = "skipped_silac";
          D.reason = gm.name + " without a SILAC call";
          continue;
        }
        else if (silac_state != 0 && silac_set.count(X.front()))
        {
          D.mod_id = rm->getFullId();
          D.sites = siteOf(*rm);
          D.exported = rm->getDiffMonoMass();
          if (silac_state > 0)
          {
            D.action = "variable";
            D.reason = label_note + gm.name + ", a label of the called " + gaps.silac +
                       " channel, exported with the whole channel outside -shift_max_variable";
          }
          else
          {
            D.action = "dropped_cap";
            D.reason = "the " + gaps.silac + " channel is dropped as a whole: " + silac_why;
          }
          continue;
        }
        else
        {
          why = label_note + gm.name;
          bool fixed_c = false;
          for (const ResidueModification* F : plan.fixed) fixed_c = fixed_c || F->getOrigin() == 'C';
          // Dominance: the peak's C-containing samples against the run's.
          const bool dominant = isCysAlkylation(*rm) && !fixed_c && s.c_placements > 0 && 2 * ev.with_c >= s.c_placements;
          if (var_ok && dominant && alk_call)
          {
            D.action = "deferred_alkylation_call";
            D.mod_id = rm->getFullId();
            D.sites = siteOf(*rm);
            D.exported = rm->getDiffMonoMass();
            D.reason = std::to_string(ev.with_c) + " of " + std::to_string(s.c_placements) +
                       " C-containing placements suggest a fixed " + rm->getFullId() + "; the alkylation call (" +
                       s.alkylation_call + ") decides the Cys modification";
            out.warnings.push_back("mass-gap peak " + std::to_string(D.peak) + " (" + rm->getFullId() + ", " +
                                   std::to_string(ev.with_c) + " of " + std::to_string(s.c_placements) +
                                   " C-containing placements) suggests a fixed " + rm->getFullId() +
                                   ", but the alkylation call is " + s.alkylation_call + "; it is not exported");
            continue;
          }
          if (var_ok && dominant)
          {
            plan.fixed.push_back(rm);
            ++out.fixed;
            D.action = "fixed";
            D.mod_id = rm->getFullId();
            D.sites = siteOf(*rm);
            D.exported = rm->getDiffMonoMass();
            D.reason = std::to_string(ev.with_c) + " of " + std::to_string(s.c_placements) +
                       " C-containing placements: the run looks alkylated";
            out.warnings.push_back("mass-gap peak " + std::to_string(D.peak) + " (" + rm->getFullId() + ", " +
                                   std::to_string(ev.with_c) + " of " + std::to_string(s.c_placements) +
                                   " C-containing placements) suggests a fixed " + rm->getFullId() +
                                   "; it is written to -search_config_out as a fixed modification");
            continue;
          }
          if (listed(plan.variable, rm) || listed(plan.fixed, rm))
          {
            D.action = "already_searched";
            D.mod_id = rm->getFullId();
            D.sites = siteOf(*rm);
            D.exported = rm->getDiffMonoMass();
            D.reason = "the plan searches " + rm->getFullId() + " already";
            continue;
          }
          entries.push_back(rm);
          if (s.expand_sites && ev.site_counted > 0)
            for (const auto& [res, n] : ev.sites)
            {
              if (res == rm->getOrigin() || n < s.site_min_count ||
                  static_cast<double>(n) < s.site_min_share * static_cast<double>(ev.site_counted))
                continue;
              const ResidueModification* m = lookup(rm->getId(), std::string(1, res), ResidueModification::ANYWHERE);
              if (m && !listed(entries, m)) entries.push_back(m);
            }
        }
      }

      if (kind != Kind::Offset && var_ok)
      {
        std::vector<const ResidueModification*> add;
        for (const ResidueModification* m : entries)
          if (!listed(plan.variable, m)) add.push_back(m);
        std::string ids, sites;
        for (const ResidueModification* m : entries)
        {
          ids += (ids.empty() ? "" : ";") + m->getFullId();
          sites += (sites.empty() ? "" : ",") + siteOf(*m);
        }
        D.mod_id = ids;
        D.sites = sites;
        D.exported = entries.front()->getDiffMonoMass();
        if (n_var >= s.max_variable)
        {
          D.action = "dropped_cap";
          D.reason = "-shift_max_variable " + std::to_string(s.max_variable) + " reached (" + why + ")";
        }
        else if (comet && plan.variable.size() + add.size() > 15)
        {
          D.action = "dropped_cap";
          D.reason = "Comet's 15 variable modification slots are full (" + why + ")";
        }
        else
        {
          plan.variable.insert(plan.variable.end(), add.begin(), add.end());
          out.variable += add.size();
          ++n_var;
          D.action = "variable";
          D.reason = why;
        }
        continue;
      }
      // Offsets (rule 4, or rules 2 and 3 under -search_shifts offsets).
      if (!off_ok)
      {
        D.action = "dropped_mode";
        D.reason = (why.empty() ? std::string("an offset") : why) + "; -search_shifts variable exports no offsets";
        continue;
      }
      if (silac_state > 0 && why == "combination" && X.size() >= 2 &&
          std::all_of(X.begin(), X.end(), [&](int m) { return silac_set.count(m) > 0; }))
      {
        D.action = "already_searched";
        D.reason = "a combination of the exported " + gaps.silac + " labels: the variable labels search it";
        continue;
      }
      const double value = round4(base - out.bias);
      D.exported = value;
      const std::string calib = out.bias_peaks ? "; centroid " + f4(base) + " minus the calibration bias " + f4(out.bias)
                                               : std::string();
      if (!comet)
      {
        D.action = "dropped_engine";
        D.reason = "Sage has no mass offsets (" + why + ")";
        continue;
      }
      if (value < 0)
      {
        D.action = "dropped_engine";
        D.reason = "a negative offset: Comet's mass_offsets are kept non-negative (" + why + ")";
        continue;
      }
      if (std::find(plan.mass_offsets.begin(), plan.mass_offsets.end(), value) != plan.mass_offsets.end())
      {
        D.action = "already_searched";
        D.reason = "the offset " + f4(value) + " is in the plan already";
        continue;
      }
      if (n_off >= s.max_offsets)
      {
        D.action = "dropped_cap";
        D.reason = "-shift_max_offsets " + std::to_string(s.max_offsets) + " reached (" + why + ")";
        continue;
      }
      plan.mass_offsets.push_back(value);
      ++n_off;
      ++out.offsets;
      D.action = "offset";
      D.reason = (why.empty() ? label_note + "an offset" : label_note + why) + calib;
    }
    if (out.offsets > 0)
    {
      // An offset is known to the residual (or, uncorrected, to the window);
      // Comet's precursor window must hold that.
      const double ptol = plan.precursor_ppm ? plan.precursor_tolerance * 1e-3 : plan.precursor_tolerance;
      if (out.residual > ptol)
        out.warnings.push_back("the exported mass offsets are known to +/- " + f4(out.residual) + " Da (" +
                               (out.bias_peaks ? std::to_string(out.bias_peaks) + " single-modification peaks after the "
                                                 "calibration bias " + f4(out.bias) + " Da"
                                               : std::string("no single-modification peak to calibrate on: the gap window")) +
                               "), more than the precursor tolerance of " + f4(ptol) +
                               " Da (at 1000 Da): Comet can miss the shifted peptides; widen "
                               "-search_precursor_tolerance");
    }
    if (out.isotope_max > plan.isotope_errors)
    {
      out.info.push_back("isotope-spaced gap peaks: the configuration searches precursor isotope errors 0.." +
                         std::to_string(out.isotope_max));
      plan.isotope_errors = out.isotope_max;
    }
    return out;
  }

  bool writeShiftDecisions(const std::string& path, const std::vector<std::string>& header,
                           const std::vector<ShiftDecision>& decisions, std::string* err)
  {
    const auto field = [](std::string v) {
      for (char& c : v)
        if (c == '\t' || c == '\n' || c == '\r') c = ' ';
      return v;
    };
    std::string buf;
    for (const std::string& h : header) buf += "# " + field(h) + "\n";
    buf += "peak\tdelta\tspectra\texplanation\taction\tmod_id\tsites\texported\tsubstitution_share\tlocalized\treason\n";
    for (const ShiftDecision& d : decisions)
    {
      appendNum(buf, static_cast<std::uint64_t>(d.peak));
      buf += '\t' + fixed(d.delta, 4) + '\t';
      appendNum(buf, d.spectra);
      buf += '\t' + field(d.explanation) + '\t' + d.action + '\t' + field(d.mod_id) + '\t' + field(d.sites) + '\t' +
             (std::isnan(d.exported) ? std::string("-") : fixed(d.exported, 4)) + '\t' + fixed(d.substitution_share, 4) + '\t';
      appendNum(buf, d.localized);
      buf += '\t' + field(d.reason.empty() ? std::string("-") : d.reason) + '\n';
    }
    FASTag::PartFile pf(path);
    std::ofstream os;
    if (!pf.open(os, std::ios::out | std::ios::binary))
    {
      if (err) *err = pf.error();
      return false;
    }
    os << buf;
    os.close();
    if (os.fail())
    {
      if (err) *err = "write failed (disk full?)";
      return false;
    }
    if (!pf.commit())
    {
      if (err) *err = pf.error();
      return false;
    }
    return true;
  }
}
