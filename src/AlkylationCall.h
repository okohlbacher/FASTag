// The alkylation call (-alkylation_out, FASTag 1.12 #3g).
//
// Which reagent, if any, alkylated the cysteines of a run, read off the
// placements the existing reconciler (TagRecon) already makes: there is no
// second index. A placement counts when its peptide has exactly one C and
// that C lies on the side of the tag that carries the placement's mass gap
// (an exact placement: on either side, with a gap of 0). The index carries
// the run's fixed modifications, so the cysteine's own mass shift is
//   reagent = gap + fixed C delta
// (gap -57.021 under a fixed Carbamidomethyl reads 0: unmodified).
// A fixed peptide-terminal label (TMT, iTRAQ: -fixed_modifications on the
// N- or C-terminus) is in the spectrum flank but not in the database prefix
// (TagRecon.h setFixedTermMods), so a gap on the labelled side is first
// reduced by the label, by the rule of Shortlist::classifyPlacement: a
// remainder within the window is an exact placement (label-exact), otherwise
//   reagent = (gap - label) + fixed C delta.
//
// Rules, each counted when it drops a placement (alk_cys excluded.*):
//   - no_cys / multi_cys / cys_in_tag: the peptide has no C, two or more, or
//     its one C is in the tag itself (the tag says nothing about its mass);
//   - cys_outside_region: the one C is on the side of the tag without the
//     gap;
//   - protein_nterm: the gap side is the protein's N-terminus (initiator Met,
//     acetylation);
//   - truncation: the gap equals, within the window, the mass of the one or
//     two outermost residues of the gap side (a non-tryptic product one G
//     shorter reads exactly like unalkylated Cys under a fixed CAM, one A
//     shorter like Propionamide);
//   - met_ambiguous: the gap side holds an M, and the reagent with and
//     without an M oxidation (+15.995) falls into two different classes.
// A counted placement is binned to the nearest Cys form within the window
// (forms()); none in reach is "unexplained".
//
// Each MS2 spectrum votes once, with its best tag (lowest E-value) that has a
// counted placement: for the class all its counted placements agree on, else
// as a conflict. The call is the class with the most spectra when it has at
// least min_spectra of them and a share of at least min_share of the binned
// spectra; the "not alkylated" family (unmodified, Cys oxidation, di- and
// trioxidation, cysteinylation, dehydroalanine) winning is the call "none".
// Otherwise no_call: few_cys_spectra (fewer than min_spectra binned) or
// ambiguous.
//
// Opt-in and not validated on held-out data. The report format is
// documented in doc/ALKYLATION-REPORT.md and kept stable (alk_run.format).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Digest.h"
#include "TagRecon.h"

