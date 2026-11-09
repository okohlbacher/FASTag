// src/IonSeries.h, phase A of #15 (1.12): the activation class of an MS2
// spectrum, the per-run counts and the warning that a run with electron or
// hybrid activation is tagged as b/y ions.
//
// Phase B (c/z-dot ion pairs, -ion_series by|cz|auto), PLAN-data-types E9:
//   (a) IonPair offsets equal OpenMS's residue-to-ion formulas; compl_delta
//       of c/z-dot is +H (1.007825 +- 1e-6), of b/y 0.
//   (b) c/z-dot ladders (TheoreticalSpectrumGenerator) of 5 tryptic peptides
//       at 2+ and 3+: under cz every tag whose sequence the peptide holds has
//       flanks within 0.01 Da of the truth and p_complement < 1; under by the
//       same reads carry the documented offset and p_complement is 1.
//       (b2) under -complement_rule precursor a c/z-dot pair shares c - 1
//       charges (the precursor takes up one electron): 1+ partners on 3+,
//       none on 2+.
//   (c) the ETD precursor filter drops the unreacted precursor and the
//       charge-reduced species (with isotopes and hydrogen transfer) but no
//       fragment, and keeps peaks 5 Da away from them.
//   (c2) issue T25: under cz a peak the deisotoper moves to the 1+ scale
//       above the precursor cut is dropped; under by it stays.
//   (d) the b/y branch reproduces the E-values FASTag 1.11.0 (78390cd)
//       wrote (test/complement_ref_1_11.inc), with the pair set explicitly;
//       bit for bit on glibc, and p_complement within 4 ulps elsewhere.
//   (e) a reversed (c-derived) tag is placed by TagRecon and counted by the
//       digest TerminusCounter with offset offC - offN, not with H2O.
//   (f) on a c/z-dot synthetic set, the digest, label and mass-gap
//       (placement delta) results equal those of the true termini, i.e. of
//       the same reads in the b/y convention.
//   plus the mode helpers (auto/cz/by), the TSV column rule and the INFO and
//   WARN lines.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Census.h"
#include "CliParam.h"
#include "ClusterAcc.h"
#include "Digest.h"
#include "FASTagger.h"
#include "IonSeries.h"
#include "PrecursorHypotheses.h"
#include "ProteomeIndex.h"
#include "TagRecon.h"
#include "complement_synth.h"
#include "cz_synth.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <algorithm>
#include <bit>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <regex>
#include <set>
#include <string>

using OpenMS::MSSpectrum;
using OpenMS::Precursor;
using AM = OpenMS::Precursor::ActivationMethod;
namespace IS = FASTag::IonSeries;

namespace
{
  int failures = 0;

  /// (d): ulps of p_complement allowed against the glibc-made 1.11 reference.
#if defined(__GLIBC__)
  constexpr std::int64_t kPcUlps = 0;
#else
  constexpr std::int64_t kPcUlps = 4;
#endif
  /// (d): ulps of the E-value allowed. Exact on glibc and Apple's libm; MSVC's
  /// C runtime puts one row 1 ulp away (windows.yml run 42455067821: case 1
  /// rank 2, LVE/1, dE/E 2.2e-16, tag, charge and p_complement equal).
#if defined(_MSC_VER)
  constexpr std::int64_t kEUlps = 4;
#else
  constexpr std::int64_t kEUlps = 0;
#endif
  /// Distance of two non-negative finite doubles in units in the last place.
  std::int64_t pcUlps(double a, double b)
  {
    if (!(a >= 0) || !(b >= 0) || !std::isfinite(a) || !std::isfinite(b)) return a == b ? 0 : INT64_MAX;
    const auto ia = std::bit_cast<std::int64_t>(a), ib = std::bit_cast<std::int64_t>(b);
    return ia > ib ? ia - ib : ib - ia;
  }
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  IS::Activation cls(std::set<AM> m) { return IS::activationClass(m); }

  /// An MS2 with one precursor carrying @p methods and, when not empty, the
  /// meta value "filter string" the mzML readers set.
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

  /// gate.sh digests the first line of the run log matching this pattern.
  const std::regex kGateSummary("^[0-9]+ MS2 spectra, [0-9]+ tags");

  // ---- phase B helpers ----
  struct RefRow
  {
    int ci, pi;
    size_t rank;
    const char* seq;
    int charge;
    double evalue, p_complement;
  };
  const RefRow kRef[] = {
#include "complement_ref_1_11.inc"
  };

  const double kWater = OpenMS::EmpiricalFormula("H2O").getMonoWeight();

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

  /// The flanks a read of residues [pos, pos+len) of @p pep carries in the
  /// tagger's convention under ion pair @p ip: forward (the low peak a
  /// C-terminal ion) or reversed (an N-terminal ion). Clamped at 0 as the
  /// tagger does.
  std::pair<double, double> flanksOf(const std::string& pep, size_t pos, size_t len, bool reversed,
                                     const IS::IonPair& ip)
  {
    const double nside = sumMass(pep.substr(0, pos)), cside = sumMass(pep.substr(pos + len));
    // The low peak's neutral mass minus offC is cterm; M - high neutral -
    // (H2O - offC) is nterm (src/FASTagger.cpp, the flank expression).
    double n, c;
    if (!reversed) { n = nside; c = cside; }
    else { n = cside + ip.reversedOffset(); c = nside - ip.reversedOffset(); }
    return {std::max(0.0, n), std::max(0.0, c)};
  }

  /// Every occurrence of @p tag in @p pep, forward (reversed = false) or of
  /// its reverse (reversed = true).
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

  /// The c/z test Params: the CLI's and the CLI's without deisotoping.
  std::vector<std::pair<const char*, FASTag::Param>> bothParams()
  {
    FASTag::Param cli = FASTag::cliDefaultParam();
    FASTag::Param off = cli;
    off.deisotope = false;
    return {{"cli", cli}, {"deisotope off", off}};
  }

  // Tryptic peptides without C (fixed CAM), I (read as L) or P.
  const char* const kPeptides[5] = {"VGAHAGEYGAEALER", "LLEQTHGGLNAWK", "DLVEGFNTWQR", "GDFQAMVYTNSAWR",
                                    "YLGYLEQLLR"};

  /// (f2) #3d's two-residue flank histogram (D3cg, TerminusCounter::
  /// enableFlank2), when the tree has it: a reversed c-derived tag whose
  /// nterm_mass is a residue pair sum + offC - offN lands in that pair's bin,
  /// as a reversed b tag at pair sum + H2O does. Returns false (skip) without
  /// #3d; the template only instantiates the calls when they exist.
  template <class TC>
  bool flank2CzCheck(TC tc_cz, TC tc_by, double rev_cz, int& bad)
  {
    if constexpr (requires { tc_cz.enableFlank2(); tc_cz.flank2Table()->find(0.0); tc_cz.dip; })
    {
      tc_cz.enableFlank2();
      tc_by.enableFlank2();
      const double er = resMass('E') + resMass('R');
      const int bin = tc_cz.flank2Table()->find(er);
      // cterm 1000 Da: no pair sum, so only the nterm end can count.
      tc_cz.add(er + rev_cz, 1000.0, "AAAA", rev_cz);
      tc_by.add(er + kWater, 1000.0, "AAAA");
      std::uint64_t n_cz = 0, n_by = 0;
      for (auto v : tc_cz.dip) n_cz += v;
      for (auto v : tc_by.dip) n_by += v;
      if (bin < 0 || n_cz != 1 || tc_cz.dip[static_cast<size_t>(bin)] != 1) ++bad;
      if (n_by != 1 || tc_by.dip[static_cast<size_t>(bin)] != 1) ++bad;
      return true;
    }
    else
    {
      (void)tc_cz; (void)tc_by; (void)rev_cz; (void)bad;
      return false;
    }
  }

