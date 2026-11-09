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
// shadow pass has no gap edges (max_gaps 0), reads b/y only, and keeps
// every tag with E <= 1 (no -max_tags cap, no -diversity, its own E cutoff
// 1), so the run's output selection does not censor the votes.
//
// A shadow tag counts when it is ungapped with E <= 1
// (Alkylation::countsTag), was read at fragment charge 1 and holds at least
// one C. Fragment charge 2 is left out: C[Propionamide]/2 lies 0.009 Th from
// a singly charged S, so a 1+ S ladder also reads as a 2+ Propionamide one.
// Each spectrum votes once, with its best (lowest E-value) counted tag: for
// the form all its C residues share, else as a conflict; a tag of equal
// E-value with another form also makes the vote a conflict. The call is
// #3g's rule (Alkylation::callAlkylation) over the six classes (five
// reagents and none = unmodified C), plus one rule of its own: no call
// (unresolved_forms) when two candidate C masses lie within twice the edge
// tolerance of each other (CAM and Carboxymethyl are 0.984 Da apart, so a
// 0.5 Da run cannot tell them).
//
// Known confounds, reported and not corrected: an ordinary edge can equal a
// two-residue sum when the peak between them is missing. C[Carbamidomethyl]
// is G + C exactly (C2H3NO is the Gly residue), C[Propionamide] is A + C
// exactly (and 0.018 Da from S + S), C[Nethylmaleimide] lies 0.029 Da from
// N + N and 0.036 Da from M + P. An edge that starts or ends on a 13C
// peak (an isotope peak the deisotoper keeps, every one under
// -no_deisotope) is another form +/- 1.00336 Da: C[Carbamidomethyl] + 13C
// lies 0.0193 Da from C[Carboxymethyl], so in CAM runs such edges can vote
// Carboxymethyl. The report lists the twins within the run's tolerance
// (aliases()); formsResolved() compares the forms' own masses only.
//
// Opt-in and experimental: measured to fail on development data (3 calls
// on 123 runs; doc/ALKYLATION-REPORT.md, section "-alkylation_tags_out").
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

  /// The 13C - 12C spacing (Da) the alias check uses for isotope-shifted edges.
  inline constexpr double kC13Spacing = 1.0033548378;

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

  /// The shadow Param of a run Param: shadowMods(), no gap edges, b/y, no
  /// tag cap, no diversity, E cutoff 1.
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

  /// The number of alphabet entries the tagger builds for @p mods (19 base
  /// residues plus one per variable modification on a base residue); the
  /// tagger indexes them with 8 bits, so a Param needs at most 255.
  std::size_t alphabetSize(const std::vector<ModSpec>& mods);

  /// The edge tolerance in Da the report reasons with: the fragment
  /// tolerance, or in ppm at 1000 m/z.
  double edgeToleranceDa(const Param& p);

  /// Whether every two candidate C masses are more than 2 * @p tol_da apart.
  bool formsResolved(const std::vector<Alkylation::Form>& cands, double tol_da);

  /// Per candidate, the two-residue sums (unmodified base residues, I as L)
  /// and the other candidate C forms shifted by +/- kC13Spacing within
  /// 2 * @p tol_da of the candidate's C mass: "G+C:0.0000" and
  /// "C[Carbamidomethyl]+13C:0.0193" entries, by distance, comma-separated,
  /// "-" when none.
  std::vector<std::string> aliases(const std::vector<Alkylation::Form>& cands, double tol_da);

  struct Tally
  {
    std::uint64_t spectra_tagged = 0;  ///< spectra the shadow pass tagged
    std::uint64_t spectra_cz = 0;      ///< spectra read as c/z, not shadow-tagged
    std::uint64_t tags = 0;            ///< counted shadow tags (ungapped, E <= 1, fragment charge 1)
    std::uint64_t tags_multi = 0;      ///< ungapped E <= 1 shadow tags at fragment charge >= 2, not counted
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
    double tol_da = 0.0;               ///< edgeToleranceDa() of the run
  };

  /// #3g's call over the votes, then no_call unresolved_forms when the
  /// candidates are not resolved at @p tol_da (formsResolved()).
  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s,
                            const std::vector<Alkylation::Form>& cands, double tol_da);

  /// The alkt_run, alkt_form and alkylation_tags_call rows of -alkylation_tags_out.
  std::vector<Digest::Row> rows(const Tally& t, const Alkylation::Call& c, const Alkylation::Settings& s,
                                const std::vector<Alkylation::Form>& cands, const ReportInfo& info);
}
