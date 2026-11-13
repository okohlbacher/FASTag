// Search-engine configuration from a FASTag run (FASTag 1.12, item #5).
//
// A SearchPlan holds what FASTag knows about the run that a database search
// needs: the database (the reduced FASTA, or the input one), the fixed and
// variable modifications FASTag was given, tolerances, missed cleavages and
// the decoy convention. renderSage writes a complete Sage configuration;
// renderComet writes the Comet keys FASTag manages, and mergeKeyValueTemplate
// puts them into a `comet -p` parameter file.
//
// Engine conventions are copied from OpenMS's adapters (TOPP sources cannot
// be linked from a tool) and cited where used:
//   - Sage term symbols '^' '$' '[' ']' from SageAdapter::getModDetails;
//   - Comet's fragment bin policy (CometAdapter.cpp, "ion trap ms/ms: 1.0005
//     tolerance, 0.4 offset ... high res ms/ms: 0.02 tolerance, 0.0 offset"),
//     the reset of unused variable_modNN slots to "0.0 X 0 3 -1 0 0 0.0", the
//     explicit add_C_cysteine = 0 (Comet applies Carbamidomethyl by default),
//     the variable-mod terminus encoding (CometModification.cpp) and the rule
//     that [COMET_ENZYME_INFO] must come last.
// renderMSFragger (1.13, backlog #18) writes a complete MSFragger 4.4.1
// fragger.params in the key order of `java -jar MSFragger.jar --config
// closed`; its key names and value encodings were checked against the
// parameters MSFragger 4.4.1 echoes ("Parameters:" in its log), see
// test/fixtures/msfragger_4.4.1_echo.txt.
// The enzyme is trypsin unless -shortlist_protease (1.13 item 20) names
// another rule: every renderer then writes that rule (SearchPlan::enzyme).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <cstddef>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace OpenMS
{
  class ResidueModification;
}

namespace FASTag::SearchConfig
{
  /**
    @brief The digestion the engine searches with (1.13 item 20).

    The default is FASTag 1.12's: trypsin, fully specific, Comet enzyme 1,
    and every renderer writes then exactly what 1.12 wrote.
  */
  struct Enzyme
  {
    std::string name = "Trypsin";  ///< for messages
    std::string cut = "KR";        ///< "" = unspecific (no cleavage rule)
    std::string nocut = "P";       ///< "" = no restriction
    bool c_terminal = true;        ///< cleaves C-terminal to the cut residues
    int termini = 2;               ///< 2 fully, 1 semi-specific
    /// Comet `comet -p` (2026.03.0) table number of this rule, -1 none: a
    /// Comet configuration then needs -search_config_template.
    int comet_default = 1;
    /// @brief Whether the rule is unspecific (no cut residues).
    /// @return true when cut is empty
    bool unspecific() const { return cut.empty(); }
    /// @brief Whether the rule is the default (trypsin, fully specific).
    /// @return true for cut KR, nocut P, C-terminal, both termini
    bool isDefault() const
    {
      return cut == "KR" && nocut == "P" && c_terminal && termini == 2;
    }
  };

  /// calibrate_mass of the MSFragger export under the msfragger defaults (post-1.15, development runs only).
  constexpr int MSFRAGGER_DEFAULT_CALIBRATION = 2;

