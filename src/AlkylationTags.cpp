// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "AlkylationTags.h"

#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <stdexcept>

namespace FASTag::AlkylationTags
{
  std::vector<Alkylation::Form> candidates(const std::vector<Alkylation::Form>& forms)
  {
    if (forms.size() < static_cast<std::size_t>(NUM_CANDIDATES) || forms[UNMODIFIED].name != "unmodified")
      throw std::runtime_error("the Cys forms are not in the expected order");
    return std::vector<Alkylation::Form>(forms.begin(), forms.begin() + NUM_CANDIDATES);
  }

  std::vector<ModSpec> shadowMods(const std::vector<ModSpec>& run_mods, const std::vector<Alkylation::Form>& cands,
                                  std::vector<std::string>* dropped)
  {
    std::vector<ModSpec> out;
    for (const ModSpec& m : run_mods)
    {
      if (m.residue == 'C')
      {
        if (dropped) dropped->push_back(m.name + (m.variable ? " (variable)" : " (fixed)"));
        continue;
      }
      out.push_back(m);
    }
    for (int k = 0; k < NUM_CANDIDATES; ++k)
      if (k != UNMODIFIED) out.push_back(ModSpec{'C', cands[static_cast<std::size_t>(k)].mass, cands[static_cast<std::size_t>(k)].name, true});
    return out;
  }

  Param shadowParam(const Param& run, const std::vector<Alkylation::Form>& cands, std::vector<std::string>* dropped)
  {
    Param p = run;
    p.mods = shadowMods(run.mods, cands, dropped);
    p.max_gaps = 0;
    p.ion_pair = IonSeries::ionPair(IonSeries::Series::BY);
    // Every tag a vote can use (E <= 1): the run's -max_tags, -max_evalue and
    // -diversity select output rows, which these tags never are.
    p.max_tag_count = 0;
    p.max_evalue = 1.0;
    p.diversity = false;
    return p;
  }

