// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "ShiftSurvey.h"

#include <OpenMS/CHEMISTRY/UnimodXMLDataProvider.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/SYSTEM/File.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
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

    std::vector<Entry> unimodEntries(const std::string& path, std::string* error)
    {
      // Read from the file, not ModificationsDB: the database also holds
      // custom_mods.xml's CUSTOM0..n (record ids 99900+) and every
      // modification registered at run time.
      std::vector<Entry> out;
      std::vector<std::unique_ptr<ResidueModification>> mods;
      try
      {
        mods = UnimodXMLDataProvider(path).loadModifications();
      }
      catch (const std::exception& e)
      {
        if (error) *error = "cannot read '" + path + "': " + e.what();
        return out;
      }
      for (const auto& m : mods)
      {
        if (!m || m->getUniModRecordId() <= 0) continue;
        const double mass = m->getDiffMonoMass();
        if (!std::isfinite(mass) || std::fabs(mass) < 1e-9) continue;
        Entry e;
        e.acc = "UNIMOD:" + std::to_string(m->getUniModRecordId());
        e.name = m->getId();
        e.origin = m->getOrigin();
        e.mass = mass;
        e.label = m->getSourceClassification() == ResidueModification::ISOTOPIC_LABEL;
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
        std::vector<std::string> is_a;
      };
      /// MOD:00008 "common": Unimod-derived placeholders standing for RESID entries.
      const char* const COMMON = "MOD:00008";
      void keep(const Term_& t, const std::set<std::string>& parents, std::vector<Entry>& out)
      {
        if (t.id.rfind("MOD:", 0) != 0 || t.obsolete || !t.has_mass) return;
        if (std::find(t.is_a.begin(), t.is_a.end(), COMMON) != t.is_a.end()) return;  // abstract
        if (t.origin == "X" && parents.count(t.id)) return;  // a residue-generic class
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
      // Two passes: the terms, then those kept (a class is known only once
      // every is_a naming it has been read).
      std::vector<Term_> terms;
      std::set<std::string> parents;
      Term_ t;
      bool in_term = false;
      std::string line;
      while (std::getline(in, line))
      {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty() && line[0] == '[')
        {
          if (in_term) terms.push_back(std::move(t));
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
        else if (key == "is_a")
        {
          const std::string parent = trim(rest.substr(0, rest.find('!')));
          t.is_a.push_back(parent);
          parents.insert(parent);
        }
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
      if (in_term) terms.push_back(std::move(t));
      for (const Term_& x : terms) keep(x, parents, out);
      return out;
    }

    std::vector<Match> match(const std::vector<Entry>& entries, double delta, double tol_da,
                             const std::vector<Site>& sites, const std::vector<FixedMod>& fixed,
                             std::size_t cap, const std::vector<std::uint64_t>* support)
    {
      auto fixedOn = [&](char res) -> const FixedMod* {
        const char r = res == 'I' ? 'L' : res;  // the alphabet folds I to L (resolveMods_)
        for (const FixedMod& f : fixed)
          if (f.residue == r || f.residue == res) return &f;
        return nullptr;
      };
      // (accession, fixed) -> the match and its support per site label.
      struct Acc
      {
        Match m;
        std::map<std::string, std::uint64_t> by_site;
      };
      std::map<std::pair<std::string, std::string>, Acc> found;
      auto add = [&](const Entry& e, const std::string& label, const std::string& fixed_name, double err,
                     std::uint64_t n) {
        Acc& a = found[std::make_pair(e.acc, fixed_name)];
        if (!a.m.entry || std::fabs(err) < std::fabs(a.m.error) ||
            (std::fabs(err) == std::fabs(a.m.error) && e.name < a.m.entry->name))
        {
          a.m.entry = &e;
          a.m.error = err;
          a.m.fixed = fixed_name;
        }
        a.by_site[label] += n;
      };
      for (std::size_t si = 0; si < sites.size(); ++si)
      {
        const Site& s = sites[si];
        const std::uint64_t n = support && si < support->size() ? (*support)[si] : 1;
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
            const bool nt = e.term == Term::N_TERM || e.term == Term::PROTEIN_N_TERM;
            const bool prot = e.term == Term::PROTEIN_N_TERM || e.term == Term::PROTEIN_C_TERM;
            if (s.kind != (nt ? 'N' : 'C')) continue;
            if (prot && !s.protein_term) continue;
            if (e.origin != 'X' && e.origin != s.residue) continue;
            label = std::string(prot ? "Protein " : "") + (nt ? "N-term" : "C-term");
            if (e.origin != 'X') { label += ' '; label += e.origin; }
            on_residue = e.origin != 'X';
          }
          const double err = delta - e.mass;
          if (std::fabs(err) <= tol_da) add(e, label, std::string(), err, n);
          const FixedMod* f = on_residue ? fixedOn(s.residue) : nullptr;
          if (f)
          {
            const double err2 = delta - (e.mass - f->mass);
            if (std::fabs(err2) <= tol_da) add(e, label, f->name, err2, n);
          }
        }
      }
      std::vector<Match> all;
      for (auto& kv : found)
      {
        Match m = kv.second.m;
        std::vector<std::pair<std::uint64_t, std::string>> v;
        for (const auto& sc : kv.second.by_site) { v.emplace_back(sc.second, sc.first); m.support += sc.second; }
        std::sort(v.begin(), v.end(), [](const auto& a, const auto& b) {
          return a.first != b.first ? a.first > b.first : a.second < b.second;
        });
        for (const auto& x : v) m.sites.push_back(x.second);
        all.push_back(std::move(m));
      }
      std::sort(all.begin(), all.end(), [](const Match& a, const Match& b) {
        if (a.support != b.support) return a.support > b.support;
        const double ea = std::fabs(a.error), eb = std::fabs(b.error);
        if (ea != eb) return ea < eb;
        return std::tie(a.entry->acc, a.fixed) < std::tie(b.entry->acc, b.fixed);
      });
      if (all.size() > cap) all.resize(cap);
      return all;
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
        for (std::size_t i = 0; i < m.sites.size(); ++i)
        {
          if (i) o += '/';
          o += m.sites[i];
        }
        if (!m.fixed.empty()) o += "[-" + clean(m.fixed) + "]";
        if (ppm_of > 0) std::snprintf(num, sizeof num, "(%+.1fppm)", m.error / ppm_of * 1e6);
        else std::snprintf(num, sizeof num, "(%+.1fmDa)", m.error * 1e3);
        o += num;
      }
      return o;
    }

    std::string isotopeError(double delta, double tol_da, const std::vector<Match>& names,
                             std::uint64_t localized, double ppm_of)
    {
      int k = 0;
      double err = 0.0;
      for (int i = 1; i <= 2; ++i)
      {
        const double e = delta - i * C13_STEP;
        if (std::fabs(e) <= tol_da && (!k || std::fabs(e) < std::fabs(err))) { k = i; err = e; }
      }
      if (!k) return "-";
      for (const Match& m : names)
      {
        if (!m.entry || m.entry->label || m.entry->origin == 'X') continue;
        if (std::fabs(m.error) >= std::fabs(err)) continue;
        if (2 * m.support >= localized && m.support > 0) return "-";  // a better residue-specific name
      }
      char num[48];
      if (ppm_of > 0) std::snprintf(num, sizeof num, "13C+%d(%+.1fppm)", k, err / ppm_of * 1e6);
      else std::snprintf(num, sizeof num, "13C+%d(%+.1fmDa)", k, err * 1e3);
      return num;
    }

    std::vector<BinGroup> groupBins(const std::map<std::int64_t, std::uint64_t>& counts, std::int64_t width)
    {
      std::vector<BinGroup> out;
      if (width <= 0)
      {
        // 1.15: local maxima take their strictly smaller neighbours.
        std::set<std::int64_t> absorbed;
        for (const auto& kv : counts)
        {
          if (absorbed.count(kv.first)) continue;
          const auto lo = counts.find(kv.first - 1), hi = counts.find(kv.first + 1);
          const std::uint64_t nl = lo != counts.end() ? lo->second : 0;
          const std::uint64_t nh = hi != counts.end() ? hi->second : 0;
          if (kv.second < nl || kv.second < nh) continue;
          BinGroup g;
          g.center = kv.first;
          for (const auto& nb : {lo, hi})
            if (nb != counts.end() && nb->second < kv.second && !absorbed.count(nb->first))
            {
              g.bins.push_back(nb->first);
              absorbed.insert(nb->first);
            }
          g.bins.push_back(kv.first);
          std::sort(g.bins.begin(), g.bins.end());
          out.push_back(std::move(g));
        }
        return out;
      }
      std::vector<std::pair<std::uint64_t, std::int64_t>> order;
      order.reserve(counts.size());
      for (const auto& kv : counts) order.emplace_back(kv.second, kv.first);
      std::sort(order.begin(), order.end(), [](const auto& a, const auto& b) {
        return a.first != b.first ? a.first > b.first : a.second < b.second;
      });
      std::set<std::int64_t> taken;
      for (const auto& seed : order)
      {
        if (taken.count(seed.second)) continue;
        BinGroup g;
        g.center = seed.second;
        for (auto it = counts.lower_bound(seed.second - width);
             it != counts.end() && it->first <= seed.second + width; ++it)
          if (taken.insert(it->first).second) g.bins.push_back(it->first);
        out.push_back(std::move(g));
      }
      std::sort(out.begin(), out.end(), [](const BinGroup& a, const BinGroup& b) { return a.center < b.center; });
      return out;
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
