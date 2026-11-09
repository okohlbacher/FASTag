// FASTag 1.13 #22: the database-free alkylation call (src/AlkylationTags.h).
// Synthetic spectra and tags only; nothing is fitted.
//
//   alkylation_tags_test                                  run the unit tests
//   alkylation_tags_test --write-mzml <out> <form> [n]    write n synthetic MS2
//       spectra of single-Cys peptides whose C carries <form> (an
//       Alkylation::forms() name: Carbamidomethyl, ..., or unmodified), for
//       test/alkylation_tags_cli_test.sh
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "AlkylationTags.h"

#include "complement_synth.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/METADATA/Precursor.h>

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <set>
#include <string>
#include <vector>

namespace A = FASTag::Alkylation;
namespace AT = FASTag::AlkylationTags;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}

/// Single-Cys tryptic peptides, no G or A next to the C (the CAM / Propionamide
/// twins G+C and A+C), no M. The C is written as "C" and replaced by the form.
static const char* const kPeptides[] = {"LTSEFCYQEK", "DVHLPWCEFR", "SYELPDCQVK", "NFEECLTSVR",
                                        "TPEVCDHLWK", "QLSECYFTER", "VLDECFNPSK", "WYEPCLSVDR",
                                        "HTDFCEVLPK", "SPLECQYTWR", "FEDSCVLQPK", "TYLVCEDHFR"};

/// The peptide with its C as @p form ("unmodified": plain C).
static std::string withForm(const std::string& pep, const std::string& form)
{
  if (form == "unmodified") return pep;
  const std::size_t c = pep.find('C');
  return pep.substr(0, c) + "C(" + form + ")" + pep.substr(c + 1);
}

static int writeMzml(const std::string& out, const std::string& form, int n)
{
  OpenMS::PeakMap exp;
  int scan = 0;
  for (int rep = 0; scan < n; ++rep)
    for (const char* pep : kPeptides)
    {
      if (scan >= n) break;
      ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, form), 2, false, 0, 0.0, 20, 1000u + static_cast<unsigned>(scan));
      OpenMS::MSSpectrum sp = s.spec;
      sp.setMSLevel(2);
      sp.setRT(10.0 + scan);
      sp.setType(OpenMS::SpectrumSettings::SpectrumType::CENTROID);
      sp.setNativeID("controllerType=0 controllerNumber=1 scan=" + std::to_string(scan + 1));
      OpenMS::Precursor pr;
      pr.setMZ(s.prec_mz);
      pr.setCharge(2);
      pr.setActivationMethods({OpenMS::Precursor::ActivationMethod::HCD});
      sp.setPrecursors({pr});
      exp.addSpectrum(sp);
      ++scan;
    }
  OpenMS::MzMLFile().store(out, exp);
  return 0;
}

static FASTag::Tag tag(const std::string& seq, double e, bool gapped = false)
{
  FASTag::Tag t;
  t.seq = seq;
  t.evalue = e;
  t.gapped = gapped;
  return t;
}