  std::size_t alphabetSize(const std::vector<ModSpec>& mods)
  {
    std::size_t n = 0;
    std::string base;
    for (const OpenMS::Residue* r : OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
      base.push_back(r->getOneLetterCode()[0]);
    n = base.size();
    for (const ModSpec& m : mods)
      if (m.variable && base.find(m.residue) != std::string::npos) ++n;
    return n;
  }

  double edgeToleranceDa(const Param& p) { return p.tol_ppm ? 1000.0 * p.frag_tol * 1e-6 : p.frag_tol; }

  bool formsResolved(const std::vector<Alkylation::Form>& cands, double tol_da)
  {
    for (double d : twinDistances(cands, nullptr, false))
      if (d <= 2.0 * tol_da) return false;
    return true;
  }

  std::vector<Step> alphabet(const std::vector<ModSpec>& mods)
  {
    std::vector<Step> out;
    for (const OpenMS::Residue* r : OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
    {
      const char c = r->getOneLetterCode()[0];
      if (c == 'C') continue;
      double m = r->getMonoWeight(OpenMS::Residue::Internal);
      for (const ModSpec& mod : mods)
        if (!mod.variable && mod.residue == c) m += mod.delta;
      out.push_back(Step{std::string(1, c), m});
    }
    std::sort(out.begin(), out.end(), [](const Step& a, const Step& b) { return a.name < b.name; });
    const std::size_t n_base = out.size();
    for (const ModSpec& mod : mods)
    {
      if (!mod.variable || mod.residue == 'C') continue;
      for (std::size_t i = 0; i < n_base; ++i)
        if (out[i].name[0] == mod.residue) out.push_back(Step{out[i].name + "[" + mod.name + "]", out[i].mass + mod.delta});
    }
    return out;
  }

  namespace
  {
    double cMass()
    {
      return OpenMS::ResidueDB::getInstance()->getResidue('C')->getMonoWeight(OpenMS::Residue::Internal);
    }
    /// "C" for unmodified, "C[Name]" otherwise.
    std::string cName(const Alkylation::Form& f) { return f.name == "unmodified" ? std::string("C") : "C[" + f.name + "]"; }
    /// Comma-separated "name:distance" by distance, "-" when empty.
    std::string joinHits(std::vector<std::pair<double, std::string>> hits)
    {
      std::sort(hits.begin(), hits.end());
      std::string v;
      for (const auto& [d, name] : hits)
      {
        char b[32];
        std::snprintf(b, sizeof b, ":%.4f", d);
        v += (v.empty() ? "" : ",") + name + b;
      }
      return v.empty() ? "-" : v;
    }
  }

  std::vector<double> twinDistances(const std::vector<Alkylation::Form>& cands, const std::vector<Step>* alpha,
                                    bool with_steps)
  {
    const std::vector<Step> base = alpha || !with_steps ? std::vector<Step>() : alphabet({});
    const std::vector<Step>& steps = alpha ? *alpha : base;
    const double c = cMass();
    std::vector<double> out;
    for (const auto& f : cands)
    {
      double d = std::numeric_limits<double>::infinity();
      for (const auto& g : cands)
        if (&g != &f) d = std::min(d, std::fabs(g.mass - f.mass));
      if (with_steps)
        for (const Step& st : steps) d = std::min(d, std::fabs(st.mass - (c + f.mass)));
      out.push_back(d);
    }
    return out;
  }

  double minTwinDistance(const std::vector<Alkylation::Form>& cands, const std::vector<Step>* alpha)
  {
    double d = std::numeric_limits<double>::infinity();
    for (double x : twinDistances(cands, alpha)) d = std::min(d, x);
    return d;
  }

  double resolvedBelowMz(const Param& p, double d_min)
  {
    if (!p.tol_ppm) return 2.0 * p.frag_tol < d_min ? std::numeric_limits<double>::infinity() : 0.0;
    if (!(p.frag_tol > 0.0)) return std::numeric_limits<double>::infinity();
    return d_min / (2.0 * p.frag_tol * 1e-6);
  }

  std::vector<std::string> twins(const std::vector<Alkylation::Form>& cands, double tol_da, const std::vector<Step>* alpha)
  {
    const std::vector<Step> base = alpha ? std::vector<Step>() : alphabet({});
    const std::vector<Step>& steps = alpha ? *alpha : base;
    const double c = cMass();
    std::vector<std::string> out;
    for (const auto& f : cands)
    {
      std::vector<std::pair<double, std::string>> hits;
      for (const auto& g : cands)
      {
        if (&g == &f) continue;
        const double d = std::fabs(g.mass - f.mass);
        if (d <= 2.0 * tol_da) hits.emplace_back(d, cName(g));
      }
      for (const Step& st : steps)
      {
        const double d = std::fabs(st.mass - (c + f.mass));
        if (d <= 2.0 * tol_da) hits.emplace_back(d, st.name);
      }
      out.push_back(joinHits(std::move(hits)));
    }
    return out;
  }

  bool stepsResolved(const std::vector<Alkylation::Form>& cands, double tol_da, const std::vector<Step>* alpha)
  {
    return minTwinDistance(cands, alpha) > 2.0 * tol_da;
  }

  std::vector<std::vector<Alias>> aliasList(const std::vector<Alkylation::Form>& cands, double tol_da,
                                            const std::vector<Step>* alpha)
  {
    // Every step a pair can be made of: the residue steps and the C forms,
    // by name ("C" sorts before "C[...]" and "D"), so a pair is spelled with
    // its names in order ("C+G").
    const double c = cMass();
    std::vector<std::pair<std::string, double>> res;
    for (const Step& st : alpha ? *alpha : alphabet({})) res.emplace_back(st.name, st.mass);
    for (const auto& f : cands) res.emplace_back(cName(f), c + f.mass);
    std::sort(res.begin(), res.end());
    std::vector<std::vector<Alias>> out;
    for (std::size_t k = 0; k < cands.size(); ++k)
    {
      const auto& f = cands[k];
      const double target = c + f.mass;
      std::vector<Alias> hits;
      for (std::size_t i = 0; i < res.size(); ++i)
        for (std::size_t j = i; j < res.size(); ++j)
        {
          const double m = res[i].second + res[j].second;
          const double d = std::fabs(m - target);
          if (d > 2.0 * tol_da) continue;
          Alias a;
          a.kind = Alias::Kind::PAIR;
          a.form = static_cast<int>(k);
          a.x = res[i].second;
          a.y = res[j].second;
          a.mass = m;
          a.dist = d;
          a.name = res[i].first + "+" + res[j].first;
          hits.push_back(std::move(a));
        }
      // 1.13 #22 review: an edge that starts or ends on the 13C peak of an
      // ion (not deisotoped, or under -no_deisotope) reads as another form
      // +/- 1.00336 Da: C[Carbamidomethyl] + 13C lies 0.0193 Da from
      // C[Carboxymethyl].
      for (std::size_t g = 0; g < cands.size(); ++g)
      {
        if (g == k) continue;
        for (int sign : {+1, -1})
        {
          const double m = c + cands[g].mass + sign * C13_SPACING;
          const double d = std::fabs(m - target);
          if (d > 2.0 * tol_da) continue;
          Alias a;
          a.kind = Alias::Kind::ISO;
          a.form = static_cast<int>(k);
          a.other = static_cast<int>(g);
          a.shift = sign * C13_SPACING;
          a.mass = m;
          a.dist = d;
          a.name = "C[" + cands[g].name + "]" + (sign > 0 ? "+13C" : "-13C");
          hits.push_back(std::move(a));
        }
      }
      std::sort(hits.begin(), hits.end(),
                [](const Alias& a, const Alias& b) { return a.dist != b.dist ? a.dist < b.dist : a.name < b.name; });
      out.push_back(std::move(hits));
    }
    return out;
  }

  std::vector<std::string> aliases(const std::vector<Alkylation::Form>& cands, double tol_da, const std::vector<Step>* alpha)
  {
    std::vector<std::string> out;
    for (const std::vector<Alias>& list : aliasList(cands, tol_da, alpha))
    {
      std::vector<std::pair<double, std::string>> hits;
      for (const Alias& a : list) hits.emplace_back(a.dist, a.name);
      out.push_back(joinHits(std::move(hits)));
    }
    return out;
  }

  namespace
  {
    /// The tagger's per-peak tolerance (FASTagger.cpp tolAt).
    double tolAt(const Param& p, double mz) { return p.tol_ppm ? mz * p.frag_tol * 1e-6 : p.frag_tol; }

    /// Index of the most intense peak within @p tol of @p mz, -1 when none.
    long peakNear(const OpenMS::MSSpectrum& s, double mz, double tol)
    {
      auto it = std::lower_bound(s.begin(), s.end(), mz - tol,
                                 [](const OpenMS::Peak1D& pk, double v) { return pk.getMZ() < v; });
      long best = -1;
      for (; it != s.end() && it->getMZ() <= mz + tol; ++it)
        if (best < 0 || it->getIntensity() > s[static_cast<std::size_t>(best)].getIntensity())
          best = static_cast<long>(it - s.begin());
      return best;
    }

    /// Whether @p mz lies within the m/z range of the peaks (widened by @p tol).
    bool inRange(const OpenMS::MSSpectrum& s, double mz, double tol)
    {
      return !s.empty() && mz >= s.front().getMZ() - tol && mz <= s.back().getMZ() + tol;
    }
  }

  AliasCheck aliasExplains(double lo, double hi, int z, const Alias& a, const SpectrumPeaks& sp, const Param& p)
  {
    if (!sp.peaks || sp.peaks->empty() || z < 1) return AliasCheck::UNTESTABLE;
    const OpenMS::MSSpectrum& s = *sp.peaks;
    const double zz = static_cast<double>(z);
    bool testable = false;
    const auto probe = [&](double mz) {
      const double tol = tolAt(p, mz);
      if (!inRange(s, mz, tol)) return false;
      testable = true;
      return peakNear(s, mz, tol) >= 0;
    };
    if (a.kind == Alias::Kind::PAIR)
    {
      // The two orders of the pair put the missing peak at lo + X/z or
      // lo + Y/z; the complementary series has it at the partner m/z.
      const double comp = sp.prec_mass > 0.0 ? sp.prec_mass / zz + 2.0 * OpenMS::Constants::PROTON_MASS_U : 0.0;
      for (double m : {a.x, a.y})
      {
        const double mid = lo + m / zz;
        if (probe(mid)) return AliasCheck::EXPLAINED;
        if (comp > 0.0 && probe(comp - mid)) return AliasCheck::EXPLAINED;
      }
      return testable ? AliasCheck::NOT_EXPLAINED : AliasCheck::UNTESTABLE;
    }
    // ISO: +13C, the edge ends on the 13C peak of the ion at hi - 1.00336/z;
    // -13C, it starts on the 13C peak of the ion at lo - 1.00336/z. The
    // monoisotopic peak is at least as intense as its 13C peak.
    const double end = a.shift > 0.0 ? hi : lo;
    const double mono = end - C13_SPACING / zz;
    const double tol = tolAt(p, mono);
    if (!inRange(s, mono, tol)) return AliasCheck::UNTESTABLE;
    const long m = peakNear(s, mono, tol);
    if (m < 0) return AliasCheck::NOT_EXPLAINED;
    const long e = peakNear(s, end, tolAt(p, end));
    const double end_int = e >= 0 ? s[static_cast<std::size_t>(e)].getIntensity() : 0.0;
    return s[static_cast<std::size_t>(m)].getIntensity() >= end_int ? AliasCheck::EXPLAINED : AliasCheck::NOT_EXPLAINED;
  }

  namespace
  {
    /// CO, the loss from a residue's b-type ion that gives its immonium (a-type) ion.
    const double CO_MASS = 12.0 + 15.9949146196;

    /// The immonium (a-type, 1+) m/z of a step of @p mass Da.
    double immoniumOf(double mass) { return mass - CO_MASS + OpenMS::Constants::PROTON_MASS_U; }

    /// Whether an ion at @p mz could have been seen in @p s: inside a scan
    /// window the spectrum declares (the acquisition range), else inside the
    /// range of its peaks.
    bool acquired(const OpenMS::MSSpectrum& s, double mz, double tol)
    {
      const auto& w = s.getInstrumentSettings().getScanWindows();
      if (w.empty()) return inRange(s, mz, tol);
      for (const auto& x : w)
        if (x.end > x.begin && mz >= x.begin - tol && mz <= x.end + tol) return true;
      return false;
    }
  }

  double immoniumMz(const Alkylation::Form& f) { return immoniumOf(cMass() + f.mass); }

  std::vector<double> aliasIons(const Alias& a, const std::vector<Alkylation::Form>& cands)
  {
    if (a.kind == Alias::Kind::PAIR) return {immoniumOf(a.x), immoniumOf(a.y)};
    if (a.other >= 0 && static_cast<std::size_t>(a.other) < cands.size())
      return {immoniumMz(cands[static_cast<std::size_t>(a.other)])};
    return {};
  }

  bool immoniumConfirms(int k, const Alias& a, const std::vector<Alkylation::Form>& cands, const SpectrumPeaks& sp,
                        const Param& p)
  {
    if (k < 0 || static_cast<std::size_t>(k) >= cands.size()) return false;
    const OpenMS::MSSpectrum* s = sp.raw ? sp.raw : sp.peaks;
    if (!s || s->empty()) return false;
    const double mz = immoniumMz(cands[static_cast<std::size_t>(k)]);
    const double tol = tolAt(p, mz);
    // The C forms the alias reads instead: its pair steps that are a C form
    // (C+G reads unmodified C), or its other form (13C).
    const double c = cMass();
    std::vector<int> other;
    for (std::size_t g = 0; g < cands.size(); ++g)
    {
      if (static_cast<int>(g) == k) continue;
      const double cg = c + cands[g].mass;
      const bool in_pair = a.kind == Alias::Kind::PAIR && (std::fabs(a.x - cg) < 1e-6 || std::fabs(a.y - cg) < 1e-6);
      if (in_pair || (a.kind == Alias::Kind::ISO && a.other == static_cast<int>(g))) other.push_back(static_cast<int>(g));
    }
    for (int g : other)
    {
      const double og = immoniumMz(cands[static_cast<std::size_t>(g)]);
      for (double shift : {0.0, C13_SPACING})
        if (std::fabs(og + shift - mz) <= tol + tolAt(p, og + shift)) return false;  // that reading's own ion
    }
    if (!inRange(*s, mz, tol) || peakNear(*s, mz, tol) < 0) return false;
    // Codex6 review n1: the form's immonium ion does not tell an exact pair
    // alias apart. The internal a-type ion of the pair (X + Y - CO + H+) has
    // the pair's mass less CO, which is the form's C mass less CO: for
    // unmodified GC or CG it is 133.0430, the CAM immonium ion itself. What
    // only the alias reading gives are the immonium ions of its own steps
    // (76.022 for unmodified C, 30.034 for G); the vote counts only when
    // each of them that could have been seen is absent, and (a pair) at
    // least one could have been: else nothing in the spectrum tells the two
    // readings apart. An ISO alias's other form has an immonium ion of its
    // own (checked above), which must be absent where it could be seen.
    bool tested = false;
    for (double m : aliasIons(a, cands))
    {
      const double t = tolAt(p, m);
      if (!acquired(*s, m, t)) continue;
      tested = true;
      if (peakNear(*s, m, t) >= 0) return false;  // an ion of the alias reading
    }
    return tested || a.kind != Alias::Kind::PAIR;
  }

  VoteContext voteContext(const Param& p, const std::vector<Alkylation::Form>& cands, const std::vector<Step>* alpha)
  {
    VoteContext ctx;
    ctx.cands = cands;
    ctx.tol = p;
    // Listed at the widest window an edge of the run can have (Da: the
    // tolerance; ppm: at 5000 m/z); each edge keeps the aliases inside its
    // own two windows (addTag()).
    const double widest = p.tol_ppm ? 5000.0 * p.frag_tol * 1e-6 : p.frag_tol;
    ctx.aliases = aliasList(cands, widest, alpha);
    const std::vector<double> d = twinDistances(cands, alpha);
    ctx.resolved_below_mz = std::numeric_limits<double>::infinity();
    for (std::size_t k = 0; k < ctx.resolved_below.size() && k < d.size(); ++k)
    {
      ctx.resolved_below[k] = resolvedBelowMz(p, d[k]);
      ctx.resolved_below_mz = std::min(ctx.resolved_below_mz, ctx.resolved_below[k]);
    }
    return ctx;
  }

  namespace
  {
    Alkylation::Call callAt(const Tally& t, const Alkylation::Settings& s, const std::vector<Alkylation::Form>& cands,
                            double resolved_below_mz)
    {
      Alkylation::Call c = Alkylation::callAlkylation(t.asAlkylationTally(cands), s);
      // Codex6 review n1: an abstention for want of evidence against an
      // alias is not a vote for the other forms. Abstentions fall on the
      // aliased forms only, so leaving them out of the share lets another
      // form clear min_share on the votes the abstaining form lost.
      if (t.alias_unconfirmed > 0)
      {
        c.abstained = t.alias_unconfirmed;
        c.voted += c.abstained;
        c.share = static_cast<double>(c.top) / static_cast<double>(c.voted);
        if (c.called && c.share < s.min_share)
        {
          c.called = false;
          c.reason = "ambiguous";
        }
      }
      if (!(resolved_below_mz > 0.0) || (t.spectra == 0 && t.unresolved > 0))
      {
        c.called = false;
        c.reason = "unresolved_forms";
      }
      return c;
    }
  }

  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s, const std::vector<Alkylation::Form>& cands,
                            double tol_da, const std::vector<Step>* alpha)
  {
    return callAt(t, s, cands, stepsResolved(cands, tol_da, alpha) ? std::numeric_limits<double>::infinity() : 0.0);
  }

  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s, const VoteContext& ctx)
  {
    return callAt(t, s, ctx.cands, ctx.resolved_below_mz);
  }

