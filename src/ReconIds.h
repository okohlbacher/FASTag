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
#pragma once

#include "TagRecon.h"

#include <OpenMS/CHEMISTRY/ModifiedPeptideGenerator.h>
#include <OpenMS/METADATA/PeptideIdentificationList.h>
#include <OpenMS/METADATA/ProteinIdentification.h>

#include <string>
#include <vector>

namespace FASTag
{
  /// Appends the hits for one tag's @p places to @p hits.
  ///
  /// @param tag     the tag as reported (inline variable mods included)
  /// @param charge  precursor charge; <= 0 becomes 2, the charge the tagger
  ///                assumed for that spectrum and so the one its flanks hold
  /// @param fixed   the run's fixed modifications, from
  ///                ModifiedPeptideGenerator::getModifications; a terminal one
  ///                is not applied (its mass is in the gap)
  void addReconHits(std::vector<OpenMS::PeptideHit>& hits, const std::vector<Reconciliation>& places,
                    const std::string& tag, double evalue, int charge,
                    const OpenMS::ModifiedPeptideGenerator::MapToResidueType& fixed);

  /// One spectrum's identification: its hits, ranked by E-value, ties sharing
  /// a rank.
  OpenMS::PeptideIdentification reconSpectrum(const OpenMS::String& native_id, double rt, double precursor_mz,
                                              std::vector<OpenMS::PeptideHit> hits);

  /// Writes @p ids to @p path as idXML, mzIdentML (.mzid) or mzTab, by
  /// extension, under one run: search engine FASTag @p version, spectra
  /// @p spectra, the search settings @p params (database, modifications,
  /// tolerance, enzyme), no significance threshold. For mzIdentML, every hit of
  /// a sequence is given the union of that sequence's evidences.
  void storeReconIds(const OpenMS::String& path, const OpenMS::String& spectra, const std::string& version,
                     OpenMS::ProteinIdentification::SearchParameters params,
                     OpenMS::PeptideIdentificationList& ids);
}
