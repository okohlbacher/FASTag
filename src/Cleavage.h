// Protease-aware placement windows for the shortlist (FASTag 1.13, item 20).
//
// FASTag 1.12 places tags on tryptic windows only (ProteomeIndex) and so
// withholds -fasta_out and -search_config_out when the protease check calls
// a run non-tryptic. With -shortlist_protease other than `trypsin` the
// shortlist's placements are found without an enzyme instead (windows whose
// database flanks match the spectrum's flanks by mass,
// TagReconciler::reconcileByMass) and then kept by the cleavage rule chosen
// here: the protease the run's tag ends call (`auto`), a named one, or none
// (`unspecific`), at full, semi or no specificity. The window test is OpenMS's
// ProteaseDigestion::isValidProduct with the rule's ProteaseDB enzyme; the
// same rule is written into the engine configuration (SearchConfig).
//
// Pure functions of their arguments (no logging, no global state).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "SearchConfig.h"

#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>

#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::Shortlist
{
  struct ProteaseVerdict;
}

namespace FASTag::Cleavage
{
  /**
    @brief One cleavage rule.

    A FASTag protease model (digest_models.tsv) with the OpenMS ProteaseDB
    enzyme that tests its windows and the spelling the engines take.
  */
  struct Rule
  {
    std::string name;       ///< the model name, as -shortlist_protease and the protease report spell it
    std::string openms;     ///< ProteaseDB enzyme; "" = unspecific (every window)
    bool c_terminal = true; ///< cuts after the residues in @p cut (false: before them)
    std::string cut;        ///< Sage cleave_at / Comet cut residues ("" unspecific)
    std::string nocut;      ///< Sage restrict / Comet no-cut residue; "" none
    /// Number of this rule in Comet 2026.03.0's own `comet -p` enzyme table
    /// when that entry is the same rule; -1 when it has none (Asp-N there
    /// cuts before D and N), so a Comet configuration needs a template.
    int comet_default = -1;
    /// @brief Whether the rule accepts every window.
    /// @return True when no ProteaseDB enzyme is set (openms is empty).
    bool unspecific() const { return openms.empty(); }
  };

  /**
    @brief Every rule, in the protease report's model order, then `unspecific`.
    @return The static rule table.
  */
  const std::vector<Rule>& rules();

  /**
    @brief Looks up the rule of a model by name (case-insensitive).
    @param[in] name Model name.
    @return The rule, or nullptr if none.
  */
  const Rule* findRule(const std::string& name);

  /**
    @brief How many ends of a window must be at a cleavage site.
  */
  enum class Specificity
  {
    FULL,  ///< both ends at a cleavage site (or a protein terminus)
    SEMI,  ///< at least one end
    NONE   ///< any window
  };
  /**
    @brief Returns the option spelling of a specificity.
    @param[in] s The specificity.
    @return "full", "semi" or "none".
  */
  const char* specificityName(Specificity s);
  /**
    @brief Parses "full", "semi" or "none".
    @param[in] s Text to parse.
    @param[out] out Parsed specificity (unchanged on failure).
    @return True on success; false for any other text.
  */
  bool parseSpecificity(const std::string& s, Specificity& out);

  /**
    @brief What the shortlist's placements are kept by, and why.
  */
  struct Choice
  {
    const Rule* rule = nullptr;                    ///< the chosen rule
    Specificity specificity = Specificity::FULL;   ///< the chosen specificity
    /// The run's confident protease call contradicts a named rule: the
    /// hand-off outputs are withheld unless -shortlist_force.
    bool refuse = false;
    /// A named rule kept although the confident call is another protease
    /// whose cleavage sites nest with the rule's (Trypsin vs Lys-C or Arg-C):
    /// the caller WARNs.
    bool mismatch = false;
    /// `auto` and the tag ends call `unspecific`: the exported search is
    /// unspecific and can take longer than a full search with the true
    /// protease (post-1.13.1, aspn); the caller WARNs.
    bool auto_unspecific = false;
    /// `auto` called Asp-N and -shortlist_specificity was not given: the
    /// specificity is Semi (post-1.13.1, aspn; development runs only).
    bool auto_semi = false;
    std::string reason;  ///< one short phrase for the log and the TSV header
  };