  std::array<std::uint32_t, NUM_CANDIDATES> formsInTag(const std::string& seq, const std::vector<Alkylation::Form>& cands)
  {
    std::array<std::uint32_t, NUM_CANDIDATES> n{};
    for (std::size_t i = 0; i < seq.size(); ++i)
    {
      if (seq[i] == '[')  // skip another residue's annotation
      {
        const std::size_t e = seq.find(']', i);
        if (e == std::string::npos) break;
        i = e;
        continue;
      }
      if (seq[i] != 'C') continue;
      if (i + 1 < seq.size() && seq[i + 1] == '[')
      {
        const std::size_t e = seq.find(']', i + 1);
        if (e == std::string::npos) break;
        const std::string name = seq.substr(i + 2, e - i - 2);
        for (int k = 0; k < NUM_CANDIDATES; ++k)
          if (k != UNMODIFIED && cands[static_cast<std::size_t>(k)].name == name) { ++n[static_cast<std::size_t>(k)]; break; }
        i = e;
      }
      else
        ++n[UNMODIFIED];
    }
    return n;
  }

  bool cAtEnd(const std::string& seq)
  {
    if (seq.empty()) return false;
    if (seq.front() == 'C' || seq.back() == 'C') return true;
    if (seq.back() != ']') return false;
    const std::size_t b = seq.rfind('[');
    return b != std::string::npos && b > 0 && seq[b - 1] == 'C';
  }

