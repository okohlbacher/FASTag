// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "AlkylationCall.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/GzipIfstream.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <tuple>

namespace FASTag::Alkylation
{
  const char* className(int cls)
  {
    static const char* const names[kNumClasses] = {"Carbamidomethyl", "Propionamide", "Nethylmaleimide",
                                                   "Methylthio", "Carboxymethyl", "none"};
    return cls >= 0 && cls < kNumClasses ? names[cls] : "-";
  }

  std::vector<Form> forms()
  {
    static const struct { const char* name; const char* site; int cls; } defs[kNumForms] = {
        {"Carbamidomethyl", "Carbamidomethyl (C)", Carbamidomethyl},
        {"Propionamide", "Propionamide (C)", Propionamide},
        {"Nethylmaleimide", "Nethylmaleimide (C)", Nethylmaleimide},
        {"Methylthio", "Methylthio (C)", Methylthio},
        {"Carboxymethyl", "Carboxymethyl (C)", Carboxymethyl},
        {"unmodified", "", None},
        {"Oxidation", "Oxidation (C)", None},
        {"Dioxidation", "Dioxidation (C)", None},
        {"Trioxidation", "Trioxidation (C)", None},
        {"Cysteinyl", "Cysteinyl (C)", None},
        {"Dehydroalanine", "Cys->Dha (C)", None}};
    std::vector<Form> out;
    const OpenMS::ModificationsDB* mdb = OpenMS::ModificationsDB::getInstance();
    for (const auto& d : defs)
    {
      Form f{d.name, d.site, 0.0, d.cls};
      if (*d.site)
      {
        const OpenMS::ResidueModification* rm = nullptr;
        try { rm = mdb->getModification(d.site); }
        catch (const OpenMS::Exception::BaseException&) { rm = nullptr; }
        if (!rm) throw std::runtime_error(std::string("OpenMS does not know the modification '") + d.site + "'");
        f.mass = rm->getDiffMonoMass();
      }
      out.push_back(f);
    }
    return out;
  }

