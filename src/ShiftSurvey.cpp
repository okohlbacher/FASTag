// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "ShiftSurvey.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/SYSTEM/File.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <set>
#include <tuple>

using namespace OpenMS;

namespace FASTag
{
  namespace ShiftSurvey
  {
    bool siteOf(const Reconciliation& r, Site& out)
    {
      if (r.loc_pos < 0 || r.loc_pos >= static_cast<int>(r.peptide.size())) return false;
      if (r.loc_alternatives > 0 && r.loc_evidence < 1) return false;
      out = Site();
      out.residue = r.peptide[static_cast<size_t>(r.loc_pos)];
      const int last = static_cast<int>(r.peptide.size()) - 1;
      if (!r.nterm_match && r.loc_pos == 0)
      {
        out.kind = 'N';
        out.protein_term = r.protein_nterm;
      }
      else if (r.nterm_match && !r.cterm_match && r.loc_pos == last)
      {
        out.kind = 'C';
        out.protein_term = r.protein_cterm;
      }
      return true;
    }

    std::string siteKey(const Site& s)
    {
      if (s.kind == 'R') return std::string(1, s.residue);
      std::string k = s.protein_term ? "Protein " : "";
      k += s.kind == 'N' ? "N-term|" : "C-term|";
      k += s.residue;
      return k;
    }

    bool parseSiteKey(const std::string& key, Site& out)
    {
      out = Site();
      if (key.size() == 1) { out.kind = 'R'; out.residue = key[0]; return true; }
      std::string k = key;
      if (k.rfind("Protein ", 0) == 0) { out.protein_term = true; k = k.substr(8); }
      if (k.size() != 8 || k[6] != '|') return false;
      if (k.compare(0, 6, "N-term") == 0) out.kind = 'N';
      else if (k.compare(0, 6, "C-term") == 0) out.kind = 'C';
      else return false;
      out.residue = k[7];
      return true;
    }

    std::vector<Entry> unimodEntries()
    {
      std::vector<Entry> out;
      const ModificationsDB* db = ModificationsDB::getInstance();
      const Size n = db->getNumberOfModifications();
      for (Size i = 0; i < n; ++i)
      {
        const ResidueModification* m = db->getModification(i);
        if (!m || m->getUniModRecordId() <= 0) continue;
        const double mass = m->getDiffMonoMass();
        if (!std::isfinite(mass) || std::fabs(mass) < 1e-9) continue;
        Entry e;
        e.acc = "UNIMOD:" + std::to_string(m->getUniModRecordId());
        e.name = m->getId();
        e.origin = m->getOrigin();
        e.mass = mass;
        switch (m->getTermSpecificity())
        {
          case ResidueModification::N_TERM: e.term = Term::N_TERM; break;
          case ResidueModification::C_TERM: e.term = Term::C_TERM; break;
          case ResidueModification::PROTEIN_N_TERM: e.term = Term::PROTEIN_N_TERM; break;
          case ResidueModification::PROTEIN_C_TERM: e.term = Term::PROTEIN_C_TERM; break;
          default: e.term = Term::ANYWHERE; break;
        }
        if (e.term == Term::ANYWHERE && (e.origin == 'X' || e.origin == '\0')) continue;  // no site
        out.push_back(std::move(e));
      }
      return out;
    }