  namespace
  {
    /// Per residue of @p seq (N->C), its candidate index; -1 for another residue or an unknown C annotation.
    std::vector<int> residueForms(const std::string& seq, const std::vector<Alkylation::Form>& cands)
    {
      std::vector<int> out;
      for (std::size_t i = 0; i < seq.size(); ++i)
      {
        int k = -1;
        const bool c = seq[i] == 'C';
        if (i + 1 < seq.size() && seq[i + 1] == '[')
        {
          const std::size_t e = seq.find(']', i + 1);
          if (e == std::string::npos) break;
          if (c)
          {
            const std::string name = seq.substr(i + 2, e - i - 2);
            for (int j = 0; j < NUM_CANDIDATES; ++j)
              if (j != UNMODIFIED && cands[static_cast<std::size_t>(j)].name == name) { k = j; break; }
          }
          i = e;
        }
        else if (c)
          k = UNMODIFIED;
        out.push_back(k);
      }
      return out;
    }

    /// What the vote checks say of one tag.
    struct Checked
    {
      bool unresolved = false;
      bool alias = false;
      bool unconfirmed = false;
    };

    /// The vote checks of one C-bearing tag (Tally::addTag with a context).
    Checked checkTag(const Tag& t, const VoteContext& ctx, const SpectrumPeaks& sp)
    {
      Checked out;
      const std::vector<int> rf = residueForms(t.seq, ctx.cands);
      const std::size_t n = rf.size();
      // The path peaks locate each residue's edge: seq is spelled from the
      // high m/z end, so residue k is the step n-1-k (no gap: one residue
      // per step).
      const bool located = t.path_mz.size() == n + 1 && !t.gapped;
      const int z = t.charge > 0 ? t.charge : 1;
      for (std::size_t k = 0; k < n; ++k)
      {
        const int f = rf[k];
        if (f < 0) continue;
        double lo = 0.0, hi = t.high_mz;
        if (located)
        {
          lo = t.path_mz[n - 1 - k];
          hi = t.path_mz[n - k];
        }
        // Review n2: the windows at the edge's own m/z hold a twin.
        if (hi >= ctx.resolved_below[static_cast<std::size_t>(f)])
        {
          out.unresolved = true;
          return out;
        }
        if (out.alias) continue;
        for (const Alias& a : ctx.aliases[static_cast<std::size_t>(f)])
        {
          if (!located)
          {
            // No edge to test: the alias cannot be ruled out where its
            // distance fits the windows at the tag's top.
            if (a.dist <= 2.0 * tolAt(ctx.tol, hi)) out.alias = true;
            continue;
          }
          // Only an alias the two windows of this edge could have matched.
          const double edge = (hi - lo) * z;
          if (std::fabs(a.mass - edge) > (tolAt(ctx.tol, lo) + tolAt(ctx.tol, hi)) * z) continue;
          if (aliasExplains(lo, hi, z, a, sp, ctx.tol) != AliasCheck::NOT_EXPLAINED) out.alias = true;
          // Release-gate review n1: no trace of the alias is no evidence for
          // the form; its immonium ion is.
          else if (!immoniumConfirms(f, a, ctx.cands, sp, ctx.tol)) out.unconfirmed = true;
        }
      }
      return out;
    }
  }