  /**
    @brief What FASTag knows about the run that a database search needs.
  */
  struct SearchPlan
  {
    std::string database;  ///< FASTA the engine searches
    std::string spectra;   ///< the run (Sage mzml_paths; a comment for Comet)
    std::vector<const OpenMS::ResidueModification*> fixed, variable;  ///< the fixed and variable modifications FASTag was given
    std::vector<double> mass_offsets;  ///< mass offsets besides 0 (none since 1.14: -search_shifts was removed)
    int isotope_errors = 0;            ///< 0..n precursor isotope errors; 0 = none
    int missed_cleavages = 1;          ///< missed cleavages
    double fragment_tolerance = 20.0;  ///< fragment tolerance, in ppm or Da (fragment_ppm)
    bool fragment_ppm = true;          ///< fragment_tolerance is in ppm, else Da
    double precursor_tolerance = 10.0; ///< precursor tolerance, in ppm or Da (precursor_ppm)
    bool precursor_ppm = true;         ///< precursor_tolerance is in ppm, else Da
    std::string decoy_prefix;          ///< "" = the engine's FASTag default (rev_ / DECOY_)
    std::string fastag_version;        ///< written into the header comment
    Enzyme enzyme;                     ///< 1.13 item 20; default trypsin
    int threads = 0;                   ///< MSFragger num_threads (FASTag's -threads; 0 = all CPUs)
    int calibrate_mass = 0;            ///< MSFragger calibrate_mass (0 off, 1 calibrate, 2 also optimize parameters)
  };

  /**
    @brief The decoy prefix a plan uses for @p engine.
    @param[in] p the plan; its decoy_prefix wins when set
    @param[in] engine "sage", "comet" or "msfragger"
    @return the plan's prefix, else rev_ for Sage and MSFragger (Philosopher/FragPipe), DECOY_ for Comet
  */
  std::string decoyPrefix(const SearchPlan& p, const std::string& engine);

  /**
    @brief Sage term symbol and residue for one modification, as SageAdapter writes them.

    "^" peptide N-term, "$" peptide C-term, "[" protein N-term, "]" protein
    C-term, then the residue letter unless it is any (X).

    @param[in] mod the modification
    @return the Sage modification key
  */
  std::string sageModKey(const OpenMS::ResidueModification& mod);

  /**
    @brief A complete Sage configuration (JSON).

    The plan's enzyme (default trypsin: KR, not before P), FASTag's missed
    cleavages, the plan's mods (static mods on one key are summed; variable
    ones listed), tolerances, isotope errors, decoys generated by Sage over
    the database with the plan's prefix.

    @param[in] p the plan
    @return the JSON text
  */
  std::string renderSage(const SearchPlan& p);

  /**
    @brief Comet's fragment bin settings.
  */
  struct CometBins
  {
    double tol = 1.0005, offset = 0.4;  ///< fragment_bin_tol and fragment_bin_offset
    int theoretical = 1;  ///< theoretical_fragment_ions
  };
  /**
    @brief CometAdapter's bin policy for a fragment tolerance.

    A high-resolution fragment tolerance (ppm, or at most 0.1 Da) gives bin
    width 2 x the tolerance in Da at m/z 1000, floored at 0.01, offset 0.0
    and theoretical_fragment_ions 0; a coarser one gives Comet's ion-trap
    defaults 1.0005 / 0.4 / 1.

    @param[in] tolerance the fragment tolerance
    @param[in] ppm whether @p tolerance is in ppm, else Da
    @return the bin settings
  */
  CometBins cometFragmentBins(double tolerance, bool ppm);

  /**
    @brief Every Comet key FASTag manages, in the order renderComet writes them.

    Database and decoys, precursor tolerance and isotope error, enzyme and
    missed cleavages, all variable_mod01..15 slots (unused ones reset), the
    fragment bins, mass_offsets, and every add_* key (0.0 unless the plan
    sets it), so no chemistry of a template survives.

    @param[in] p the plan
    @param[out] keys cleared, then filled with the key/value pairs
    @return "" or an error (a modification Comet cannot express)
  */
  std::string cometKeys(const SearchPlan& p, std::vector<std::pair<std::string, std::string>>& keys);

  /**
    @brief The managed Comet keys as a parameter fragment.

    With a header that says to merge it into `comet -p` defaults
    (-search_config_template).

    @param[in] p the plan
    @param[out] err if not null, receives the error when rendering fails
    @return the fragment; "" on error
  */
  std::string renderComet(const SearchPlan& p, std::string* err = nullptr);

