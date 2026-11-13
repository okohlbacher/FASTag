// Reconciliation placements as identifications, written by OpenMS's own
// idXML / mzIdentML / mzTab writers (-recon_id_out).
//
// A hit is one placement of one tag: the database window with nothing on it
// but the run's fixed RESIDUE modifications (the window masses were computed
// with them; a terminal one is not, so its mass stays in the gap), and the
// proteins the window occurs in as its evidences -- -recon_out rows that
// differ only in protein are one hit.
// The mass gap a placement leaves stays metadata, because the flanks localise
// it to a region, never to a residue. The score is the tag's E-value, lower is
// better, and nothing here is FDR-controlled: the run says so in a CV-free
// userParam (FDR_controlled = false) in every format.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "TagRecon.h"

#include <OpenMS/CHEMISTRY/ModifiedPeptideGenerator.h>
#include <OpenMS/METADATA/PeptideIdentificationList.h>
#include <OpenMS/METADATA/ProteinIdentification.h>

#include <string>
#include <vector>

namespace FASTag
{
  /**
    @brief Append the hits for one tag's placements to a hit list.

    Placements that differ only in protein (or position in the same protein)
    become one hit with one more peptide evidence.

    @param[in,out] hits the hit list; new hits are appended, existing ones are kept
    @param[in] places the tag's placements (-recon_out rows)
    @param[in] tag the tag as reported (inline variable mods included)
    @param[in] evalue the tag's E-value, used as the hit score (lower is better)
    @param[in] charge precursor charge; <= 0 becomes 2, the charge the tagger
               assumed for that spectrum and so the one its flanks hold
    @param[in] fixed the run's fixed modifications, from
               ModifiedPeptideGenerator::getModifications; a terminal one
               is not applied (its mass is in the gap)
  */
  void addReconHits(std::vector<OpenMS::PeptideHit>& hits, const std::vector<Reconciliation>& places,
                    const std::string& tag, double evalue, int charge,
                    const OpenMS::ModifiedPeptideGenerator::MapToResidueType& fixed);

  /**
    @brief One spectrum's identification: its hits, ranked by E-value, ties sharing a rank.

    @param[in] native_id the spectrum's native ID (spectrum reference)
    @param[in] rt retention time (seconds)
    @param[in] precursor_mz precursor m/z (Th)
    @param[in] hits the spectrum's hits; moved into the result
    @return the identification, hits sorted by E-value (stable) and ranked
  */
  OpenMS::PeptideIdentification reconSpectrum(const std::string& native_id, double rt, double precursor_mz,
                                              std::vector<OpenMS::PeptideHit> hits);

  /**
    @brief Write identifications as idXML, mzIdentML (.mzid) or mzTab, chosen by extension.

    All identifications go under one run: search engine FASTag @p version,
    spectra @p spectra, the search settings @p params (database,
    modifications, tolerance, enzyme), no significance threshold, and the
    userParam FDR_controlled = false. For mzIdentML, every hit of a sequence
    is given the union of that sequence's evidences.

    @param[in] path output file; its extension selects the format
    @param[in] spectra the spectra file (primary MS run path)
    @param[in] version the FASTag version written as search engine version
    @param[in] params the search settings
    @param[in,out] ids the identifications to write; for mzIdentML their hits'
                   evidences are replaced by the per-sequence union
  */
  void storeReconIds(const std::string& path, const std::string& spectra, const std::string& version,
                     OpenMS::ProteinIdentification::SearchParameters params,
                     OpenMS::PeptideIdentificationList& ids);
}