  void Tally::addTag(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands)
  {
    addTagChecked(v, t, cands, nullptr, nullptr);
  }

  void Tally::addTag(Vote& v, const Tag& t, const VoteContext& ctx, const SpectrumPeaks& sp)
  {
    addTagChecked(v, t, ctx.cands, &ctx, &sp);
  }

  void Tally::addTagChecked(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands, const VoteContext* ctx,
                            const SpectrumPeaks* sp)
  {
    if (!Alkylation::countsTag(t.gapped, t.evalue)) return;
    if (t.charge != 1)
    {
      ++tags_multi;
      return;
    }
    ++tags;
    if (!v.any || t.evalue < v.best) v.best = t.evalue;
    v.any = true;
    const auto n = formsInTag(t.seq, cands);
    int form = -1, kinds = 0;
    for (int k = 0; k < NUM_CANDIDATES; ++k)
      if (n[static_cast<std::size_t>(k)])
      {
        residues[static_cast<std::size_t>(k)] += n[static_cast<std::size_t>(k)];
        ++kinds;
        form = k;
      }
    if (kinds == 0) return;
    ++tags_with_c;
    if (cAtEnd(t.seq)) return;
    if (v.have && t.evalue > v.evalue) return;
    // Only a tag that is kept, or ties the kept one, is checked.
    const Checked ck = ctx && sp ? checkTag(t, *ctx, *sp) : Checked{};
    if (v.have && t.evalue == v.evalue)
    {
      // An equal E-value with another form, an alias or a twin: the evidence does not decide.
      if (ck.unresolved) v.unresolved = true;
      if (ck.alias) v.alias = true;
      // Of two tags of one form, one without an unconfirmed alias confirms the vote.
      if (!ck.unconfirmed) v.unconfirmed = false;
      if (kinds > 1 || v.conflict || form != v.form || ck.alias)
      {
        v.conflict = true;
        v.form = -1;
      }
      return;
    }
    v.have = true;
    v.evalue = t.evalue;
    v.unresolved = ck.unresolved;
    v.alias = ck.alias;
    v.unconfirmed = ck.unconfirmed;
    v.conflict = kinds > 1 || ck.alias;
    v.form = v.conflict ? -1 : form;
  }

