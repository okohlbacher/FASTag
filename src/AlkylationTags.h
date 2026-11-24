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
// most VOTE_MAX_EVALUE (1e-4): the vote is for the form all its C residues
// share, else a conflict; a tag of equal E-value with another form also
// makes the vote a conflict. (The first rule, the best C tag of every
// spectrum at E <= 1, failed: chance C edges in weak or terminal positions
// spread the votes over all forms.) The call is
// #3g's rule (Alkylation::callAlkylation) over the six classes (five
// reagents and none = unmodified C; a conflict counts against the share),
// plus the twin guard: a C form whose mass lies within the two edge windows
// of another C form or a residue step (CAM and Carboxymethyl are 0.984 Da
// apart) cannot be told from it. Review n2: the guard applies per vote, with
// the windows the tagger used at the C edge's own m/z (resolvedBelowMz());
// such a vote is set aside (Tally::unresolved), and the call is no_call
// unresolved_forms when no vote is left (a 0.5 Da run: none at any m/z).
//
// Aliases (review n1): an edge can equal a two-residue sum when the peak
// between them is missing. C[Carbamidomethyl] is G + C exactly (C2H3NO is
// the Gly residue), C[Propionamide] is A + C exactly (and 0.018 Da from
// S + S), C[Nethylmaleimide] lies 0.029 Da from N + N and 0.036 Da from
// M + P. An edge that starts or ends on a 13C peak (an isotope peak the
// deisotoper keeps, every one under -no_deisotope) is another form
// +/- 1.00336 Da: C[Carbamidomethyl] + 13C lies 0.0193 Da from
// C[Carboxymethyl]. Each C edge of a voting tag is checked against the
// spectrum for every alias of its form (aliasExplains()): a peak at either
// intermediate position (in the same series or at the complementary m/z),
// or the monoisotopic peak beside a 13C endpoint, explains the edge as the
// alias, and so does an alias the spectrum cannot test; the vote is then a
// conflict (Tally::alias_rejected). Review n1 (release gate): an alias that
// leaves no trace (both intermediate peaks lost in both series, or removed
// by the peak selection) is not evidence for the C form either, since the
// two readings have one mass. Such a vote counts only with independent
// evidence of its form: the form's C immonium ion (residue - CO + H+, e.g.
// 133.043 for C[Carbamidomethyl]) in the spectrum as read, resolved from the
// immonium ion of any C form the alias reads instead. Without it the vote
// abstains (Tally::alias_unconfirmed), set aside like an unresolved one.
// Measured on PXD020401 and PXD003531 with an open Sage search: the CAM
// immonium is in 49-61% of the spectra of CAM peptides and in 3.5-4.6% of
// those of peptides without CAM; the NEM one in 46% of NEM peptides.
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

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <array>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace FASTag::AlkylationTags
{
  /// @brief Version of the alkt_* and alkylation_tags_call sections (alkt_run.format).
  ///
  /// 2 (feedback 202dbcf4): alias.<form> sums over the run's own alphabet (fixed and
  /// variable modifications of other residues); new rows twin.<form>; a
  /// twin makes forms_resolved no. Written by -alkylation_tags_out and
  /// inside -alkylation_out, whose default call it is.
  ///
  /// 3 (review n1, n2, n3): alkt_run resolved_below_mz; alkt_form
  /// alias_rejected and unresolved; conflicts count against the share (the
  /// share's n is votes plus conflicts) and alkylation_tags_call gains the
  /// row voted after share.
  ///
  /// 4 (release-gate review n1): a vote whose C edge an alias reads as well,
  /// with no trace of the alias in the spectrum, counts only when the form's
  /// C immonium ion is seen; else it abstains (alkt_form alias_unconfirmed,
  /// new row; not in the share). The alias.<form> descriptions say so.
  inline constexpr int REPORT_FORMAT = 4;

  /// @brief The 13C - 12C spacing (Da) the alias check uses for isotope-shifted edges.
  inline constexpr double C13_SPACING = 1.0033548378;

  /// @brief The number of candidate forms.
  ///
  /// The candidate forms: Alkylation::forms() 0 .. NUM_CANDIDATES-1, the five
  /// reagents then "unmodified" (class none).
  inline constexpr int NUM_CANDIDATES = 6;
  /// @brief Index of the unmodified form among the candidates.
  inline constexpr int UNMODIFIED = 5;

  /**
    @brief The candidate forms (the first NUM_CANDIDATES of Alkylation::forms()).
    @param[in] forms Alkylation::forms()
    @return the first NUM_CANDIDATES forms
    @throw std::runtime_error when @p forms is shorter than NUM_CANDIDATES or its entry UNMODIFIED is not "unmodified"
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
  std::array<std::uint32_t, NUM_CANDIDATES> formsInTag(const std::string& seq,
                                                       const std::vector<Alkylation::Form>& cands);

  /// @brief The largest E-value of a voting tag.
  ///
  /// A spectrum votes only when its best counted tag has an E-value of at
  /// most this (reassessment on development data: chance C edges fill the
  /// looser tags).
  inline constexpr double VOTE_MAX_EVALUE = 1e-4;

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
    bool conflict = false;  ///< the kept vote is a conflict between forms (or an alias explains it)
    int form = -1;  ///< candidate index (no conflict)
    bool alias = false;  ///< an alias explains a C edge of the kept tag (aliasExplains()); then also conflict
    bool unresolved = false;  ///< a C edge of the kept tag lies where its form has a twin in the edge windows
    bool unconfirmed = false;  ///< an alias reads a C edge of the kept tag as well, leaves no trace, and the form's immonium ion is not seen
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

  struct Step;

  /**
    @brief Per candidate, the distance (Da) from its C mass to the nearest single-step twin.

    The pairs of twins(): another candidate form (|g.mass - f.mass|) and,
    with @p with_steps, a residue step of @p alpha (|step - (C + f.mass)|).

    @param[in] cands the candidate forms
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @param[in] with_steps false: the other forms only (formsResolved())
    @return one distance per candidate; +inf when there is nothing to compare
  */
  std::vector<double> twinDistances(const std::vector<Alkylation::Form>& cands, const std::vector<Step>* alpha = nullptr,
                                    bool with_steps = true);

  /**
    @brief The smallest single-step twin distance over the candidates (twinDistances()).
    @param[in] cands the candidate forms
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return the distance in Da; +inf when there is none
  */
  double minTwinDistance(const std::vector<Alkylation::Form>& cands, const std::vector<Step>* alpha = nullptr);

  /**
    @brief The m/z below which the tagger's two edge windows cannot both take a step @p d_min apart.

    The tagger looks each step up with the tolerance at its target m/z
    (FASTagger.cpp tolAt), so two steps @p d_min apart can end on one peak at
    m/z M when 2 * tol(M) >= @p d_min (the boundary of formsResolved()).

    @param[in] p the run's (or shadow) Param: frag_tol, tol_ppm
    @param[in] d_min the twin distance in Da (minTwinDistance(), or one entry of twinDistances())
    @return Da: +inf when 2 * frag_tol < @p d_min, else 0; ppm: @p d_min / (2 * frag_tol * 1e-6)
  */
  double resolvedBelowMz(const Param& p, double d_min);

  /**
    @brief One residue step the shadow pass can read besides a C form.
  */
  struct Step
  {
    std::string name;  ///< "K", or "M[Oxidation]" for a variable alternative
    double mass = 0.0; ///< residue mass in Da, fixed modifications included
  };

  /**
    @brief The residue steps of the shadow alphabet other than C.

    The 18 base residues other than C (I as L) with the fixed modifications
    of @p mods folded in, then one entry per variable modification on one of
    them, as the tagger builds its alphabet (FASTagger.cpp, Alphabet). C is
    left out: its forms are the candidates.

    @param[in] mods the shadow pass' modifications (shadowMods())
    @return the steps, base residues by name, then the variable alternatives
  */
  std::vector<Step> alphabet(const std::vector<ModSpec>& mods);

  /**
    @brief Per candidate, the single steps that read like its C mass.

    Another candidate C form, or a residue step of @p alpha, whose mass lies
    within 2 * @p tol_da of the candidate's C mass ("C[Carboxymethyl]:0.9840",
    "C" for unmodified C), by distance, comma-separated, "-" when none. Such
    a twin is one edge, so no spectrum can tell the two apart: the call is
    then not made (unresolved_forms).

    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return one entry per candidate
  */
  std::vector<std::string> twins(const std::vector<Alkylation::Form>& cands, double tol_da,
                                 const std::vector<Step>* alpha = nullptr);

  /**
    @brief Whether no candidate has a single-step twin (twins()).

    formsResolved() over the candidates, plus no residue step of @p alpha
    within 2 * @p tol_da of a candidate's C mass.

    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return true when every candidate is resolved
  */
  bool stepsResolved(const std::vector<Alkylation::Form>& cands, double tol_da, const std::vector<Step>* alpha = nullptr);

  /**
    @brief Per candidate, the masses that could be mistaken for its C mass.

    The two-step sums (two residue steps of @p alpha or C forms, I as L) and
    the other candidate C forms shifted by +/- C13_SPACING within
    2 * @p tol_da of the candidate's C mass: "C+G:0.0000" and
    "C[Carbamidomethyl]+13C:0.0193" entries, by distance, comma-separated,
    "-" when none. These need a missing peak or an isotope peak; a voting
    C edge is checked for them against the spectrum (aliasExplains()).

    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return one entry per candidate
  */
  std::vector<std::string> aliases(const std::vector<Alkylation::Form>& cands, double tol_da,
                                   const std::vector<Step>* alpha = nullptr);

  /**
    @brief One reading a candidate's single C edge can also be (an alias; aliasList()).
  */
  struct Alias
  {
    enum class Kind
    {
      PAIR,  ///< two steps over a missing peak
      ISO    ///< another C form whose edge starts or ends on a 13C peak
    };
    Kind kind = Kind::PAIR;
    int form = -1;            ///< the candidate it reads like
    double x = 0.0, y = 0.0;  ///< PAIR: the two step masses (Da), in name order
    int other = -1;           ///< ISO: the other candidate
    double shift = 0.0;       ///< ISO: +C13_SPACING (the edge ends on a 13C peak) or -C13_SPACING (it starts on one)
    double mass = 0.0;        ///< the reading's mass: x + y, or the other form's C mass + shift
    double dist = 0.0;        ///< |mass - the candidate's C mass|
    std::string name;         ///< as in aliases(): "C+G", "C[Carbamidomethyl]+13C"
  };

  /**
    @brief The aliases of aliases(), structured: per candidate, by distance.
    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da): an alias within 2 * @p tol_da is listed
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return one list per candidate
  */
  std::vector<std::vector<Alias>> aliasList(const std::vector<Alkylation::Form>& cands, double tol_da,
                                            const std::vector<Step>* alpha = nullptr);

  /**
    @brief The peaks a shadow tag was read from, for the alias check.
  */
  struct SpectrumPeaks
  {
    const OpenMS::MSSpectrum* peaks = nullptr;  ///< the tagger's prepared peaks (preparedPeaks()), m/z sorted
    double prec_mass = 0.0;                     ///< neutral precursor mass (Da), for the complementary m/z
    /// The spectrum as read (before the tagger's peak selection), m/z sorted,
    /// for the immonium check; null: @p peaks are used.
    const OpenMS::MSSpectrum* raw = nullptr;
  };

  /**
    @brief The m/z of the C immonium ion of a candidate form (1+).

    C residue + form mass - CO + proton: 133.0430 for Carbamidomethyl,
    76.0216 for unmodified C.

    @param[in] f the form
    @return the m/z
  */
  double immoniumMz(const Alkylation::Form& f);

  /**
    @brief Whether the spectrum holds independent evidence for form @p k against alias @p a.

    True when a peak lies within the tagger's per-peak tolerance of the C
    immonium ion of form @p k (immoniumMz()) in @p sp (raw when given, else
    peaks), and that position cannot be the immonium ion, or its 13C peak, of
    a C form the alias reads instead (its pair steps that are C forms, or
    its other form); false when the immonium lies outside the peaks.

    @param[in] k the candidate index of the voted form
    @param[in] a the alias of form @p k
    @param[in] cands the candidate forms
    @param[in] sp the peaks
    @param[in] p the Param whose frag_tol and tol_ppm give the tolerance
    @return the verdict
  */
  bool immoniumConfirms(int k, const Alias& a, const std::vector<Alkylation::Form>& cands, const SpectrumPeaks& sp,
                        const Param& p);

  /// @brief What aliasExplains() found.
  enum class AliasCheck
  {
    NOT_EXPLAINED,  ///< the alias leaves no trace: the edge reads as the C form
    EXPLAINED,      ///< a peak the alias puts there is present
    UNTESTABLE      ///< every position the alias predicts lies outside the peaks
  };

  /**
    @brief Whether the spectrum explains the C edge @p lo -> @p hi (m/z, fragment charge @p z) as @p a.

    PAIR X+Y: a peak within the tagger's per-peak tolerance (tolAt) at
    lo + X/z or lo + Y/z (the missing middle peak of the same series), or at
    the complementary m/z of either (prec_mass/z + 2 * proton - m). ISO
    +13C: a peak at hi - C13_SPACING/z at least as intense as the peak at hi
    (hi is the 13C peak of that ion); ISO -13C: the same below lo.

    @param[in] lo the lower peak of the edge (m/z)
    @param[in] hi the upper peak of the edge (m/z)
    @param[in] z the fragment charge
    @param[in] a the alias
    @param[in] sp the peaks
    @param[in] p the Param whose frag_tol and tol_ppm give the per-peak tolerance
    @return the verdict
  */
  AliasCheck aliasExplains(double lo, double hi, int z, const Alias& a, const SpectrumPeaks& sp, const Param& p);

  /**
    @brief What the vote checks need of a run: its candidates, aliases and windows.
  */
  struct VoteContext
  {
    std::vector<Alkylation::Form> cands;           ///< the candidate forms
    std::vector<std::vector<Alias>> aliases;       ///< aliasList() at the widest edge window of the run
    Param tol;                                     ///< frag_tol and tol_ppm of the shadow pass
    std::array<double, NUM_CANDIDATES> resolved_below{};  ///< per candidate, resolvedBelowMz() of its twin distance
    double resolved_below_mz = 0.0;                ///< the smallest of them: the run's report row
  };

  /**
    @brief The VoteContext of a run.
    @param[in] p the shadow Param (shadowParam())
    @param[in] cands the candidate forms
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return the context
  */
  VoteContext voteContext(const Param& p, const std::vector<Alkylation::Form>& cands,
                          const std::vector<Step>* alpha = nullptr);

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
    std::uint64_t conflict = 0;        ///< votes whose tag holds two forms, or that an alias explains
    std::uint64_t alias_rejected = 0;  ///< of the conflicts, votes whose C edge an alias explains (aliasExplains())
    std::uint64_t unresolved = 0;      ///< votes set aside: a C edge where its form has a twin in the edge windows
    std::uint64_t alias_unconfirmed = 0;  ///< votes set aside: an alias without a trace and no immonium ion of the form
    std::array<std::uint64_t, NUM_CANDIDATES> votes{};     ///< votes per form
    std::array<std::uint64_t, NUM_CANDIDATES> residues{};  ///< C residues per form over counted tags

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
      @brief Adds one shadow tag of a spectrum, with the vote checks of the tool.

      As addTag() above; a tag that would be kept is first checked: a C
      edge whose upper m/z reaches its form's resolved_below (the edge
      windows hold a twin; Tag::path_mz locates the edge, else
      Tag::high_mz bounds it) makes the vote unresolved; else an alias of
      the edge's form that aliasExplains() finds explained or untestable
      makes it a conflict (alias); an alias that it finds not explained
      needs immoniumConfirms(), else the vote abstains (unconfirmed).

      @param[in,out] v the spectrum's vote so far
      @param[in] t the shadow tag
      @param[in] ctx the run's vote context (voteContext())
      @param[in] sp the spectrum's prepared peaks
    */
    void addTag(Vote& v, const Tag& t, const VoteContext& ctx, const SpectrumPeaks& sp);
  private:
    void addTagChecked(Vote& v, const Tag& t, const std::vector<Alkylation::Form>& cands, const VoteContext* ctx,
                       const SpectrumPeaks* sp);

  public:
    /**
      @brief Adds the spectrum's vote (after its tags).

      Cast only when that tag is the spectrum's best counted tag and its
      E-value is at most VOTE_MAX_EVALUE; also counts the spectrum as tagged.

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
    bool tol_ppm = false;              ///< the run's fragment tolerance is in ppm
    double resolved_below_mz = std::numeric_limits<double>::infinity();  ///< VoteContext::resolved_below_mz
    std::vector<Step> alpha;           ///< the shadow alphabet's other steps (alphabet()); empty = the base residues
  };

  /**
    @brief The alkylation call over the votes, at a Da edge tolerance.

    #3g's call over the votes, then no_call unresolved_forms when a
    candidate has a single-step twin at @p tol_da (stepsResolved()): at a
    tolerance in Da no m/z resolves it. callTags(t, s, ctx) is the call of a
    run.

    @param[in] t the run's tally
    @param[in] s the call settings
    @param[in] cands the candidate forms
    @param[in] tol_da the edge tolerance (Da)
    @param[in] alpha the residue steps (alphabet()); the base residues when null
    @return the call
  */
  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s,
                            const std::vector<Alkylation::Form>& cands, double tol_da,
                            const std::vector<Step>* alpha = nullptr);

  /**
    @brief The alkylation call of a run over its checked votes.

    #3g's call over the votes; no_call unresolved_forms when no m/z resolves
    the forms (ctx.resolved_below_mz <= 0) or when every vote was set aside
    as unresolved (t.spectra == 0, t.unresolved > 0).

    @param[in] t the run's tally (addTag() with the context)
    @param[in] s the call settings
    @param[in] ctx the run's vote context
    @return the call
  */
  Alkylation::Call callTags(const Tally& t, const Alkylation::Settings& s, const VoteContext& ctx);

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
