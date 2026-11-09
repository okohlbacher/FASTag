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
  /// One cleavage rule: a FASTag protease model (digest_models.tsv) with the
  /// OpenMS ProteaseDB enzyme that tests its windows and the spelling the
  /// engines take.
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
    bool unspecific() const { return openms.empty(); }
  };

  /// Every rule, in the protease report's model order, then `unspecific`.
  const std::vector<Rule>& rules();

  /// The rule of model @p name (case-insensitive); nullptr if none.
  const Rule* findRule(const std::string& name);

  enum class Specificity
  {
    Full,  ///< both ends at a cleavage site (or a protein terminus)
    Semi,  ///< at least one end
    None   ///< any window
  };
  /// "full", "semi", "none".
  const char* specificityName(Specificity s);
  /// Parses "full", "semi" or "none"; false otherwise.
  bool parseSpecificity(const std::string& s, Specificity& out);

  /// What the shortlist's placements are kept by, and why.
  struct Choice
  {
    const Rule* rule = nullptr;
    Specificity specificity = Specificity::Full;
    /// The run's confident protease call contradicts a named rule: the
    /// hand-off outputs are withheld unless -shortlist_force.
    bool refuse = false;
    std::string reason;  ///< one short phrase for the log and the TSV header
  };

  /// @p option is -shortlist_protease other than `trypsin` (`auto`,
  /// `unspecific` or a model name, which the caller validated with findRule),
  /// @p spec -shortlist_specificity, @p v the protease check of the run.
  ///   auto:       a Compatible or NonTryptic call -> the called model's rule;
  ///               Inconclusive -> Trypsin (what FASTag 1.12 assumes);
  ///   unspecific: every window, never refused (the specificity is None);
  ///   a model:    that rule; refused when the call is confident and names a
  ///               protease the rule is not (a non-trypsin-compatible call
  ///               other than the rule, or a trypsin-compatible call for a rule
  ///               that is not), unless @p spec is None. A call of the
  ///               `unspecific` model names no other protease and is never a
  ///               contradiction.
  Choice choose(const std::string& option, Specificity spec, const FASTag::Shortlist::ProteaseVerdict& v);

  /// The engine's digestion for a rule: its residues, semi = 1 terminus,
  /// and an unspecific rule or Specificity::None as unspecific (Sage
  /// cleave_at "", Comet's Cut_everywhere entry 0).
  FASTag::SearchConfig::Enzyme engineEnzyme(const Rule& rule, Specificity spec);

  /// The window test of one Choice: OpenMS ProteaseDigestion::isValidProduct
  /// with the rule's enzyme, the specificity and at most @p missed_cleavages
  /// internal sites (not counted for an unspecific rule or Specificity::None).
  /// A window at the protein's start, or at position 1 after an initiator
  /// Met, counts as cleaved there (allow_nterm_protein_cleavage).
  class WindowFilter
  {
  public:
    WindowFilter(const Rule& rule, Specificity spec, int missed_cleavages);
    /// @p protein the database sequence (ambiguity residues as 'X'),
    /// [@p start, @p start + @p len) the window in it.
    bool accepts(const std::string& protein, std::uint32_t start, std::uint32_t len) const;

  private:
    bool all_ = false;
    OpenMS::ProteaseDigestion dig_;
  };
}