  /**
    @brief Tests whether one rule's cleavage sites are a subset of the other's.

    Same side of the residue, same no-cut residue, and one cut set within the
    other (Trypsin with Lys-C or Arg-C; a rule with itself). Lys-C and Arg-C
    are disjoint, so not nested. Unspecific rules nest with none.

    @param[in] a First rule.
    @param[in] b Second rule.
    @return True when the rules are nested.
  */
  bool nested(const Rule& a, const Rule& b);

  /**
    @brief Chooses the rule and specificity that keep the shortlist's placements.

      auto:       a Compatible or NonTryptic call -> the called model's rule;
                  Inconclusive -> Trypsin (what FASTag 1.12 assumes);
      unspecific: every window, never refused (the specificity is None);
      a model:    that rule; refused when the call is confident and names
                  another protease whose cleavage sites do not nest with the
                  rule's (nested(): so Lys-C vs Arg-C is refused, Trypsin vs
                  Lys-C or Arg-C is kept with Choice::mismatch set), unless
                  @p spec is None. A call of the `unspecific` model names no
                  other protease and is never a contradiction. A called model
                  without a rule: refused when NonTryptic, or Compatible for
                  a rule that is not trypsin-compatible.

    When @p spec_given is false, an Asp-N call under `auto` is kept and
    exported semi-specific (Choice::auto_semi): Asp-N digests hold many
    semi-specific and E-cleaved peptides, and the full-specificity shortlist
    kept fewer proteins than the unspecific one it replaces on the development
    runs. A named `asp-n` keeps @p spec.

    @param[in] option -shortlist_protease other than `trypsin` (`auto`,
      `unspecific` or a model name, which the caller validated with findRule).
    @param[in] spec -shortlist_specificity.
    @param[in] v The protease check of the run.
    @param[in] spec_given The user set -shortlist_specificity.
    @return The chosen rule, specificity and flags.
  */
  Choice choose(const std::string& option, Specificity spec, const FASTag::Shortlist::ProteaseVerdict& v,
                bool spec_given = true);

  /**
    @brief The engine's digestion for a rule.

    Its residues, semi = 1 terminus, and an unspecific rule or
    Specificity::NONE as unspecific (Sage cleave_at "", Comet's Cut_everywhere
    entry 0).

    @param[in] rule The cleavage rule.
    @param[in] spec The specificity.
    @return The enzyme settings for the engine configuration.
  */
  FASTag::SearchConfig::Enzyme engineEnzyme(const Rule& rule, Specificity spec);

  /**
    @brief The window test of one Choice.

    OpenMS ProteaseDigestion::isValidProduct with the rule's enzyme, the
    specificity and at most a given number of internal missed cleavage sites
    (not counted for an unspecific rule or Specificity::NONE). A window at the
    protein's start, or at position 1 after an initiator Met, counts as
    cleaved there (allow_nterm_protein_cleavage).
  */
  class WindowFilter
  {
  public:
    /**
      @brief Sets up the digestion for a rule and specificity.
      @param[in] rule The cleavage rule.
      @param[in] spec The specificity; None accepts every window.
      @param[in] missed_cleavages Maximum internal cleavage sites in a window.
    */
    WindowFilter(const Rule& rule, Specificity spec, int missed_cleavages);
    /**
      @brief Tests one window of a protein.
      @param[in] protein The database sequence (ambiguity residues as 'X').
      @param[in] start Start of the window in @p protein (0-based).
      @param[in] len Length of the window; [@p start, @p start + @p len) is the window.
      @return True when the window passes; always true for an unspecific
        filter; false for an empty window or one past the protein's end.
    */
    bool accepts(const std::string& protein, std::uint32_t start, std::uint32_t len) const;

  private:
    bool all_ = false;
    OpenMS::ProteaseDigestion dig_;
  };
}
