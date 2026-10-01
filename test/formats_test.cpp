// The standard-format outputs: USIs for the tag TSV (collection validation,
// the index forms, the USI 1.0 grammar) and -recon_id_out (placements written
// as idXML / mzIdentML / mzTab, then read back by OpenMS, the mzIdentML also
// schema-validated).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "ReconIds.h"
#include "Usi.h"

#include <OpenMS/CHEMISTRY/ProteaseDB.h>
#include <OpenMS/FORMAT/IdXMLFile.h>
#include <OpenMS/FORMAT/MzIdentMLFile.h>
#include <OpenMS/FORMAT/MzTab.h>
#include <OpenMS/FORMAT/MzTabFile.h>
#include <OpenMS/SYSTEM/File.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <iterator>
#include <regex>
#include <string>
#include <vector>

using namespace OpenMS;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  // USI 1.0 without an interpretation: prefix, a permitted collection, a run
  // that does not open a [subFolder], then one of the spectrum index forms.
  const std::regex USI_GRAMMAR(
      R"(^mzspec:(PXD\d{6}|RPXD\d{6}|PXL\d{6}|MSV\d{9}|RMSV\d{9}|USI000000):)"
      R"([^\[\t\n][^\t\n]*:(scan:\d+|index:\d+|nativeId:\d+(,\d+)*)$)");

  void usiTests()
  {
    for (const char* good : {"PXD000561", "RPXD006668", "PXL000001", "MSV000078556", "RMSV000078556",
                             "USI000000"})
      check(FASTag::isUsiCollection(good), std::string("collection accepted: ") + good);
    for (const char* bad : {"", "PXD", "PXD12345", "PXD0005610", "pxd000561", "PXD00056a", "PDX000561",
                            "MSV00007855", "MSV0000785560", "RPXD00666", "USI000001", "PXD000561 ",
                            " PXD000561", "PXD000561:x", "MSV000078556X"})
      check(!FASTag::isUsiCollection(bad), std::string("collection refused: '") + bad + "'");

    // The spec's own examples (USI 1.0, sections 3.3 and 3.6.4).
    const std::string run = "mzspec:PXD000561:Adult_Frontalcortex_bRP_Elite_85_f09:";
    check(run + FASTag::usiIndex("controllerType=0 controllerNumber=1 scan=17555", 9)
              == "mzspec:PXD000561:Adult_Frontalcortex_bRP_Elite_85_f09:scan:17555",
          "Thermo native ID -> scan");
    check(FASTag::usiIndex("controllerType=5 controllerNumber=1 scan=7", 0) == "nativeId:5,1,7",
          "Thermo off the MS controller -> nativeId");
    check(FASTag::usiIndex("sample=1 period=1 cycle=2740 experiment=10", 0) == "nativeId:1,1,2740,10",
          "WIFF -> nativeId");
    check(FASTag::usiIndex("function=10 process=1 scan=345", 0) == "nativeId:10,1,345",
          "Waters -> nativeId, not its scan field");
    check(FASTag::usiIndex("frame=120 scan=475", 0) == "nativeId:120,475", "Bruker TDF -> nativeId");
    check(FASTag::usiIndex("spectrum=12", 0) == "nativeId:12", "spectrum identifier format -> nativeId");
    // Real inputs: diaTracer writes frame=N (TSF's layout) for pseudo-spectra
    // under a Thermo declaration; a TDF conversion numbers index= from 1.
    check(FASTag::usiIndex("frame=1039", 8) == "index:8", "frame=N alone -> position");
    check(FASTag::usiIndex("index=1", 0) == "index:0", "index=N -> position, whatever its base");
    check(FASTag::usiIndex("scan=42", 0) == "scan:42", "scan number only -> scan");
    // No PSI-MS nativeID format, or one not made of integers: the input position.
    check(FASTag::usiIndex("spectrum_17", 16) == "index:16", "non-native ID -> position");
    check(FASTag::usiIndex("", 1) == "index:1", "empty ID -> position");
    check(FASTag::usiIndex("merged=3", 5) == "index:5", "unknown key -> position");
    check(FASTag::usiIndex("frame=1 scan=2 precursor=3", 6) == "index:6",
          "an ID extending a format's keys (a derived spectrum) -> position");
    check(FASTag::usiIndex("scan=2 frame=1", 7) == "index:7", "keys out of the format's order -> position");
    check(FASTag::usiIndex("controllerType=0 controllerNumber=1 scan=x7", 4) == "index:4",
          "non-integer field -> position");
    check(FASTag::usiIndex("scan=5 merged", 2) == "index:2", "field without '=' -> position");

    for (const std::string& id : {std::string("controllerType=0 controllerNumber=1 scan=17555"),
                                  std::string("sample=1 period=1 cycle=2740 experiment=10"),
                                  std::string("index=0"), std::string("not a native id")})
    {
      const std::string usi = run + FASTag::usiIndex(id, 123);
      check(std::regex_match(usi, USI_GRAMMAR), "USI grammar: " + usi);
    }
    check(!std::regex_match("mzspec:PXD00056:run:scan:1", USI_GRAMMAR), "grammar refuses a bad collection");
  }

  FASTag::Reconciliation placement(const std::string& protein, const std::string& peptide, size_t start,
                                   size_t pos, double delta = 0.0, int lo = 0, int hi = -1,
                                   const std::string& interp = "")
  {
    FASTag::Reconciliation r;
    r.protein = protein;
    r.peptide = peptide;
    r.start = start;
    r.pos = pos;
    r.nterm_match = true;
    r.cterm_match = delta == 0.0;
    r.delta_mass = delta;
    r.region_lo = lo;
    r.region_hi = hi;
    r.delta_interp = interp;
    return r;
  }

  /// "spectrum sequence accession" for every hit x evidence, sorted: what
  /// -recon_out rows the identifications stand for.
  std::vector<std::string> expand(const PeptideIdentificationList& peps)
  {
    std::vector<std::string> out;
    for (const auto& p : peps)
      for (const auto& h : p.getHits())
        for (const auto& ev : h.getPeptideEvidences())
          out.push_back(p.getSpectrumReference() + " " + h.getSequence().toUnmodifiedString() + " "
                        + ev.getProteinAccession());
    std::sort(out.begin(), out.end());
    return out;
  }

  size_t hitCount(const PeptideIdentificationList& peps)
  {
    size_t n = 0;
    for (const auto& p : peps) n += p.getHits().size();
    return n;
  }

  std::string slurp(const String& path)
  {
    std::ifstream in(path.c_str());
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  }

  void reconIdTests()
  {
    const auto fixed = ModifiedPeptideGenerator::getModifications({"Carbamidomethyl (C)"});
    // The hits for one tag's placements.
    const auto hits = [&fixed](const std::vector<FASTag::Reconciliation>& places, const std::string& tag,
                               double evalue, int charge, std::vector<PeptideHit> to = {}) {
      FASTag::addReconHits(to, places, tag, evalue, charge, fixed);
      return to;
    };

    PeptideIdentificationList ids;
    // Spectrum 11: an exact placement, and a second tag whose C-side flank is
    // 15.995 heavier than the window (an oxidation candidate on M, region 4-6).
    ids.push_back(FASTag::reconSpectrum(
        "controllerType=0 controllerNumber=1 scan=11", 600.5, 467.2244,
        hits({placement("sp|P00002|TWO", "GLLTDMR", 3, 1, 15.9949, 4, 6, "mod:Oxidation@M")}, "LLT", 0.01, 0,
             hits({placement("sp|P00001|ONE", "SAMPLECK", 10, 1)}, "AMPL", 0.5, 2))));
    // Spectrum 12: one tag in a window two proteins share (two -recon_out rows,
    // one hit) and in a longer window of one of them.
    ids.push_back(FASTag::reconSpectrum(
        "controllerType=0 controllerNumber=1 scan=12", 612.0, 501.7,
        hits({placement("sp|P00001|ONE", "VVGGLK", 20, 0), placement("sp|P00003|THREE", "VVGGLK", 40, 0),
              placement("sp|P00003|THREE", "VVGGLKR", 40, 0, -156.1011, 6, 6, "?")},
             "VVGG", 0.2, 3)));
    // Spectrum 13: the shared window again, through another tag. OpenMS's
    // mzIdentML writer links a repeated sequence to its first hit's evidences.
    ids.push_back(FASTag::reconSpectrum(
        "controllerType=0 controllerNumber=1 scan=13", 640.0, 501.7,
        hits({placement("sp|P00001|ONE", "VVGGLK", 20, 1), placement("sp|P00003|THREE", "VVGGLK", 40, 1)},
             "VGGL", 0.3, 3)));
    const size_t n_rows = 7, n_hits = 5;
    const std::vector<std::string> rows = expand(ids);

    const PeptideIdentification& s11 = ids[0];
    check(s11.getHits().size() == 2 && s11.getHits()[0].getScore() == 0.01, "hits ranked by E-value");
    check(s11.getHits()[1].getSequence().toString() == "SAMPLEC(Carbamidomethyl)K",
          "fixed mod applied, nothing else");
    check(s11.getHits()[0].getSequence().toString() == "GLLTDMR", "the mass gap is not placed as a mod");
    check(s11.getHits()[0].getCharge() == 2, "unknown precursor charge -> the tagger's 2");
    check(hitCount(ids) == n_hits && rows.size() == n_rows,
          "rows differing only in protein are one hit, one evidence per row");
    check(ids[1].getHits()[0].getPeptideEvidences().size() == 2, "shared window: both proteins as evidences");
    check(ids[1].getHits()[0].getRank() == ids[1].getHits()[1].getRank(), "tied E-values share a rank");

    ProteinIdentification::SearchParameters sp;
    sp.db = "test.fasta";
    sp.fixed_modifications = {"Carbamidomethyl (C)"};
    sp.missed_cleavages = 1;
    sp.fragment_mass_tolerance = 20;
    sp.fragment_mass_tolerance_ppm = true;
    sp.digestion_enzyme = *ProteaseDB::getInstance()->getEnzyme("Trypsin");

    const String base = File::getTempDirectory() + "/fastag_formats_" + File::getUniqueName(false);

    // idXML
    {
      const String path = base + ".idXML";
      FASTag::storeReconIds(path, "run.mzML", "1.5.0", sp, ids);
      std::vector<ProteinIdentification> prots;
      PeptideIdentificationList peps;
      IdXMLFile().load(path, prots, peps);
      check(hitCount(peps) == n_hits && expand(peps) == rows, "idXML: the hits and their proteins");
      check(prots.size() == 1 && prots[0].getSearchEngine() == "FASTag", "idXML: search engine");
      check(prots.size() == 1 && String(prots[0].getSearchParameters().getMetaValue("FDR_controlled")) == "false",
            "idXML: marked not FDR-controlled");
      check(!peps.empty() && !peps[0].isHigherScoreBetter(), "idXML: lower E-value is better");
      check(!peps.empty() && peps[0].getSpectrumReference() == "controllerType=0 controllerNumber=1 scan=11",
            "idXML: spectrum reference is the native ID");
      check(!peps.empty() && std::fabs(double(peps[0].getHits()[0].getMetaValue("delta_mass")) - 15.9949) < 1e-9
                && String(peps[0].getHits()[0].getMetaValue("delta_interp")) == "mod:Oxidation@M",
            "idXML: the gap travels as metadata");
      std::remove(path.c_str());
    }
    // mzIdentML: schema-valid, and it reads back with every evidence in place
    {
      const String path = base + ".mzid";
      FASTag::storeReconIds(path, "run.mzML", "1.5.0", sp, ids);
      MzIdentMLFile f;
      check(f.isValid(path, std::cerr), "mzid: valid against mzIdentML1.1.0.xsd");
      std::vector<ProteinIdentification> prots;
      PeptideIdentificationList peps;
      f.load(path, prots, peps);
      check(hitCount(peps) == n_hits && expand(peps) == rows, "mzid: the hits and their proteins");
      // mzIdentML positions are 1-based (OpenMS writes start + 1 and reads the
      // attribute back as is, so the file is what to check).
      check(slurp(path).find("start=\"11\" end=\"18\"") != std::string::npos,
            "mzid: evidence positions in the protein");
      std::remove(path.c_str());
    }
    // mzTab: one PSM row per hit, its proteins comma-separated
    {
      const String path = base + ".mzTab";
      FASTag::storeReconIds(path, "run.mzML", "1.5.0", sp, ids);
      MzTab mztab;
      MzTabFile().load(path, mztab);
      std::vector<std::string> got;
      for (const MzTabPSMSectionRow& r : mztab.getPSMSectionRows())
      {
        std::vector<String> accs;
        r.accession.get().split(',', accs);
        for (const String& a : accs)
          got.push_back(r.spectra_ref.getSpecRef() + " " + r.sequence.get() + " " + a);
      }
      std::sort(got.begin(), got.end());
      check(mztab.getPSMSectionRows().size() == n_hits && got == rows, "mzTab: the hits and their proteins");
      check(slurp(path).find("FDR_controlled") != std::string::npos, "mzTab: marked not FDR-controlled");
      std::remove(path.c_str());
    }
  }
}

int main()
{
  usiTests();
  reconIdTests();
  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "formats_test: all passed\n";
  return 0;
}
