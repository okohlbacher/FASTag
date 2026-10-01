// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "ReconIds.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/DATASTRUCTURES/DateTime.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/MzTab.h>
#include <OpenMS/FORMAT/MzTabFile.h>

#include <algorithm>
#include <map>
#include <set>
#include <utility>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    /// Joins every PeptideIdentification to the one ProteinIdentification.
    const char* const RUN_ID = "FASTag_recon";

    /// The hit for @p pl, without its evidence.
    PeptideHit reconHit(const Reconciliation& pl, const std::string& tag, double evalue, int charge,
                        const ModifiedPeptideGenerator::MapToResidueType& fixed)
    {
      AASequence seq = AASequence::fromString(pl.peptide);
      ModifiedPeptideGenerator::applyFixedModifications(fixed, seq);
      const double calc_mz = seq.getMZ(charge);

      PeptideHit hit(evalue, 0, charge, std::move(seq));
      // The -recon_out columns, under their TSV names where those are unambiguous.
      hit.setMetaValue("tag", tag);
      hit.setMetaValue("tag_pos", static_cast<int>(pl.pos));
      hit.setMetaValue("tag_reversed", pl.reversed ? 1 : 0);
      hit.setMetaValue("nterm_match", pl.nterm_match ? 1 : 0);
      hit.setMetaValue("cterm_match", pl.cterm_match ? 1 : 0);
      hit.setMetaValue("delta_mass", pl.delta_mass);
      hit.setMetaValue("delta_region", pl.region_hi >= pl.region_lo
                                           ? String(pl.region_lo) + "-" + String(pl.region_hi)
                                           : String());
      hit.setMetaValue("delta_interp", pl.delta_interp);
      // OpenMS's key for the calculated m/z (the mzIdentML reader sets it, the
      // writer folds it into calculatedMassToCharge): beside the precursor m/z
      // it puts experimental vs calculated mass into idXML as well.
      hit.setMetaValue("calcMZ", calc_mz);
      return hit;
    }
  }

  void addReconHits(std::vector<PeptideHit>& hits, const std::vector<Reconciliation>& places,
                    const std::string& tag, double evalue, int charge,
                    const ModifiedPeptideGenerator::MapToResidueType& fixed)
  {
    if (charge <= 0) charge = 2;  // FASTag::tagSpectrum's assumption
    // Residue modifications only: the index leaves a terminal one out of its
    // window masses, so its mass is in delta_mass already and on the peptide
    // it would count twice.
    ModifiedPeptideGenerator::MapToResidueType residue_fixed;
    for (const auto& m : fixed.val)
      if (m.first->getTermSpecificity() == ResidueModification::ANYWHERE) residue_fixed.val.insert(m);
    const size_t first = hits.size();
    std::vector<const Reconciliation*> made;  // the placement each new hit came from
    for (const Reconciliation& pl : places)
    {
      PeptideEvidence ev;
      ev.setProteinAccession(pl.protein);
      ev.setStart(static_cast<Int>(pl.start));
      ev.setEnd(static_cast<Int>(pl.start + pl.peptide.size()) - 1);
      // The same window, tag position and flank agreement in another protein
      // (or at another position in the same one) is the same hit, one more
      // evidence. Not keyed on delta_mass: the index sums masses along the
      // whole database, so one window's gap differs between proteins in the
      // last bits.
      size_t k = 0;
      while (k < made.size()
             && !(made[k]->peptide == pl.peptide && made[k]->pos == pl.pos && made[k]->reversed == pl.reversed
                  && made[k]->nterm_match == pl.nterm_match && made[k]->cterm_match == pl.cterm_match))
        ++k;
      if (k == made.size())
      {
        made.push_back(&pl);
        hits.push_back(reconHit(pl, tag, evalue, charge, residue_fixed));
      }
      hits[first + k].addPeptideEvidence(ev);
    }
  }

  PeptideIdentification reconSpectrum(const String& native_id, double rt, double precursor_mz,
                                      std::vector<PeptideHit> hits)
  {
    PeptideIdentification id;
    id.setIdentifier(RUN_ID);
    id.setScoreType("tag E-value");
    id.setHigherScoreBetter(false);
    id.setSpectrumReference(native_id);
    id.setRT(rt);
    id.setMZ(precursor_mz);
    id.setHits(std::move(hits));
    id.sort();  // stable: equal E-values keep the -recon_out row order
    std::vector<PeptideHit>& hs = id.getHits();
    for (size_t i = 0; i < hs.size(); ++i)
      hs[i].setRank(i > 0 && hs[i].getScore() == hs[i - 1].getScore() ? hs[i - 1].getRank()
                                                                        : static_cast<UInt>(i));
    return id;
  }

  void storeReconIds(const String& path, const String& spectra, const std::string& version,
                     ProteinIdentification::SearchParameters params, PeptideIdentificationList& ids)
  {
    ProteinIdentification run;
    run.setIdentifier(RUN_ID);
    run.setSearchEngine("FASTag");
    run.setSearchEngineVersion(version);
    run.setDateTime(DateTime::now());
    run.setPrimaryMSRunPath({spectra});  // also where the mzIdentML writer looks
    params.setMetaValue("FDR_controlled", "false");
    run.setSearchParameters(std::move(params));
    // The mzIdentML writer makes a DBSequence per protein hit and drops any
    // evidence without one (an invalid file), so every accession gets a hit.
    std::set<String> accessions;
    for (const PeptideIdentification& id : ids)
      for (const PeptideHit& h : id.getHits())
        for (const PeptideEvidence& ev : h.getPeptideEvidences()) accessions.insert(ev.getProteinAccession());
    for (const String& acc : accessions)
    {
      ProteinHit ph;
      ph.setAccession(acc);
      run.insertHit(ph);
    }
    const std::vector<ProteinIdentification> runs{run};

    const FileTypes::Type type = FileHandler::getTypeByFileName(path);
    if (type == FileTypes::MZTAB)
    {
      // FileHandler cannot write mzTab. Every hit, not the best per spectrum:
      // the file must hold what -recon_out holds.
      MzTab mztab = MzTab::exportIdentificationsToMzTab(runs, ids, path, false, false, true,
                                                        "FASTag tag reconciliation");
      MzTabMetaData md = mztab.getMetaData();
      MzTabParameter not_fdr;
      not_fdr.fromCellString("[,,FDR_controlled,false]");
      md.custom[md.custom.size() + 1] = not_fdr;
      mztab.setMetaData(md);
      MzTabFile().store(path, mztab);
      return;
    }
    if (type == FileTypes::MZIDENTML)
    {
      // OpenMS's mzIdentML writer writes a sequence's evidences once, from its
      // first hit, and points every later hit of that sequence at them. The
      // proteins a window occurs in do not depend on the tag that placed it,
      // so the hits of a sequence agree already; the union makes it certain.
      std::map<String, std::vector<PeptideEvidence>> evidences;
      for (const PeptideIdentification& id : ids)
        for (const PeptideHit& h : id.getHits())
        {
          std::vector<PeptideEvidence>& all = evidences[h.getSequence().toString()];
          for (const PeptideEvidence& ev : h.getPeptideEvidences())
            if (std::find(all.begin(), all.end(), ev) == all.end()) all.push_back(ev);
        }
      for (PeptideIdentification& id : ids)
        for (PeptideHit& h : id.getHits()) h.setPeptideEvidences(evidences[h.getSequence().toString()]);
    }
    FileHandler().storeIdentifications(path, runs, ids, {FileTypes::IDXML, FileTypes::MZIDENTML});
  }
}