#include <OpenMS/FORMAT/FASTAFile.h>

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace FASTag::Alkylation
{
  /// Version of the -alkylation_out sections (alk_run.format).
  inline constexpr int REPORT_FORMAT = 1;

  /**
    @brief The call classes of the alkylation call.

    None is the "not alkylated" family.
  */
  enum CallClass : int
  {
    CARBAMIDOMETHYL = 0,  ///< Carbamidomethyl (iodoacetamide)
    PROPIONAMIDE,         ///< Propionamide (acrylamide)
    NETHYLMALEIMIDE,      ///< N-ethylmaleimide
    METHYLTHIO,           ///< Methylthio (MMTS)
    CARBOXYMETHYL,        ///< Carboxymethyl (iodoacetic acid)
    NONE,                 ///< the "not alkylated" family
    NUM_CLASSES           ///< number of call classes
  };
  /**
    @brief Report name of a call class.

    @param[in] cls Call class (CallClass value).
    @return The Unimod name, "none" for the family, "-" for an out-of-range @p cls.
  */
  const char* className(int cls);

  /// The number of Cys forms (forms()).
  inline constexpr int NUM_FORMS = 11;

  /**
    @brief One state a cysteine can be found in.
  */
  struct Form
  {
    std::string name;  ///< report key: the Unimod name, "unmodified" for 0
    std::string site;  ///< OpenMS ModificationsDB id ("" for unmodified)
    double mass = 0;   ///< monoisotopic mass shift on C
    int cls = NONE;    ///< call class
  };
  /**
    @brief The eleven Cys forms, masses from OpenMS ModificationsDB.

    Carbamidomethyl, Propionamide, Nethylmaleimide, Methylthio, Carboxymethyl,
    then the family unmodified, Oxidation, Dioxidation, Trioxidation,
    Cysteinyl, Dehydroalanine.

    @return The forms in the order above.
    @throw std::runtime_error when OpenMS does not know one of the modifications.
  */
  std::vector<Form> forms();

  /**
    @brief Parameters of the alkylation call.
  */
  struct Settings
  {
    double window = 0.02;              ///< Da; 0.5 on a Da run (the -alkylation_window default)
    std::uint64_t min_spectra = 10;    ///< -alkylation_min_spectra
    double min_share = 0.6;            ///< -alkylation_min_share
    double fixed_c = 0.0;              ///< the run's fixed modification on C (0: none)
    /// The run's fixed peptide N-/C-terminal modification masses (TMT,
    /// iTRAQ; 0: none), as the reconciler gets them (setFixedTermMods).
    double fixed_term_n = 0.0, fixed_term_c = 0.0;
    double met_oxidation = 15.9949146; ///< Oxidation (M), set from ModificationsDB by the caller
    /// Residue masses as the index sums them: unmodified residue masses plus
    /// the run's fixed modifications, by ASCII code (residueMasses()).
    std::array<double, 128> residue_mass{};
  };
  /**
    @brief Internal monoisotopic residue masses plus fixed modifications.

    Residue masses from OpenMS ResidueDB (I as L) plus @p fixed, as
    ProteomeIndex::build sums them.

    @param[in] fixed Fixed modifications as (residue, delta mass in Da); a delta on L also applies to I.
    @return Masses indexed by ASCII code (0 for residues not set).
  */
  std::array<double, 128> residueMasses(const std::vector<std::pair<char, double>>& fixed);

  /**
    @brief What evaluate() made of one placement.

    Binned and Unexplained count; the others drop the placement.
  */
  enum class Outcome : int
  {
    BINNED = 0,        ///< reagent binned to a form
    UNEXPLAINED,       ///< counted, but no form within the window
    NO_CYS,             ///< peptide has no C
    MULTI_CYS,          ///< peptide has two or more C
    CYS_IN_TAG,          ///< the one C is in the tag
    CYS_OUTSIDE_REGION,  ///< the one C is on the side without the gap
    PROTEIN_N_TERM,      ///< the gap side is the protein N-terminus
    TRUNCATION,        ///< the gap equals the mass of one or two outermost residues
    MET_AMBIGUOUS,      ///< Met oxidation changes the class
    COUNT             ///< number of outcomes
  };
  /**
    @brief Report key of an outcome (alk_cys excluded.<key>).

    @param[in] o The outcome.
    @return The key, "-" for kCount.
  */
  const char* outcomeName(Outcome o);

  /**
    @brief One placement as the reconciler reports it (Reconciliation).
  */
  struct Placement
  {
    std::string_view peptide;  ///< database spelling
    std::size_t start = 0;     ///< 0-based position of the peptide in its protein
    int tag_pos = 0;           ///< first peptide residue of the tag
    int tag_len = 0;           ///< database residues the tag matched
    /// Flank mass agreement on the N- and C-terminal side; both true = exact placement.
    bool nterm_match = true, cterm_match = true;
    double gap = 0.0;          ///< delta_mass: spectrum flank - database flank on the mismatched side
  };

  /**
    @brief The evaluation of one placement (evaluate()).
  */
  struct Eval
  {
    Outcome outcome = Outcome::NO_CYS;  ///< what became of the placement
    int form = -1;         ///< index into forms() (Binned)
    double reagent = 0.0;  ///< (gap - terminal label) + fixed C delta (from NoCys on: 0)
  };
  /**
    @brief Evaluates one placement by the rules in the file description.

    @param[in] p The placement.
    @param[in] s Settings (window, fixed modifications, residue masses).
    @param[in] forms The Cys forms (forms()).
    @return Outcome, binned form and reagent mass of the placement.
  */
  Eval evaluate(const Placement& p, const Settings& s, const std::vector<Form>& forms);

  /**
    @brief One spectrum's vote: its best tag with a counted placement.
  */
  struct Vote
  {
    bool have = false;      ///< a counted placement exists
    double evalue = 0.0;    ///< E-value of the voting tag
    bool conflict = false;  ///< the tag's counted placements disagree on the class
    int cls = -1;           ///< call class; -1 = unexplained
    int form = -1;          ///< the form all placements agree on, else -1
  };
  /**
    @brief The vote of one tag from its placements' evaluations.

    The outcome counts of those placements are added to @p outcomes. have is
    false when no placement counts.

    @param[in] evals Evaluations of the tag's placements (evaluate()).
    @param[in] forms The Cys forms (forms()).
    @param[in,out] outcomes Per-outcome placement counts, incremented.
    @return The tag's vote.
  */
  Vote tagVote(const std::vector<Eval>& evals, const std::vector<Form>& forms,
               std::array<std::uint64_t, static_cast<int>(Outcome::COUNT)>& outcomes);

  /**
    @brief Whether a written tag row feeds the call.

    Ungapped with E <= 1, the tags the digest report counts. The caller adds
    its own gates (the selected precursor hypothesis once #6 is merged, b/y
    tags only).

    @param[in] gapped Whether the tag is gapped.
    @param[in] evalue E-value of the tag.
    @return true when the tag counts.
  */
  inline bool countsTag(bool gapped, double evalue) { return !gapped && evalue <= 1.0; }

  /**
    @brief Run totals, summed over threads (merge) after the tagging loop.
  */
  struct Tally
  {
    std::uint64_t tags = 0;      ///< filtered tags placed (E <= 1, ungapped)
    std::uint64_t spectra = 0;   ///< spectra with a vote
    std::uint64_t conflict = 0, unexplained = 0;  ///< votes without a class
    std::array<std::uint64_t, NUM_CLASSES> cls{};  ///< votes per call class
    std::array<std::uint64_t, NUM_FORMS> form{};   ///< votes per form (forms() order; agreed form only)
    std::array<std::uint64_t, static_cast<int>(Outcome::COUNT)> outcomes{};  ///< placements per outcome
    /// Tags left out because they are not b/y tags (c/z, PLAN-INTEGRATION
    /// 2.3 contract 2; excludeNonBy()). Always 0 before c/z tagging (#15
    /// phase B): the E15B merge counts its c/z tags here instead of placing
    /// them for the call.
    std::uint64_t excluded_non_by = 0;
    /**
      @brief Counts one spectrum's vote; nothing when it has none.

      @param[in] v The vote.
    */
    void add(const Vote& v);
    /// @brief Counts one tag left out as not a b/y tag.
    void excludeNonBy() { ++excluded_non_by; }
    /**
      @brief Adds all counts of another tally (per-thread merge).

      @param[in] o The tally to add.
    */
    void merge(const Tally& o);
  };

  /**
    @brief Processes one counted tag (countsTag()) with its placements.

    The whole per-tag work of the consumer in tag_one: counts the tag in
    t.tags, its placements' outcomes in t.outcomes, and keeps the tag's vote in
    @p spectrum_vote when it has one and is the spectrum's best (lowest
    E-value) so far. Call addSpectrum() once after the spectrum's tags.

    @param[in,out] t Run tally.
    @param[in,out] spectrum_vote The spectrum's best vote so far, replaced by a better one.
    @param[in] places The tag's placements from the reconciler.
    @param[in] evalue E-value of the tag.
    @param[in] s Settings.
    @param[in] forms The Cys forms (forms()).
  */
  void addTag(Tally& t, Vote& spectrum_vote, const std::vector<Reconciliation>& places, double evalue,
              const Settings& s, const std::vector<Form>& forms);
  /**
    @brief Adds the spectrum's vote (from addTag()) to @p t; nothing without one.

    @param[in,out] t Run tally.
    @param[in] spectrum_vote The spectrum's vote.
  */
  inline void addSpectrum(Tally& t, const Vote& spectrum_vote) { t.add(spectrum_vote); }

  /**
    @brief The alkylation call of a run (callAlkylation()).
  */
  struct Call
  {
    bool called = false;         ///< a class was called
    int cls = -1;                ///< the call (called) or the leading class
    std::string reason = "-";    ///< no call: few_cys_spectra, ambiguous or (shipped proteome) tags_too_short
    std::uint64_t top = 0, binned = 0;  ///< spectra of the leading class; spectra binned to any class
    double share = 0.0;          ///< top / binned (0 when nothing is binned)
  };
  /**
    @brief Makes the call from the run totals.

    The class with the most spectra is called when it has at least
    min_spectra spectra, a share of at least min_share and no tie; otherwise
    the reason is few_cys_spectra (fewer than min_spectra binned) or ambiguous.

    @param[in] t Run totals.
    @param[in] s Settings (min_spectra, min_share).
    @return The call.
  */
  Call callAlkylation(const Tally& t, const Settings& s);
  /**
    @brief Marks a no_call whose run cannot place any tag as tags_too_short.

    1.13 (#24): a no_call whose run cannot place any tag on the database --
    its longest tag (seed length + 2 x extension) is shorter than the
    reconciler's minimum tag length -- gets the reason tags_too_short
    instead of few_cys_spectra. Applied to the shipped proteomes only (the
    1.12 database sources keep their report).

    @param[in,out] c The call; its reason is replaced when the rule applies.
    @param[in] longest_tag The run's longest tag length.
    @param[in] min_tag_length The reconciler's minimum tag length (<= 0: rule off).
    @return true when it applied.
  */
  bool markTagsTooShort(Call& c, int longest_tag, int min_tag_length);

  /**
    @brief What the report states about the database and the run.
  */
  struct ReportInfo
  {
    std::string database;         ///< path of the FASTA the placements are on
    std::string database_source;  ///< recon_fasta, fasta, proteome or bundled:<name>
    std::string reagent_note;     ///< fixed C modification name ("" = none)
    /// 1.13 (#24): a shipped proteome's provenance from its proteomes.tsv row
    /// (UniProt release, proteome id, entries, sha256); "" writes no
    /// database_release row (every non-bundled database, as in 1.12).
    std::string database_release;
    /// 1.13 (#24): with a shipped proteome, the reconciler's minimum tag
    /// length on it and the run's longest tag (alk_run min_tag_length);
    /// 0 writes no row.
    int min_tag_length = 0;
    int longest_tag = 0;  ///< the run's longest tag (see min_tag_length)
  };
  /**
    @brief The alk_run, alk_cys and alkylation_call rows of -alkylation_out.

    @param[in] t Run totals.
    @param[in] c The call.
    @param[in] s Settings.
    @param[in] forms The Cys forms (forms()).
    @param[in] info Database and run information.
    @return The report rows.
  */
  std::vector<Digest::Row> alkylationRows(const Tally& t, const Call& c, const Settings& s,
                                          const std::vector<Form>& forms, const ReportInfo& info);

  /**
    @brief Loads a FASTA, plain or gzip-compressed (a ".gz" name).

    OpenMS FASTAFile for plain files, GzipIfstream otherwise (FASTAFile cannot
    read .gz). Identifier: the header up to the first blank; description: the
    rest. With @p sha256, also the SHA-256 (64 hex digits) of the FASTA text
    read: the decompressed bytes of a .gz, the file's bytes otherwise.

    @param[in] path FASTA file path.
    @param[out] out The entries read (replaced).
    @param[out] sha256 If not null, receives the SHA-256 hex digest.
  */
  void loadFasta(const std::string& path, std::vector<OpenMS::FASTAFile::FASTAEntry>& out,
                 std::string* sha256 = nullptr);

  /**
    @brief One row of the shipped proteomes' manifest.

    1.13 (#24): data/alkylation/proteomes.tsv, written by
    tools/fetch_proteomes.sh.
  */
  struct ShippedProteome
  {
    std::string name;          ///< human, mouse, yeast or ecoli
    std::string proteome;      ///< UniProt proteome id (UP...)
    std::string taxon;         ///< NCBI taxon id
    std::string release;       ///< UniProt release (e.g. 2026_04)
    std::string release_date;  ///< date of the UniProt release
    std::uint64_t entries = 0; ///< FASTA entries of the file
    std::string sha256;        ///< of the .fasta.gz
    std::string fasta_sha256;  ///< of the uncompressed FASTA
    std::string file;          ///< file name in the directory
  };
  /**
    @brief Finds the row of `name` in the manifest text.

    Header line `name<TAB>proteome...`, tab-separated, CR tolerated. Fails
    when the header lacks a needed column, `name` has no row, its entries is
    not a positive number, its file names a path (a '/' or '\\', or a leading
    '.') rather than a file beside the manifest, its sha256 or fasta_sha256 is
    not 64 lowercase hex digits, or `name` has two rows.

    @param[in] manifest_text Text of proteomes.tsv.
    @param[in] name Proteome name to look up.
    @param[out] out The row; written only on success.
    @return true when a valid row was found.
  */
  bool findShippedProteome(const std::string& manifest_text, const std::string& name, ShippedProteome& out);
  /**
    @brief The database_release value of a shipped proteome.

    Its sha256 is the FASTA's (fasta_sha256), which FASTag checks the file
    against at load.

    @param[in] sp The manifest row.
    @return The release description.
  */
  std::string shippedRelease(const ShippedProteome& sp);
}