  void Tally::addSpectrum(const Vote& v)
  {
    ++spectra_tagged;
    if (!v.have || v.evalue > v.best || v.evalue > VOTE_MAX_EVALUE) return;
    if (v.unresolved)
    {
      ++unresolved;
      return;
    }
    if (v.unconfirmed && !v.conflict)
    {
      ++alias_unconfirmed;
      return;
    }
    ++spectra;
    if (v.conflict)
    {
      ++conflict;
      if (v.alias) ++alias_rejected;
    }
    else ++votes[static_cast<std::size_t>(v.form)];
  }

  void Tally::merge(const Tally& o)
  {
    spectra_tagged += o.spectra_tagged;
    spectra_cz += o.spectra_cz;
    tags += o.tags;
    tags_multi += o.tags_multi;
    tags_with_c += o.tags_with_c;
    spectra += o.spectra;
    conflict += o.conflict;
    alias_rejected += o.alias_rejected;
    unresolved += o.unresolved;
    alias_unconfirmed += o.alias_unconfirmed;
    for (std::size_t k = 0; k < votes.size(); ++k) votes[k] += o.votes[k];
    for (std::size_t k = 0; k < residues.size(); ++k) residues[k] += o.residues[k];
  }

  Alkylation::Tally Tally::asAlkylationTally(const std::vector<Alkylation::Form>& cands) const
  {
    Alkylation::Tally a;
    a.tags = tags;
    a.spectra = spectra;
    a.conflict = conflict;
    for (int k = 0; k < NUM_CANDIDATES; ++k)
    {
      a.cls[static_cast<std::size_t>(cands[static_cast<std::size_t>(k)].cls)] += votes[static_cast<std::size_t>(k)];
      a.form[static_cast<std::size_t>(k)] = votes[static_cast<std::size_t>(k)];
    }
    return a;
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
    std::string votedText(const Alkylation::Call& c)
    {
      return u(c.voted) + " votes are in the share: " + u(c.binned) + " for a form, " +
             u(c.voted - c.binned - c.abstained) + " conflicted, " + u(c.abstained) +
             " abstained (alias_unconfirmed).";
    }
  }