  /// ion_series_test --write-mzml <fasta> <out.mzML> <cz|cz0|czt25|by> [n]: a synthetic
  /// run for the CLI tests (ion_series_cli_test, threads_test). n (40)
  /// tryptic peptides of @p fasta (up to one missed cleavage, length 8-18, no
  /// C/U/X/B/Z, unique, in protein order), at precursor charge 2 and 3 alternately: cz = c and z-dot ions
  /// (OpenMS TheoreticalSpectrumGenerator) at fragment charges 1 .. z-1 with
  /// the activation ETD (MS:1000598), the unreacted precursor and its
  /// charge-reduced species as ETD spectra carry them, and 15 noise peaks; by
  /// = b and y ions of the same peptides with CID (MS:1000133); cz0 = cz
  /// without a precursor charge; czt25 = cz plus, per spectrum, a 2+ isotope
  /// cluster whose 1+ equivalent lies 150 Da above the precursor cut
  /// (CzSynth::addReducedAboveCut, issue T25). Seeded,
  /// deterministic; written by OpenMS MzMLFile (indexed).
  int writeMzml(int argc, char** argv)
  {
    if (argc < 5)
    {
      std::cerr << "usage: ion_series_test --write-mzml <fasta> <out.mzML> <cz|cz0|czt25|by> [n]\n";
      return 2;
    }
    // cz0: cz without a precursor charge (for -unknown_charge infer).
    const bool t25 = std::string(argv[4]) == "czt25";
    const bool cz = std::string(argv[4]) == "cz" || std::string(argv[4]) == "cz0" || t25;
    const bool no_charge = std::string(argv[4]) == "cz0";
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
    const double P = OpenMS::Constants::PROTON_MASS_U;
    OpenMS::PeakMap exp;
    for (size_t i = 0; i < peps.size(); ++i)
    {
      const int z = i % 2 == 0 ? 2 : 3;
      CzSynth::Spec sp = CzSynth::make(peps[i], z, cz ? CzSynth::Ions::CZ : CzSynth::Ions::BY, std::max(1, z - 1), 15,
                                       1000u + static_cast<unsigned>(i));
      if (cz)
        for (int k = 0; k < z; ++k)  // the unreacted precursor (k = 0) and the charge-reduced species
          sp.spec.emplace_back((sp.M + z * P) / (z - k), 3.0 + k);
      if (t25) CzSynth::addReducedAboveCut(sp);
      sp.spec.sortByPosition();
      sp.spec.setMSLevel(2);
      sp.spec.setRT(10.0 + i);
      sp.spec.setNativeID("controllerType=0 controllerNumber=1 scan=" + std::to_string(i + 1));
      sp.spec.setType(OpenMS::SpectrumSettings::SpectrumType::CENTROID);
      OpenMS::Precursor pr;
      pr.setMZ(sp.prec_mz);
      if (!no_charge) pr.setCharge(z);
      pr.setActivationMethods({cz ? AM::ETD : AM::CID});
      sp.spec.setPrecursors({pr});
      exp.addSpectrum(sp.spec);
    }
    OpenMS::MzMLFile().store(argv[3], exp);
    std::cout << "wrote " << exp.size() << " " << (cz ? "c/z (ETD)" : "b/y (CID)") << " spectra to " << argv[3] << "\n";
    return peps.size() == n ? 0 : 1;
  }
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::string(argv[1]) == "--write-mzml") return writeMzml(argc, argv);
  using A = IS::Activation;

  // ---- classes of the PSI-MS dissociation methods the readers map ----
  check(cls({AM::CID}) == A::Collisional, "CID (MS:1000133) is collisional");
  check(cls({AM::HCD}) == A::Collisional, "HCD (MS:1000422) is collisional");
  check(cls({AM::TRAP}) == A::Collisional, "trap-type CID (MS:1002472) is collisional");
  check(cls({AM::PQD}) == A::Collisional, "PQD (MS:1000599) is collisional");
  check(cls({AM::LCID}) == A::Collisional && cls({AM::HCID}) == A::Collisional && cls({AM::SORI}) == A::Collisional,
        "low/high-energy CID and SORI are collisional");
  check(cls({AM::ETD}) == A::Electron, "ETD (MS:1000598) is electron");
  check(cls({AM::ECD}) == A::Electron, "ECD (MS:1000250) is electron");
  check(cls({AM::EThcD}) == A::Hybrid, "EThcD (MS:1002631) is hybrid");
  check(cls({AM::ETciD}) == A::Hybrid, "ETciD (MS:1003182) is hybrid");
  // ETD with a supplemental term: both readers give {ETD, EThcD} or {ETD, ETciD}.
  check(cls({AM::ETD, AM::EThcD}) == A::Hybrid, "ETD + supplemental beam-type CID is hybrid");
  check(cls({AM::ETD, AM::ETciD}) == A::Hybrid, "ETD + supplemental CID is hybrid");
  check(cls({AM::ETD, AM::HCD}) == A::Hybrid, "ETD and HCD listed together is hybrid");
  check(cls({AM::ECD, AM::CID}) == A::Hybrid, "ECD and CID listed together is hybrid");
  check(cls({}) == A::Unknown, "no method is unknown");
  check(cls({AM::PD}) == A::Unknown && cls({AM::BIRD}) == A::Unknown && cls({AM::IMD}) == A::Unknown
          && cls({AM::PSD}) == A::Unknown && cls({AM::SID}) == A::Unknown && cls({AM::LIFT}) == A::Unknown,
        "photo/IR/surface/post-source methods are unknown, not collisional");
  check(cls({AM::HCD, AM::PD}) == A::Collisional, "an unclassified method next to HCD does not hide it");

  // ---- the filter-string fallback (Thermo @<method><energy> tokens) ----
  using IS::activationClassFromFilter;
  check(activationClassFromFilter("FTMS + p NSI d Full ms2 652.83@hcd28.00 [110.00-1355.00]") == A::Collisional,
        "filter @hcd is collisional");
  check(activationClassFromFilter("ITMS + c NSI d w Full ms2 617.32@cid35.00 [155.00-1245.00]") == A::Collisional,
        "filter @cid is collisional");
  check(activationClassFromFilter("ITMS + c NSI d Full ms2 700.12@pqd27.00 [50.00-2000.00]") == A::Collisional,
        "filter @pqd is collisional");
  check(activationClassFromFilter("ITMS + c NSI d Full ms2 652.83@etd66.67 [50.00-1320.00]") == A::Electron,
        "filter @etd is electron");
  check(activationClassFromFilter("FTMS + p NSI d Full ms2 900.00@ecd [100.00-2000.00]") == A::Electron,
        "filter @ecd without an energy is electron");
  check(activationClassFromFilter("FTMS + p NSI d sa Full ms2 865.94@etd50.00@hcd25.00 [120.00-2000.00]")
          == A::Hybrid,
        "filter @etd..@hcd.. (EThcD) is hybrid");
  check(activationClassFromFilter("ITMS + c NSI d sa Full ms2 865.94@etd50.00@cid20.00 [120.00-2000.00]")
          == A::Hybrid,
        "filter @etd..@cid.. (ETciD) is hybrid");
  check(activationClassFromFilter("FTMS + p NSI d Full ms2 652.83@ETD66.67 [50.00-1320.00]") == A::Electron,
        "filter tokens are case-insensitive");
  check(activationClassFromFilter("FTMS + p NSI d Full ms2 652.83@uvpd25.00 [50.00-1320.00]") == A::Unknown,
        "filter @uvpd is unknown");
  check(activationClassFromFilter("FTMS + p NSI Full ms [350.00-2000.00]") == A::Unknown, "MS1 filter is unknown");
  check(activationClassFromFilter("") == A::Unknown, "empty filter is unknown");
  check(activationClassFromFilter("@") == A::Unknown && activationClassFromFilter("x@") == A::Unknown,
        "a bare @ is unknown");
  check(activationClassFromFilter("ms2 500.00@etd.5@hcd") == A::Hybrid, "tokens end at the first non-letter");
  check(activationClassFromFilter("ms2 500.00@etdx25") == A::Unknown, "a token is the whole letter run after @");
  check(activationClassFromFilter("ms2 500.00@etdhcd25") == A::Unknown, "an unlisted token is not split");

  // ---- one spectrum: the precursor's methods first, then the filter ----
  check(IS::activationClass(ms2({AM::CID})) == A::Collisional, "spectrum with CID");
  check(IS::activationClass(ms2({AM::ETD}, "ITMS + c NSI d Full ms2 617.32@cid35.00 [1-2]")) == A::Electron,
        "the precursor's methods win over the filter string");
  check(IS::activationClass(ms2({}, "ITMS + c NSI d Full ms2 617.32@etd35.00 [1-2]")) == A::Electron,
        "no methods: the filter string decides");
  check(IS::activationClass(ms2({AM::PD}, "ITMS + c NSI d Full ms2 617.32@etd35.00 [1-2]")) == A::Electron,
        "only unclassified methods: the filter string decides");
  check(IS::activationClass(ms2({})) == A::Unknown, "no methods and no filter string is unknown");
  {
    MSSpectrum s = ms2({AM::CID});
    Precursor second;
    second.setActivationMethods({AM::ETD});
    auto precs = s.getPrecursors();
    precs.push_back(second);
    s.setPrecursors(precs);
    check(IS::activationClass(s) == A::Collisional, "the first precursor, as tagging uses it");
  }
  {
    MSSpectrum s;
    s.setMSLevel(2);
    s.setMetaValue("filter string", "ITMS + c NSI d Full ms2 617.32@etd35.00 [1-2]");
    check(IS::activationClass(s) == A::Electron, "no precursor: the filter string decides");
  }

  // ---- names ----
  check(std::string(IS::activationName(A::Collisional)) == "collisional" &&
          std::string(IS::activationName(A::Electron)) == "electron" &&
          std::string(IS::activationName(A::Hybrid)) == "hybrid" &&
          std::string(IS::activationName(A::Unknown)) == "unknown",
        "class names");

  // ---- counts and the threshold: more than 1% electron or hybrid ----
  {
    IS::ActivationCounts c;
    check(c.total() == 0 && !c.warnUnderBy(), "no MS2, no warning");
    for (int i = 0; i < 99; ++i) c.add(A::Collisional);
    c.add(A::Electron);
    check(c.total() == 100 && c.of(A::Electron) == 1 && c.of(A::Collisional) == 99, "counts per class");
    check(!c.warnUnderBy(), "exactly 1% electron does not warn");
    c.add(A::Collisional);
    check(!c.warnUnderBy(), "1 of 101 does not warn");
    c.add(A::Hybrid);
    check(c.warnUnderBy(), "2 of 102 (electron + hybrid) warns");

    IS::ActivationCounts u;
    for (int i = 0; i < 1000; ++i) u.add(A::Unknown);
    check(!u.warnUnderBy(), "an all-unknown run (MGF, mzPeak) does not warn");

    IS::ActivationCounts h;
    h.add(A::Hybrid);
    check(h.warnUnderBy(), "a single hybrid MS2 of 1 warns");

    // Merging is a plain sum, so thread order cannot change it.
    IS::ActivationCounts a, b;
    a.add(A::Electron);
    a.add(A::Collisional);
    b.add(A::Unknown);
    b.add(A::Hybrid);
    b.add(A::Electron);
    IS::ActivationCounts ab = a, ba = b;
    ab.merge(b);
    ba.merge(a);
    check(ab.n == ba.n && ab.total() == 5 && ab.of(A::Electron) == 2, "merge is a commutative sum");
  }

  // ---- the warning line ----
  {
    IS::ActivationCounts c;
    for (int i = 0; i < 3491; ++i) c.add(A::Collisional);
    for (int i = 0; i < 3492; ++i) c.add(A::Electron);
    const std::string w = IS::byModeWarning(c);
    check(w.find("ETD") != std::string::npos, "the warning names ETD");
    check(w.find("3492 of 6983 MS2 spectra") != std::string::npos, "the warning gives electron of total");
    check(w.find("3491 collisional, 3492 electron, 0 hybrid, 0 unknown") != std::string::npos,
          "the warning gives the per-class counts");
    check(w.find('\n') == std::string::npos, "the warning is one line");
    check(!std::regex_search(w, kGateSummary), "the warning cannot match the gate's summary-line pattern");
    IS::ActivationCounts h;
    h.add(A::Hybrid);
    const std::string wh = IS::byModeWarning(h);
    check(wh.find("EThcD") != std::string::npos, "the warning names EThcD for hybrid spectra");
    check(!std::regex_search(wh, kGateSummary), "the hybrid warning cannot match the gate pattern");
  }

  // ---- the E accumulator of the tagging loop (src/ClusterAcc.h) ----
  {
    FASTag::ClusterAcc::ClusterThread t1, t2, run;
    t1.e.activation.add(A::Electron);
    t2.e.activation.add(A::Collisional);
    t2.e.activation.add(A::Electron);
    run.merge(t1);
    run.merge(t2);
    check(run.e.activation.total() == 3 && run.e.activation.of(A::Electron) == 2,
          "ClusterThread::merge sums the activation counts");
  }

  // ================================================================ phase B
  const double kOffN = 17.026549, kOffC = 1.991841;  // NH3; O - N (OpenMS Zp1)

  // ---- (a) ion pairs ----
  {
    const IS::IonPair by = IS::ionPair(IS::Series::BY), cz = IS::ionPair(IS::Series::CZ);
    check(by.kind == IS::Series::BY && cz.kind == IS::Series::CZ, "ionPair kinds");
    check(std::fabs(by.offN - OpenMS::Residue::getInternalToBIon().getMonoWeight()) < 1e-12 &&
            std::fabs(by.offC - OpenMS::Residue::getInternalToYIon().getMonoWeight()) < 1e-12,
          "b/y offsets are OpenMS's internal-to-B/Y");
    check(std::fabs(cz.offN - OpenMS::Residue::getInternalToCIon().getMonoWeight()) < 1e-12 &&
            std::fabs(cz.offC - OpenMS::Residue::getInternalToZp1Ion().getMonoWeight()) < 1e-12,
          "c/z-dot offsets are OpenMS's internal-to-C/Zp1");
    check(std::fabs(cz.offN - kOffN) < 1e-5 && std::fabs(cz.offC - kOffC) < 1e-5, "c = residues + NH3, z-dot = residues + O - N");
    check(std::fabs(by.offN) < 1e-12 && std::fabs(by.offC - kWater) < 1e-12, "b = residues, y = residues + H2O");
    check(std::fabs(cz.compl_delta - 1.007825) <= 1e-6, "compl_delta(c/z-dot) = +H = 1.007825");
    check(by.compl_delta == 0.0, "compl_delta(b/y) = 0 exactly");
    check(std::fabs(by.reversedOffset() - kWater) < 1e-12, "b/y reversed offset is one water");
    check(std::fabs(cz.reversedOffset() - (kOffC - kOffN)) < 1e-5 && std::fabs(cz.reversedOffset() + 15.034708) < 1e-5,
          "c/z-dot reversed offset offC - offN = -15.0347");
    // The default Param and Tag are b/y, the 1.11 reading.
    check(FASTag::Param().ion_pair.kind == IS::Series::BY && FASTag::cliDefaultParam().ion_pair.kind == IS::Series::BY,
          "Param defaults to b/y");
    check(FASTag::Tag().ion_series == IS::Series::BY, "Tag defaults to b/y");
    // The complement deltas through ComplementSpec.
    const auto cs_by = FASTag::ComplementSpec::fromParam(FASTag::cliDefaultParam());
    const auto cs_cz = FASTag::ComplementSpec::fromParam(withPair(FASTag::cliDefaultParam(), IS::Series::CZ));
    check(cs_by.pair_deltas == std::vector<double>{0.0}, "b/y complement keeps the single delta 0");
    check(cs_cz.pair_deltas.size() == 1 && std::fabs(cs_cz.pair_deltas[0] - 1.007825) < 1e-6,
          "c/z complement pairs sum to M + H");
  }

  // ---- the census header is run-level (PLAN-INTEGRATION 2.3/2) ----
  {
    namespace C = FASTag::Census;
    check(C::header() == C::header(false), "the census header defaults to the 1.11 layout");
    C::runColumns().ion_series = true;
    const std::string h = C::header();
    check(h == C::header(true) && h.size() > 17 && h.compare(h.size() - 17, 17, "\tbest_ion_series\n") == 0,
          "a run with the ion_series column: header() ends with best_ion_series");
    C::runColumns().ion_series = false;
    check(C::header() == C::header(false), "the run-level census columns reset");
  }

  // ---- modes ----
  {
    check(IS::modeFromString("by") == IS::Mode::By && IS::modeFromString("cz") == IS::Mode::Cz &&
            IS::modeFromString("auto") == IS::Mode::Auto,
          "mode names");
    check(std::string(IS::kModeDefault) == "by", "the default mode is by");
    check(std::string(IS::modeName(IS::Mode::Auto)) == "auto" && std::string(IS::seriesName(IS::Series::CZ)) == "cz" &&
            std::string(IS::seriesName(IS::Series::BY)) == "by",
          "names round-trip");
    for (A a : {A::Collisional, A::Electron, A::Hybrid, A::Unknown})
    {
      check(IS::seriesFor(IS::Mode::By, a) == IS::Series::BY, "by reads every class as b/y");
      check(IS::seriesFor(IS::Mode::Cz, a) == IS::Series::CZ, "cz reads every class as c/z");
    }
    check(IS::seriesFor(IS::Mode::Auto, A::Electron) == IS::Series::CZ, "auto reads electron as c/z");
    check(IS::seriesFor(IS::Mode::Auto, A::Hybrid) == IS::Series::BY, "auto reads hybrid as b/y (deferred)");
    check(IS::seriesFor(IS::Mode::Auto, A::Collisional) == IS::Series::BY &&
            IS::seriesFor(IS::Mode::Auto, A::Unknown) == IS::Series::BY,
          "auto reads collisional and unknown as b/y");
    IS::ActivationCounts col, el;
    col.add(A::Collisional);
    col.add(A::Hybrid);
    el.add(A::Electron);
    check(!IS::seriesColumn(IS::Mode::By, el), "by never writes the ion_series column");
    check(IS::seriesColumn(IS::Mode::Cz, col), "cz always writes it");
    check(!IS::seriesColumn(IS::Mode::Auto, col), "auto on a run without electron activation writes what by writes");
    check(IS::seriesColumn(IS::Mode::Auto, el), "auto with electron activation writes the column");
    // One rule for the column and the per-spectrum series: auto reads the
    // activation of mzML only, and a c/z row exists only with the column.
    check(IS::autoReadsActivation(false, false) && !IS::autoReadsActivation(true, false) &&
            !IS::autoReadsActivation(false, true),
          "auto reads activation from mzML, not from mzPeak or MGF");
    for (A a : {A::Collisional, A::Electron, A::Hybrid, A::Unknown})
      for (IS::Mode m : {IS::Mode::By, IS::Mode::Cz, IS::Mode::Auto})
      {
        check(IS::seriesInRun(m, a, true) == IS::seriesFor(m, a), "with the column the run reads seriesFor()");
        check(IS::seriesInRun(m, a, false) == IS::Series::BY, "without the column every spectrum is read as b/y");
      }
    // Per input type under auto: the column needs a pre-scan, which only
    // inputs whose activation auto reads get; an ETD spectrum that an mzPeak
    // reader delivers is then read as b/y, never as an unlabelled c/z row.
    for (int in = 0; in < 3; ++in)
    {
      const bool mzpeak = in == 1, mgf = in == 2;
      const bool column = IS::autoReadsActivation(mzpeak, mgf) && IS::seriesColumn(IS::Mode::Auto, el);
      const bool cz_row = IS::seriesInRun(IS::Mode::Auto, A::Electron, column) == IS::Series::CZ;
      check(cz_row == column, "auto: a c/z row only with the ion_series column");
      check(cz_row == (in == 0), "auto: ETD is read as c/z from mzML only");
    }
    const std::string nw = IS::autoNoColumnWarning(7);
    check(nw.find("7 electron-activated") != std::string::npos && nw.find('\n') == std::string::npos &&
            !std::regex_search(nw, kGateSummary),
          "the auto no-column warning");
    // Warnings and the INFO line: one line each, never the gate pattern.
    IS::ActivationCounts h;
    for (int i = 0; i < 99; ++i) h.add(A::Electron);
    h.add(A::Hybrid);
    check(!IS::warnHybridUnderAuto(h), "1 hybrid of 100 (exactly 1%) does not warn under auto");
    h.add(A::Hybrid);
    check(IS::warnHybridUnderAuto(h), "2 hybrid of 101 warns under auto");
    const std::string hw = IS::hybridAutoWarning(h);
    check(hw.find("EThcD") != std::string::npos && hw.find("2 of 101") != std::string::npos &&
            hw.find('\n') == std::string::npos && !std::regex_search(hw, kGateSummary),
          "the hybrid warning names EThcD and the counts on one line");
    IS::ActivationCounts k;
    k.add(A::Collisional);
    k.add(A::Electron);
    check(IS::warnCollisionalUnderCz(k) && !IS::warnCollisionalUnderCz(el), "cz warns on collisional spectra only");
    IS::SeriesCounts sc;
    sc.ms2_cz = 3;
    sc.ms2_by = 4;
    const std::string info = IS::seriesInfo(IS::Mode::Auto, sc, h);
    check(info.rfind("Ion series (-ion_series auto): 3 MS2 spectra tagged as c/z-dot ions, 4 as b/y ions", 0) == 0 &&
            !std::regex_search(info, kGateSummary) && info.find('\n') == std::string::npos,
          "the INFO line");
    IS::SeriesCounts a2 = sc, b2;
    b2.ms2_cz = 1;
    b2.species_excluded = 2;
    a2.merge(b2);
    check(a2.ms2_cz == 4 && a2.ms2_by == 4 && a2.species_excluded == 2, "SeriesCounts merge sums");
    FASTag::ClusterAcc::ClusterThread t1, t2;
    t1.e.series.ms2_cz = 2;
    t2.e.series.ms2_by = 5;
    t1.merge(t2);
    check(t1.e.series.ms2_cz == 2 && t1.e.series.ms2_by == 5, "ThreadE::merge sums the series counts");
  }

  // ---- (b) c/z-dot ladders read as c/z and as b/y ----
  {
    const IS::IonPair czp = IS::ionPair(IS::Series::CZ), byp = IS::ionPair(IS::Series::BY);
    // What a b/y reading of a c/z read gives (the documented offset): the
    // low peak is taken for y (residues + H2O) while it is z-dot (residues +
    // offC) or c (residues + offN).
    const auto byFlanks = [&](const std::string& pep, size_t pos, size_t len, bool rev) {
      const double nside = sumMass(pep.substr(0, pos)), cside = sumMass(pep.substr(pos + len));
      const double low = rev ? nside + czp.offN : cside + czp.offC;
      const double M = sumMass(pep) + kWater;
      const double high = low + sumMass(pep.substr(pos, len));
      return std::pair<double, double>{std::max(0.0, M - high), std::max(0.0, low - kWater)};
    };
    for (const auto& [pname, base] : bothParams())
    {
      const FASTag::Param pcz = withPair(base, IS::Series::CZ), pby = withPair(base, IS::Series::BY);
      const FASTag::Tables tcz(pcz), tby(pby);
      int spectra_with_true = 0, true_tags = 0, compl_ok = 0, by_true = 0, coincidental_spectra = 0;
      for (const char* pep : kPeptides)
        for (int z : {2, 3})
        {
          // 20 noise peaks: with every peak complemented the hypergeometric
          // test is uninformative (p = 1 whatever the rule).
          const CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::CZ, z - 1, 20, 100u + static_cast<unsigned>(z));
          const std::string what = std::string(pname) + " " + pep + " " + std::to_string(z) + "+";
          const auto tags = FASTag::tagSpectrum(s.spec, s.prec_mz, z, pcz, tcz);
          int here = 0;
          for (const FASTag::Tag& t : tags)
          {
            if (t.gapped) continue;
            const std::string seq = FASTag::baseSequence(t.seq);
            const auto occ = occurrences(pep, seq);
            if (occ.empty()) continue;
            check(t.ion_series == IS::Series::CZ, what + ": tags carry ion_series cz");
            double best = 1e9;
            for (const auto& [pos, rev] : occ)
            {
              const auto [n, c] = flanksOf(pep, pos, seq.size(), rev, czp);
              best = std::min(best, std::max(std::fabs(t.nterm_mass - n), std::fabs(t.cterm_mass - c)));
            }
            check(best <= 0.01, what + ": tag " + seq + " flanks within 0.01 Da of the truth (off " + std::to_string(best) + ")");
            ++here;
            ++true_tags;
            if (t.p_complement < 1.0) ++compl_ok;
            else check(false, what + ": true tag " + seq + " has p_complement 1 under cz");
          }
          if (here > 0) ++spectra_with_true;
          // b/y: the same ladder, without the noise (a noise peak may
          // complement by chance), read as b/y.
          const CzSynth::Spec s0 = CzSynth::make(pep, z, CzSynth::Ions::CZ, z - 1, 0, 100u + static_cast<unsigned>(z));
          const auto btags = FASTag::tagSpectrum(s0.spec, s0.prec_mz, z, pby, tby);
          // A c/z ladder can hold a pair whose m/z happen to sum to a b/y
          // complement (DLVEGFNTWQR: c4 + z7 = M + 2p - 0.0099): then b/y
          // finds that complement by coincidence, and p_complement < 1 is
          // right. Such spectra are left out of the p_complement = 1 check.
          bool coincidental = false;
          for (size_t a = 0; a < s0.spec.size() && !coincidental; ++a)
            for (size_t b = a + 1; b < s0.spec.size() && !coincidental; ++b)
              for (int fz = 1; fz <= std::max(1, z - 1) && !coincidental; ++fz)
                coincidental = std::fabs(s0.spec[a].getMZ() + s0.spec[b].getMZ() - (s0.M / fz + 2 * OpenMS::Constants::PROTON_MASS_U)) < 0.03;
          if (coincidental) ++coincidental_spectra;
          for (const FASTag::Tag& t : btags)
          {
            check(t.ion_series == IS::Series::BY, what + ": tags carry ion_series by");
            if (t.gapped) continue;
            const std::string seq = FASTag::baseSequence(t.seq);
            const auto occ = occurrences(pep, seq);
            if (occ.empty()) continue;
            if (!coincidental) check(t.p_complement == 1.0, what + ": under by a c/z read has no complements");
            double best = 1e9, best_cz = 1e9;
            for (const auto& [pos, rev] : occ)
            {
              const auto [n, c] = byFlanks(pep, pos, seq.size(), rev);
              best = std::min(best, std::max(std::fabs(t.nterm_mass - n), std::fabs(t.cterm_mass - c)));
              const auto [n2, c2] = flanksOf(pep, pos, seq.size(), rev, czp);
              best_cz = std::min(best_cz, std::max(std::fabs(t.nterm_mass - n2), std::fabs(t.cterm_mass - c2)));
            }
            check(best <= 0.01, what + ": by read of " + seq + " carries the documented offset");
            check(best_cz > 0.9, what + ": by read of " + seq + " is not at the c/z truth");
            ++by_true;
          }
          (void)byp;
        }
      std::cout << "b. " << pname << ": " << true_tags << " true c/z tags in " << spectra_with_true
                << " of 10 spectra, " << compl_ok << " with p_complement < 1; " << by_true << " b/y reads ("
                << coincidental_spectra << " spectra with a coincidental b/y pair)\n";
      check(spectra_with_true == 10, std::string(pname) + ": every spectrum yields a true tag under cz");
      check(coincidental_spectra <= 5, std::string(pname) + ": at most 5 of 10 spectra hold a coincidental b/y pair (" +
                                           std::to_string(coincidental_spectra) + ")");
      check(true_tags >= 50 && by_true >= 20, std::string(pname) + ": enough true tags for a meaningful check");
    }
    // b/y ladders under b/y still read with 1.11's water convention.
    const CzSynth::Spec s = CzSynth::make("VGAHAGEYGAEALER", 2, CzSynth::Ions::BY, 1);
    const FASTag::Param pby = FASTag::cliDefaultParam();
    const FASTag::Tables tby(pby);
    int ok = 0;
    for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, pby, tby))
    {
      if (t.gapped) continue;
      const std::string seq = FASTag::baseSequence(t.seq);
      for (const auto& [pos, rev] : occurrences("VGAHAGEYGAEALER", seq))
      {
        const auto [n, c] = flanksOf("VGAHAGEYGAEALER", pos, seq.size(), rev, byp);
        if (std::fabs(t.nterm_mass - n) <= 0.01 && std::fabs(t.cterm_mass - c) <= 0.01) { ++ok; break; }
      }
    }
    check(ok >= 5, "b/y ladder under b/y: flanks in the water convention (" + std::to_string(ok) + " tags)");
  }

  // ---- (b2) the precursor complement rule on c/z-dot ladders ----
  // ETD/ECD: [M+cH]^c+ takes up one electron, so a c and a z-dot fragment
  // share c - 1 charges. With 1+ fragments only, the partner of a 1+ ion of
  // a 3+ precursor is a 1+ ion; a 2+ precursor's fragment pairs cannot both
  // be charged. The b/y reading (charge loss 0) is the 1.11 expression.
  {
    const auto cs_by = FASTag::ComplementSpec::fromParam(FASTag::cliDefaultParam());
    const auto cs_cz = FASTag::ComplementSpec::fromParam(withPair(FASTag::cliDefaultParam(), IS::Series::CZ));
    check(cs_by.charge_loss == 0 && cs_cz.charge_loss == 1 && IS::ionPair(IS::Series::BY).charge_loss == 0 &&
            IS::ionPair(IS::Series::CZ).charge_loss == 1,
          "charge loss: b/y 0, c/z-dot 1");
    for (const auto& [pname, base0] : bothParams())
    {
      FASTag::Param base = base0;
      base.complement_rule = FASTag::ComplementRule::Precursor;
      const FASTag::Param pcz = withPair(base, IS::Series::CZ);
      const FASTag::Tables tcz(pcz);
      size_t peaks3 = 0, compl3 = 0, compl2 = 0, compl3_both = 0;
      for (const char* pep : kPeptides)
        for (int z : {2, 3})
        {
          const CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::CZ, 1, 0, 300u + static_cast<unsigned>(z));
          FASTag::SpectrumDiag d;
          FASTag::tagSpectrum(s.spec, s.prec_mz, z, pcz, tcz, &d);
          check(d.prepared, std::string(pname) + " " + pep + ": prepared");
          if (z == 3) { peaks3 += d.n_kept; compl3 += d.n_compl; }
          else compl2 += d.n_compl;
          if (z == 3)
          {
            FASTag::Param pb = pcz;
            pb.complement_rule = FASTag::ComplementRule::Both;
            const FASTag::Tables tb(pb);
            FASTag::SpectrumDiag db;
            FASTag::tagSpectrum(s.spec, s.prec_mz, z, pb, tb, &db);
            compl3_both += db.n_compl;
          }
        }
      std::cout << "b2. " << pname << ": precursor rule on c/z, 3+: " << compl3 << " of " << peaks3
                << " kept peaks complemented at 1+; 2+: " << compl2 << "\n";
      // The c ion's partner is the z-dot ion at the same 1+: nearly every
      // ladder peak has it (the first and last rungs may not).
      check(peaks3 > 0 && 10 * compl3 >= 8 * peaks3,
            std::string(pname) + ": 3+ c/z under the precursor rule finds the 1+ partners (c - 1 charges)");
      check(compl2 == 0, std::string(pname) + ": 2+ c/z under the precursor rule has no partner (z >= c - 1)");
      check(compl3_both >= compl3, std::string(pname) + ": both is at least the precursor rule");
    }
  }
  // ---- (b3) #6's charge evidence counts c/z-dot pairs for c/z spectra ----
  // The infer and isotope calls count 1+ pairs at M + 2p; a spectrum read as
  // c/z-dot counts them at M + H + 2p (the tool passes the c/z
  // ComplementSpec), so a c/z ladder supports its true mass.
  {
    const auto cs_by = FASTag::ComplementSpec::fromParam(FASTag::cliDefaultParam());
    const auto cs_cz = FASTag::ComplementSpec::fromParam(withPair(FASTag::cliDefaultParam(), IS::Series::CZ));
    double e_cz = 0, e_by = 0;
    for (const char* pep : kPeptides)
    {
      const CzSynth::Spec s = CzSynth::make(pep, 2, CzSynth::Ions::CZ, 1, 0, 400u);
      e_cz += FASTag::Hyp::complementExcess(s.spec, s.M, cs_cz);
      e_by += FASTag::Hyp::complementExcess(s.spec, s.M, cs_by);
      const CzSynth::Spec b = CzSynth::make(pep, 2, CzSynth::Ions::BY, 1, 0, 400u);
      check(FASTag::Hyp::complementExcess(b.spec, b.M, cs_by) > 3.0, std::string(pep) + ": b/y pairs at M + 2p (1.11 sum)");
    }
    std::cout << "b3. complement excess of 5 c/z ladders: c/z pairs " << e_cz << ", b/y pairs " << e_by << "\n";
    check(e_cz > 20.0 && e_cz > e_by + 15.0, "b3: c/z-dot pairs carry the charge evidence of a c/z ladder");
    // The infer call on ETD spectra as the instrument writes them: c/z-dot
    // ladders plus the unreacted precursor and its charge-reduced species
    // (the 1+ one at M + c*p lies above every fragment, so the b/y range
    // evidence would rule the true charge out).
    FASTag::Hyp::HypParam hp;
    hp.mode = FASTag::Hyp::ChargeMode::Infer;
    int right = 0, total = 0;
    const double P = OpenMS::Constants::PROTON_MASS_U;
    for (const char* pep : kPeptides)
      for (int z : {2, 3})
      {
        CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::CZ, z - 1, 0, 500u + static_cast<unsigned>(z));
        for (int k = 0; k < z; ++k) s.spec.emplace_back((s.M + z * P) / (z - k), 3.0 + k);
        s.spec.sortByPosition();
        const auto call = FASTag::Hyp::inferCharge(s.spec, s.prec_mz, {2, 3, 4}, hp, cs_cz);
        ++total;
        if (call.charge == z && call.src != FASTag::Hyp::ChargeSource::Assumed) ++right;
      }
    std::cout << "b3. infer on 10 ETD spectra with charge-reduced species: " << right << " at the true charge\n";
    check(right >= 8, "b3: infer calls the true charge of c/z spectra with charge-reduced species");
  }

  // ---- (c) the ETD precursor filter ----
  {
    const double P = OpenMS::Constants::PROTON_MASS_U, H = 1.00782503, C13 = 1.0033548378;
    for (const auto& [pname, base] : bothParams())
      for (int z : {2, 3})
      {
        // The first test peptide whose fragments all lie more than 5 Da from
        // every precursor species below the cut, so "no fragment dropped" is
        // a property of the filter, not of luck.
        std::string pick;
        for (const char* cand : kPeptides)
        {
          const CzSynth::Spec t = CzSynth::make(cand, z, CzSynth::Ions::CZ, 1);
          double nf = 1e9;
          for (int k = 0; k < z; ++k)
          {
            const double cr = (t.M + z * P) / (z - k);
            if (cr > t.M + P + 1.5) continue;
            for (const auto& pk : t.spec) nf = std::min(nf, std::fabs(pk.getMZ() - cr));
          }
          if (nf > 6.0) { pick = cand; break; }
        }
        check(!pick.empty(), "(c) a test peptide clear of its precursor species at " + std::to_string(z) + "+");
        if (pick.empty()) continue;
        const std::string what = std::string(pname) + " " + std::to_string(z) + "+ " + pick;
        const CzSynth::Spec lad = CzSynth::make(pick, z, CzSynth::Ions::CZ, 1);
        const double max_mz = lad.M + P + 1.5;  // the tagger's precursor cut
        OpenMS::MSSpectrum withred = lad.spec, withprobe = lad.spec;
        int probes = 0, reduced_below_cut = 0;
        double nearest_fragment = 1e9;
        for (int k = 0; k < z; ++k)
        {
          const int zr = z - k;
          const double cr = (lad.M + z * P) / zr;
          // unreacted (k = 0) or charge-reduced species, its 13C isotopes and
          // its hydrogen-transfer forms (-H, +H, +2H).
          for (double d : {0.0, C13 / zr, 2 * C13 / zr, -H / zr, H / zr, 2 * H / zr})
          {
            withred.emplace_back(cr + d, 5.0);
            if (cr + d <= max_mz) ++reduced_below_cut;
          }
          for (double d : {-5.0, 5.0})
            if (cr + d <= max_mz) { withprobe.emplace_back(cr + d, 0.7); ++probes; }
          if (cr <= max_mz)
            for (const auto& pk : lad.spec) nearest_fragment = std::min(nearest_fragment, std::fabs(pk.getMZ() - cr));
        }
        withred.sortByPosition();
        withprobe.sortByPosition();
        check(nearest_fragment > 5.0, what + ": the fixture keeps fragments away from the precursor species");
        check(reduced_below_cut > 0, what + ": some charge-reduced peaks pass the precursor cut");
        const FASTag::Param pcz = withPair(base, IS::Series::CZ), pby = withPair(base, IS::Series::BY);
        const int kept_lad = FASTag::complementPopulation(lad.spec, lad.prec_mz, z, pcz)[0];
        const int kept_red = FASTag::complementPopulation(withred, lad.prec_mz, z, pcz)[0];
        const int kept_probe = FASTag::complementPopulation(withprobe, lad.prec_mz, z, pcz)[0];
        const int kept_red_by = FASTag::complementPopulation(withred, lad.prec_mz, z, pby)[0];
        const int kept_lad_by = FASTag::complementPopulation(lad.spec, lad.prec_mz, z, pby)[0];
        check(kept_lad > 20 && kept_lad == kept_lad_by, what + ": the ladder alone is not filtered (" +
                                                           std::to_string(kept_lad) + " vs " + std::to_string(kept_lad_by) + ")");
        check(kept_red == kept_lad, what + ": cz drops every precursor species and no fragment (" +
                                        std::to_string(kept_red) + " vs " + std::to_string(kept_lad) + ")");
        check(kept_red_by > kept_lad_by, what + ": by keeps the precursor species (no ETD filter)");
        check(kept_probe == kept_lad + probes, what + ": peaks 5 Da from a precursor species are kept (" +
                                                   std::to_string(kept_probe) + " vs " + std::to_string(kept_lad + probes) + ")");
      }
  }

  // ---- (c2) issue T25: charge-reduced peaks re-filtered against the cut ----
  // A 2+ isotope cluster below the precursor cut whose 1+ equivalent lies
  // above it: under cz the deisotoped (moved) peak is cut again, under by it
  // stays (the b/y output is the 1.12 reference), and without deisotoping
  // nothing moves, so cz and by keep the same peaks.
  {
    const double P = OpenMS::Constants::PROTON_MASS_U;
    int cases = 0;
    for (const auto& [pname, base] : bothParams())
      for (int z : {2, 3})
        for (const char* pep : kPeptides)
        {
          CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::CZ, 1);
          const double max_mz = s.M + P + 1.5;  // the tagger's precursor cut
          const double mz1 = CzSynth::addReducedAboveCut(s);
          const std::string what = std::string("(c2) ") + pname + " " + std::to_string(z) + "+ " + pep;
          bool measured_below = true;
          for (const auto& pk : s.spec) measured_below = measured_below && pk.getMZ() <= max_mz;
          check(measured_below, what + ": every measured peak lies below the precursor cut");
          const FASTag::Param pcz = withPair(base, IS::Series::CZ), pby = withPair(base, IS::Series::BY);
          const OpenMS::MSSpectrum kcz = FASTag::preparedPeaks(s.spec, s.prec_mz, z, pcz);
          const OpenMS::MSSpectrum kby = FASTag::preparedPeaks(s.spec, s.prec_mz, z, pby);
          const auto has = [](const OpenMS::MSSpectrum& k, double mz) {
            for (const auto& pk : k) if (std::fabs(pk.getMZ() - mz) < 0.01) return true;
            return false;
          };
          double top_cz = 0;
          for (const auto& pk : kcz) top_cz = std::max(top_cz, pk.getMZ());
          check(top_cz <= max_mz, what + ": cz keeps no peak above the precursor cut (top " + std::to_string(top_cz) +
                                      ", cut " + std::to_string(max_mz) + ")");
          if (base.deisotope)
          {
            check(has(kby, mz1), what + ": by keeps the moved peak above the cut (fixture triggers T25)");
            check(!has(kcz, mz1), what + ": cz drops the moved peak");
            check(kcz.size() + 1 == kby.size(), what + ": cz drops exactly the moved peak (" +
                                                    std::to_string(kcz.size()) + " vs " + std::to_string(kby.size()) + ")");
          }
          else
            check(kcz.size() == kby.size(), what + ": without deisotoping nothing moves, cz keeps what by keeps");
          ++cases;
        }
    std::cout << "c2. T25 re-filter of charge-reduced peaks: " << cases << " cases\n";
  }

  // ---- (d) the b/y branch reproduces FASTag 1.11.0 ----
  {
    int rows = 0, pc_off = 0;
    for (int pi = 0; pi < 2; ++pi)
    {
      FASTag::Param p = FASTag::cliDefaultParam();
      if (pi == 1) p.deisotope = false;
      p = withPair(p, IS::Series::BY);  // explicitly, as -ion_series by sets it
      const FASTag::Tables tab(p);
      for (int ci = 0; ci < 5; ++ci)
      {
        const ComplementSynth::Case& c = ComplementSynth::kRefCases[ci];
        const ComplementSynth::Spec s = ComplementSynth::make(c.pep, c.charge, c.y2, c.iso, 0.0, c.noise, c.seed);
        const auto tags = FASTag::tagSpectrum(s.spec, s.prec_mz, c.charge, p, tab);
        for (const RefRow& r : kRef)
        {
          if (r.ci != ci || r.pi != pi) continue;
          if (r.rank == 999) { check(tags.size() == static_cast<size_t>(r.evalue), "(d) tag count as 1.11"); continue; }
          ++rows;
          if (r.rank >= tags.size()) { check(false, "(d) rank missing"); continue; }
          const FASTag::Tag& t = tags[r.rank];
          char got[256];
          std::snprintf(got, sizeof got, ": %s/%d E %.17g p_c %.17g, 1.11 %s/%d E %.17g p_c %.17g (dE/E %.3g, dp_c %.3g)",
                        t.seq.c_str(), t.charge, t.evalue, t.p_complement, r.seq, r.charge, r.evalue, r.p_complement,
                        std::fabs(t.evalue - r.evalue) / std::max(1e-300, std::fabs(r.evalue)),
                        std::fabs(t.p_complement - r.p_complement));
          // The tag and its charge equal 1.11 bit for bit everywhere, the E-value
          // too except under MSVC (kEUlps).
          // p_complement is Boost's hypergeometric tail, whose result follows the
          // C library's math functions: glibc (where the .inc was made, x86-64 and
          // aarch64 alike) gives it bit for bit, Apple's libm 1-2 ulps away (CI
          // run 42427807615: 51 of 100 rows, E-value difference 0 in every row).
          // Off glibc p_complement is therefore held to kPcUlps ulps.
          check(t.seq == r.seq && t.charge == r.charge && pcUlps(t.evalue, r.evalue) <= kEUlps && pcUlps(t.p_complement, r.p_complement) <= kPcUlps,
                "(d) case " + std::to_string(ci) + " rank " + std::to_string(r.rank) + " equals 1.11 bit for bit" +
                    (kPcUlps ? " (p_complement within " + std::to_string(kPcUlps) + " ulps)" : std::string()) +
                    (kEUlps ? " (E-value within " + std::to_string(kEUlps) + " ulps, MSVC)" : std::string()) + got);
          if (t.p_complement != r.p_complement) ++pc_off;
          check(t.ion_series == IS::Series::BY, "(d) b/y tags");
        }
      }
    }
    check(rows >= 40, "(d) enough 1.11 reference rows");
    std::cout << "d. " << rows << " rows equal FASTag 1.11.0 under an explicit b/y pair (" << pc_off
              << " with p_complement off by at most " << kPcUlps << " ulps)\n";
  }

  // ---- (e) a reversed c-derived tag: TagRecon and Digest ----
  {
    const IS::IonPair czp = IS::ionPair(IS::Series::CZ);
    const std::string pep = "SAMGLEVGATSDGK";
    std::vector<OpenMS::FASTAFile::FASTAEntry> entries;
    entries.emplace_back("PROT1", "test protein", "MSTVWYAAR" + pep + "GTANLEFDSK");
    FASTag::ProteomeIndex idx;
    idx.build(entries, {}, 0);
    FASTag::TagReconciler r(0.02, false, true);
    r.attach(&idx, 0, 4);
    // From the formula: tag LEVG (pep[4..8)) read off the c ladder, reversed.
    const size_t pos = 4;
    const std::string tag = pep.substr(pos, 4), rev(tag.rbegin(), tag.rend());
    const auto [n, c] = flanksOf(pep, pos, 4, true, czp);
    const auto exact_rev = [&](const std::vector<FASTag::Reconciliation>& v) {
      for (const auto& x : v)
        if (x.peptide == pep && x.pos == pos && x.reversed && x.nterm_match && x.cterm_match &&
            std::fabs(x.delta_mass) < 1e-6)
          return true;
      return false;
    };
    check(exact_rev(r.reconcile(rev, n, c, nullptr, 2, nullptr, &czp)),
          "(e) a reversed c/z read places exactly with offC - offN");
    check(!exact_rev(r.reconcile(rev, n, c)), "(e) read with the b/y water offset it does not");
    // From the tagger: a c-only ladder, tagged under cz.
    const CzSynth::Spec s = CzSynth::make(pep, 2, CzSynth::Ions::C, 1);
    // Tag length 4: the index looks up tags of at least 4 residues.
    FASTag::Param pcz = withPair(FASTag::cliDefaultParam(), IS::Series::CZ);
    pcz.tag_length = 4;
    const FASTag::Tables tcz(pcz);
    int reversed_tags = 0, placed = 0, unplaced_as_by = 0;
    for (const FASTag::Tag& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 2, pcz, tcz))
    {
      if (t.gapped || t.n_res < 4) continue;
      const std::string seq = FASTag::baseSequence(t.seq);
      const std::string fwd(seq.rbegin(), seq.rend());
      if (pep.find(fwd) == std::string::npos) continue;
      ++reversed_tags;
      bool ok = false, ok_by = false;
      for (const auto& x : r.reconcile(seq, t.nterm_mass, t.cterm_mass, nullptr, 2, nullptr, &czp))
        ok = ok || (x.peptide == pep && x.reversed && x.nterm_match && x.cterm_match);
      for (const auto& x : r.reconcile(seq, t.nterm_mass, t.cterm_mass))
        ok_by = ok_by || (x.peptide == pep && x.reversed && x.nterm_match && x.cterm_match);
      if (!ok)
      {
        const size_t at = pep.find(fwd);
        const auto [en, ec] = flanksOf(pep, at, fwd.size(), true, czp);
        std::cerr << "(e) unplaced: " << t.seq << " n " << t.nterm_mass << " c " << t.cterm_mass << " want n " << en
                  << " c " << ec << " ext " << t.extended << " n_res " << t.n_res << " places "
                  << r.reconcile(seq, t.nterm_mass, t.cterm_mass, nullptr, 2, nullptr, &czp).size() << "\n";
      }
      placed += ok;
      unplaced_as_by += !ok_by;
    }
    check(reversed_tags >= 2 && placed == reversed_tags && unplaced_as_by == reversed_tags,
          "(e) every reversed tag of a c ladder places exactly under cz and not under b/y (" +
              std::to_string(placed) + "/" + std::to_string(reversed_tags) + ")");
    // Digest: a reversed read next to the C-terminal K counts K at P1 with
    // offC - offN; with the water offset it does not.
    const size_t kpos = pep.size() - 5;  // tag SDG? -> residues [9, 13): "TSDG", K after
    const auto [kn, kc] = flanksOf(pep, kpos, 4, true, czp);
    const std::string krev = std::string(pep.rbegin() + 1, pep.rbegin() + 5);
    FASTag::Digest::TerminusCounter tc_cz, tc_by;
    tc_cz.add(kn, kc, krev, czp.reversedOffset());
    tc_by.add(kn, kc, krev);
    const int K = FASTag::Digest::aaIndex('K');
    check(K >= 0 && tc_cz.cterm()[static_cast<size_t>(K)] == 1, "(e) the c/z reversed read counts K at P1");
    check(K >= 0 && tc_by.cterm()[static_cast<size_t>(K)] == 0, "(e) read with H2O it does not");
  }

  // ---- (f2) #3d flank2 dip under c/z (only with D3cg merged) ----
  {
    int bad = 0;
    const bool ran = flank2CzCheck(FASTag::Digest::TerminusCounter(), FASTag::Digest::TerminusCounter(),
                                   IS::ionPair(IS::Series::CZ).reversedOffset(), bad);
    check(bad == 0, "f2: a reversed c-derived tag enters the flank2 dip at its pair sum, with offC - offN");
    std::cout << "f2. flank2 dip under c/z: " << (ran ? "checked" : "skipped (no #3d in this tree)") << "\n";
  }

  // ---- (f) terminal reports on a c/z-dot synthetic set equal the true termini ----
  {
    const IS::IonPair czp = IS::ionPair(IS::Series::CZ), byp = IS::ionPair(IS::Series::BY);
    const double tmt = 229.162932;
    FASTag::Digest::TerminusCounter tc_cz, tc_by;
    std::uint64_t expect_kr = 0;
    size_t reads = 0;
    for (const char* pc : kPeptides)
    {
      const std::string pep = pc;
      for (size_t pos = 0; pos + 3 <= pep.size(); ++pos)
        for (bool rev : {false, true})
          for (bool label : {false, true})
          {
            if (label && (pos != 0 || rev)) continue;  // an N-terminal label on a forward read at the N end
            const std::string seq = rev ? std::string(pep.rbegin() + static_cast<long>(pep.size() - pos - 3),
                                                      pep.rbegin() + static_cast<long>(pep.size() - pos))
                                        : pep.substr(pos, 3);
            auto fc = flanksOf(pep, pos, 3, rev, czp);
            auto fb = flanksOf(pep, pos, 3, rev, byp);
            if (label) { fc.first += tmt; fb.first += tmt; }
            tc_cz.add(fc.first, fc.second, seq, czp.reversedOffset());
            tc_by.add(fb.first, fb.second, seq);
            ++reads;
            // A read that ends at the peptide's last residue minus one has the
            // C-terminal K/R as its only C-side residue.
            if (pos + 3 == pep.size() - 1) ++expect_kr;
          }
    }
    check(tc_cz.tags == tc_by.tags && tc_cz.tags == reads, "(f) every read counted");
    check(tc_cz.c_near == tc_by.c_near && tc_cz.n_h2o == tc_by.n_h2o && tc_cz.n_near == tc_by.n_near,
          "(f) residue key counts equal the b/y convention");
    check(tc_cz.cpos == tc_by.cpos && tc_cz.npos == tc_by.npos, "(f) P1..P4 / P1'..P4' counts equal");
    check(tc_cz.lab_n == tc_by.lab_n && tc_cz.lab_c == tc_by.lab_c && tc_cz.lab_bg_n == tc_by.lab_bg_n &&
            tc_cz.lab_bg_c == tc_by.lab_bg_c,
          "(f) label counts equal");
    const int K = FASTag::Digest::aaIndex('K'), R = FASTag::Digest::aaIndex('R');
    const std::uint64_t kr = tc_cz.cterm()[static_cast<size_t>(K)] + tc_cz.cterm()[static_cast<size_t>(R)];
    check(kr >= expect_kr && expect_kr > 0, "(f) the C-terminal K/R of the true termini are counted (" +
                                                std::to_string(kr) + " >= " + std::to_string(expect_kr) + ")");
    check(tc_cz.lab_n[0] >= 5, "(f) the five TMT-labelled N-terminal reads count as TMT");
    FASTag::Digest::DigestSettings ds;
    const auto lr_cz = FASTag::Digest::labelRows(tc_cz, ds), lr_by = FASTag::Digest::labelRows(tc_by, ds);
    bool same = lr_cz.size() == lr_by.size() && !lr_cz.empty();
    for (size_t i = 0; same && i < lr_cz.size(); ++i)
      same = lr_cz[i].key == lr_by[i].key && lr_cz[i].value == lr_by[i].value && lr_cz[i].n == lr_by[i].n;
    check(same, "(f) -label_out rows equal the b/y convention's");

    // Mass gap: a +79.966 gap on either side, forward and reversed, gives the
    // same placement delta and interpretation as the b/y convention.
    const std::string pep = "SAMGLEVGATSDGK";
    std::vector<OpenMS::FASTAFile::FASTAEntry> entries;
    entries.emplace_back("PROT1", "test protein", "MSTVWYAAR" + pep + "GTANLEFDSK");
    FASTag::ProteomeIndex idx;
    idx.build(entries, {}, 0);
    FASTag::TagReconciler r(0.02, false, true);
    r.attach(&idx, 0, 4);
    r.setModCandidates({{"Phospho", 79.96633, "STY"}});
    int compared = 0;
    for (bool rev : {false, true})
      for (bool nside : {false, true})
      {
        const size_t pos = 4;
        const std::string t = pep.substr(pos, 4), tr(t.rbegin(), t.rend());
        auto fc = flanksOf(pep, pos, 4, rev, czp), fb = flanksOf(pep, pos, 4, rev, byp);
        // The gap sits on the peptide's N or C side; in a reversed read the
        // N side is the cterm flank.
        const bool on_first = rev ? !nside : nside;
        (on_first ? fc.first : fc.second) += 79.96633;
        (on_first ? fb.first : fb.second) += 79.96633;
        const auto pc = r.reconcile(rev ? tr : t, fc.first, fc.second, nullptr, 2, nullptr, &czp);
        const auto pb = r.reconcile(rev ? tr : t, fb.first, fb.second);
        const auto pick = [&](const std::vector<FASTag::Reconciliation>& v) -> const FASTag::Reconciliation* {
          for (const auto& x : v)
            if (x.peptide == pep && x.pos == pos && x.reversed == rev) return &x;
          return nullptr;
        };
        const FASTag::Reconciliation *xc = pick(pc), *xb = pick(pb);
        check(xc && xb, "(f) gapped placement found in both conventions");
        if (!xc || !xb) continue;
        check(std::fabs(xc->delta_mass - xb->delta_mass) < 1e-6 && std::fabs(xc->delta_mass - 79.96633) < 1e-3 &&
                xc->delta_interp == xb->delta_interp && xc->nterm_match == xb->nterm_match &&
                xc->cterm_match == xb->cterm_match && xc->region_lo == xb->region_lo && xc->region_hi == xb->region_hi,
              std::string("(f) mass gap ") + (rev ? "reversed " : "forward ") + (nside ? "N side" : "C side") +
                  ": delta and interpretation as b/y");
        ++compared;
      }
    check(compared == 4, "(f) four gapped placements compared");
  }

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "ion_series_test: all checks passed\n";
  return 0;
}
