// The database-free alkylation call (-alkylation_tags_out, FASTag 1.13,
// backlog #22).
//
// Which reagent, if any, alkylated the cysteines of a run, read off the
// residues of the tags themselves: no protein database. Every MS2 spectrum
// is tagged a second time (a "shadow" pass whose tags are never written)
// with the run's alphabet minus every C modification, so C is unmodified
// (103.009), plus one variable alternative per reagent form of
// Alkylation::forms() (Carbamidomethyl, Propionamide, Nethylmaleimide,
// Methylthio, Carboxymethyl). The tagger spells such an edge C[Name]. The
// shadow pass has no gap edges (max_gaps 0) and reads b/y only.
//
// A shadow tag counts when it is ungapped with E <= 1
// (Alkylation::countsTag) and holds at least one C. Each spectrum votes
// once, with its best (lowest E-value) counted tag: for the form all its C
// residues share, else as a conflict. The call is #3g's rule
// (Alkylation::callAlkylation) over the six classes (five reagents and
// none = unmodified C).
//
// Known confounds, reported and not corrected: an ordinary edge can equal a
// two-residue sum when the peak between them is missing. C[Carbamidomethyl]
// is G + C exactly (C2H3NO is the Gly residue), C[Propionamide] is A + C
// exactly, C[Nethylmaleimide] lies 0.029 Da from N + N and 0.036 Da from
// M + P. Unmodified C, Methylthio and Carboxymethyl have no such twin.
//
// Opt-in and not validated on held-out data (doc/ALKYLATION-REPORT.md,
// section "-alkylation_tags_out").
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "AlkylationCall.h"
#include "Digest.h"
#include "FASTagger.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::AlkylationTags
{
  /// Version of the -alkylation_tags_out sections (alkt_run.format).
  inline constexpr int kReportFormat = 1;

  /// The candidate forms: Alkylation::forms() 0 .. kNumCandidates-1, the five
  /// reagents then "unmodified" (class none).
  inline constexpr int kNumCandidates = 6;
  /// Index of the unmodified form among the candidates.
  inline constexpr int kUnmodified = 5;

  /// The candidate forms (the first kNumCandidates of Alkylation::forms()).
  std::vector<Alkylation::Form> candidates(const std::vector<Alkylation::Form>& forms);

  /// The shadow pass' modifications: @p run_mods without any modification
  /// on C (fixed or variable), then one variable C modification per reagent
  /// candidate, named as the form. @p dropped receives the names of the C
  /// modifications taken out ("Carbamidomethyl (fixed)").
  std::vector<ModSpec> shadowMods(const std::vector<ModSpec>& run_mods,
                                  const std::vector<Alkylation::Form>& cands,
                                  std::vector<std::string>* dropped = nullptr);

  /// The shadow Param of a run Param: shadowMods(), no gap edges, b/y.
  Param shadowParam(const Param& run, const std::vector<Alkylation::Form>& cands,
                    std::vector<std::string>* dropped = nullptr);

  /// Per candidate, how many of the C residues of the tag sequence @p seq
  /// (as the tagger writes it: "AC[Carbamidomethyl]DK") are of that form. A
  /// bare C is unmodified; a C with a name no candidate has is not counted.
  std::array<std::uint32_t, kNumCandidates> formsInTag(const std::string& seq,
                                                       const std::vector<Alkylation::Form>& cands);

  /// One spectrum's vote: its best counted tag with a C.
  struct Vote
  {
    bool have = false;
    double evalue = 0.0;
    bool conflict = false;
    int form = -1;  ///< candidate index (no conflict)
  };

  struct Tally
  {
    std::uint64_t spectra_tagged = 0;  ///< spectra the shadow pass tagged
    std::uint64_t spectra_cz = 0;      ///< spectra read as c/z, not shadow-tagged
    std::uint64_t tags = 0;            ///< counted shadow tags (ungapped, E <= 1)
    std::uint64_t tags_with_c = 0;     ///< of those, tags with a C
    std::uint64_t spectra = 0;         ///< spectra with a vote
    std::uint64_t conflict = 0;        ///< votes whose tag holds two forms
    std::array<std::uint64_t, kNumCandidates> votes{};     ///< votes per form
    std::array<std::uint64_t, kNumCandidates> residues{};  ///< C residues per form over counted tags

    /// One shadow tag of a spectrum: counted when countsTag(); its vote kept
    /// in @p v when it has a C and is the spectrum's best so far.
    void addTag(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands);
    /// The spectrum's vote (after its tags); also counts the spectrum as tagged.
    void addSpectrum(const Vote& v);
    void merge(const Tally& o);
    /// The vote counts as an Alkylation::Tally (class = candidate class), for
    /// Alkylation::callAlkylation.
    Alkylation::Tally asAlkylationTally(const std::vector<Alkylation::Form>& cands) const;
  };

  /// What the report states about the run.
  struct ReportInfo
  {
    std::vector<std::string> dropped;  ///< C modifications the shadow pass took out
    std::string lengths;               ///< seed lengths, "4" or "3,4"
  };

  /// The alkt_run, alkt_form and alkylation_tags_call rows of -alkylation_tags_out.
  std::vector<Digest::Row> rows(const Tally& t, const Alkylation::Call& c, const Alkylation::Settings& s,
                                const std::vector<Alkylation::Form>& cands, const ReportInfo& info);
}