  std::vector<Digest::Row> rows(const Tally& t, const Alkylation::Call& c, const Alkylation::Settings& s,
                                const std::vector<Alkylation::Form>& cands, const ReportInfo& info)
  {
    using Digest::num;
    std::vector<Digest::Row> r;
    auto add = [&](const char* sec, const std::string& key, const std::string& value, const std::string& n,
                   const std::string& d) { r.push_back(Digest::Row{sec, key, value, n, d}); };
    // ---- alkt_run
    add("alkt_run", "format", std::to_string(REPORT_FORMAT), "-",
        "The database-free alkylation report follows format " + std::to_string(REPORT_FORMAT) +
            " (doc/ALKYLATION-REPORT.md, -alkylation_tags_out).");
    add("alkt_run", "method", "shadow_tags", "-",
        "Every MS2 spectrum is tagged a second time with unmodified C and one alternative C edge per reagent; "
        "those tags are not written. No database is used.");
    add("alkt_run", "status", "experimental", "-",
        "Experimental: the held-out test passed at the margin, 40 of 57 runs called and 37 of the calls right, "
        "with report format 2; the voting rules of format " + std::to_string(REPORT_FORMAT) +
            " were not tested again (doc/ALKYLATION-REPORT.md). Unalkylated and low-resolution runs are rarely called.");
    std::string forms;
    for (const auto& f : cands) forms += (forms.empty() ? "" : ",") + f.name;
    add("alkt_run", "forms", forms, std::to_string(cands.size()), "The C forms the shadow pass can spell.");
    std::string dropped;
    for (const auto& d : info.dropped) dropped += (dropped.empty() ? "" : ",") + d;
    add("alkt_run", "c_mods_removed", dropped.empty() ? "-" : dropped, std::to_string(info.dropped.size()),
        dropped.empty() ? "The run has no modification on C."
                        : "The shadow pass leaves out the run's C modifications: " + dropped + ".");
    add("alkt_run", "tag_lengths", info.lengths.empty() ? "-" : info.lengths, "-",
        "The shadow pass uses the run's seed lengths, extension and tolerances, without gap edges.");
    add("alkt_run", "spectra_tagged", u(t.spectra_tagged), "-",
        u(t.spectra_tagged) + " MS2 spectra with peaks and a precursor were shadow-tagged (b/y); some may give no tag.");
    add("alkt_run", "spectra_cz", u(t.spectra_cz), "-",
        u(t.spectra_cz) + " MS2 spectra were read as c/z and are not shadow-tagged.");
    add("alkt_run", "tags", u(t.tags), "-",
        u(t.tags) + " shadow tags are ungapped with an E-value of at most 1, read at fragment charge 1.");
    add("alkt_run", "tags_multi", u(t.tags_multi), "-",
        u(t.tags_multi) + " such tags read at fragment charge 2 or more are not counted (C[Propionamide]/2 reads like S).");
    add("alkt_run", "tags_with_c", u(t.tags_with_c), u(t.tags), u(t.tags_with_c) + " of them hold a C.");
    add("alkt_run", "spectra", u(t.spectra), u(t.spectra_tagged),
        u(t.spectra) + " spectra vote: their best counted tag holds a C, none at an end of the tag, with an E-value of at most " +
            num(VOTE_MAX_EVALUE) + ".");
    add("alkt_run", "min_spectra", u(s.min_spectra), "-",
        "A call needs " + u(s.min_spectra) + " votes in total and for the called class.");
    add("alkt_run", "min_share", num(s.min_share), "-", "A call needs a share of " + num(s.min_share) + " of the votes, conflicts included.");
    add("alkt_run", "edge_tolerance", num(info.tol_da), "-",
        "The report reasons with an edge tolerance of " + num(info.tol_da) +
            " Da (the fragment tolerance, or in ppm at 1000 m/z).");
    const std::vector<Step>* alpha = info.alpha.empty() ? nullptr : &info.alpha;
    const bool resolved = stepsResolved(cands, info.tol_da, alpha);
    add("alkt_run", "forms_resolved", resolved ? "yes" : "no", "-",
        resolved ? "No C form lies within twice the edge tolerance of another C form or of a residue this run can read "
                   "(two-step and isotope-shifted readings are listed under alias)."
        : info.tol_ppm
            ? "At 1000 m/z a C form lies within twice the edge tolerance of another C form or of a residue this run can read "
              "(twin.<form>); in ppm the guard applies per vote at the C edge's m/z (resolved_below_mz)."
            : "A C form lies within twice the edge tolerance of another C form or of a residue this run can read "
              "(twin.<form>; Carbamidomethyl and Carboxymethyl are 0.984 Da apart): no call is made.");
    const bool every_mz = std::isinf(info.resolved_below_mz);
    add("alkt_run", "resolved_below_mz", every_mz ? "-" : num(info.resolved_below_mz), "-",
        every_mz ? std::string("The edge windows hold no twin of a C form at any m/z.")
        : info.resolved_below_mz <= 0.0
            ? std::string("The edge windows hold a twin of a C form at every m/z: no vote is resolved.")
            : "A C edge reaching " + num(info.resolved_below_mz) +
                  " m/z or more has a twin of its form in the two edge windows (the tolerance at its own m/z); its "
                  "vote is set aside (alkt_form unresolved).");

    // ---- alkt_form
    std::uint64_t binned = 0;
    for (std::uint64_t v : t.votes) binned += v;
    std::uint64_t res_all = 0;
    for (std::uint64_t v : t.residues) res_all += v;
    for (int k = 0; k < NUM_CANDIDATES; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      add("alkt_form", f.name, u(t.votes[static_cast<std::size_t>(k)]), u(binned),
          u(t.votes[static_cast<std::size_t>(k)]) + " spectra vote " + f.name + " (" + num(f.mass) + " Da on C; class " +
              Alkylation::className(f.cls) + ").");
    }
    for (int k = 0; k < NUM_CANDIDATES; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      add("alkt_form", "residues." + f.name, u(t.residues[static_cast<std::size_t>(k)]), u(res_all),
          u(t.residues[static_cast<std::size_t>(k)]) + " of " + u(res_all) + " C residues in counted tags are " + f.name + ".");
    }
    const std::vector<std::string> al = aliases(cands, info.tol_da, alpha);
    for (int k = 0; k < NUM_CANDIDATES; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      add("alkt_form", "alias." + f.name, al[static_cast<std::size_t>(k)], "-",
          al[static_cast<std::size_t>(k)] == "-"
              ? "No two residues sum to C[" + f.name + "] and no 13C-shifted C form reads like it within twice the edge tolerance."
              : "Two residues whose middle peak is missing (X+Y), or another C form whose edge starts or ends on a 13C peak "
                "(C[Name]+13C / -13C), read like C[" + f.name + "] (reading:distance in Da); a vote whose edge the spectrum "
                "explains so is a conflict (alias_rejected); one it does not explain counts only with the C[" + f.name +
                "] immonium ion at " + num(immoniumMz(f)) + " m/z and, for X+Y, with the immonium ions of X and Y "
                "absent where the spectrum could hold them (one of them there at least; the X+Y internal a-ion has the "
                "immonium's m/z), else it abstains (alias_unconfirmed).");
    }
    const std::vector<std::string> tw = twins(cands, info.tol_da, alpha);
    for (int k = 0; k < NUM_CANDIDATES; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      const std::string& v = tw[static_cast<std::size_t>(k)];
      add("alkt_form", "twin." + f.name, v, "-",
          v == "-" ? "No other C form and no residue this run can read lies within twice the edge tolerance of C[" + f.name + "]."
                   : "One edge of this mass also reads as another C form or a residue (reading:distance in Da): the forms "
                     "cannot be told apart, so no call is made.");
    }
    add("alkt_form", "conflict", u(t.conflict), u(t.spectra),
        u(t.conflict) + " voting spectra have a best tag (or tags of equal E-value) with C residues of two forms, or one "
                        "an alias explains; they count against the share.");
    add("alkt_form", "alias_rejected", u(t.alias_rejected), u(t.conflict),
        u(t.alias_rejected) + " of the conflicts have a C edge that the spectrum explains as an alias (a peak between "
                              "the two residues, in either series, or the monoisotopic peak beside a 13C endpoint), or "
                              "one it cannot test.");
    add("alkt_form", "unresolved", u(t.unresolved), u(t.spectra + t.unresolved),
        u(t.unresolved) + " spectra would vote with a C edge at or above resolved_below_mz, where the edge windows "
                          "hold a twin of its form; they are set aside, not in the share.");
    add("alkt_form", "alias_unconfirmed", u(t.alias_unconfirmed), u(t.spectra + t.unresolved + t.alias_unconfirmed),
        u(t.alias_unconfirmed) + " spectra would vote with a C edge that an alias also reads, with no trace of the alias "
                                 "and without an ion that tells the readings apart (the form's immonium, none of the alias's own immonium "
                                 "ions); they abstain, and count in the share's denominator.");

    // ---- alkylation_tags_call
    const std::string name = c.cls >= 0 ? Alkylation::className(c.cls) : "-";
    const char* sec = "alkylation_tags_call";
    if (c.called)
    {
      double mass = 0.0;
      for (const auto& f : cands)
        if (f.cls == c.cls && f.cls != Alkylation::NONE) { mass = f.mass; break; }
      add(sec, "status", "call", u(c.binned),
          c.cls == Alkylation::NONE
              ? "The votes favour unalkylated cysteines (database-free; experimental)."
              : "The votes favour " + name +
                    " (database-free; experimental).");
      add(sec, "reagent", name, u(c.top), "The call is " + name + ".");
      add(sec, "mass", c.cls == Alkylation::NONE ? "-" : num(mass), "-",
          c.cls == Alkylation::NONE ? "A call of none has no reagent mass." : name + " adds " + num(mass) + " Da to C.");
      add(sec, "share", num(c.share), u(c.voted),
          "A share of " + f3(c.share) + " of the " + u(c.voted) + " votes (binned, conflicted and abstained) are " + name + ".");
      add(sec, "voted", u(c.voted), u(c.binned), votedText(c));
      add(sec, "reason", "-", "-", "The call is made.");
    }
    else
    {
      add(sec, "status", "no_call", u(c.binned),
          c.reason == "unresolved_forms"
              ? std::string("No alkylation is called: the fragment tolerance does not resolve the C forms where the votes are.")
          : c.reason == "few_cys_spectra"
              ? "No alkylation is called: " + u(c.binned) + " votes are fewer than " + u(s.min_spectra) + "."
              : "No alkylation is called: the leading class " + name + " has " + u(c.top) + " of " + u(c.voted) +
                    " votes (binned, conflicted and abstained), short of " + u(s.min_spectra) + " votes and a share of " +
                    num(s.min_share) + " (or tied).");
      add(sec, "reagent", "-", "-", "No reagent is called.");
      add(sec, "mass", "-", "-", "No reagent is called.");
      add(sec, "share", c.voted ? num(c.share) : "-", u(c.voted),
          c.voted ? "The leading class " + name + " has a share of " + f3(c.share) + " of the " + u(c.voted) +
                        " votes (binned, conflicted and abstained)."
                  : "No spectrum votes.");
      add(sec, "voted", u(c.voted), u(c.binned), votedText(c));
      add(sec, "reason", c.reason, "-", "The first no-call rule that applies is " + c.reason + ".");
    }
    return r;
  }
}
