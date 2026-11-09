// a/x ions (FASTag 1.13 backlog item 11; src/IonSeries.h, -ion_series ax and
// -ion_series auto -ion_series_photo ax):
//   (a) the a/x IonPair equals OpenMS's internal-to-A/X formulas and the
//       hand values a = residues - CO, x = residues + CO2; compl_delta -2H,
//       reversed offset CO2 + CO = +71.984744, no charge loss; ComplementSpec.
//   (b) modes and names: ax reads every class as a/x; auto reads a
//       photo-activated spectrum as a/x only with photo_ax; the column and
//       seriesInRun rules; the 1.12 by/cz/auto results are unchanged.
//   (c) photoActivated: PHD alone, an @uvpd filter token; never when a
//       collisional or electron method or token classifies the spectrum.
//   (d) a/x ladders (TheoreticalSpectrumGenerator) of 5 tryptic peptides at
//       2+ and 3+: under ax every tag the peptide holds has flanks within
//       0.01 Da of the truth, most with p_complement < 1; read as b/y the
//       same reads are off by the documented offsets.
//   (e) a reversed (a-derived) tag is placed by TagRecon and counted by the
//       digest TerminusCounter with offset offC - offN, not with H2O.
//   (f) the INFO and WARN lines: 1.12's text under by/cz/auto, a/x counts
//       under ax and auto + photo ax; never the gate summary pattern.
//   (g) RunMeta writes the ion_series_ax/_photo rows only for a/x runs.
//   plus --write-mzml for the CLI test (ax_cli_test.sh).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "CliParam.h"
#include "ClusterAcc.h"
#include "Digest.h"
#include "FASTagger.h"
#include "IonSeries.h"
#include "ProteomeIndex.h"
#include "RunMeta.h"
#include "TagRecon.h"
#include "cz_synth.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <regex>
#include <set>
#include <string>
#include <vector>