    namespace
    {
      std::string trim(const std::string& s)
      {
        const size_t a = s.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) return std::string();
        const size_t b = s.find_last_not_of(" \t\r\n");
        return s.substr(a, b - a + 1);
      }
      /// The quoted value of `Key: "value"` (property_value / xref form), or the bare rest.
      std::string quoted(const std::string& rest)
      {
        const size_t a = rest.find('"');
        if (a == std::string::npos) return trim(rest);
        const size_t b = rest.find('"', a + 1);
        return b == std::string::npos ? rest.substr(a + 1) : rest.substr(a + 1, b - a - 1);
      }
      int unimodIn(const std::string& s)
      {
        for (const char* tag : {"UniMod:", "Unimod:", "UNIMOD:"})
        {
          const size_t p = s.find(tag);
          if (p != std::string::npos) return std::atoi(s.c_str() + p + 7);
        }
        return 0;
      }
      struct Term_
      {
        std::string id, name, origin, termspec;
        double mass = 0.0;
        bool has_mass = false, obsolete = false;
        int unimod = 0;
      };
      void keep(const Term_& t, std::vector<Entry>& out)
      {
        if (t.id.rfind("MOD:", 0) != 0 || t.obsolete || !t.has_mass) return;
        if (!std::isfinite(t.mass) || std::fabs(t.mass) < 1e-9) return;
        if (t.origin.size() != 1 || !std::isalpha(static_cast<unsigned char>(t.origin[0]))) return;
        Entry e;
        e.acc = t.id;
        e.name = t.name;
        e.origin = static_cast<char>(std::toupper(static_cast<unsigned char>(t.origin[0])));
        e.mass = t.mass;
        e.unimod = t.unimod;
        if (t.termspec == "N-term") e.term = Term::N_TERM;
        else if (t.termspec == "C-term") e.term = Term::C_TERM;
        else e.term = Term::ANYWHERE;
        if (e.term == Term::ANYWHERE && e.origin == 'X') return;  // no site
        out.push_back(std::move(e));
      }
    }

