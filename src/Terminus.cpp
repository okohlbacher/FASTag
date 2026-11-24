// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "Terminus.h"

#include "IonSeries.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/CONCEPT/Exception.h>

#include <algorithm>
#include <cctype>
#include <cmath>

namespace FASTag::Terminus
{
  namespace
  {
    /// A string a la String.prototype.localeCompare (ICU root collation) for
    /// the labels compared here, as the GUI sorts them: punctuation and
    /// symbols before digits before letters, letters by their case-folded
    /// value first, then lower case before upper case.
    int collateClass(unsigned char c, int& w)
    {
      static const std::string punct = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
      if (std::isalpha(c)) { w = std::tolower(c); return 2; }
      if (std::isdigit(c)) { w = c; return 1; }
      const size_t at = punct.find(static_cast<char>(c));
      w = at == std::string::npos ? 1000 + c : static_cast<int>(at);
      return 0;
    }
    int localeCompare(const std::string& a, const std::string& b)
    {
      const size_t n = std::min(a.size(), b.size());
      for (size_t i = 0; i < n; ++i)
      {
        int wa = 0, wb = 0;
        const int ca = collateClass(static_cast<unsigned char>(a[i]), wa);
        const int cb = collateClass(static_cast<unsigned char>(b[i]), wb);
        if (ca != cb) return ca < cb ? -1 : 1;
        if (wa != wb) return wa < wb ? -1 : 1;
      }
      if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;
      for (size_t i = 0; i < n; ++i)
        if (a[i] != b[i])
        {
          const bool la = std::islower(static_cast<unsigned char>(a[i])) != 0;
          return la ? -1 : 1;
        }
      return 0;
    }
    std::string il(std::string s)
    {
      for (char& c : s) if (c == 'I') c = 'L';
      return s;
    }
    bool nTerminal(char s) { return s == 'b' || s == 'c'; }
  }

