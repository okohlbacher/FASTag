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
// (Alkylation::countsTag) and was read at fragment charge 1. Fragment charge 2 is left out: C[Propionamide]/2 lies 0.009 Th from
// a singly charged S, so a 1+ S ladder also reads as a 2+ Propionamide one.
// A spectrum votes only when its best (lowest E-value) counted tag holds a
// C, no C is the first or last residue of that tag, and its E-value is at
// most kVoteMaxEvalue (1e-4): the vote is for the form all its C residues
// share, else a conflict; a tag of equal E-value with another form also
// makes the vote a conflict. (The first rule, the best C tag of every
// spectrum at E <= 1, failed: chance C edges in weak or terminal positions
// spread the votes over all forms.) The call is
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
// Opt-in and experimental: on development data 61 of 123 runs are called,
// 51 as the SDRF annotation states, and unalkylated runs are rarely called.
// The held-out test passed at the margin: 40 of 57 runs called, 37 right
// (doc/ALKYLATION-REPORT.md, "-alkylation_tags_out").
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /// @brief Version of the -alkylation_tags_out sections (alkt_run.format).
  inline constexpr int kReportFormat = 1;

  /// @brief The 13C - 12C spacing (Da) the alias check uses for isotope-shifted edges.
  inline constexpr double kC13Spacing = 1.0033548378;

  /// @brief The number of candidate forms.
  ///
  /// The candidate forms: Alkylation::forms() 0 .. kNumCandidates-1, the five
  /// reagents then "unmodified" (class none).
  inline constexpr int kNumCandidates = 6;
  /// @brief Index of the unmodified form among the candidates.
  inline constexpr int kUnmodified = 5;

  /**
    @brief The candidate forms (the first kNumCandidates of Alkylation::forms()).
    @param[in] forms Alkylation::forms()
    @return the first kNumCandidates forms
    @throw std::runtime_error when @p forms is shorter than kNumCandidates or its entry kUnmodified is not "unmodified"
  */
  std::vector<Alkylation::Form> candidates(const std::vector<Alkylation::Form>& forms);

  /**
    @brief The shadow pass' modifications.

    @p run_mods without any modification on C (fixed or variable), then one
    variable C modification per reagent candidate, named as the form.

    @param[in] run_mods the run's modifications
    @param[in] cands the candidate forms
    @param[out] dropped if not null, receives (appended) the names of the C modifications taken out ("Carbamidomethyl (fixed)")
    @return the shadow modifications
  */
  std::vector<ModSpec> shadowMods(const std::vector<ModSpec>& run_mods,
                                  const std::vector<Alkylation::Form>& cands,
                                  std::vector<std::string>* dropped = nullptr);

  /**
    @brief The shadow Param of a run Param.

    shadowMods(), no gap edges, b/y, no tag cap, no diversity, E cutoff 1.

    @param[in] run the run's Param
    @param[in] cands the candidate forms
    @param[out] dropped if not null, receives (appended) the names of the C modifications taken out
    @return the shadow Param
  */
  Param shadowParam(const Param& run, const std::vector<Alkylation::Form>& cands,
                    std::vector<std::string>* dropped = nullptr);

  /**
    @brief Per candidate, how many of the C residues of the tag sequence @p seq are of that form.

    A bare C is unmodified; a C with a name no candidate has is not counted.

    @param[in] seq the tag sequence as the tagger writes it ("AC[Carbamidomethyl]DK")
    @param[in] cands the candidate forms
    @return the count per candidate
  */
  std::array<std::uint32_t, kNumCandidates> formsInTag(const std::string& seq,
                                                       const std::vector<Alkylation::Form>& cands);

  /// @brief The largest E-value of a voting tag.
  ///
  /// A spectrum votes only when its best counted tag has an E-value of at
  /// most this (reassessment on development data: chance C edges fill the
  /// looser tags).
  inline constexpr double kVoteMaxEvalue = 1e-4;

  /**
    @brief Whether the first or the last residue of the tag sequence @p seq is a C (any form).

    A terminal edge has one neighbour less to confirm it.

    @param[in] seq the tag sequence as the tagger writes it
    @return true when a C is at either end
  */
  bool cAtEnd(const std::string& seq);

  /**
    @brief One spectrum's vote.

    Its best counted tag whose C residues are all inside the tag (have,
    evalue, conflict, form), and the best E-value of any counted tag (best).
  */
  struct Vote
  {
    bool any = false;  ///< a counted tag was seen
    double best = 0.0;  ///< lowest E-value over the counted tags, with or without C
    bool have = false;  ///< a voting C tag was kept
    double evalue = 0.0;  ///< E-value of the kept C tag
    bool conflict = false;  ///< the kept vote is a conflict between forms
    int form = -1;  ///< candidate index (no conflict)
  };

  /**
    @brief The number of alphabet entries the tagger builds for @p mods.

    19 base residues plus one per variable modification on a base residue;
    the tagger indexes them with 8 bits, so a Param needs at most 255.

    @param[in] mods the modifications
    @return the alphabet size
  */
  std::size_t alphabetSize(const std::vector<ModSpec>& mods);

  /**
    @brief The edge tolerance in Da the report reasons with.
    @param[in] p the run's Param
    @return the fragment tolerance, or, when in ppm, its value at 1000 m/z (Da)
  */
  double edgeToleranceDa(const Param& p);

  /**
    @brief Whether every two candidate C masses are more than 2 * @p tol_da apart.
    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @return true when all pairs are resolved
  */
  bool formsResolved(const std::vector<Alkylation::Form>& cands, double tol_da);

  /**
    @brief Per candidate, the masses that could be mistaken for its C mass.

    The two-residue sums (unmodified base residues, I as L) and the other
    candidate C forms shifted by +/- kC13Spacing within 2 * @p tol_da of the
    candidate's C mass: "G+C:0.0000" and "C[Carbamidomethyl]+13C:0.0193"
    entries, by distance, comma-separated, "-" when none.

    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @return one entry per candidate
  */
  std::vector<std::string> aliases(const std::vector<Alkylation::Form>& cands, double tol_da);

  /**
    @brief The run's counts of shadow tags and votes.
  */
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

    /**
      @brief Adds one shadow tag of a spectrum.

      Counted when countsTag(); its vote kept in @p v when it has a C, none
      at an end, and is the best such so far.

      @param[in,out] v the spectrum's vote so far
      @param[in] t the shadow tag
      @param[in] cands the candidate forms
    */
    void addTag(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands);
    /**
      @brief Adds the spectrum's vote (after its tags).

      Cast only when that tag is the spectrum's best counted tag and its
      E-value is at most kVoteMaxEvalue; also counts the spectrum as tagged.

      @param[in] v the spectrum's vote
    */
    void addSpectrum(const Vote& v);
    /**
      @brief Adds all counts of @p o to this tally.
      @param[in] o another tally (e.g. of another thread)
    */
    void merge(const Tally& o);
    /**
      @brief The vote counts as an Alkylation::Tally (class = candidate class), for Alkylation::callAlkylation.
      @param[in] cands the candidate forms
      @return the converted tally
    */
    Alkylation::Tally asAlkylationTally(const std::vector<Alkylation::Form>& cands) const;
  };

  /**
    @brief What the report states about the run.
  */
  struct ReportInfo
  {
    std::vector<std::string> dropped;  ///< C modifications the shadow pass took out
    std::string lengths;               ///< seed lengths, "4" or "3,4"
    double tol_da = 0.0;               ///< edgeToleranceDa() of the run
  };

  /**
    @brief The alkylation call over the votes.

    #3g's call over the votes, then no_call unresolved_forms when the
    candidates are not resolved at @p tol_da (formsResolved()).

    @param[in] t the run's tally
    @param[in] s the call settings
    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @return the call
  */
  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s,
                            const std::vector<Alkylation::Form>& cands, double tol_da);

  /**
    @brief The alkt_run, alkt_form and alkylation_tags_call rows of -alkylation_tags_out.
    @param[in] t the run's tally
    @param[in] c the call
    @param[in] s the call settings
    @param[in] cands the candidate forms
    @param[in] info what the report states about the run
    @return the report rows
  */
  std::vector<Digest::Row> rows(const Tally& t, const Alkylation::Call& c, const Alkylation::Settings& s,
                                const std::vector<Alkylation::Form>& cands, const ReportInfo& info);
}