  std::array<double, 128> residueMasses(const std::vector<std::pair<char, double>>& fixed)
  {
    std::array<double, 128> m{};
    for (const OpenMS::Residue* r : OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
      m[static_cast<unsigned char>(r->getOneLetterCode()[0])] = r->getMonoWeight(OpenMS::Residue::Internal);
    m[static_cast<unsigned char>('I')] = m[static_cast<unsigned char>('L')];
    for (const auto& [res, delta] : fixed)
    {
      m[static_cast<unsigned char>(res)] += delta;
      if (res == 'L') m[static_cast<unsigned char>('I')] += delta;
    }
    return m;
  }

  const char* outcomeName(Outcome o)
  {
    switch (o)
    {
      case Outcome::Binned: return "binned";
      case Outcome::Unexplained: return "unexplained";
      case Outcome::NoCys: return "no_cys";
      case Outcome::MultiCys: return "multi_cys";
      case Outcome::CysInTag: return "cys_in_tag";
      case Outcome::CysOutsideRegion: return "cys_outside_region";
      case Outcome::ProteinNTerm: return "protein_nterm";
      case Outcome::Truncation: return "truncation";
      case Outcome::MetAmbiguous: return "met_ambiguous";
      default: return "-";
    }
  }

  namespace
  {
    char up(char c) { return static_cast<char>(std::toupper(static_cast<unsigned char>(c))); }

    /// The form nearest @p reagent within the window, -1 if none.
    int bin(double reagent, const Settings& s, const std::vector<Form>& forms)
    {
      int best = -1;
      double err = 0.0;
      for (std::size_t k = 0; k < forms.size(); ++k)
      {
        const double e = std::fabs(reagent - forms[k].mass);
        if (e <= s.window && (best < 0 || e < err)) { best = static_cast<int>(k); err = e; }
      }
      return best;
    }

    double massOf(char c, const Settings& s) { return s.residue_mass[static_cast<unsigned char>(up(c)) & 127]; }
  }

  Eval evaluate(const Placement& p, const Settings& s, const std::vector<Form>& forms)
  {
    Eval e;
    const int L = static_cast<int>(p.peptide.size());
    int cpos = -1, ncys = 0;
    for (int i = 0; i < L; ++i)
      if (up(p.peptide[static_cast<std::size_t>(i)]) == 'C') { ++ncys; cpos = i; }
    if (ncys == 0) return e;  // NoCys
    if (ncys > 1) { e.outcome = Outcome::MultiCys; return e; }
    const int tag_end = p.tag_pos + p.tag_len;  // one past the tag
    if (cpos >= p.tag_pos && cpos < tag_end) { e.outcome = Outcome::CysInTag; return e; }
    bool exact = p.nterm_match && p.cterm_match;
    bool nside = cpos < p.tag_pos;
    double gap = 0.0;
    if (!exact)
    {
      const bool gap_n = !p.nterm_match;  // the reconciler allows one mismatched side
      // A fixed terminal label on the gap side is in the spectrum flank, not
      // in the database prefix: take it off (Shortlist::classifyPlacement).
      // What is left within the window is a label-exact placement.
      const double label = gap_n ? s.fixed_term_n : s.fixed_term_c;
      double rest = p.gap;
      if (label != 0.0)
      {
        rest -= label;
        if (std::fabs(rest) <= s.window) exact = true;
      }
      if (!exact)
      {
        if (gap_n != nside) { e.outcome = Outcome::CysOutsideRegion; return e; }
        gap = rest;
        if (nside && p.start == 0) { e.outcome = Outcome::ProteinNTerm; return e; }
      }
    }
    // The gap side: [0, tag_pos) or [tag_end, L).
    const int lo = nside ? 0 : tag_end, hi = nside ? p.tag_pos - 1 : L - 1;
    if (!exact && std::fabs(gap) > s.window)
    {
      // Truncation guard: the outermost one or two residues of the gap side.
      const int o1 = nside ? lo : hi, o2 = nside ? lo + 1 : hi - 1;
      const double m1 = massOf(p.peptide[static_cast<std::size_t>(o1)], s);
      if (std::fabs(std::fabs(gap) - m1) <= s.window) { e.outcome = Outcome::Truncation; return e; }
      if (hi - lo >= 1)
      {
        const double m2 = m1 + massOf(p.peptide[static_cast<std::size_t>(o2)], s);
        if (std::fabs(std::fabs(gap) - m2) <= s.window) { e.outcome = Outcome::Truncation; return e; }
      }
    }
    e.reagent = gap + s.fixed_c;
    bool has_m = false;
    for (int i = lo; i <= hi; ++i)
      if (up(p.peptide[static_cast<std::size_t>(i)]) == 'M') has_m = true;
    int b = bin(e.reagent, s, forms);
    if (has_m)
    {
      const int b_ox = bin(e.reagent - s.met_oxidation, s, forms);
      if (b >= 0 && b_ox >= 0 && forms[static_cast<std::size_t>(b)].cls != forms[static_cast<std::size_t>(b_ox)].cls)
      {
        e.outcome = Outcome::MetAmbiguous;
        return e;
      }
      if (b < 0) b = b_ox;
    }
    e.outcome = b >= 0 ? Outcome::Binned : Outcome::Unexplained;
    e.form = b;
    return e;
  }

  Vote tagVote(const std::vector<Eval>& evals, const std::vector<Form>& forms,
               std::array<std::uint64_t, static_cast<int>(Outcome::kCount)>& outcomes)
  {
    Vote v;
    for (const Eval& e : evals)
    {
      ++outcomes[static_cast<std::size_t>(e.outcome)];
      if (e.outcome != Outcome::Binned && e.outcome != Outcome::Unexplained) continue;
      const int form = e.outcome == Outcome::Binned ? e.form : -1;
      const int cls = form >= 0 ? forms[static_cast<std::size_t>(form)].cls : -1;  // -1 = unexplained
      if (!v.have)
      {
        v.have = true;
        v.cls = cls;
        v.form = form;
        continue;
      }
      if (form != v.form) v.form = -1;
      if (cls != v.cls) v.conflict = true;
    }
    if (v.conflict) { v.cls = -1; v.form = -1; }
    return v;
  }

  void addTag(Tally& t, Vote& spectrum_vote, const std::vector<Reconciliation>& places, double evalue,
              const Settings& s, const std::vector<Form>& forms)
  {
    ++t.tags;
    static thread_local std::vector<Eval> evals;
    evals.clear();
    for (const Reconciliation& pl : places)
    {
      Placement ap;
      ap.peptide = pl.peptide;
      ap.start = pl.start;
      ap.tag_pos = static_cast<int>(pl.pos);
      ap.tag_len = static_cast<int>(pl.tag_len);
      ap.nterm_match = pl.nterm_match;
      ap.cterm_match = pl.cterm_match;
      ap.gap = pl.delta_mass;
      evals.push_back(evaluate(ap, s, forms));
    }
    Vote v = tagVote(evals, forms, t.outcomes);
    if (v.have && (!spectrum_vote.have || evalue < spectrum_vote.evalue))
    {
      v.evalue = evalue;
      spectrum_vote = v;
    }
  }

  void Tally::add(const Vote& v)
  {
    if (!v.have) return;
    ++spectra;
    if (v.conflict) ++conflict;
    else if (v.cls < 0) ++unexplained;
    else
    {
      ++cls[static_cast<std::size_t>(v.cls)];
      if (v.form >= 0 && v.form < kNumForms) ++form[static_cast<std::size_t>(v.form)];
    }
  }

  void Tally::merge(const Tally& o)
  {
    tags += o.tags;
    spectra += o.spectra;
    conflict += o.conflict;
    unexplained += o.unexplained;
    excluded_non_by += o.excluded_non_by;
    for (std::size_t k = 0; k < cls.size(); ++k) cls[k] += o.cls[k];
    for (std::size_t k = 0; k < form.size(); ++k) form[k] += o.form[k];
    for (std::size_t k = 0; k < outcomes.size(); ++k) outcomes[k] += o.outcomes[k];
  }

  Call callAlkylation(const Tally& t, const Settings& s)
  {
    Call c;
    int top = -1;
    bool tie = false;
    for (int k = 0; k < kNumClasses; ++k)
    {
      c.binned += t.cls[static_cast<std::size_t>(k)];
      if (top < 0 || t.cls[static_cast<std::size_t>(k)] > t.cls[static_cast<std::size_t>(top)]) { top = k; tie = false; }
      else if (t.cls[static_cast<std::size_t>(k)] == t.cls[static_cast<std::size_t>(top)]) tie = true;
    }
    c.cls = top;
    c.top = t.cls[static_cast<std::size_t>(top)];
    c.share = c.binned ? static_cast<double>(c.top) / static_cast<double>(c.binned) : 0.0;
    if (c.binned < s.min_spectra) c.reason = "few_cys_spectra";
    else if (tie || c.top < s.min_spectra || c.share < s.min_share) c.reason = "ambiguous";
    else c.called = true;
    return c;
  }

  namespace
  {
    std::string u(std::uint64_t v) { return std::to_string(v); }
    std::string f3(double v)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%.3f", v);
      return b;
    }
  }

