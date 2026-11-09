// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "AlkylationTags.h"

#include <cstdio>
#include <stdexcept>

namespace FASTag::AlkylationTags
{
  std::vector<Alkylation::Form> candidates(const std::vector<Alkylation::Form>& forms)
  {
    if (forms.size() < static_cast<std::size_t>(kNumCandidates) || forms[kUnmodified].name != "unmodified")
      throw std::runtime_error("the Cys forms are not in the expected order");
    return std::vector<Alkylation::Form>(forms.begin(), forms.begin() + kNumCandidates);
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
    for (int k = 0; k < kNumCandidates; ++k)
      if (k != kUnmodified) out.push_back(ModSpec{'C', cands[static_cast<std::size_t>(k)].mass, cands[static_cast<std::size_t>(k)].name, true});
    return out;
  }

  Param shadowParam(const Param& run, const std::vector<Alkylation::Form>& cands, std::vector<std::string>* dropped)
  {
    Param p = run;
    p.mods = shadowMods(run.mods, cands, dropped);
    p.max_gaps = 0;
    p.ion_pair = IonSeries::ionPair(IonSeries::Series::BY);
    return p;
  }

  std::array<std::uint32_t, kNumCandidates> formsInTag(const std::string& seq, const std::vector<Alkylation::Form>& cands)
  {
    std::array<std::uint32_t, kNumCandidates> n{};
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
        for (int k = 0; k < kNumCandidates; ++k)
          if (k != kUnmodified && cands[static_cast<std::size_t>(k)].name == name) { ++n[static_cast<std::size_t>(k)]; break; }
        i = e;
      }
      else
        ++n[kUnmodified];
    }
    return n;
  }

  void Tally::addTag(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands)
  {
    if (!Alkylation::countsTag(t.gapped, t.evalue)) return;
    ++tags;
    const auto n = formsInTag(t.seq, cands);
    int form = -1, kinds = 0;
    for (int k = 0; k < kNumCandidates; ++k)
      if (n[static_cast<std::size_t>(k)])
      {
        residues[static_cast<std::size_t>(k)] += n[static_cast<std::size_t>(k)];
        ++kinds;
        form = k;
      }
    if (kinds == 0) return;
    ++tags_with_c;
    if (v.have && !(t.evalue < v.evalue)) return;
    v.have = true;
    v.evalue = t.evalue;
    v.conflict = kinds > 1;
    v.form = kinds > 1 ? -1 : form;
  }

  void Tally::addSpectrum(const Vote& v)
  {
    ++spectra_tagged;
    if (!v.have) return;
    ++spectra;
    if (v.conflict) ++conflict;
    else ++votes[static_cast<std::size_t>(v.form)];
  }

  void Tally::merge(const Tally& o)
  {
    spectra_tagged += o.spectra_tagged;
    spectra_cz += o.spectra_cz;
    tags += o.tags;
    tags_with_c += o.tags_with_c;
    spectra += o.spectra;
    conflict += o.conflict;
    for (std::size_t k = 0; k < votes.size(); ++k) votes[k] += o.votes[k];
    for (std::size_t k = 0; k < residues.size(); ++k) residues[k] += o.residues[k];
  }

  Alkylation::Tally Tally::asAlkylationTally(const std::vector<Alkylation::Form>& cands) const
  {
    Alkylation::Tally a;
    a.tags = tags;
    a.spectra = spectra;
    a.conflict = conflict;
    for (int k = 0; k < kNumCandidates; ++k)
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
  }

  std::vector<Digest::Row> rows(const Tally& t, const Alkylation::Call& c, const Alkylation::Settings& s,
                                const std::vector<Alkylation::Form>& cands, const ReportInfo& info)
  {
    using Digest::num;
    std::vector<Digest::Row> r;
    auto add = [&](const char* sec, const std::string& key, const std::string& value, const std::string& n,
                   const std::string& d) { r.push_back(Digest::Row{sec, key, value, n, d}); };
    // ---- alkt_run
    add("alkt_run", "format", std::to_string(kReportFormat), "-",
        "The database-free alkylation report follows format " + std::to_string(kReportFormat) +
            " (doc/ALKYLATION-REPORT.md, -alkylation_tags_out).");
    add("alkt_run", "method", "shadow_tags", "-",
        "Every MS2 spectrum is tagged a second time with unmodified C and one alternative C edge per reagent; "
        "those tags are not written. No database is used.");
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
    add("alkt_run", "spectra_tagged", u(t.spectra_tagged), "-", u(t.spectra_tagged) + " MS2 spectra were shadow-tagged (b/y).");
    add("alkt_run", "spectra_cz", u(t.spectra_cz), "-",
        u(t.spectra_cz) + " MS2 spectra were read as c/z and are not shadow-tagged.");
    add("alkt_run", "tags", u(t.tags), "-", u(t.tags) + " shadow tags are ungapped with an E-value of at most 1.");
    add("alkt_run", "tags_with_c", u(t.tags_with_c), u(t.tags), u(t.tags_with_c) + " of them hold a C.");
    add("alkt_run", "spectra", u(t.spectra), u(t.spectra_tagged),
        u(t.spectra) + " spectra have such a tag; each votes once, with its best one.");
    add("alkt_run", "min_spectra", u(s.min_spectra), "-",
        "A call needs " + u(s.min_spectra) + " votes in total and for the called class.");
    add("alkt_run", "min_share", num(s.min_share), "-", "A call needs a share of " + num(s.min_share) + " of the votes.");
    add("alkt_run", "confounds", "Carbamidomethyl=G+C,Propionamide=A+C,Nethylmaleimide~N+N|M+P", "-",
        "A C edge of these forms equals (or nearly equals) two residues whose middle peak is missing; such votes are not corrected.");

    // ---- alkt_form
    std::uint64_t binned = 0;
    for (std::uint64_t v : t.votes) binned += v;
    std::uint64_t res_all = 0;
    for (std::uint64_t v : t.residues) res_all += v;
    for (int k = 0; k < kNumCandidates; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      add("alkt_form", f.name, u(t.votes[static_cast<std::size_t>(k)]), u(binned),
          u(t.votes[static_cast<std::size_t>(k)]) + " spectra vote " + f.name + " (" + num(f.mass) + " Da on C; class " +
              Alkylation::className(f.cls) + ").");
    }
    for (int k = 0; k < kNumCandidates; ++k)
    {
      const auto& f = cands[static_cast<std::size_t>(k)];
      add("alkt_form", "residues." + f.name, u(t.residues[static_cast<std::size_t>(k)]), u(res_all),
          u(t.residues[static_cast<std::size_t>(k)]) + " of " + u(res_all) + " C residues in counted tags are " + f.name + ".");
    }
    add("alkt_form", "conflict", u(t.conflict), u(t.spectra),
        u(t.conflict) + " spectra have a best tag with C residues of two forms.");

    // ---- alkylation_tags_call
    const std::string name = c.cls >= 0 ? Alkylation::className(c.cls) : "-";
    const char* sec = "alkylation_tags_call";
    if (c.called)
    {
      double mass = 0.0;
      for (const auto& f : cands)
        if (f.cls == c.cls && f.cls != Alkylation::None) { mass = f.mass; break; }
      add(sec, "status", "call", u(c.binned),
          c.cls == Alkylation::None ? "The cysteines are not alkylated (database-free; not validated on held-out data)."
                                    : "The cysteines are alkylated with " + name +
                                          " (database-free; not validated on held-out data).");
      add(sec, "reagent", name, u(c.top), "The call is " + name + ".");
      add(sec, "mass", c.cls == Alkylation::None ? "-" : num(mass), "-",
          c.cls == Alkylation::None ? "A call of none has no reagent mass." : name + " adds " + num(mass) + " Da to C.");
      add(sec, "share", num(c.share), u(c.binned), "A share of " + f3(c.share) + " of the " + u(c.binned) + " votes are " + name + ".");
      add(sec, "reason", "-", "-", "The call is made.");
    }
    else
    {
      add(sec, "status", "no_call", u(c.binned),
          c.reason == "few_cys_spectra"
              ? "No alkylation is called: " + u(c.binned) + " votes are fewer than " + u(s.min_spectra) + "."
              : "No alkylation is called: the leading class " + name + " has " + u(c.top) + " of " + u(c.binned) +
                    " votes, short of " + u(s.min_spectra) + " votes and a share of " + num(s.min_share) + " (or tied).");
      add(sec, "reagent", "-", "-", "No reagent is called.");
      add(sec, "mass", "-", "-", "No reagent is called.");
      add(sec, "share", c.binned ? num(c.share) : "-", u(c.binned),
          c.binned ? "The leading class " + name + " has a share of " + f3(c.share) + "." : "No spectrum votes.");
      add(sec, "reason", c.reason, "-", "The first no-call rule that applies is " + c.reason + ".");
    }
    return r;
  }
}