  Residues residuesFrom(const std::vector<ModSpec>& mods)
  {
    Residues r;
    for (const OpenMS::Residue* res : OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
    {
      const char c = res->getOneLetterCode()[0];
      double m = res->getMonoWeight(OpenMS::Residue::Internal);
      for (const ModSpec& mod : mods)
        if (!mod.variable && mod.residue == c) m += mod.delta;
      r.base[c] = m;
    }
    if (r.base.count('L')) r.base['I'] = r.base['L'];
    for (const ModSpec& mod : mods)
    {
      if (!mod.variable) continue;
      const auto it = r.base.find(mod.residue);
      if (it != r.base.end()) r.variable.emplace(std::make_pair(mod.residue, mod.name), it->second + mod.delta);
    }
    return r;
  }

  Termini terminiFrom(const Residues& res, const std::vector<double>& nterm_mods, const std::vector<double>& cterm_mods,
                      const std::vector<int>& isotope)
  {
    Termini t;
    t.nterm.insert(t.nterm.end(), nterm_mods.begin(), nterm_mods.end());
    t.cterm.insert(t.cterm.end(), cterm_mods.begin(), cterm_mods.end());
    t.isotope = isotope.empty() ? std::vector<int>{0} : isotope;
    for (const auto& [c, m] : res.base) t.residues.emplace_back(std::string(1, c), m);
    for (const auto& [key, m] : res.variable) t.residues.emplace_back(std::string(1, key.first) + "[" + key.second + "]", m);
    return t;
  }

  Termini terminiOfRun(const std::vector<ModSpec>& mods, const std::vector<std::string>& mod_names,
                       const std::vector<int>& isotope)
  {
    using OpenMS::ResidueModification;
    std::vector<double> term_n, term_c;
    for (const std::string& nm : mod_names)
    {
      if (nm.empty()) continue;
      const ResidueModification* mod = nullptr;
      try { mod = OpenMS::ModificationsDB::getInstance()->getModification(nm); }
      catch (OpenMS::Exception::BaseException&) { continue; }  // refused by resolveMods_ already
      if (!mod || mod->getOrigin() != 'X') continue;
      const auto spec = mod->getTermSpecificity();
      if (spec == ResidueModification::N_TERM || spec == ResidueModification::PROTEIN_N_TERM)
        term_n.push_back(mod->getDiffMonoMass());
      else if (spec == ResidueModification::C_TERM || spec == ResidueModification::PROTEIN_C_TERM)
        term_c.push_back(mod->getDiffMonoMass());
    }
    return terminiFrom(residuesFrom(mods), term_n, term_c, isotope);
  }

  std::string terminus(char series, int charge, double low_mz, double nterm, double cterm, const Peaks& s,
                       const Termini& t)
  {
    const int z = charge > 0 ? charge : 1;
    // The side read from the peaks: the fragment tolerance at the low peak,
    // as a neutral mass (times z).
    const double tol_peak = tolAt(s, low_mz) * z;
    const bool have_prec = s.precursor && s.charge > 0;
    // The side from the precursor: that plus the fragment tolerance at the
    // precursor m/z times its charge (FASTag tags with no precursor
    // tolerance of its own).
    const double tol_prec = have_prec ? tol_peak + tolAt(s, *s.precursor) * s.charge : 0;
    const std::vector<int> peak_iso{0};
    std::vector<int> prec_iso;
    for (int k : t.isotope) prec_iso.push_back(k - s.isotope);
    if (prec_iso.empty()) prec_iso.push_back(0);
    const auto side = [&](char end, double f, const std::vector<double>& targets, bool from_peaks) -> std::string {
      if (!from_peaks && !have_prec) return {};
      const double tol = from_peaks ? tol_peak : tol_prec;
      const std::vector<int>& iso = from_peaks ? peak_iso : prec_iso;
      const auto near = [&](double x) {
        for (double m : targets)
          for (int d : iso)
            if (std::fabs(f - (m + d * C13 + x)) <= tol) return true;
        return false;
      };
      if (near(0)) return std::string(1, end);
      std::vector<std::string> labels;
      for (const auto& [label, r] : t.residues)
        if (near(r) && std::find(labels.begin(), labels.end(), label) == labels.end()) labels.push_back(label);
      if (labels.empty()) return {};
      std::stable_sort(labels.begin(), labels.end(), [](const std::string& x, const std::string& y) {
        int c = localeCompare(il(x), il(y));
        if (c == 0) c = localeCompare(x, y);
        return c < 0;
      });
      std::string out(1, end);
      out += '+';
      if (labels.size() == 1) return out + labels[0];
      out += '[';
      for (const std::string& l : labels) out += l;
      return out + ']';
    };
    const bool n_from_peaks = nTerminal(series);
    const std::string n = side('N', nterm, t.nterm, n_from_peaks);
    const std::string c = side('C', cterm, t.cterm, !n_from_peaks);
    if (!n.empty() && !c.empty()) return n + "," + c;
    return n.empty() ? c : n;
  }

  bool anchorUsed(char series, const std::string& tokens)
  {
    if (tokens.empty()) return false;
    if (tokens[0] == 'N') return true;  // the N side comes first
    // The C side: after the comma at bracket depth 0 (a label may hold none).
    std::string c;
    int depth = 0;
    for (size_t i = 0; i < tokens.size(); ++i)
    {
      if (tokens[i] == '[') ++depth;
      else if (tokens[i] == ']') --depth;
      else if (tokens[i] == ',' && depth == 0) { c = tokens.substr(i + 1); break; }
    }
    if (c.empty()) c = tokens;
    if (c == "C") return true;
    if (c.rfind("C+", 0) != 0) return false;
    const std::string away = c.substr(2);
    if (away == "K" || away == "R") return !nTerminal(series);  // y1/z1 of K/R only
    if (away.size() < 2 || away.front() != '[' || away.back() != ']') return false;
    // A set, [KQ]: its residues (X or X[Name]); a bare K or R among them.
    const std::string inner = away.substr(1, away.size() - 2);
    for (size_t i = 0; i < inner.size();)
    {
      size_t j = i + 1;
      if (j < inner.size() && inner[j] == '[')
      {
        int d = 0;
        for (; j < inner.size(); ++j)
        {
          if (inner[j] == '[') ++d;
          else if (inner[j] == ']' && --d == 0) { ++j; break; }
        }
      }
      if (j == i + 1 && (inner[i] == 'K' || inner[i] == 'R')) return true;
      i = j;
    }
    return false;
  }

  Call seriesCall(const Tag& t, const Peaks& s, const Termini& terms)
  {
    static const double WATER = OpenMS::EmpiricalFormula("H2O").getMonoWeight();
    const double PROTON = OpenMS::Constants::PROTON_MASS_U;
    const bool cz = t.ion_series == IonSeries::Series::CZ;
    const IonSeries::IonPair pair = IonSeries::ionPair(cz ? IonSeries::Series::CZ : IonSeries::Series::BY);
    const int z = t.charge > 0 ? t.charge : 1;
    const double low = t.low_mz * z - PROTON * z;
    // The far end as the flanks take it (nterm_mass): the low peak plus the
    // residue masses, not the measured highest peak, whose own error the
    // precursor-side tolerance does not cover (as the GUI's rawFlanksOf).
    const double high = low + t.res_mass;
    // The precursor side has no flank without a precursor; terminus() then
    // does not test it, so any value serves.
    const bool have_prec = s.precursor && s.charge > 0;
    const double M = have_prec ? *s.precursor * s.charge - s.charge * PROTON : 0.0;
    // As written (the low peak a C-terminal ion), unclamped.
    const double c_fwd = low - pair.offC;
    const double n_fwd = M - high - (WATER - pair.offC);
    // Reversed (the low peak an N-terminal ion).
    const double n_rev = c_fwd + pair.reversedOffset();
    const double c_rev = n_fwd - pair.reversedOffset();
    const char fwd = cz ? 'z' : 'y', rev = cz ? 'c' : 'b';
    const std::string tf = terminus(fwd, t.charge, t.low_mz, n_fwd, c_fwd, s, terms);
    const std::string tr = terminus(rev, t.charge, t.low_mz, n_rev, c_rev, s, terms);
    Call out;
    if (!tf.empty() && !tr.empty())
      out.terminus = std::string(1, fwd) + ":" + tf + ";" + std::string(1, rev) + ":" + tr;
    else if (!tf.empty())
      out.terminus = tf;
    else if (!tr.empty())
      out.terminus = tr;
    // The series: the one reading anchored through a used token, at a
    // tolerance the anchors were measured at.
    // c/z rows are never called: the anchors were measured on b/y only (the
    // GUI shows a c/z anchor as "likely" at most).
    const bool uf = anchorUsed(fwd, tf), ur = anchorUsed(rev, tr);
    if (!cz && seriesTolerance(s) && uf != ur) out.series = std::string(1, uf ? fwd : rev);
    return out;
  }
}
