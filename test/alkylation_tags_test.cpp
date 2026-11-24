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
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/METADATA/Precursor.h>

#include <algorithm>
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
static const char* const PEPTIDES[] = {"LTSEFCYQEK", "DVHLPWCEFR", "SYELPDCQVK", "NFEECLTSVR",
                                        "TPEVCDHLWK", "QLSECYFTER", "VLDECFNPSK", "WYEPCLSVDR",
                                        "HTDFCEVLPK", "SPLECQYTWR", "FEDSCVLQPK", "TYLVCEDHFR"};

/// The peptide with its C as @p form ("unmodified": plain C).
static std::string withForm(const std::string& pep, const std::string& form)
{
  if (form == "unmodified") return pep;
  const std::size_t c = pep.find('C');
  return pep.substr(0, c) + "C(" + form + ")" + pep.substr(c + 1);
}

/// Declares the scan window an instrument acquiring from @p lo m/z writes
/// (mzML scan window lower/upper limit), up to 2000 m/z or the top peak.
/// Codex6 review n1: an ion the alias reading gives (76.022, the unmodified
/// C immonium) is absent as evidence only where it could have been seen.
static void acquiredFrom(OpenMS::MSSpectrum& s, double lo)
{
  OpenMS::ScanWindow w;
  w.begin = lo;
  w.end = std::max(2000.0, s.empty() ? 0.0 : s.back().getMZ() + 1.0);
  s.getInstrumentSettings().setScanWindows({w});
}

/// Adds the C immonium ion of @p form (AlkylationTags::immoniumMz) to a
/// synthetic spectrum, at 0.3 (fragments 0.5-1, noise 0.02-0.22), as HCD
/// spectra of a C peptide often carry it (49-61% of CAM peptide spectra on
/// PXD020401 and PXD003531), and declares it acquired from 50 m/z
/// (acquiredFrom()). Release-gate review n1: a vote whose C edge an alias
/// reads as well needs it.
static void addImmonium(OpenMS::MSSpectrum& s, const std::string& form)
{
  for (const auto& f : FASTag::Alkylation::forms())
    if (f.name == form)
    {
      s.emplace_back(FASTag::AlkylationTags::immoniumMz(f), 0.3f);
      s.sortByPosition();
      acquiredFrom(s, 50.0);
      return;
    }
}

static int writeMzml(const std::string& out, const std::string& form, int n)
{
  OpenMS::PeakMap exp;
  int scan = 0;
  for (int rep = 0; scan < n; ++rep)
    for (const char* pep : PEPTIDES)
    {
      if (scan >= n) break;
      // "mixed": two of three spectra Carbamidomethyl, one Nethylmaleimide.
      const std::string f = form != "mixed" ? form : (scan % 3 == 2 ? "Nethylmaleimide" : "Carbamidomethyl");
      ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, f), 2, false, 0, 0.0, 20, 1000u + static_cast<unsigned>(scan));
      addImmonium(s.spec, f);
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

static FASTag::Tag tag(const std::string& seq, double e, bool gapped = false, int charge = 1)
{
  FASTag::Tag t;
  t.seq = seq;
  t.evalue = e;
  t.gapped = gapped;
  t.charge = charge;
  return t;
}

/// One spectrum through the tool's path (src/FASTag.cpp): the shadow tags,
/// each checked against the prepared peaks (VoteContext), then the vote.
/// With @p unchecked, the same tags into @p raw without the checks (the
/// 0dfac519 vote), so a test can show its confound is live.
static void tagChecked(AT::Tally& t, const OpenMS::MSSpectrum& spec, double prec_mz, int charge, const FASTag::Param& sp,
                       const FASTag::Tables& tabs, const AT::VoteContext& ctx, AT::Tally* raw = nullptr)
{
  const OpenMS::MSSpectrum prep = FASTag::preparedPeaks(spec, prec_mz, charge, sp);
  // The spectrum as read, for the immonium check, as FASTag.cpp passes it.
  const AT::SpectrumPeaks pk{&prep, (prec_mz - OpenMS::Constants::PROTON_MASS_U) * charge, &spec};
  AT::Vote v, w;
  for (const FASTag::Tag& tg : FASTag::tagSpectrum(spec, prec_mz, charge, sp, tabs))
  {
    t.addTag(v, tg, ctx, pk);
    if (raw) raw->addTag(w, tg, ctx.cands);
  }
  t.addSpectrum(v);
  if (raw) raw->addSpectrum(w);
}