  std::vector<Digest::Row> alkylationRows(const Tally& t, const Call& c, const Settings& s,
                                          const std::vector<Form>& forms, const ReportInfo& info)
  {
    using Digest::num;
    std::vector<Digest::Row> r;
    auto add = [&](const char* sec, const std::string& key, const std::string& value, const std::string& n,
                   const std::string& d) { r.push_back(Digest::Row{sec, key, value, n, d}); };
    // ---- alk_run: settings and what was counted
    add("alk_run", "format", std::to_string(kReportFormat), "-",
        "The alkylation report follows format " + std::to_string(kReportFormat) + " (doc/ALKYLATION-REPORT.md).");
    add("alk_run", "database", info.database, "-", "The placements are on the database " + info.database + ".");
    add("alk_run", "database_source", info.database_source, "-",
        info.database_source == "recon_fasta" ? "The database is -recon_fasta."
        : info.database_source == "fasta"     ? "The database is -fasta, the placement database of this run."
        : info.database_source == "proteome"  ? "The database is the -alkylation_proteome FASTA."
                                              : "The database is the proteome shipped with FASTag (" + info.database_source + ").");
    add("alk_run", "fixed_c_delta", num(s.fixed_c), "-",
        info.reagent_note.empty() ? "The run has no fixed modification on C; the reagent mass is the gap."
                                  : "The run's fixed " + info.reagent_note + " on C adds " + num(s.fixed_c) +
                                        " Da to every gap: the reagent mass is gap + " + num(s.fixed_c) + ".");
    for (const auto& [key, label, side] : {std::tuple<const char*, double, const char*>{"fixed_nterm_delta", s.fixed_term_n, "N"},
                                           std::tuple<const char*, double, const char*>{"fixed_cterm_delta", s.fixed_term_c, "C"}})
      add("alk_run", key, num(label), "-",
          label == 0.0 ? std::string("The run has no fixed peptide ") + side + "-terminal modification."
                       : std::string("The run's fixed peptide ") + side + "-terminal modification of " + num(label) +
                             " Da is taken off a gap on the " + side +
                             " side first (the spectrum carries it, the database does not); a rest within the window is an exact placement.");
    add("alk_run", "window", num(s.window), "-", "A reagent mass bins to a Cys form within " + num(s.window) + " Da of it.");
    add("alk_run", "min_spectra", u(s.min_spectra), "-",
        "A call needs " + u(s.min_spectra) + " spectra binned in total and for the called class.");
    add("alk_run", "min_share", num(s.min_share), "-",
        "A call needs a share of " + num(s.min_share) + " of the binned spectra.");
    add("alk_run", "tags", u(t.tags), "-", u(t.tags) + " placed tags (ungapped, E-value at most 1) were looked at.");
    add("alk_run", "spectra", u(t.spectra), "-",
        u(t.spectra) + " MS2 spectra have a tag with a single-Cys placement that counts; each votes once, with its best such tag.");

    // ---- alk_cys: votes per form and class, the rest, and the placements dropped
    std::uint64_t binned = 0;
    for (std::uint64_t v : t.cls) binned += v;
    for (std::size_t k = 0; k < forms.size() && k < t.form.size(); ++k)
      add("alk_cys", forms[k].name, u(t.form[k]), u(binned),
          u(t.form[k]) + " spectra bin to " + forms[k].name + " (" + num(forms[k].mass) + " Da on C; class " +
              className(forms[k].cls) + ").");
    for (int k = 0; k < kNumClasses; ++k)
      add("alk_cys", std::string("class.") + className(k), u(t.cls[static_cast<std::size_t>(k)]), u(binned),
          u(t.cls[static_cast<std::size_t>(k)]) + " of " + u(binned) + " binned spectra are of the class " + className(k) +
              (k == None ? " (unmodified, oxidised, cysteinylated or dehydroalanine Cys)." : "."));
    add("alk_cys", "unexplained", u(t.unexplained), u(t.spectra),
        u(t.unexplained) + " spectra have a reagent mass no Cys form explains within the window.");
    add("alk_cys", "conflict", u(t.conflict), u(t.spectra),
        u(t.conflict) + " spectra have a best tag whose counted placements disagree on the class.");
    std::uint64_t placements = 0;
    for (std::uint64_t v : t.outcomes) placements += v;
    for (int k = static_cast<int>(Outcome::NoCys); k < static_cast<int>(Outcome::kCount); ++k)
    {
      const Outcome o = static_cast<Outcome>(k);
      static const char* const why[] = {"", "", "have no C in the peptide", "have two or more C in the peptide",
                                        "have their one C inside the tag", "have their one C on the side without the gap",
                                        "have the gap at the protein N-terminus",
                                        "have a gap equal to the mass of the outermost one or two residues (a shorter product)",
                                        "read as two classes with and without an M oxidation in the gap"};
      add("alk_cys", std::string("excluded.") + outcomeName(o), u(t.outcomes[static_cast<std::size_t>(k)]), u(placements),
          u(t.outcomes[static_cast<std::size_t>(k)]) + " of " + u(placements) + " placements are left out: they " + why[k] + ".");
    }
    add("alk_cys", "excluded.non_by", u(t.excluded_non_by), u(t.tags + t.excluded_non_by),
        u(t.excluded_non_by) + " of " + u(t.tags + t.excluded_non_by) +
            " tags are left out because they are not b/y tags (c/z); they are not placed for the call.");

    // ---- alkylation_call
    const std::string name = c.cls >= 0 ? className(c.cls) : "-";
    if (c.called)
    {
      double mass = 0.0;
      for (const Form& fm : forms)
        if (fm.cls == c.cls && fm.cls != None) { mass = fm.mass; break; }
      add("alkylation_call", "status", "call", u(c.binned),
          c.cls == None ? "The cysteines are not alkylated (not validated on held-out data)."
                        : "The cysteines are alkylated with " + name + " (not validated on held-out data).");
      add("alkylation_call", "reagent", name, u(c.top), "The call is " + name + ".");
      add("alkylation_call", "mass", c.cls == None ? "-" : num(mass), "-",
          c.cls == None ? "A call of none has no reagent mass." : name + " adds " + num(mass) + " Da to C.");
      add("alkylation_call", "share", num(c.share), u(c.binned),
          "A share of " + f3(c.share) + " of the " + u(c.binned) + " binned spectra are " + name + ".");
      add("alkylation_call", "reason", "-", "-", "The call is made.");
    }
    else
    {
      add("alkylation_call", "status", "no_call", u(c.binned),
          c.reason == "few_cys_spectra"
              ? "No alkylation is called: " + u(c.binned) + " binned spectra are fewer than " + u(s.min_spectra) + "."
              : "No alkylation is called: the leading class " + name + " has " + u(c.top) + " of " + u(c.binned) +
                    " binned spectra, short of " + u(s.min_spectra) + " spectra and a share of " + num(s.min_share) +
                    " (or tied).");
      add("alkylation_call", "reagent", "-", "-", "No reagent is called.");
      add("alkylation_call", "mass", "-", "-", "No reagent is called.");
      add("alkylation_call", "share", c.binned ? num(c.share) : "-", u(c.binned),
          c.binned ? "The leading class " + name + " has a share of " + f3(c.share) + "." : "No spectrum is binned.");
      add("alkylation_call", "reason", c.reason, "-", "The first no-call rule that applies is " + c.reason + ".");
    }
    return r;
  }

