// src/IonSeries.h, phase A of #15 (1.12): the activation class of an MS2
// spectrum, the per-run counts and the warning that a run with electron or
// hybrid activation is tagged as b/y ions.
//
// Phase B (c/z ion pairs, -ion_series) extends this test.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "ClusterAcc.h"
#include "IonSeries.h"

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

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
}

int main()
{
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

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "ion_series_test: all checks passed\n";
  return 0;
}