  /**
    @brief MSFragger's site of a variable modification.

    fragger.params: "amino acid codes, [ and ] specifies protein termini, n
    and c specifies peptide termini". The residue letter; "n^"/"c^" a peptide
    terminus, "[^"/"]^" a protein terminus, followed by the residue instead
    of '^' for a terminal modification on one residue ("nQ", "[M").

    @param[in] mod the modification
    @return the site; "" for a modification on any residue, which FASTag does not export
  */
  std::string msfraggerSite(const OpenMS::ResidueModification& mod);

  /**
    @brief Every key of a complete MSFragger 4.4.1 fragger.params in the order of its `--config closed` file.

    With FASTag's values: database, decoy prefix, the precursor window
    (precursor_mass_lower/upper/units) and the same
    precursor_true_tolerance/units, fragment tolerance, the plan's calibrate_mass,
    isotope_error 0/../n, mass_offsets with 0 first ('/'-separated),
    trypsin and missed cleavages, the used variable_mod_NN slots only and
    every add_* key (0.0 unless the plan sets it). The other keys keep the
    --config closed defaults, except num_threads (the plan's threads: an
    explicit -threads n is n, FASTag's default -threads 0 stays 0 = every
    CPU) and labile_fragment_ion_series b,y (4.4.1 rejects its own blank
    default).

    @param[in] p the plan
    @param[out] keys cleared, then filled with the key/value pairs
    @return "" or an error (a modification or setting MSFragger cannot take;
      also mass offsets with a Da precursor window, on which MSFragger 4.4.1
      exits 1 with "Could not find <delta> in the list")
  */
  std::string msfraggerKeys(const SearchPlan& p, std::vector<std::pair<std::string, std::string>>& keys);

  /**
    @brief The complete fragger.params.

    "key = value" lines, no inline comments: MSFragger 4.4.1 reads a comment
    after spaces as part of the value.

    @param[in] p the plan
    @param[out] err if not null, receives the error when rendering fails
    @return the file text; "" on error
  */
  std::string renderMSFragger(const SearchPlan& p, std::string* err = nullptr);

  /**
    @brief The result of mergeKeyValueTemplate().
  */
  struct MergeResult
  {
    std::string text;                   ///< the merged parameter file
    std::string error;                  ///< "" on success
    std::vector<std::string> warnings;  ///< e.g. a rewritten enzyme number
  };

  /**
    @brief Whether @p key belongs to a family FASTag manages as a whole.
    @param[in] key a Comet parameter key
    @return true for every variable_modNN (two digits) and every add_* key
  */
  bool cometManagedFamily(const std::string& key);

  /**
    @brief Merges @p keys into a Comet parameter file @p tmpl.

    A line whose key is in @p keys gets its value (an inline comment is
    kept), a line of a managed family whose key is not in @p keys is
    dropped, keys the template lacks are inserted before
    [COMET_ENZYME_INFO]; comments, blank lines, the version header and
    unmanaged keys stay as they are. The template's enzyme table must hold
    trypsin (cut KR, not before P, C-terminal): the search_enzyme_number and
    sample_enzyme_number keys are set to its number, and a different number
    in the template is a warning. No table, or no trypsin in it, is an error.

    @param[in] tmpl the template's text
    @param[in] keys the managed key/value pairs (cometKeys())
    @return the merged text, an error ("" on success) and warnings
  */
  MergeResult mergeKeyValueTemplate(const std::string& tmpl,
                                    const std::vector<std::pair<std::string, std::string>>& keys);
  /**
    @brief Merges @p keys into @p tmpl with the plan's enzyme (1.13 item 20).

    Its entry in the table (same sense, cut residues as a set, no-cut residue
    or '-'; unspecific: sense 0, cut '-', no-cut '-') sets both enzyme
    numbers. The default Enzyme is the call above, byte for byte.

    @param[in] tmpl the template's text
    @param[in] keys the managed key/value pairs (cometKeys())
    @param[in] enzyme the enzyme to find in the template's table
    @return the merged text, an error ("" on success) and warnings
  */
  MergeResult mergeKeyValueTemplate(const std::string& tmpl,
                                    const std::vector<std::pair<std::string, std::string>>& keys,
                                    const Enzyme& enzyme);
}