    std::vector<Entry> psimodEntries(const std::string& path, std::string* error)
    {
      std::vector<Entry> out;
      std::string resolved = path;
      try
      {
        if (!File::exists(resolved)) resolved = File::find(path);
      }
      catch (...)
      {
        if (error) *error = "cannot find '" + path + "'";
        return out;
      }
      std::ifstream in(resolved);
      if (!in)
      {
        if (error) *error = "cannot read '" + resolved + "'";
        return out;
      }
      Term_ t;
      bool in_term = false;
      std::string line;
      while (std::getline(in, line))
      {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty() && line[0] == '[')
        {
          if (in_term) keep(t, out);
          t = Term_();
          in_term = line == "[Term]";
          continue;
        }
        if (!in_term || line.empty() || line[0] == '!' || line[0] == '#') continue;
        const size_t c = line.find(':');
        if (c == std::string::npos) continue;
        const std::string key = line.substr(0, c);
        std::string rest = trim(line.substr(c + 1));
        if (key == "id") t.id = rest;
        else if (key == "name") t.name = rest;
        else if (key == "is_obsolete") t.obsolete = rest == "true";
        else if (key == "def")
        {
          // The Unimod cross-reference sits in the def's source list,
          // [UniMod:35] or [PubMed:..., UniMod:23 "site"].
          const size_t br = rest.rfind('[');
          if (br != std::string::npos && !t.unimod) t.unimod = unimodIn(rest.substr(br));
        }
        else if (key == "property_value" || key == "xref")
        {
          const size_t c2 = rest.find(':');
          if (c2 == std::string::npos) continue;
          const std::string pk = trim(rest.substr(0, c2));
          const std::string pv = quoted(rest.substr(c2 + 1));
          if (pk == "DiffMono")
          {
            char* end = nullptr;
            const double v = std::strtod(pv.c_str(), &end);
            if (end && end != pv.c_str()) { t.mass = v; t.has_mass = true; }
          }
          else if (pk == "Origin") t.origin = pv;
          else if (pk == "TermSpec") t.termspec = pv;
          else if ((pk == "Unimod" || pk == "UniMod") && !t.unimod) t.unimod = std::atoi(pv.c_str());
        }
      }
      if (in_term) keep(t, out);
      return out;
    }

    std::vector<Match> match(const std::vector<Entry>& entries, double delta, double tol_da,
                             const std::vector<Site>& sites, const std::vector<FixedMod>& fixed,
                             std::size_t cap)
    {
      std::vector<Match> all;
      auto fixedOn = [&](char res) -> const FixedMod* {
        const char r = res == 'I' ? 'L' : res;  // the alphabet folds I to L (resolveMods_)
        for (const FixedMod& f : fixed)
          if (f.residue == r || f.residue == res) return &f;
        return nullptr;
      };
      for (const Site& s : sites)
        for (const Entry& e : entries)
        {
          std::string label;
          bool on_residue = false;
          if (e.term == Term::ANYWHERE)
          {
            if (e.origin != s.residue) continue;
            label = std::string(1, s.residue);
            on_residue = true;
          }
          else
          {
            const bool n = e.term == Term::N_TERM || e.term == Term::PROTEIN_N_TERM;
            const bool prot = e.term == Term::PROTEIN_N_TERM || e.term == Term::PROTEIN_C_TERM;
            if (s.kind != (n ? 'N' : 'C')) continue;
            if (prot && !s.protein_term) continue;
            if (e.origin != 'X' && e.origin != s.residue) continue;
            label = std::string(prot ? "Protein " : "") + (n ? "N-term" : "C-term");
            if (e.origin != 'X') { label += ' '; label += e.origin; }
            on_residue = e.origin != 'X';
          }
          const double err = delta - e.mass;
          if (std::fabs(err) <= tol_da) all.push_back({&e, label, std::string(), err});
          const FixedMod* f = on_residue ? fixedOn(s.residue) : nullptr;
          if (f)
          {
            const double err2 = delta - (e.mass - f->mass);
            if (std::fabs(err2) <= tol_da) all.push_back({&e, label, f->name, err2});
          }
        }
      std::sort(all.begin(), all.end(), [](const Match& a, const Match& b) {
        const double ea = std::fabs(a.error), eb = std::fabs(b.error);
        if (ea != eb) return ea < eb;
        return std::tie(a.entry->acc, a.site, a.fixed, a.entry->name) <
               std::tie(b.entry->acc, b.site, b.fixed, b.entry->name);
      });
      std::vector<Match> out;
      std::set<std::tuple<std::string, std::string, std::string>> seen;
      for (const Match& m : all)
      {
        if (out.size() >= cap) break;
        if (!seen.insert(std::make_tuple(m.entry->acc, m.site, m.fixed)).second) continue;
        out.push_back(m);
      }
      return out;
    }

    namespace
    {
      std::string clean(const std::string& s)
      {
        std::string o = s;
        for (char& c : o)
          if (c == ';' || c == '\t' || c == '\n' || c == '\r' || c == '@') c = ' ';
        return o;
      }
    }

    std::string format(const std::vector<Match>& matches, bool psimod, double ppm_of)
    {
      if (matches.empty()) return "-";
      std::string o;
      char num[48];
      for (const Match& m : matches)
      {
        if (!o.empty()) o += ';';
        if (psimod) o += m.entry->acc + ' ';
        o += clean(m.entry->name);
        o += '@';
        o += m.site;
        if (!m.fixed.empty()) o += "[-" + clean(m.fixed) + "]";
        if (ppm_of > 0) std::snprintf(num, sizeof num, "(%+.1fppm)", m.error / ppm_of * 1e6);
        else std::snprintf(num, sizeof num, "(%+.1fmDa)", m.error * 1e3);
        o += num;
      }
      return o;
    }

    std::string formatSites(const std::map<std::string, std::uint64_t>& counts)
    {
      if (counts.empty()) return "-";
      std::vector<std::pair<std::uint64_t, std::string>> v;
      for (const auto& kv : counts) v.emplace_back(kv.second, kv.first);
      std::sort(v.begin(), v.end(), [](const auto& a, const auto& b) {
        return a.first != b.first ? a.first > b.first : a.second < b.second;
      });
      std::string o;
      for (const auto& x : v)
      {
        if (!o.empty()) o += ',';
        o += x.second + ':' + std::to_string(x.first);
      }
      return o;
    }
  }
}