/// A synthetic tag at fragment charge 1 whose C edge ends at @p high_mz (no path peaks: Tag::high_mz bounds it).
static FASTag::Tag tagAt(const std::string& seq, double e, double high_mz)
{
  FASTag::Tag t = tag(seq, e);
  t.high_mz = high_mz;
  t.low_mz = high_mz - 500.0;
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
    check(cands[AT::UNMODIFIED].cls == A::NONE && cands[AT::UNMODIFIED].mass == 0.0, "unmodified is class none, 0 Da");
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
    p.max_tag_count = 1;
    p.max_evalue = 0.1;
    p.diversity = true;
    const FASTag::Param sq = AT::shadowParam(p, cands);
    check(sq.max_tag_count == 0 && sq.max_evalue == 1.0 && !sq.diversity,
          "shadow pass ignores the run's -max_tags, -max_evalue and -diversity");
    check(AT::alphabetSize({}) == 19, "19 base residues");
    check(AT::alphabetSize(sq.mods) == 19 + 1 + 5, "M oxidation and five C alternatives");
  }

  // ---- formsInTag
  {
    auto n = AT::formsInTag("AC[Carbamidomethyl]DCK", cands);
    check(n[0] == 1 && n[AT::UNMODIFIED] == 1, "one CAM and one plain C");
    n = AT::formsInTag("M[Oxidation]CK", cands);
    check(n[AT::UNMODIFIED] == 1 && n[0] == 0, "another residue's annotation is skipped");
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

  // ---- votes: the spectrum's best counted tag, when it has a C, none at an
  // end, and E <= VOTE_MAX_EVALUE; conflicts; gapped and E > 1 ignored
  {
    AT::Tally t;
    AT::Vote v;
    t.addTag(v, tag("PEPTK", 1e-5), cands);                    // counted, no C
    t.addTag(v, tag("LC[Propionamide]EK", 1e-6), cands);       // vote Prop
    t.addTag(v, tag("LC[Carbamidomethyl]EK", 1e-7), cands);    // better: CAM
    t.addTag(v, tag("LCEK", 1e-6), cands);                     // worse
    t.addTag(v, tag("C[Methylthio]EK", 1e-9, true), cands);    // gapped: not counted
    t.addTag(v, tag("C[Methylthio]EK", 2.0), cands);           // E > 1: not counted
    t.addSpectrum(v);
    check(t.tags == 4 && t.tags_with_c == 3, "counted tags and tags with C");
    check(t.spectra == 1 && t.votes[0] == 1 && t.conflict == 0, "the spectrum votes CAM with its best tag");
    check(t.residues[0] == 1 && t.residues[1] == 1 && t.residues[AT::UNMODIFIED] == 1 && t.residues[3] == 0,
          "residues per form over counted tags");
    AT::Vote w;
    t.addTag(w, tag("LC[Carbamidomethyl]VCK", 1e-6), cands);
    t.addSpectrum(w);
    check(t.spectra == 2 && t.conflict == 1 && t.votes[0] == 1, "two forms in the best tag is a conflict");
    AT::Vote none;
    t.addTag(none, tag("PEPK", 1e-6), cands);
    t.addSpectrum(none);
    check(t.spectra_tagged == 3 && t.spectra == 2, "a spectrum without a C tag is tagged but does not vote");
    AT::Tally u;
    u.merge(t);
    u.merge(t);
    check(u.spectra == 4 && u.votes[0] == 2 && u.residues[0] == 4 && u.conflict == 2, "merge sums");

    // 1.13 #22 reassessment: no vote when the spectrum's best tag has no C,
    // when the C is the first or last residue, or when E > VOTE_MAX_EVALUE
    check(AT::cAtEnd("CVEK") && AT::cAtEnd("C[Carbamidomethyl]VEK") && AT::cAtEnd("VEKC") && AT::cAtEnd("VEKC[Propionamide]"),
          "cAtEnd: a C at either end, any form");
    check(!AT::cAtEnd("VC[Propionamide]EK") && !AT::cAtEnd("VCEM[Oxidation]") && !AT::cAtEnd("") && !AT::cAtEnd("PEPK"),
          "cAtEnd: an inner C, another residue's annotation, no C");
    AT::Tally q;
    AT::Vote q1, q2, q3, q4, q5;
    q.addTag(q1, tag("LC[Carbamidomethyl]EK", 1e-6), cands);
    q.addTag(q1, tag("PEPTK", 1e-7), cands);  // the best tag has no C
    q.addSpectrum(q1);
    check(q.spectra == 0, "no vote when a tag without C is better");
    q.addTag(q2, tag("C[Carbamidomethyl]VEK", 1e-7), cands);
    q.addSpectrum(q2);
    q.addTag(q3, tag("VEKC", 1e-7), cands);
    q.addTag(q3, tag("LC[Propionamide]EK", 1e-6), cands);  // inner C, but not the best tag
    q.addSpectrum(q3);
    check(q.spectra == 0 && q.tags_with_c == 4, "no vote with a C at an end of the best tag");
    q.addTag(q4, tag("LC[Carbamidomethyl]EK", 2.0 * AT::VOTE_MAX_EVALUE), cands);
    q.addSpectrum(q4);
    check(q.spectra == 0, "no vote above VOTE_MAX_EVALUE");
    q.addTag(q5, tag("LC[Carbamidomethyl]EK", AT::VOTE_MAX_EVALUE), cands);
    q.addTag(q5, tag("PEPTK", AT::VOTE_MAX_EVALUE), cands);  // a tie with a tag without C keeps the vote
    q.addSpectrum(q5);
    check(q.spectra == 1 && q.votes[0] == 1, "a vote at kVoteMaxEvalue, tied with a tag without C");

    // equal E-values: another form makes a conflict, the same form does not
    AT::Tally e;
    AT::Vote a, b, c2;
    e.addTag(a, tag("LC[Propionamide]EK", 1e-6), cands);
    e.addTag(a, tag("VC[Carbamidomethyl]EK", 1e-6), cands);
    e.addSpectrum(a);
    check(e.conflict == 1 && e.votes[0] == 0 && e.votes[1] == 0, "tied tags of two forms are a conflict");
    e.addTag(b, tag("LC[Carbamidomethyl]EK", 1e-6), cands);
    e.addTag(b, tag("VC[Carbamidomethyl]VEK", 1e-6), cands);
    e.addSpectrum(b);
    check(e.votes[0] == 1 && e.conflict == 1, "tied tags of one form vote that form");
    e.addTag(c2, tag("LC[Propionamide]EK", 1e-6), cands);
    e.addTag(c2, tag("VC[Carbamidomethyl]EK", 1e-6), cands);
    e.addTag(c2, tag("LC[Nethylmaleimide]VEK", 1e-7), cands);  // a strictly better tag decides
    e.addSpectrum(c2);
    check(e.votes[2] == 1 && e.conflict == 1, "a better tag replaces a tied conflict");
    // fragment charge 2 and more: not counted
    AT::Tally z;
    AT::Vote zv;
    z.addTag(zv, tag("C[Propionamide]C[Propionamide]C[Propionamide]", 0.001, false, 2), cands);
    z.addSpectrum(zv);
    check(z.tags == 0 && z.tags_multi == 1 && z.spectra == 0, "a 2+ tag does not vote");
  }

  // ---- resolution and aliases
  {
    check(AT::formsResolved(cands, 0.02) && AT::formsResolved(cands, 0.3), "forms resolved at 0.02 and 0.3 Da");
    check(!AT::formsResolved(cands, 0.5), "CAM and Carboxymethyl (0.984 Da apart) unresolved at 0.5 Da");
    FASTag::Param pp;
    check(std::fabs(AT::edgeToleranceDa(pp) - 0.02) < 1e-12, "20 ppm is 0.02 Da at 1000 m/z");
    pp.tol_ppm = false;
    pp.frag_tol = 0.5;
    check(AT::edgeToleranceDa(pp) == 0.5, "a Da tolerance is itself");
    const auto al = AT::aliases(cands, 0.02);
    check(al[0].rfind("C+G:0.0000", 0) == 0, "CAM's first alias is C+G at 0: " + al[0]);
    check(al[1].find("A+C:0.0000") != std::string::npos && al[1].find("S+S:0.0178") != std::string::npos,
          "Propionamide aliases A+C and S+S: " + al[1]);
    check(al[2].find("N+N:0.0290") != std::string::npos && al[2].find("M+P:0.0364") != std::string::npos,
          "Nethylmaleimide aliases N+N and M+P: " + al[2]);
    check(al[3] == "-", "Methylthio has no alias at 0.02 Da: " + al[3]);
    // The isotope twin: C[Carbamidomethyl] + 13C is 0.0193 Da from C[Carboxymethyl].
    check(al[4] == "C[Carbamidomethyl]+13C:0.0193", "Carboxymethyl's only alias is C[Carbamidomethyl]+13C: " + al[4]);
    check(al[0].find("C[Carboxymethyl]-13C:0.0193") != std::string::npos,
          "CAM aliases C[Carboxymethyl]-13C: " + al[0]);
    const auto al5 = AT::aliases(cands, 0.005);
    check(al5[4] == "-" && al5[0].find("13C") == std::string::npos, "no isotope twin at 0.005 Da: " + al5[4]);
    AT::Tally t;
    t.spectra = 30;
    t.votes[0] = 30;
    A::Settings s;
    check(AT::callTags(t, s, cands, 0.02).called, "30 CAM votes at 0.02 Da: call");
    const A::Call c = AT::callTags(t, s, cands, 0.5);
    check(!c.called && c.reason == "unresolved_forms", "30 CAM votes at 0.5 Da: unresolved_forms");
  }

  // ---- feedback 202dbcf4: single-step twins and aliases over the run's alphabet
  {
    const auto base = AT::alphabet({});
    check(base.size() == 18, "18 base steps without C: " + std::to_string(base.size()));
    bool no_c = true;
    for (const auto& st : base) no_c = no_c && st.name != "C";
    check(no_c, "C is not a step (its forms are the candidates)");
    // the base residues: no twin at 20 ppm or 0.3 Da; at 0.5 Da CAM and Carboxymethyl twin each other
    const auto t02 = AT::twins(cands, 0.02);
    const auto t05 = AT::twins(cands, 0.5);
    bool none02 = true;
    for (const auto& v : t02) none02 = none02 && v == "-";
    check(none02 && AT::stepsResolved(cands, 0.02) && AT::stepsResolved(cands, 0.3), "no twin at 0.02 or 0.3 Da");
    check(t05[0] == "C[Carboxymethyl]:0.9840" && t05[4] == "C[Carbamidomethyl]:0.9840" && !AT::stepsResolved(cands, 0.5),
          "CAM and Carboxymethyl twin at 0.5 Da: " + t05[0] + " / " + t05[4]);
    check(AT::stepsResolved(cands, 0.02) == AT::formsResolved(cands, 0.02) &&
              AT::stepsResolved(cands, 0.5) == AT::formsResolved(cands, 0.5),
          "on the base residues, the step rule is the 1.13 form rule");
    // a variable modification whose residue reads like a C form: one edge of
    // that mass is either, so the form is not resolved and there is no call.
    // K + 31.9361 = 160.0311, 0.0004 Da from C[Carbamidomethyl] (160.0307).
    const double k = OpenMS::ResidueDB::getInstance()->getResidue('K')->getMonoWeight(OpenMS::Residue::Internal);
    const double cam_c = OpenMS::ResidueDB::getInstance()->getResidue('C')->getMonoWeight(OpenMS::Residue::Internal) + cands[0].mass;
    std::vector<FASTag::ModSpec> mods = {FASTag::ModSpec{'K', cam_c - k + 0.0004, "Twin", true}};
    const auto alpha = AT::alphabet(AT::shadowMods(mods, cands));
    check(alpha.size() == 19 && alpha.back().name == "K[Twin]", "the variable alternative is a step: " + alpha.back().name);
    const auto tw = AT::twins(cands, 0.02, &alpha);
    check(tw[0] == "K[Twin]:0.0004", "K[Twin] twins C[Carbamidomethyl]: " + tw[0]);
    check(!AT::stepsResolved(cands, 0.02, &alpha), "a residue twin leaves the forms unresolved");
    AT::Tally t;
    t.spectra = 30;
    t.votes[0] = 30;
    A::Settings s;
    check(AT::callTags(t, s, cands, 0.02).called, "30 CAM votes, base residues: call");
    const A::Call c = AT::callTags(t, s, cands, 0.02, &alpha);
    check(!c.called && c.reason == "unresolved_forms", "30 CAM votes with a residue twin: unresolved_forms");
    // a fixed modification moves the residue (the step K is then K + delta)
    const auto fixed = AT::alphabet({FASTag::ModSpec{'K', cam_c - k + 0.0004, "Twin", false}});
    check(fixed.size() == 18 && !AT::stepsResolved(cands, 0.02, &fixed), "a fixed K twin also leaves the forms unresolved");
    // the alias sums use the alphabet: the base aliases stay with a modification
    const auto al = AT::aliases(cands, 0.02, &alpha);
    check(al[0].rfind("C+G:0.0000", 0) == 0, "CAM's C+G alias kept with mods: " + al[0]);
    // An alias that only a modified residue makes: Oxidation (M) + A
    // (147.0354 + 71.0371 = 218.0725) against a form that sits there.
    const double oxm = 131.040485 + 15.994915;
    std::vector<FASTag::ModSpec> mo = {FASTag::ModSpec{'M', 15.994915, "Oxidation", true}};
    const auto alpha_ox = AT::alphabet(AT::shadowMods(mo, cands));
    std::vector<A::Form> fake = cands;
    fake[3].mass = oxm + 71.03711 - (cam_c - cands[0].mass);  // Methylthio moved onto M[Oxidation] + A
    const auto alo = AT::aliases(fake, 0.02, &alpha_ox);
    check(alo[3].find("A+M[Oxidation]") != std::string::npos, "a modified residue in an alias: " + alo[3]);
    check(AT::aliases(fake, 0.02)[3].find("M[Oxidation]") == std::string::npos, "not without the modification");
    // the report rows: format 2 and one twin row per form
    AT::ReportInfo info;
    info.tol_da = 0.02;
    info.alpha = alpha;
    const auto rows = AT::rows(t, c, s, cands, info);
    int twins_rows = 0;
    std::string fmt, resolved, cam_twin;
    for (const auto& r : rows)
    {
      if (r.section == "alkt_form" && r.key.rfind("twin.", 0) == 0) ++twins_rows;
      if (r.section == "alkt_form" && r.key == "twin.Carbamidomethyl") cam_twin = r.value;
      if (r.section == "alkt_run" && r.key == "format") fmt = r.value;
      if (r.section == "alkt_run" && r.key == "forms_resolved") resolved = r.value;
    }
    check(fmt == "4" && twins_rows == AT::NUM_CANDIDATES && cam_twin == "K[Twin]:0.0004" && resolved == "no",
          "format 4, six twin rows, forms_resolved no: " + fmt + " " + std::to_string(twins_rows) + " " + cam_twin + " " + resolved);
  }

  // ---- the call: #3g's rule over the six classes
  {
    A::Settings s;
    AT::Tally t;
    t.spectra = 23;
    t.votes[0] = 20;
    t.votes[AT::UNMODIFIED] = 3;
    A::Call c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(c.called && c.cls == A::CARBAMIDOMETHYL && c.top == 20 && c.binned == 23, "20 CAM of 23: call CAM");
    t.votes[0] = 3;
    t.votes[AT::UNMODIFIED] = 12;
    c = A::callAlkylation(t.asAlkylationTally(cands), s);
    check(c.called && c.cls == A::NONE, "12 unmodified of 15: call none");
    t.votes[0] = 5;
    t.votes[AT::UNMODIFIED] = 2;
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
    run.max_extension = 6;  // as the tool runs (-extension): a vote needs a tag with an inner C
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const FASTag::Tables run_tabs(run);
    // review n1: through the tool's checks (the positive control of the alias
    // check: a real C form keeps its votes)
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    for (int k = 0; k < AT::NUM_CANDIDATES; ++k)
    {
      const std::string form = cands[static_cast<std::size_t>(k)].name;
      AT::Tally t;
      unsigned seed = 7;
      for (const char* pep : PEPTIDES)
      {
        ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, form), 2, false, 0, 0.0, 20, seed++);
        addImmonium(s.spec, form);
        tagChecked(t, s.spec, s.prec_mz, 2, sp, tabs, ctx);
      }
      A::Settings st;
      st.min_spectra = 6;
      const A::Call c = AT::callTags(t, st, ctx);
      check(c.called && c.cls == cands[static_cast<std::size_t>(k)].cls,
            form + ": synthetic spectra call " + (c.called ? A::className(c.cls) : "no_call " + c.reason) + " (votes " +
                std::to_string(t.votes[static_cast<std::size_t>(k)]) + " of " + std::to_string(t.spectra) + ")");
      std::cerr << "checked " << form << ": " << t.votes[static_cast<std::size_t>(k)] << " of " << t.spectra << " (alias_rejected "
                << t.alias_rejected << ")\n";
      check(t.votes[static_cast<std::size_t>(k)] >= 8, form + ": at least 8 of 12 spectra vote their form");
      if (k == 2)
      {
        // Control: the run's own alphabet (fixed CAM) never spells a NEM C, so
        // the call needs the shadow pass.
        AT::Tally r;
        for (const char* pep : PEPTIDES)
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

  // ---- a 3+ precursor whose S ladder reads as 2+ C[Propionamide] (the
  //      review's counterexample): the 2+ reading exists but does not vote
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = 0;
    run.deisotope = false;
    run.peaks_per_window = 0;
    run.max_peak_count = 20;
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    OpenMS::MSSpectrum s;
    for (int i = 0; i < 16; ++i) s.emplace_back(100.0 + 0.1 * i, 1.0f);
    for (double mz : {500.0, 587.032028435, 674.064056870, 761.096085305}) s.emplace_back(mz, 100.0f);
    s.sortByPosition();
    AT::Tally t;
    bool saw_2plus_prop = false;
    for (int rep = 0; rep < 10; ++rep)
    {
      AT::Vote v;
      for (const FASTag::Tag& tg : FASTag::tagSpectrum(s, 800.0, 3, sp, tabs))
      {
        if (tg.charge == 2 && tg.seq.find("C[Propionamide]") != std::string::npos && tg.evalue <= 1.0) saw_2plus_prop = true;
        t.addTag(v, tg, cands);
      }
      t.addSpectrum(v);
    }
    check(saw_2plus_prop, "the 2+ C[Propionamide] reading of the S ladder exists (the test is live)");
    check(t.votes[1] == 0, "no Propionamide vote from the 1+ S ladder");
    check(!A::callAlkylation(t.asAlkylationTally(cands), A::Settings{}).called, "no call from the S ladder");
  }

  // ---- the isotope twin through the tagger (review): undeisotoped CAM
  //      spectra with 13C peaks give C[Carboxymethyl] readings (edges that end
  //      on the next ion's 13C peak); the alias row names the twin. At a
  //      0.02 Da tolerance the 0.0193 Da offset matches at every m/z (at 20 ppm
  //      only above ~965 m/z, where the peak tolerance reaches 0.0193 Da).
  //      Review n1: the final call is asserted, through the tool's checks:
  //      CAM or no call, never decided by a Carboxymethyl vote. The 13C
  //      reading loses to the monoisotopic one while both ladders go on; with
  //      the monoisotopic peak of the ion after the C lost (b and y; its 13C
  //      peaks kept: "broken"), the 13C ladder is the longer tag and the
  //      unchecked vote (0dfac519) has Carboxymethyl votes (3 of 9 here).
  for (const int ext : {0, 6, -6})
  {
    const bool broken = ext < 0;
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = broken ? -ext : ext;
    run.deisotope = false;
    run.tol_ppm = false;
    run.frag_tol = 0.02;
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    AT::Tally t, raw;
    int cm_reads = 0;
    unsigned seed = 300;
    for (int rep = 0; rep < 3; ++rep)
      for (const char* pep : PEPTIDES)
      {
        ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, "Carbamidomethyl"), 2, false, 2, 0.0, 20, seed++);
        addImmonium(s.spec, "Carbamidomethyl");
        if (broken)
        {
          const OpenMS::AASequence aa = OpenMS::AASequence::fromString(withForm(pep, "Carbamidomethyl"));
          const std::size_t c = std::string(pep).find('C'), n = aa.size();
          std::vector<double> drop;
          if (c + 2 < n) drop.push_back(aa.getPrefix(c + 2).getMonoWeight(OpenMS::Residue::BIon, 1));
          if (n - c + 1 < n) drop.push_back(aa.getSuffix(n - c + 1).getMonoWeight(OpenMS::Residue::YIon, 1));
          OpenMS::MSSpectrum kept;
          for (const auto& pk : s.spec)
          {
            bool d = false;
            for (double m : drop) d = d || std::fabs(pk.getMZ() - m) < 1e-6;
            if (!d) kept.push_back(pk);
          }
          s.spec = kept;
        }
        for (const FASTag::Tag& tg : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, sp, tabs))
        {
          if (std::getenv("ALKT_DEBUG") && tg.seq.find("C[Carboxymethyl]") != std::string::npos)
            std::cerr << pep << " " << tg.seq << " z" << tg.charge << " E " << tg.evalue << "\n";
          if (tg.charge == 1 && !tg.gapped && tg.evalue <= 1.0 && tg.seq.find("C[Carboxymethyl]") != std::string::npos) ++cm_reads;
        }
        tagChecked(t, s.spec, s.prec_mz, 2, sp, tabs, ctx, &raw);
      }
    A::Settings st;
    const A::Call c = AT::callTags(t, st, ctx);
    std::cerr << "isotope twin, extension " << (broken ? -ext : ext) << (broken ? " broken" : "") << ": " << cm_reads << " C[Carboxymethyl] readings; unchecked CAM "
              << raw.votes[0] << " Carboxymethyl " << raw.votes[4] << " of " << raw.spectra << "; checked CAM " << t.votes[0]
              << " Carboxymethyl " << t.votes[4] << " alias_rejected " << t.alias_rejected << " of " << t.spectra << " -> "
              << (c.called ? A::className(c.cls) : "no_call " + c.reason) << "\n";
    check(cm_reads > 0, "undeisotoped CAM spectra with 13C peaks read C[Carboxymethyl] (the confound is live)");
    check(t.residues[4] > 0, "the C[Carboxymethyl] readings reach the counted residues");
    const std::string label = "extension " + std::to_string(run.max_extension) + (broken ? " broken" : "");
    if (broken)
    {
      check(raw.votes[4] > 0, label + ": the unchecked vote has Carboxymethyl votes (the confound is live)");
      check(t.alias_rejected >= raw.votes[4], label + ": the isotope check rejects them");
    }
    check(t.votes[4] == 0, label + ": no Carboxymethyl vote survives the isotope check");
    check(!c.called || c.cls == A::CARBAMIDOMETHYL, label + ": the call is CAM or no_call, never Carboxymethyl");
    if (ext == 6) check(c.called && c.cls == A::CARBAMIDOMETHYL, label + ": the checked votes call CAM");
  }

  // ---- negative control: peptides without C give no vote and no call;
  //      3+ precursors with 2+ y ions still call CAM
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = 6;  // as the tool runs (-extension): a vote needs a tag with an inner C
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    AT::Tally none, z3, none_c, z3_c;  // *_c: through the tool's checks
    unsigned seed = 50;
    for (const char* pep : PEPTIDES)
    {
      std::string nc = pep;
      nc[nc.find('C')] = 'S';
      const ComplementSynth::Spec s = ComplementSynth::make(nc, 2, false, 0, 0.0, 20, seed++);
      AT::Vote v;
      for (const FASTag::Tag& tg : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, sp, tabs))
      {
        if (std::getenv("ALKT_DEBUG") && tg.seq.find('C') != std::string::npos && tg.evalue <= 1)
          std::cerr << nc << " " << tg.seq << " z" << tg.charge << " E " << tg.evalue << "\n";
        none.addTag(v, tg, cands);
      }
      none.addSpectrum(v);
      tagChecked(none_c, s.spec, s.prec_mz, 2, sp, tabs, ctx);
      ComplementSynth::Spec s3 = ComplementSynth::make(withForm(pep, "Carbamidomethyl"), 3, true, 0, 0.0, 20, seed++);
      addImmonium(s3.spec, "Carbamidomethyl");
      AT::Vote w;
      for (const FASTag::Tag& tg : FASTag::tagSpectrum(s3.spec, s3.prec_mz, 3, sp, tabs)) z3.addTag(w, tg, cands);
      z3.addSpectrum(w);
      tagChecked(z3_c, s3.spec, s3.prec_mz, 3, sp, tabs, ctx);
    }
    // Random edges between noise peaks give a few weak (E 0.3-1) C votes even
    // without a C (3 of 12 here, each a different form): far fewer than the
    // 12 of 12 a C peptide set gives, and no call.
    check(none.spectra <= 4, "C-free peptides: at most 4 of 12 vote (" + std::to_string(none.spectra) + ")");
    std::uint64_t top = 0;
    for (auto v : none.votes) top = std::max(top, v);
    check(top <= 2, "C-free peptides: no form gets more than 2 votes");
    check(!A::callAlkylation(none.asAlkylationTally(cands), A::Settings{}).called, "C-free peptides: no call");
    // With 2+ y ions only the b ladder reads at charge 1: the right tags have
    // E near VOTE_MAX_EVALUE, so fewer spectra vote (5 of 12), all for CAM.
    A::Settings st;
    st.min_spectra = 4;
    check(z3.spectra == z3.votes[0], "3+ CAM spectra: every vote is CAM");
    const A::Call c3 = A::callAlkylation(z3.asAlkylationTally(cands), st);
    check(c3.called && c3.cls == A::CARBAMIDOMETHYL,
          "3+ CAM spectra: call " + (c3.called ? std::string(A::className(c3.cls)) : "no_call " + c3.reason));
    // the same through the tool's checks
    check(!AT::callTags(none_c, A::Settings{}, ctx).called && none_c.spectra <= none.spectra, "C-free peptides, checked: no call");
    const A::Call c3c = AT::callTags(z3_c, st, ctx);
    check(c3c.called && c3c.cls == A::CARBAMIDOMETHYL && z3_c.votes[0] == z3.votes[0],
          "3+ CAM spectra, checked: call CAM with the same votes (" + std::to_string(z3_c.votes[0]) + " of " +
              std::to_string(z3.votes[0]) + ")");
  }

  // ---- review n2: the twin guard per vote, with the tagger's own edge
  //      windows (the tolerance at the C edge's m/z), not one tolerance at
  //      1000 m/z for the whole run. CAM and Carboxymethyl are 0.984 Da
  //      apart: at 400 ppm two windows overlap from 1230 m/z, at 500 ppm from
  //      984 m/z.
  {
    const double d_cam = AT::twinDistances(cands)[0];
    check(std::fabs(d_cam - 0.98402) < 1e-4 && std::fabs(AT::minTwinDistance(cands) - d_cam) < 1e-12,
          "the smallest twin distance is CAM / Carboxymethyl, 0.984 Da");
    FASTag::Param p400;
    p400.tol_ppm = true;
    p400.frag_tol = 400.0;
    check(std::fabs(AT::resolvedBelowMz(p400, 0.984) - 1230.0) < 1e-9, "0.984 / (2 * 400e-6) = 1230");
    FASTag::Param pda;
    pda.tol_ppm = false;
    pda.frag_tol = 0.3;
    check(std::isinf(AT::resolvedBelowMz(pda, 0.984)), "0.3 Da resolves 0.984 Da at every m/z");
    pda.frag_tol = 0.5;
    check(AT::resolvedBelowMz(pda, 0.984) == 0.0, "0.5 Da resolves 0.984 Da at no m/z");
    // formsResolved / stepsResolved are the same rule on the same distances
    for (double tol : {0.02, 0.3, 0.49, 0.492, 0.5})
      check(AT::formsResolved(cands, tol) == (2.0 * tol < d_cam) && AT::stepsResolved(cands, tol) == (2.0 * tol < d_cam),
            "formsResolved/stepsResolved follow twinDistances at " + std::to_string(tol));

    // Twelve spectra, each one CAM tag whose C edge ends at hi m/z; the tag
    // carries its path peaks, and the spectrum is those peaks (no alias peak).
    const auto run = [&](const FASTag::Param& p, double hi, AT::Tally* raw) {
      const auto* rdb = OpenMS::ResidueDB::getInstance();
      auto res = [&](const char* c) { return rdb->getResidue(c)->getMonoWeight(OpenMS::Residue::Internal); };
      const AT::VoteContext ctx = AT::voteContext(AT::shadowParam(p, cands), cands);
      AT::Tally t;
      for (int i = 0; i < 12; ++i)
      {
        // LC[Carbamidomethyl]EK, spelled from the high end: L is the top
        // step, then C (path[2] -> path[3] = hi), E, K.
        FASTag::Tag tg = tag("LC[Carbamidomethyl]EK", 1e-6);
        const double c_lo = hi - (res("C") + cands[0].mass);
        tg.path_mz = {c_lo - res("E") - res("K"), c_lo - res("E"), c_lo, hi, hi + res("L")};
        tg.n_res = 4;
        tg.low_mz = tg.path_mz.front();
        tg.high_mz = tg.path_mz.back();
        OpenMS::MSSpectrum pk;
        pk.emplace_back(AT::immoniumMz(cands[0]), 30.0f);  // the CAM immonium ion (review n1)
        for (double mz : tg.path_mz) pk.emplace_back(mz, 100.0f);
        acquiredFrom(pk, 50.0);
        const AT::SpectrumPeaks sp{&pk, 4000.0};
        AT::Vote v, w;
        t.addTag(v, tg, ctx, sp);
        t.addSpectrum(v);
        if (raw)
        {
          raw->addTag(w, tg, cands);
          raw->addSpectrum(w);
        }
      }
      return std::make_pair(t, ctx);
    };
    A::Settings st;
    // (a) 400 ppm, C edge at 1200 m/z (< 1230): the votes count, the run is called
    {
      const auto [t, ctx] = run(p400, 1200.0, nullptr);
      const A::Call c = AT::callTags(t, st, ctx);
      check(std::fabs(ctx.resolved_below_mz - 1230.0) < 0.1, "400 ppm: resolved below 1230 m/z (" + std::to_string(ctx.resolved_below_mz) + ")");
      check(t.votes[0] == 12 && t.unresolved == 0 && c.called && c.cls == A::CARBAMIDOMETHYL,
            "400 ppm, C edge at 1200 m/z: 12 CAM votes, call CAM (" + std::to_string(t.votes[0]) + ", " + c.reason + ")");
    }
    // (b) 400 ppm, C edge at 1260 m/z (>= 1230): one peak fits both windows;
    //     the 0dfac519 vote counted it (raw), now it is set aside
    {
      AT::Tally raw;
      const auto [t, ctx] = run(p400, 1260.0, &raw);
      const A::Call c = AT::callTags(t, st, ctx);
      check(raw.votes[0] == 12 && A::callAlkylation(raw.asAlkylationTally(cands), st).called,
            "400 ppm, 1260 m/z: the unchecked vote counts CAM (the guard at 1000 m/z, 0.8 < 0.984 Da, let it through)");
      check(t.votes[0] == 0 && t.unresolved == 12 && t.spectra == 0, "400 ppm, 1260 m/z: the 12 votes are unresolved");
      check(!c.called && c.reason == "unresolved_forms", "400 ppm, 1260 m/z: no_call unresolved_forms (" + c.reason + ")");
    }
    FASTag::Param p500 = p400;
    p500.frag_tol = 500.0;
    // (c) 500 ppm, C edge at 900 m/z (< 984): counted and called; the run-wide
    //     guard (1.0 Da at 1000 m/z >= 0.984) suppressed it
    {
      const auto [t, ctx] = run(p500, 900.0, nullptr);
      const A::Call c = AT::callTags(t, st, ctx);
      check(t.votes[0] == 12 && c.called && c.reason != "unresolved_forms",
            "500 ppm, C edge at 900 m/z: counted and called (" + c.reason + ")");
      const A::Call old = AT::callTags(t, st, cands, AT::edgeToleranceDa(p500));
      check(!old.called && old.reason == "unresolved_forms", "500 ppm: the run-wide guard at 1000 m/z gave unresolved_forms");
    }
    // (d) 500 ppm, C edge at 1000 m/z (>= 984): unresolved
    {
      const auto [t, ctx] = run(p500, 1000.0, nullptr);
      check(t.unresolved == 12 && t.votes[0] == 0 && AT::callTags(t, st, ctx).reason == "unresolved_forms",
            "500 ppm, C edge at 1000 m/z: unresolved");
    }
    // (e) Da: 0.3 resolves at every m/z, 0.5 at none (formsResolved's results)
    for (double tol : {0.3, 0.5})
    {
      FASTag::Param pd;
      pd.tol_ppm = false;
      pd.frag_tol = tol;
      for (double hi : {600.0, 1500.0})
      {
        const auto [t, ctx] = run(pd, hi, nullptr);
        const A::Call c = AT::callTags(t, st, ctx);
        const bool want = AT::formsResolved(cands, tol);
        // At 0.3 Da the pair aliases of CAM within the windows find no peak
        // in this path-only spectrum, so all 12 count.
        check((t.votes[0] == 12) == want && (t.unresolved == 12) == !want && c.called == want &&
                  (want || c.reason == "unresolved_forms"),
              "Da " + std::to_string(tol) + " at " + std::to_string(hi) + " m/z: as formsResolved (" + c.reason + ")");
      }
    }
    // the report rows: resolved_below_mz and unresolved
    {
      const auto [t, ctx] = run(p400, 1260.0, nullptr);
      AT::ReportInfo info;
      info.tol_da = AT::edgeToleranceDa(p400);
      info.tol_ppm = true;
      info.resolved_below_mz = ctx.resolved_below_mz;
      const auto rows = AT::rows(t, AT::callTags(t, st, ctx), st, cands, info);
      std::string rb, un, un_n;
      for (const auto& r : rows)
      {
        if (r.section == "alkt_run" && r.key == "resolved_below_mz") rb = r.value;
        if (r.section == "alkt_form" && r.key == "unresolved") { un = r.value; un_n = r.n; }
      }
      check(rb.rfind("1230.0", 0) == 0 && un == "12" && un_n == "12", "rows resolved_below_mz " + rb + ", unresolved " + un + " of " + un_n);
    }
  }

  // ---- review n3: through the combined report, a conflict counts against
  //      the share. 10 CAM and 90 conflicted votes gave share 1.0 and a CAM
  //      call (the placements abstaining); now share 0.1 of 100, no_call.
  {
    FASTag::Param p;
    const AT::VoteContext ctx = AT::voteContext(AT::shadowParam(p, cands), cands);
    A::Settings st;
    A::Call placement;  // abstains
    placement.reason = "few_cys_spectra";
    for (const auto& [cam, conf] : {std::pair<int, int>{10, 90}, std::pair<int, int>{90, 10}})
    {
      AT::Tally t;
      t.votes[0] = static_cast<std::uint64_t>(cam);
      t.conflict = static_cast<std::uint64_t>(conf);
      t.spectra = 100;
      const A::Call tags = AT::callTags(t, st, ctx);
      const A::Call out = A::combineCalls(tags, &placement);
      const auto rows = A::callRows("alkylation_call", out, st, A::forms(), "votes", true);
      std::string status, share, share_n, voted;
      for (const auto& r : rows)
      {
        if (r.key == "status") status = r.value;
        if (r.key == "share") { share = r.value; share_n = r.n; }
        if (r.key == "voted") voted = r.value;
      }
      const std::string what = std::to_string(cam) + " CAM + " + std::to_string(conf) + " conflicts: " + status + " " + out.reason +
                               " share " + share + " n " + share_n;
      if (cam == 10)
        check(!out.called && out.reason == "ambiguous" && std::fabs(out.share - 0.1) < 1e-12 && out.voted == 100 &&
                  status == "no_call" && share == "0.1" && share_n == "100" && voted == "100",
              what);
      else
        check(out.called && out.cls == A::CARBAMIDOMETHYL && std::fabs(out.share - 0.9) < 1e-12 && out.voted == 100 &&
                  status == "call" && share == "0.9" && share_n == "100",
              what);
      std::string tshare_n;
      for (const auto& r : AT::rows(t, tags, st, cands, AT::ReportInfo{}))
        if (r.section == "alkylation_tags_call" && r.key == "share") tshare_n = r.n;
      check(tshare_n == "100", "alkylation_tags_call share n is votes plus conflicts: " + tshare_n);
    }
  }

  // ---- review n1: aliases. An unmodified GC/CG (AC/CA) whose middle peak is
  //      lost in one series reads as one C[Carbamidomethyl]
  //      (C[Propionamide]) edge there; the other series keeps the middle
  //      peak, which the alias check finds. The unchecked vote (0dfac519)
  //      calls the reagent; the checked one must not.
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = 6;
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    for (const char x : {'G', 'A'})
    {
      const int k = x == 'G' ? 0 : 1;  // the form the pair reads as
      AT::Tally checked, raw;
      unsigned seed = 600;
      int n = 0;
      for (int rep = 0; rep < 2; ++rep)
        for (const char* base : PEPTIDES)
        {
          // X before the C on even spectra, after it on odd ones; the middle
          // peak dropped from y (rep 0) or from b (rep 1).
          std::string pep = base;
          const std::size_t c = pep.find('C');
          const bool before = (n % 2) == 0;
          pep.insert(before ? c : c + 1, 1, x);
          const std::size_t j = c;  // the pair (XC or CX) is at j, j + 1
          ComplementSynth::Spec s = ComplementSynth::make(pep, 2, false, 0, 0.0, 20, seed++);
          const OpenMS::AASequence aa = OpenMS::AASequence::fromString(pep);
          const double b_mid = aa.getPrefix(j + 1).getMonoWeight(OpenMS::Residue::BIon, 1);
          const double y_mid = aa.getSuffix(aa.size() - j - 1).getMonoWeight(OpenMS::Residue::YIon, 1);
          const double drop = rep == 0 ? y_mid : b_mid;
          OpenMS::MSSpectrum kept;
          for (const auto& pk : s.spec)
            if (std::fabs(pk.getMZ() - drop) > 1e-6) kept.push_back(pk);
          check(kept.size() + 1 == s.spec.size(), pep + ": one middle peak dropped");
          tagChecked(checked, kept, s.prec_mz, 2, sp, tabs, ctx, &raw);
          ++n;
        }
      A::Settings st;
      const A::Call rc = A::callAlkylation(raw.asAlkylationTally(cands), st);
      const A::Call cc = AT::callTags(checked, st, ctx);
      const std::string fname = cands[static_cast<std::size_t>(k)].name;
      std::cerr << "alias " << x << "C: unchecked " << fname << " " << raw.votes[static_cast<std::size_t>(k)] << " unmod "
                << raw.votes[AT::UNMODIFIED] << " of " << raw.spectra << " -> "
                << (rc.called ? A::className(rc.cls) : "no_call " + rc.reason) << "; checked " << fname << " "
                << checked.votes[static_cast<std::size_t>(k)] << " unmod " << checked.votes[AT::UNMODIFIED] << " alias_rejected "
                << checked.alias_rejected << " of " << checked.spectra << " -> "
                << (cc.called ? A::className(cc.cls) : "no_call " + cc.reason) << "\n";
      check(rc.called && rc.cls == cands[static_cast<std::size_t>(k)].cls,
            std::string(1, x) + "C with a lost middle peak: the unchecked vote calls " + fname + " (the confound is live)");
      check(!(cc.called && cc.cls == cands[static_cast<std::size_t>(k)].cls),
            std::string(1, x) + "C with a lost middle peak: no " + fname + " call");
      check(checked.alias_rejected > 0, std::string(1, x) + "C: the alias check rejects votes");
    }
  }

  // ---- release-gate review n1: an alias that leaves no trace. Unmodified
  //      GC/CG (AC/CA) with the middle peak lost in BOTH series reads as one
  //      C[Carbamidomethyl] (C[Propionamide]) edge that no peak contradicts;
  //      the format 3 vote counted it for the reagent. The vote now needs the
  //      reagent's C immonium ion, which an unmodified C peptide does not
  //      give (its own, 76.022, is added): the final call is not the reagent.
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = 6;
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    for (const char x : {'G', 'A'})
    {
      const int k = x == 'G' ? 0 : 1;
      AT::Tally checked, raw;
      unsigned seed = 900;
      int n = 0;
      for (int rep = 0; rep < 2; ++rep)
        for (const char* base : PEPTIDES)
        {
          std::string pep = base;
          const std::size_t c = pep.find('C');
          pep.insert((n % 2) == 0 ? c : c + 1, 1, x);
          ComplementSynth::Spec s = ComplementSynth::make(pep, 2, false, 0, 0.0, 20, seed++);
          const OpenMS::AASequence aa = OpenMS::AASequence::fromString(pep);
          const double b_mid = aa.getPrefix(c + 1).getMonoWeight(OpenMS::Residue::BIon, 1);
          const double y_mid = aa.getSuffix(aa.size() - c - 1).getMonoWeight(OpenMS::Residue::YIon, 1);
          OpenMS::MSSpectrum kept;
          for (const auto& pk : s.spec)
            if (std::fabs(pk.getMZ() - b_mid) > 1e-6 && std::fabs(pk.getMZ() - y_mid) > 1e-6) kept.push_back(pk);
          check(kept.size() + 2 == s.spec.size(), pep + ": both middle peaks dropped");
          addImmonium(kept, "unmodified");
          tagChecked(checked, kept, s.prec_mz, 2, sp, tabs, ctx, &raw);
          ++n;
        }
      A::Settings st;
      const A::Call rc = A::callAlkylation(raw.asAlkylationTally(cands), st);
      const A::Call cc = AT::callTags(checked, st, ctx);
      const std::string fname = cands[static_cast<std::size_t>(k)].name;
      std::cerr << "alias " << x << "C, both middle peaks lost: unchecked " << fname << " "
                << raw.votes[static_cast<std::size_t>(k)] << " of " << raw.spectra << " -> "
                << (rc.called ? A::className(rc.cls) : "no_call " + rc.reason) << "; checked " << fname << " "
                << checked.votes[static_cast<std::size_t>(k)] << " alias_unconfirmed " << checked.alias_unconfirmed << " of "
                << checked.spectra << " -> " << (cc.called ? A::className(cc.cls) : "no_call " + cc.reason) << "\n";
      check(rc.called && rc.cls == cands[static_cast<std::size_t>(k)].cls,
            std::string(1, x) + "C, both middle peaks lost: the unchecked vote calls " + fname + " (the confound is live)");
      check(checked.alias_unconfirmed > 0, std::string(1, x) + "C, both middle peaks lost: votes abstain (alias_unconfirmed)");
      check(checked.votes[static_cast<std::size_t>(k)] <= 2,
            std::string(1, x) + "C, both middle peaks lost: at most 2 " + fname + " votes survive (" +
                std::to_string(checked.votes[static_cast<std::size_t>(k)]) + ")");
      check(!(cc.called && cc.cls == cands[static_cast<std::size_t>(k)].cls),
            std::string(1, x) + "C, both middle peaks lost: the final call is not " + fname);
    }
    // Positive control: real CAM spectra keep their call with the immonium
    // ion and abstain without it (the rule is live on true reagent spectra).
    AT::Tally with, without;
    unsigned seed = 950;
    for (const char* pep : PEPTIDES)
    {
      ComplementSynth::Spec s = ComplementSynth::make(withForm(pep, "Carbamidomethyl"), 2, false, 0, 0.0, 20, seed++);
      tagChecked(without, s.spec, s.prec_mz, 2, sp, tabs, ctx);
      addImmonium(s.spec, "Carbamidomethyl");
      tagChecked(with, s.spec, s.prec_mz, 2, sp, tabs, ctx);
    }
    A::Settings st;
    st.min_spectra = 6;
    const A::Call cw = AT::callTags(with, st, ctx);
    check(cw.called && cw.cls == A::CARBAMIDOMETHYL && with.alias_unconfirmed == 0,
          "CAM spectra with the immonium ion: call CAM, none abstains");
    check(without.votes[0] == 0 && without.alias_unconfirmed >= with.votes[0] && !AT::callTags(without, st, ctx).called,
          "CAM spectra without the immonium ion: every CAM vote abstains, no call (" + std::to_string(without.alias_unconfirmed) + ")");
    // the report row
    std::string au, au_n;
    for (const auto& r : AT::rows(without, AT::callTags(without, st, ctx), st, cands, AT::ReportInfo{}))
      if (r.section == "alkt_form" && r.key == "alias_unconfirmed") { au = r.value; au_n = r.n; }
    check(au == std::to_string(without.alias_unconfirmed) &&
              au_n == std::to_string(without.spectra + without.unresolved + without.alias_unconfirmed),
          "row alias_unconfirmed " + au + " of " + au_n);
  }

  // ---- codex6 review n1, final-call control 1: the internal a-type ion of an
  //      unmodified GC/CG (AC/CA) pair has the CAM (Propionamide) immonium m/z.
  //      Both middle peaks lost in both series, that ion present and the
  //      spectrum acquired from 100 m/z (76.022, the unmodified C immonium,
  //      cannot be seen): the format 4 rule of f0211733 took the ion for the
  //      reagent's immonium and counted the votes. Nothing tells the readings
  //      apart, so they abstain and the final call is not the reagent.
  {
    FASTag::Param run;
    run.tag_length = 3;
    run.max_extension = 6;
    run.mods = {{'C', cands[0].mass, "Carbamidomethyl", false}};
    const FASTag::Param sp = AT::shadowParam(run, cands);
    const FASTag::Tables tabs(sp);
    const AT::VoteContext ctx = AT::voteContext(sp, cands, nullptr);
    for (const char x : {'G', 'A'})
    {
      const int k = x == 'G' ? 0 : 1;
      AT::Tally checked, raw;
      unsigned seed = 1900;
      int n = 0;
      for (int rep = 0; rep < 2; ++rep)
        for (const char* base : PEPTIDES)
        {
          std::string pep = base;
          const std::size_t c = pep.find('C');
          pep.insert((n % 2) == 0 ? c : c + 1, 1, x);
          ComplementSynth::Spec s = ComplementSynth::make(pep, 2, false, 0, 0.0, 20, seed++);
          const OpenMS::AASequence aa = OpenMS::AASequence::fromString(pep);
          const double b_mid = aa.getPrefix(c + 1).getMonoWeight(OpenMS::Residue::BIon, 1);
          const double y_mid = aa.getSuffix(aa.size() - c - 1).getMonoWeight(OpenMS::Residue::YIon, 1);
          OpenMS::MSSpectrum kept;
          for (const auto& pk : s.spec)
            if (pk.getMZ() >= 100.0 && std::fabs(pk.getMZ() - b_mid) > 1e-6 && std::fabs(pk.getMZ() - y_mid) > 1e-6)
              kept.push_back(pk);
          // The pair's internal a-type ion: X + C - CO + H+, the reagent's immonium m/z.
          const double internal_a = OpenMS::ResidueDB::getInstance()->getResidue(std::string(1, x))->getMonoWeight(
                                        OpenMS::Residue::Internal) +
                                    OpenMS::ResidueDB::getInstance()->getResidue("C")->getMonoWeight(OpenMS::Residue::Internal) -
                                    (12.0 + 15.9949146196) + OpenMS::Constants::PROTON_MASS_U;
          check(std::fabs(internal_a - AT::immoniumMz(cands[static_cast<std::size_t>(k)])) < 1e-4,
                std::string(1, x) + "C internal a-ion " + std::to_string(internal_a) + " is the reagent immonium m/z");
          kept.emplace_back(internal_a, 0.3f);
          kept.sortByPosition();
          acquiredFrom(kept, 100.0);
          tagChecked(checked, kept, s.prec_mz, 2, sp, tabs, ctx, &raw);
          ++n;
        }
      A::Settings st;
      const A::Call cc = AT::callTags(checked, st, ctx);
      const std::string fname = cands[static_cast<std::size_t>(k)].name;
      std::cerr << "alias " << x << "C, both middle peaks lost, internal a-ion, from 100 m/z: checked " << fname << " "
                << checked.votes[static_cast<std::size_t>(k)] << " alias_unconfirmed " << checked.alias_unconfirmed << " of "
                << checked.spectra << " -> " << (cc.called ? A::className(cc.cls) : "no_call " + cc.reason) << "\n";
      check(A::callAlkylation(raw.asAlkylationTally(cands), st).called, std::string(1, x) + "C internal a-ion: the unchecked vote calls (live)");
      check(checked.alias_unconfirmed > 0, std::string(1, x) + "C internal a-ion: votes abstain");
      check(checked.votes[static_cast<std::size_t>(k)] <= 2, std::string(1, x) + "C internal a-ion: at most 2 " + fname +
                                                                  " votes survive (" +
                                                                  std::to_string(checked.votes[static_cast<std::size_t>(k)]) + ")");
      check(!(cc.called && cc.cls == cands[static_cast<std::size_t>(k)].cls),
            std::string(1, x) + "C internal a-ion: the final call is not " + fname);
    }
  }

  // ---- codex6 review n1, final-call control 2: abstentions are in the share.
  //      55 CAM and 45 Methylthio candidate votes, 28 CAM ones abstaining
  //      (alias_unconfirmed): 27 CAM and 45 Methylthio votes were a Methylthio
  //      share of 0.625 over the 60% threshold; with the abstentions it is 0.45.
  {
    int cam = -1, mt = -1;
    for (std::size_t g = 0; g < cands.size(); ++g)
    {
      if (cands[g].name == "Carbamidomethyl") cam = static_cast<int>(g);
      if (cands[g].name == "Methylthio") mt = static_cast<int>(g);
    }
    check(cam >= 0 && mt >= 0, "Carbamidomethyl and Methylthio are candidates");
    if (cam >= 0 && mt >= 0)
    {
      FASTag::Param p;
      p.tol_ppm = true;
      p.frag_tol = 10.0;
      const AT::VoteContext ctx = AT::voteContext(AT::shadowParam(p, cands), cands, nullptr);
      A::Settings st;
      const auto tally = [&](std::uint64_t c, std::uint64_t m, std::uint64_t abst) {
        AT::Tally t;
        t.votes[static_cast<std::size_t>(cam)] = c;
        t.votes[static_cast<std::size_t>(mt)] = m;
        t.spectra = c + m;
        t.alias_unconfirmed = abst;
        return t;
      };
      const A::Call all = AT::callTags(tally(55, 45, 0), st, ctx);
      check(!all.called, "55 CAM / 45 Methylthio: no call (" + all.reason + ")");
      const A::Call abst = AT::callTags(tally(27, 45, 28), st, ctx);
      check(!(abst.called && abst.cls == A::METHYLTHIO),
            "27 CAM / 45 Methylthio / 28 CAM abstaining: not a Methylthio call (share " + std::to_string(abst.share) + ")");
      check(!abst.called && abst.reason == "ambiguous" && std::fabs(abst.share - 0.45) < 1e-9 && abst.voted == 100,
            "27 / 45 / 28 abstaining: ambiguous, share 0.45 of 100 (" + abst.reason + " " + std::to_string(abst.share) + " " +
                std::to_string(abst.voted) + ")");
      // The rule is live: without abstentions 27 / 45 is a Methylthio call.
      const A::Call none = AT::callTags(tally(27, 45, 0), st, ctx);
      check(none.called && none.cls == A::METHYLTHIO, "27 CAM / 45 Methylthio, none abstaining: Methylthio is called");
      // The report says so.
      std::string share_n, voted_d;
      for (const auto& r : AT::rows(tally(27, 45, 28), abst, st, cands, AT::ReportInfo{}))
      {
        if (r.section == "alkylation_tags_call" && r.key == "share") share_n = r.n;
        if (r.section == "alkylation_tags_call" && r.key == "voted") voted_d = r.description;
      }
      check(share_n == "100" && voted_d.find("28 abstained") != std::string::npos,
            "the share's n is 100 and voted names the 28 abstentions (" + share_n + ", " + voted_d + ")");
    }
  }

  // ---- immoniumConfirms: the form's immonium, resolved from the alias's own
  {
    check(std::fabs(AT::immoniumMz(cands[0]) - 133.0430) < 1e-3, "CAM C immonium 133.043");
    check(std::fabs(AT::immoniumMz(cands[AT::UNMODIFIED]) - 76.0216) < 1e-3, "unmodified C immonium 76.022");
    FASTag::Param p;
    p.tol_ppm = true;
    p.frag_tol = 20.0;
    const auto al = AT::aliasList(cands, 0.05, nullptr);
    const AT::Alias* cg = nullptr;
    const AT::Alias* iso = nullptr;
    for (const auto& a : al[0])
      if (a.name == "C+G") cg = &a;
    for (const auto& a : al[4])
      if (a.kind == AT::Alias::Kind::ISO && a.other == 0) iso = &a;
    check(cg && iso, "aliases C+G of CAM and C[Carbamidomethyl]+13C of Carboxymethyl listed");
    if (cg && iso)
    {
      // Codex6 review n1: 133.0430 is also the internal a-type ion of
      // unmodified GC/CG, so the CAM immonium tells C+G apart only with the
      // unmodified C immonium (76.022) absent where it could have been seen.
      OpenMS::MSSpectrum with, without, gc_ion, gc_c76, peaks_from_60;
      with.emplace_back(AT::immoniumMz(cands[0]), 10.0f);
      with.emplace_back(500.0, 100.0f);
      acquiredFrom(with, 50.0);
      without.emplace_back(120.0, 10.0f);
      without.emplace_back(500.0, 100.0f);
      acquiredFrom(without, 50.0);
      // 133.043 alone, acquired from 100 m/z: 76.022 could not be seen.
      gc_ion.emplace_back(AT::immoniumMz(cands[0]), 10.0f);
      gc_ion.emplace_back(500.0, 100.0f);
      acquiredFrom(gc_ion, 100.0);
      // 133.043 with the unmodified C immonium beside it: the C+G reading's own ion.
      gc_c76 = with;
      gc_c76.emplace_back(AT::immoniumMz(cands[AT::UNMODIFIED]), 2.0f);
      gc_c76.sortByPosition();
      // No scan window: the peaks' range decides (a peak at 60 m/z puts 76.022 inside it).
      peaks_from_60.emplace_back(60.0, 1.0f);
      peaks_from_60.emplace_back(AT::immoniumMz(cands[0]), 10.0f);
      peaks_from_60.emplace_back(500.0, 100.0f);
      const AT::SpectrumPeaks pw{&with, 1000.0}, po{&without, 1000.0}, pg{&gc_ion, 1000.0}, p76{&gc_c76, 1000.0},
          p60{&peaks_from_60, 1000.0};
      check(AT::immoniumConfirms(0, *cg, cands, pw, p), "CAM immonium present, 76.022 seeable and absent: C+G confirmed as CAM");
      check(!AT::immoniumConfirms(0, *cg, cands, po, p), "no CAM immonium: not confirmed");
      check(!AT::immoniumConfirms(0, *cg, cands, pg, p),
            "133.043 (the GC internal a-ion too) with 76.022 outside the scan window: not confirmed");
      check(!AT::immoniumConfirms(0, *cg, cands, p76, p), "133.043 with 76.022 present: not confirmed");
      check(AT::immoniumConfirms(0, *cg, cands, p60, p), "no scan window, peaks from 60 m/z, no 76.022: confirmed");
      peaks_from_60.erase(peaks_from_60.begin());
      check(!AT::immoniumConfirms(0, *cg, cands, p60, p), "no scan window, peaks from 133 m/z: 76.022 unseeable, not confirmed");
      // raw takes precedence over the prepared peaks
      const AT::SpectrumPeaks pr{&without, 1000.0, &with};
      check(AT::immoniumConfirms(0, *cg, cands, pr, p), "the raw spectrum's immonium ion counts");
      // Carboxymethyl (134.027) against CAM + 13C (its immonium's 13C at
      // 134.046): told apart at 20 ppm, not at 0.02 Da
      OpenMS::MSSpectrum cm;
      cm.emplace_back(AT::immoniumMz(cands[4]), 10.0f);
      cm.emplace_back(500.0, 100.0f);
      const AT::SpectrumPeaks pc{&cm, 1000.0};
      check(AT::immoniumConfirms(4, *iso, cands, pc, p), "20 ppm: the Carboxymethyl immonium confirms against CAM+13C");
      FASTag::Param da;
      da.tol_ppm = false;
      da.frag_tol = 0.02;
      check(!AT::immoniumConfirms(4, *iso, cands, pc, da), "0.02 Da: the CAM 13C immonium is in the window, not confirmed");
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