  void loadFasta(const std::string& path, std::vector<OpenMS::FASTAFile::FASTAEntry>& out)
  {
    const bool gz = path.size() > 3 && path.compare(path.size() - 3, 3, ".gz") == 0;
    if (!gz)
    {
      OpenMS::FASTAFile().load(path, out);
      return;
    }
    out.clear();
    OpenMS::GzipIfstream in(path.c_str());
    std::string text;
    char buf[1 << 16];
    while (!in.streamEnd())
    {
      const std::size_t n = in.read(buf, sizeof buf);
      text.append(buf, n);
      if (n == 0) break;
    }
    in.close();
    OpenMS::FASTAFile::FASTAEntry cur;
    bool have = false;
    std::size_t pos = 0;
    while (pos <= text.size())
    {
      std::size_t nl = text.find('\n', pos);
      if (nl == std::string::npos) nl = text.size();
      std::string line = text.substr(pos, nl - pos);
      pos = nl + 1;
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (line.empty()) { if (nl == text.size()) break; continue; }
      if (line[0] == '>')
      {
        if (have) out.push_back(cur);
        cur = OpenMS::FASTAFile::FASTAEntry();
        const std::string h = line.substr(1);
        const std::size_t sp = h.find_first_of(" \t");
        cur.identifier = h.substr(0, sp);
        const std::size_t ds = sp == std::string::npos ? std::string::npos : h.find_first_not_of(" \t", sp);
        cur.description = ds == std::string::npos ? std::string() : h.substr(ds);
        have = true;
      }
      else if (have)
        for (char ch : line)
          if (!std::isspace(static_cast<unsigned char>(ch))) cur.sequence += ch;
      if (nl == text.size()) break;
    }
    if (have) out.push_back(cur);
  }
}