int main(int argc, char** argv)
{
  if (argc >= 4 && std::string(argv[1]) == "--write-mzml")
    return writeMzml(argv[2], argv[3], argc >= 5 ? std::atoi(argv[4]) : 60);

  const std::vector<A::Form> forms = A::forms();
  const std::vector<A::Form> cands = AT::candidates(forms);

  // ---- candidates: the five reagents, then unmodified
  {
    check(cands.size() == 6, "six candidate forms");
    const char* want[] = {"Carbamidomethyl", "Propionamide", "Nethylmaleimide", "Methylthio", "Carboxymethyl", "unmodified"};
    for (int k = 0; k < 6; ++k) check(cands[static_cast<std::size_t>(k)].name == want[k], std::string("candidate ") + want[k]);
    check(cands[AT::kUnmodified].cls == A::None && cands[AT::kUnmodified].mass == 0.0, "unmodified is class none, 0 Da");
    check(std::fabs(cands[0].mass - 57.021464) < 1e-5, "Carbamidomethyl mass from ModificationsDB");
    check(std::fabs(cands[2].mass - 125.047679) < 1e-5, "Nethylmaleimide mass from ModificationsDB");
  }

  // ---- shadowMods / shadowParam: C mods out, five alternatives in, the rest kept
  {
    std::vector<FASTag::ModSpec> run = {{'C', 57.021464, "Carbamidomethyl", false},
                                        {'M', 15.994915, "Oxidation", true},
                                        {'K', 229.162932, "TMT6plex", false},
                                        {'C', 45.987721, "Methylthio", true}};
    std::vector<std::string> dropped;
    const auto m = AT::shadowMods(run, cands, &dropped);
    check(dropped.size() == 2 && dropped[0] == "Carbamidomethyl (fixed)" && dropped[1] == "Methylthio (variable)",
          "both C modifications are reported dropped");
    int c_var = 0, c_fixed = 0, other = 0;
    for (const auto& x : m)
    {
      if (x.residue == 'C') (x.variable ? ++c_var : ++c_fixed);
      else ++other;
    }
    check(c_var == 5 && c_fixed == 0, "five variable C alternatives, no fixed C");
    check(other == 2, "the M and K modifications are kept");
    FASTag::Param p;
    p.max_gaps = 1;
    p.mods = run;
    p.ion_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
    const FASTag::Param sp = AT::shadowParam(p, cands);
    check(sp.max_gaps == 0, "shadow pass has no gap edges");
    check(sp.ion_pair.kind == FASTag::IonSeries::Series::BY, "shadow pass reads b/y");
    check(sp.tag_length == p.tag_length && sp.frag_tol == p.frag_tol, "shadow pass keeps length and tolerance");
  }

  // ---- formsInTag
  {
    auto n = AT::formsInTag("AC[Carbamidomethyl]DCK", cands);
    check(n[0] == 1 && n[AT::kUnmodified] == 1, "one CAM and one plain C");
    n = AT::formsInTag("M[Oxidation]CK", cands);
    check(n[AT::kUnmodified] == 1 && n[0] == 0, "another residue's annotation is skipped");
    n = AT::formsInTag("C[Nethylmaleimide]C[Nethylmaleimide]", cands);
    check(n[2] == 2, "two NEM");
    n = AT::formsInTag("PC[Unknown]K", cands);
    unsigned sum = 0;
    for (auto v : n) sum += v;
    check(sum == 0, "an unknown C annotation is not counted");
    n = AT::formsInTag("PEPTIDEK", cands);
    sum = 0;
    for (auto v : n) sum += v;
    check(sum == 0, "no C, nothing counted");
  }

  // ---- votes: best counted tag with a C; conflicts; gapped and E > 1 ignored
  {
    AT::Tally t;
    AT::Vote v;
    t.addTag(v, tag("PEPTK", 1e-3), cands);                    // counted, no C
    t.addTag(v, tag("LC[Propionamide]EK", 0.5), cands);        // vote Prop
    t.addTag(v, tag("LC[Carbamidomethyl]EK", 0.1), cands);     // better: CAM
    t.addTag(v, tag("LCEK", 0.2), cands);                      // worse
    t.addTag(v, tag("C[Methylthio]EK", 1e-5, true), cands);    // gapped: not counted
    t.addTag(v, tag("C[Methylthio]EK", 2.0), cands);           // E > 1: not counted
    t.addSpectrum(v);
    check(t.tags == 4 && t.tags_with_c == 3, "counted tags and tags with C");
    check(t.spectra == 1 && t.votes[0] == 1 && t.conflict == 0, "the spectrum votes CAM with its best tag");
    check(t.residues[0] == 1 && t.residues[1] == 1 && t.residues[AT::kUnmodified] == 1 && t.residues[3] == 0,
          "residues per form over counted tags");
    AT::Vote w;
    t.addTag(w, tag("C[Carbamidomethyl]VC", 0.01), cands);
    t.addSpectrum(w);
    check(t.spectra == 2 && t.conflict == 1 && t.votes[0] == 1, "two forms in the best tag is a conflict");
    AT::Vote none;
    t.addTag(none, tag("PEPK", 0.1), cands);
    t.addSpectrum(none);
    check(t.spectra_tagged == 3 && t.spectra == 2, "a spectrum without a C tag is tagged but does not vote");
    AT::Tally u;
    u.merge(t);
    u.merge(t);
    check(u.spectra == 4 && u.votes[0] == 2 && u.residues[0] == 4 && u.conflict == 2, "merge sums");
  }

  // ---- the call: #3g's rule over the six classes
  {
    A::Settings s;
    AT::Tally t;
    t.spectra = 23;
    t.votes[0] = 20;
    t.votes[AT::kUnmodified] = 3;
    A::Call c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(c.called && c.cls == A::Carbamidomethyl && c.top == 20 && c.binned == 23, "20 CAM of 23: call CAM");
    t.votes[0] = 3;
    t.votes[AT::kUnmodified] = 12;
    c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(c.called && c.cls == A::None, "12 unmodified of 15: call none");
    t.votes[0] = 5;
    t.votes[AT::kUnmodified] = 2;
    c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(!c.called && c.reason == "few_cys_spectra", "7 votes: few_cys_spectra");
    t.votes = {};
    t.votes[0] = 10;
    t.votes[2] = 10;
    c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(!c.called && c.reason == "ambiguous", "a tie is ambiguous");

    // the report rows
    AT::ReportInfo info;
    info.dropped = {"Carbamidomethyl (fixed)"};
    info.lengths = "4";
    const auto rows = AT::rows(t, c, s, cands, info);
    std::set<std::string> secs, keys;
    bool five = true;
    for (const auto& r : rows)
    {
      secs.insert(r.section);
      five = five && !r.section.empty() && !r.key.empty() && !r.value.empty() && !r.n.empty() && !r.description.empty();
      check(keys.insert(r.section + "\t" + r.key).second, "unique row " + r.section + " " + r.key);
    }
    check(five, "every row has five non-empty fields");
    check(secs == std::set<std::string>{"alkt_run", "alkt_form", "alkylation_tags_call"}, "the three sections");
    bool status = false;
    for (const auto& r : rows)
      if (r.section == "alkylation_tags_call" && r.key == "status") status = r.value == "no_call";
    check(status, "the status row says no_call");
  }

  // ---- the confounds the report names
  {
    const auto* rdb = OpenMS::ResidueDB::getInstance();
    auto res = [&](const char* c) { return rdb->getResidue(c)->getMonoWeight(OpenMS::Residue::Internal); };
    const double C = res("C");
    check(std::fabs(C + cands[0].mass - (res("G") + C)) < 1e-6, "C[Carbamidomethyl] equals G + C");
    check(std::fabs(C + cands[1].mass - (res("A") + C)) < 1e-6, "C[Propionamide] equals A + C");
    const double nem = C + cands[2].mass;
    check(std::fabs(2 * res("N") - nem - 0.0290) < 0.001, "C[Nethylmaleimide] is 0.029 Da from N + N");
    check(std::fabs(res("M") + res("P") - nem - 0.0364) < 0.001, "C[Nethylmaleimide] is 0.036 Da from M + P");
  }

  // ---- end to end through the tagger: each reagent's synthetic spectra are
  //      called as that reagent; unmodified as none. The run Param carries the
  //      default fixed CAM, which the shadow pass must drop.
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const FASTag::Tables run_tabs(run);
    for (int k = 0; k < AT::kNumCandidates; ++k)
    {
      const std::string form = cands[static_cast<std::size_t>(k)].name;
      AT::Tally t;
      unsigned seed = 7;
      for (const char* pep : kPeptides)
      {
        const ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, form), 2, false, 0, 0.0, 20, seed++);
        AT::Vote v;
        for (const FASTag::Tag& tg : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, sp, tabs)) t.addTag(v, tg, cands);
        t.addSpectrum(v);
      }
      A::Settings st;
      st.min_spectra = 6;
      const A::Call c = A::callAlkylation(t.asAlkylationTally(cands), st);
      check(c.called && c.cls == cands[static_cast<std::size_t>(k)].cls,
            form + ": synthetic spectra call " + (c.called ? A::className(c.cls) : "no_call " + c.reason) + " (votes " +
                std::to_string(t.votes[static_cast<std::size_t>(k)]) + " of " + std::to_string(t.spectra) + ")");
      check(t.votes[static_cast<std::size_t>(k)] >= 8, form + ": at least 8 of 12 spectra vote their form");
      if (k == 2)
      {
        // Control: the run's own alphabet (fixed CAM) never spells a NEM C, so
        // the call needs the shadow pass.
        AT::Tally r;
        for (const char* pep : kPeptides)
        {
          const ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, form), 2, false, 0, 0.0, 20, 99);
          AT::Vote v;
          for (const FASTag::Tag& tg : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, run, run_tabs)) r.addTag(v, tg, cands);
          r.addSpectrum(v);
        }
        check(r.votes[2] == 0, "the run alphabet spells no Nethylmaleimide C");
      }
    }
  }

  if (failures)
  {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "alkylation_tags_test: all passed\n";
  return 0;
}