using OpenMS::MSSpectrum;
using OpenMS::Precursor;
using AM = OpenMS::Precursor::ActivationMethod;
namespace IS = FASTag::IonSeries;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  const std::regex kGateSummary("^[0-9]+ MS2 spectra, [0-9]+ tags");
  const double kWater = OpenMS::EmpiricalFormula("H2O").getMonoWeight();

  MSSpectrum ms2(std::set<AM> methods, const std::string& filter = std::string())
  {
    MSSpectrum s;
    s.setMSLevel(2);
    Precursor p;
    p.setMZ(500.0);
    p.setCharge(2);
    if (!methods.empty()) p.setActivationMethods(methods);
    s.setPrecursors({p});
    if (!filter.empty()) s.setMetaValue("filter string", filter);
    return s;
  }

  double resMass(char c)
  {
    return OpenMS::ResidueDB::getInstance()->getResidue(std::string(1, c))->getMonoWeight(OpenMS::Residue::Internal);
  }
  double sumMass(const std::string& s)
  {
    double m = 0;
    for (char c : s) m += resMass(c);
    return m;
  }

  /// The flanks of a read of residues [pos, pos+len) under @p ip (the
  /// tagger's convention; see ion_series_test.cpp).
  std::pair<double, double> flanksOf(const std::string& pep, size_t pos, size_t len, bool reversed,
                                     const IS::IonPair& ip)
  {
    const double nside = sumMass(pep.substr(0, pos)), cside = sumMass(pep.substr(pos + len));
    double n, c;
    if (!reversed) { n = nside; c = cside; }
    else { n = cside + ip.reversedOffset(); c = nside - ip.reversedOffset(); }
    return {std::max(0.0, n), std::max(0.0, c)};
  }

  std::vector<std::pair<size_t, bool>> occurrences(const std::string& pep, const std::string& tag)
  {
    std::vector<std::pair<size_t, bool>> out;
    const std::string rev(tag.rbegin(), tag.rend());
    for (size_t at = pep.find(tag); at != std::string::npos; at = pep.find(tag, at + 1)) out.emplace_back(at, false);
    for (size_t at = pep.find(rev); at != std::string::npos; at = pep.find(rev, at + 1)) out.emplace_back(at, true);
    return out;
  }

  FASTag::Param withPair(FASTag::Param p, IS::Series s)
  {
    p.ion_pair = IS::ionPair(s);
    return p;
  }

  const char* const kPeptides[5] = {"VGAHAGEYGAEALER", "LLEQTHGGLNAWK", "DLVEGFNTWQR", "GDFQAMVYTNSAWR",
                                    "YLGYLEQLLR"};

  /// ax_ions_test --write-mzml <fasta> <out.mzML> <uvpd|uvpd_filter|by> [n]:
  /// n (40) tryptic peptides of @p fasta (as ion_series_test --write-mzml),
  /// precursor charge 2 and 3 alternately, 15 noise peaks. uvpd = a and x
  /// ions (fragment charges 1 .. z-1) with the activation photodissociation
  /// (MS:1000435, PHD); uvpd_filter = the same peaks with no activation term
  /// and the filter string "FTMS + c NSI d Full ms2 <mz>@uvpd25.00
  /// [100.0000-2000.0000]"; by = b and y ions with CID (MS:1000133).
  int writeMzml(int argc, char** argv)
  {
    if (argc < 5)
    {
      std::cerr << "usage: ax_ions_test --write-mzml <fasta> <out.mzML> <uvpd|uvpd_filter|by> [n]\n";
      return 2;
    }
    const std::string kind = argv[4];
    const bool ax = kind == "uvpd" || kind == "uvpd_filter";
    const size_t n = argc > 5 ? static_cast<size_t>(std::stoul(argv[5])) : 40;
    std::vector<OpenMS::FASTAFile::FASTAEntry> prot;
    OpenMS::FASTAFile().load(argv[2], prot);
    OpenMS::ProteaseDigestion dig;
    dig.setEnzyme("Trypsin");
    dig.setMissedCleavages(1);
    std::set<std::string> seen;
    std::vector<std::string> peps;
    for (const auto& e : prot)
    {
      std::vector<OpenMS::AASequence> out;
      dig.digest(OpenMS::AASequence::fromString(e.sequence), out, 8, 18);
      for (const auto& a : out)
      {
        const std::string s = a.toUnmodifiedString();
        if (s.find_first_of("CUXBZ") != std::string::npos || !seen.insert(s).second) continue;
        peps.push_back(s);
        if (peps.size() == n) break;
      }
      if (peps.size() == n) break;
    }
    OpenMS::PeakMap exp;
    for (size_t i = 0; i < peps.size(); ++i)
    {
      const int z = i % 2 == 0 ? 2 : 3;
      CzSynth::Spec sp = CzSynth::make(peps[i], z, ax ? CzSynth::Ions::AX : CzSynth::Ions::BY, std::max(1, z - 1), 15,
                                       2000u + static_cast<unsigned>(i));
      sp.spec.setMSLevel(2);
      sp.spec.setRT(10.0 + i);
      sp.spec.setNativeID("controllerType=0 controllerNumber=1 scan=" + std::to_string(i + 1));
      sp.spec.setType(OpenMS::SpectrumSettings::SpectrumType::CENTROID);
      Precursor pr;
      pr.setMZ(sp.prec_mz);
      pr.setCharge(z);
      if (kind == "uvpd") pr.setActivationMethods({AM::PHD});
      else if (kind == "by") pr.setActivationMethods({AM::CID});
      sp.spec.setPrecursors({pr});
      if (kind == "uvpd_filter")
      {
        char f[128];
        std::snprintf(f, sizeof f, "FTMS + c NSI d Full ms2 %.4f@uvpd25.00 [100.0000-2000.0000]", sp.prec_mz);
        sp.spec.setMetaValue("filter string", std::string(f));
      }
      exp.addSpectrum(sp.spec);
    }
    OpenMS::MzMLFile().store(argv[3], exp);
    std::cout << "wrote " << exp.size() << " " << kind << " spectra to " << argv[3] << "\n";
    return peps.size() == n ? 0 : 1;
  }
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::string(argv[1]) == "--write-mzml") return writeMzml(argc, argv);
  using A = IS::Activation;
  const IS::IonPair axp = IS::ionPair(IS::Series::AX), byp = IS::ionPair(IS::Series::BY);

  // ---- (a) the a/x ion pair ----
  {
    check(axp.kind == IS::Series::AX, "ionPair(AX).kind");
    check(std::fabs(axp.offN - OpenMS::Residue::getInternalToAIon().getMonoWeight()) < 1e-12 &&
            std::fabs(axp.offC - OpenMS::Residue::getInternalToXIon().getMonoWeight()) < 1e-12,
          "a/x offsets are OpenMS's internal-to-A/X");
    // Hand values (not OpenMS's): a = residues - CO, x = residues + CO2.
    check(std::fabs(axp.offN + 27.994915) < 1e-5, "a = residues - CO (-27.994915)");
    check(std::fabs(axp.offC - 43.989829) < 1e-5, "x = residues + CO2 (+43.989829)");
    check(std::fabs(axp.compl_delta + 2.015650) < 1e-5, "compl_delta(a/x) = -2H = -2.015650");
    check(std::fabs(axp.reversedOffset() - 71.984744) < 1e-5, "a/x reversed offset offC - offN = +71.984744");
    check(axp.charge_loss == 0, "a/x loses no charge");
    const auto cs = FASTag::ComplementSpec::fromParam(withPair(FASTag::cliDefaultParam(), IS::Series::AX));
    check(cs.pair_deltas.size() == 1 && std::fabs(cs.pair_deltas[0] + 2.015650) < 1e-5 && cs.charge_loss == 0,
          "a/x complement pairs sum to M - 2H at the precursor's charges");
    check(std::string(IS::seriesName(IS::Series::AX)) == "ax", "seriesName(AX) is ax");
    check(std::string(IS::seriesName(IS::Series::BY)) == "by" && std::string(IS::seriesName(IS::Series::CZ)) == "cz",
          "1.12 series names unchanged");
    check(static_cast<int>(IS::Series::AX) == 2 && static_cast<int>(IS::Series::CZ) == 1, "series values stable");
  }

  // ---- (b) modes ----
  {
    check(IS::modeFromString("ax") == IS::Mode::Ax && std::string(IS::modeName(IS::Mode::Ax)) == "ax",
          "mode ax round-trips");
    check(std::string(IS::kModeValues) == "by,cz,auto,ax" && std::string(IS::kModeDefault) == "by",
          "mode values; default by");
    check(std::string(IS::kPhotoDefault) == "by" && std::string(IS::kPhotoValues) == "by,ax",
          "-ion_series_photo values; default by");
    for (A a : {A::Collisional, A::Electron, A::Hybrid, A::Unknown})
    {
      check(IS::seriesFor(IS::Mode::Ax, a) == IS::Series::AX, "ax reads every class as a/x");
      for (bool ph : {false, true})
      {
        check(IS::seriesFor(IS::Mode::By, a, ph) == IS::Series::BY, "by never reads a/x");
        check(IS::seriesFor(IS::Mode::Cz, a, ph) == IS::Series::CZ, "cz never reads a/x");
      }
      // 1.12's auto: photo_ax off gives the two-argument result.
      check(IS::seriesFor(IS::Mode::Auto, a, false) == IS::seriesFor(IS::Mode::Auto, a), "auto without photo is 1.12's");
    }
    check(IS::seriesFor(IS::Mode::Auto, A::Unknown, true) == IS::Series::AX, "auto + photo ax reads photo as a/x");
    check(IS::seriesFor(IS::Mode::Auto, A::Unknown, false) == IS::Series::BY, "auto reads photo as b/y by default");
    check(IS::seriesFor(IS::Mode::Auto, A::Electron, true) == IS::Series::CZ, "electron stays c/z under photo ax");
    check(IS::seriesFor(IS::Mode::Auto, A::Collisional, true) == IS::Series::BY, "a classified spectrum is never photo");
    IS::ActivationCounts photo, col;
    photo.add(A::Unknown);
    photo.photo = 1;
    col.add(A::Collisional);
    check(IS::seriesColumn(IS::Mode::Ax, col), "ax always writes the column");
    check(!IS::seriesColumn(IS::Mode::Auto, photo), "auto without photo ax: no column for a photo run (1.12)");
    check(IS::seriesColumn(IS::Mode::Auto, photo, true), "auto + photo ax with a photo spectrum: the column");
    check(!IS::seriesColumn(IS::Mode::Auto, col, true), "auto + photo ax without photo spectra: no column");
    check(IS::seriesInRun(IS::Mode::Auto, A::Unknown, false, true) == IS::Series::BY,
          "without the column a photo spectrum is read as b/y");
    check(IS::seriesInRun(IS::Mode::Auto, A::Unknown, true, true) == IS::Series::AX, "with it as a/x");
    check(IS::seriesInRun(IS::Mode::Ax, A::Collisional, true) == IS::Series::AX, "ax with its column");
    IS::ActivationCounts m1 = photo, m2 = photo;
    m1.merge(m2);
    check(m1.photo == 2 && m1.total() == 2, "ActivationCounts merge sums photo");
    IS::SeriesCounts s1, s2;
    s1.ms2_ax = 2;
    s2.ms2_ax = 3;
    s1.merge(s2);
    check(s1.ms2_ax == 5, "SeriesCounts merge sums a/x");
    FASTag::ClusterAcc::ClusterThread t1, t2;
    t1.e.series.ms2_ax = 1;
    t2.e.series.ms2_ax = 4;
    t2.e.activation.photo = 3;
    t1.merge(t2);
    check(t1.e.series.ms2_ax == 5 && t1.e.activation.photo == 3, "ClusterThread merge sums a/x and photo");
  }

  // ---- (c) photodissociation ----
  {
    check(IS::photoActivated(ms2({AM::PHD})), "PHD (MS:1000435) is photo");
    check(!IS::photoActivated(ms2({AM::PHD, AM::HCD})), "PHD with HCD is collisional, not photo");
    check(!IS::photoActivated(ms2({AM::PHD, AM::ETD})), "PHD with ETD is electron, not photo");
    check(!IS::photoActivated(ms2({AM::CID})), "CID is not photo");
    check(!IS::photoActivated(ms2({})), "no method is not photo");
    check(!IS::photoActivated(ms2({AM::IMD})), "IRMPD is not photo");
    check(IS::photoActivated(ms2({}, "FTMS + c NSI d Full ms2 652.3400@uvpd25.00 [100.0000-1500.0000]")),
          "an @uvpd filter token is photo");
    check(IS::photoActivated(ms2({}, "FTMS + c NSI d Full ms2 652.3400@UVPD25.00 [100-1500]")), "case-insensitive");
    check(!IS::photoActivated(ms2({}, "FTMS + c NSI d Full ms2 652.3400@hcd25.00@uvpd10.00 [100-1500]")),
          "@hcd@uvpd is collisional");
    check(!IS::photoActivated(ms2({}, "FTMS + c NSI d Full ms2 652.3400@uvpdx25.00 [100-1500]")),
          "only the whole token uvpd");
    check(IS::activationClass(ms2({AM::PHD})) == A::Unknown, "photo stays in the unknown class (1.12 counts)");
  }

  // ---- (d) a/x ladders read as a/x and as b/y ----
  {
    const FASTag::Param base = FASTag::cliDefaultParam();
    const FASTag::Param pax = withPair(base, IS::Series::AX), pby = withPair(base, IS::Series::BY);
    const FASTag::Tables tax(pax), tby(pby);
    int spectra_with_true = 0, true_tags = 0, compl_ok = 0, by_reads = 0, by_off = 0;
    for (const char* pep : kPeptides)
      for (int z : {2, 3})
      {
        const CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::AX, z - 1, 20, 300u + static_cast<unsigned>(z));
        const std::string what = std::string(pep) + " " + std::to_string(z) + "+";
        int here = 0;
        for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, z, pax, tax))
        {
          // The tags the reports count (ungapped, E <= 1): a 3-residue read
          // with E > 1 can spell a stretch of the peptide by coincidence
          // (YLGYLEQLLR 3+: YLG from 2+ peaks at E 6.6, flanks one tag off).
          if (t.gapped || t.evalue > 1.0) continue;
          const std::string seq = FASTag::baseSequence(t.seq);
          const auto occ = occurrences(pep, seq);
          if (occ.empty()) continue;
          check(t.ion_series == IS::Series::AX, what + ": tags carry ion_series ax");
          double best = 1e9;
          for (const auto& [pos, rev] : occ)
          {
            const auto [n, c] = flanksOf(pep, pos, seq.size(), rev, axp);
            best = std::min(best, std::max(std::fabs(t.nterm_mass - n), std::fabs(t.cterm_mass - c)));
          }
          check(best <= 0.01, what + ": tag " + seq + " flanks within 0.01 Da of the truth (off " +
                                  std::to_string(best) + "; n " + std::to_string(t.nterm_mass) + " c " +
                                  std::to_string(t.cterm_mass) + " z " + std::to_string(t.charge) + " low_mz " +
                                  std::to_string(t.low_mz) + " E " + std::to_string(t.evalue) + ")");
          ++here;
          ++true_tags;
          if (t.p_complement < 1.0) ++compl_ok;
        }
        if (here > 0) ++spectra_with_true;
        // b/y reading of the same ladder: the flanks miss the truth.
        for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, z, pby, tby))
        {
          check(t.ion_series == IS::Series::BY, what + ": b/y tags carry ion_series by");
          if (t.gapped) continue;
          const std::string seq = FASTag::baseSequence(t.seq);
          const auto occ = occurrences(pep, seq);
          if (occ.empty()) continue;
          ++by_reads;
          double best = 1e9;
          for (const auto& [pos, rev] : occ)
          {
            const auto [n, c] = flanksOf(pep, pos, seq.size(), rev, axp);
            best = std::min(best, std::max(std::fabs(t.nterm_mass - n), std::fabs(t.cterm_mass - c)));
          }
          if (best > 1.0) ++by_off;
        }
      }
    std::cout << "d. " << true_tags << " true a/x tags in " << spectra_with_true << " of 10 spectra, " << compl_ok
              << " with p_complement < 1; " << by_off << " of " << by_reads << " b/y reads off the truth\n";
    check(spectra_with_true == 10, "every a/x spectrum yields a true tag under ax");
    check(true_tags >= 50, "enough true a/x tags for a meaningful check");
    check(2 * compl_ok >= true_tags, "most true a/x tags find their complement (M - 2H)");
    check(by_reads >= 20 && by_off == by_reads, "every b/y read of an a/x ladder misses the a/x truth");
    // A wrong compl_delta must cost the complement: with b/y's delta 0 the
    // same a/x reads find (almost) none.
    FASTag::Param wrong = pax;
    wrong.ion_pair.compl_delta = 0.0;
    const FASTag::Tables tw(wrong);
    int wrong_compl = 0, right_compl = 0;
    for (const char* pep : kPeptides)
    {
      const CzSynth::Spec s = CzSynth::make(pep, 2, CzSynth::Ions::AX, 1, 20, 302u);
      for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, wrong, tw)) wrong_compl += t.p_complement < 1.0;
      for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, pax, tax)) right_compl += t.p_complement < 1.0;
    }
    check(right_compl > 3 * wrong_compl + 5, "the -2H complement delta is what finds the a/x pairs (" +
                                                 std::to_string(right_compl) + " vs " + std::to_string(wrong_compl) + ")");
    // b/y ladders under b/y keep 1.11's convention (the default Param).
    check(FASTag::cliDefaultParam().ion_pair.kind == IS::Series::BY, "the default Param stays b/y");
  }

  // ---- (e) a reversed a-derived tag: TagRecon and Digest ----
  {
    const std::string pep = "SAMGLEVGATSDGK";
    std::vector<OpenMS::FASTAFile::FASTAEntry> entries;
    entries.emplace_back("PROT1", "test protein", "MSTVWYAAR" + pep + "GTANLEFDSK");
    FASTag::ProteomeIndex idx;
    idx.build(entries, {}, 0);
    FASTag::TagReconciler r(0.02, false, true);
    r.attach(&idx, 0, 4);
    const size_t pos = 4;
    const std::string tag = pep.substr(pos, 4), rev(tag.rbegin(), tag.rend());
    const auto [n, c] = flanksOf(pep, pos, 4, true, axp);
    const auto exact_rev = [&](const std::vector<FASTag::Reconciliation>& v) {
      for (const auto& x : v)
        if (x.peptide == pep && x.pos == pos && x.reversed && x.nterm_match && x.cterm_match &&
            std::fabs(x.delta_mass) < 1e-6)
          return true;
      return false;
    };
    const IS::IonPair czp = IS::ionPair(IS::Series::CZ);
    check(exact_rev(r.reconcile(rev, n, c, nullptr, 2, nullptr, &axp)), "(e) a reversed a/x read places with offC - offN");
    check(!exact_rev(r.reconcile(rev, n, c)), "(e) read with the b/y water offset it does not");
    check(!exact_rev(r.reconcile(rev, n, c, nullptr, 2, nullptr, &czp)), "(e) nor with the c/z offset");
    // From the tagger: an a-only ladder, tagged under ax, reads reversed.
    const CzSynth::Spec s = CzSynth::make(pep, 2, CzSynth::Ions::A, 1);
    FASTag::Param pax = withPair(FASTag::cliDefaultParam(), IS::Series::AX);
    pax.tag_length = 4;
    const FASTag::Tables tax(pax);
    int reversed_tags = 0, placed = 0, unplaced_as_by = 0;
    for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, pax, tax))
    {
      if (t.gapped || t.n_res < 4) continue;
      const std::string seq = FASTag::baseSequence(t.seq);
      const std::string fwd(seq.rbegin(), seq.rend());
      if (pep.find(fwd) == std::string::npos) continue;
      ++reversed_tags;
      bool ok = false, ok_by = false;
      for (const auto& x : r.reconcile(seq, t.nterm_mass, t.cterm_mass, nullptr, 2, nullptr, &axp))
        ok = ok || (x.peptide == pep && x.reversed && x.nterm_match && x.cterm_match);
      for (const auto& x : r.reconcile(seq, t.nterm_mass, t.cterm_mass))
        ok_by = ok_by || (x.peptide == pep && x.reversed && x.nterm_match && x.cterm_match);
      placed += ok;
      unplaced_as_by += !ok_by;
    }
    check(reversed_tags >= 2 && placed == reversed_tags && unplaced_as_by == reversed_tags,
          "(e) every reversed tag of an a ladder places under ax and not under b/y (" + std::to_string(placed) + "/" +
              std::to_string(reversed_tags) + ")");
    // Forward x-derived reads place with the plain convention.
    const CzSynth::Spec sx = CzSynth::make(pep, 2, CzSynth::Ions::X, 1);
    int fwd_tags = 0, fwd_placed = 0;
    for (const FASTag::Tag& t : FASTag::tagSpectrum(sx.spec, sx.prec_mz, 2, pax, tax))
    {
      if (t.gapped || t.n_res < 4) continue;
      const std::string seq = FASTag::baseSequence(t.seq);
      if (pep.find(seq) == std::string::npos) continue;
      ++fwd_tags;
      bool ok = false;
      for (const auto& x : r.reconcile(seq, t.nterm_mass, t.cterm_mass, nullptr, 2, nullptr, &axp))
        ok = ok || (x.peptide == pep && !x.reversed && x.nterm_match && x.cterm_match);
      fwd_placed += ok;
    }
    check(fwd_tags >= 2 && fwd_placed == fwd_tags, "(e) every forward tag of an x ladder places under ax (" +
                                                       std::to_string(fwd_placed) + "/" + std::to_string(fwd_tags) + ")");
    // Digest: a reversed read next to the C-terminal K counts K at P1 with
    // the a/x offset; with H2O it does not.
    const size_t kpos = pep.size() - 5;
    const auto [kn, kc] = flanksOf(pep, kpos, 4, true, axp);
    const std::string krev = std::string(pep.rbegin() + 1, pep.rbegin() + 5);
    FASTag::Digest::TerminusCounter tc_ax, tc_by;
    tc_ax.add(kn, kc, krev, axp.reversedOffset());
    tc_by.add(kn, kc, krev);
    const int K = FASTag::Digest::aaIndex('K');
    check(K >= 0 && tc_ax.cterm()[static_cast<size_t>(K)] == 1, "(e) the a/x reversed read counts K at P1");
    check(K >= 0 && tc_by.cterm()[static_cast<size_t>(K)] == 0, "(e) read with H2O it does not");
    // Every read of the 5 peptides in the a/x convention gives the counts of
    // the same reads in the b/y convention (the true termini).
    FASTag::Digest::TerminusCounter all_ax, all_by;
    for (const char* pc : kPeptides)
    {
      const std::string p = pc;
      for (size_t at = 0; at + 3 <= p.size(); ++at)
        for (bool rv : {false, true})
        {
          const std::string seq = rv ? std::string(p.rbegin() + static_cast<long>(p.size() - at - 3),
                                                   p.rbegin() + static_cast<long>(p.size() - at))
                                     : p.substr(at, 3);
          const auto fa = flanksOf(p, at, 3, rv, axp), fb = flanksOf(p, at, 3, rv, byp);
          all_ax.add(fa.first, fa.second, seq, axp.reversedOffset());
          all_by.add(fb.first, fb.second, seq);
        }
    }
    check(all_ax.c_near == all_by.c_near && all_ax.n_h2o == all_by.n_h2o && all_ax.n_near == all_by.n_near &&
            all_ax.cpos == all_by.cpos && all_ax.npos == all_by.npos,
          "(e) digest counts of a/x reads equal the b/y convention's");
  }

  // ---- (f) INFO and WARN lines ----
  {
    IS::SeriesCounts sc;
    sc.ms2_by = 4;
    sc.ms2_cz = 3;
    IS::ActivationCounts act;
    act.add(A::Electron);
    act.add(A::Unknown);
    act.photo = 1;
    const std::string v112 =
        "Ion series (-ion_series auto): 3 MS2 spectra tagged as c/z-dot ions, 4 as b/y ions (activation: 0 "
        "collisional, 1 electron, 0 hybrid, 1 unknown).";
    check(IS::seriesInfo(IS::Mode::Auto, sc, act) == v112, "auto without photo ax: 1.12's INFO line, byte for byte");
    check(IS::seriesInfo(IS::Mode::Auto, sc, act, false) == v112, "photo_ax false is the 1.12 line");
    const std::string cz = IS::seriesInfo(IS::Mode::Cz, sc, act);
    check(cz.find("a/x") == std::string::npos && cz.find("photo") == std::string::npos, "cz: no a/x in the line");
    sc.ms2_ax = 2;
    const std::string ph = IS::seriesInfo(IS::Mode::Auto, sc, act, true);
    check(ph == "Ion series (-ion_series auto): 3 MS2 spectra tagged as c/z-dot ions, 4 as b/y ions, 2 as a/x ions "
                "(activation: 0 collisional, 1 electron, 0 hybrid, 1 unknown, of them 1 photodissociation).",
          "auto + photo ax: a/x and photo counts (" + ph + ")");
    const std::string ax = IS::seriesInfo(IS::Mode::Ax, sc, act);
    check(ax.rfind("Ion series (-ion_series ax): ", 0) == 0 && ax.find(", 2 as a/x ions") != std::string::npos,
          "ax: a/x counts");
    for (const std::string& l : {ph, ax, IS::classifiedAxWarning(act), IS::speciesExcludedAxWarning(5)})
      check(!std::regex_search(l, kGateSummary) && l.find('\n') == std::string::npos, "one line, not the gate pattern");
    IS::ActivationCounts h;
    for (int i = 0; i < 99; ++i) h.add(A::Unknown);
    h.add(A::Collisional);
    check(!IS::warnClassifiedUnderAx(h), "1 classified of 100 (1%) does not warn under ax");
    h.add(A::Electron);
    check(IS::warnClassifiedUnderAx(h), "2 of 101 warn under ax");
    check(IS::classifiedAxWarning(h).find("2 of 101") != std::string::npos, "the warning names the counts");
    check(IS::speciesExcludedAxWarning(5).find("5 tag rows read as a/x") != std::string::npos, "species a/x warning");
  }

  // ---- (g) RunMeta rows ----
  {
    namespace RR = FASTag::RunReport;
    RR::RunMeta m;
    m.ion_series = "auto";
    m.ion_series_ms2_by = 5;
    m.ion_series_ms2_cz = 1;
    const auto has = [](const std::vector<FASTag::Digest::Row>& rows, const std::string& key) {
      for (const auto& r : rows)
        if (r.key == key) return true;
      return false;
    };
    auto rows = RR::runRows(m, RR::Emit::Versioned);
    check(has(rows, "ion_series_cz") && !has(rows, "ion_series_ax") && !has(rows, "ion_series_photo"),
          "no a/x rows by default (1.12 layout)");
    m.ion_series_ax_row = true;
    m.ion_series_ms2_ax = 2;
    m.ion_series_photo = "ax";
    rows = RR::runRows(m, RR::Emit::Versioned);
    bool ok = false;
    for (const auto& r : rows)
      if (r.key == "ion_series_ax") ok = r.value == "2" && r.n == "8";
    check(ok && has(rows, "ion_series_photo"), "an a/x run writes ion_series_ax (2 of 8) and ion_series_photo");
  }

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "ax_ions_test: all checks passed\n";
  return 0;
}
