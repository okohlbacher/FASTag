// The command line's tagging parameters, in one place (1.12 P3).
//
// FASTag::Param (FASTagger.h) carries the LIBRARY defaults: deisotoping off,
// no gap edges, the strongest 100 peaks. The tool registers different ones
// (deisotoping on, -gaps 1, -max_peaks 400, -peaks_per_window 10, the fixed
// Carbamidomethyl (C)), and a unit test that claims "as the CLI runs it" must
// use those. The defaults below are the single source of both: FASTag.cpp
// registers its options with them and starts its Param fill from
// cliDefaultParam(), and tests call cliDefaultParam() directly.
//
// Also here: the -out_spectra parameter names that 1.11 writes, frozen for the
// compatibility shim (see legacyOutSpectraParameterNames()).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "FASTagger.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <array>
#include <string_view>

namespace FASTag::Cli
{
  // Registered defaults of the options that fill FASTag::Param. Changing one
  // changes --help, the CTD and every run that relies on it.
  inline constexpr int TAG_LENGTH = 3;  ///< -tag_length
  inline constexpr int EXTENSION = 0;  ///< -extension
  inline constexpr int GAPS = 1;       ///< -gaps
  inline constexpr bool DEISOTOPE = true;  ///< -no_deisotope is a flag, off
  inline constexpr int PEAKS_PER_WINDOW = 10;                ///< -peaks_per_window
  inline constexpr double FRAGMENT_TOLERANCE = 20.0;        ///< -fragment_tolerance
  inline constexpr const char* FRAGMENT_TOLERANCE_UNIT = "ppm";  ///< -fragment_tolerance_unit
  inline constexpr int MAX_PEAKS = 400;                     ///< -max_peaks
  inline constexpr int MAX_TAGS = 50;                       ///< -max_tags
  inline constexpr double MAX_EVALUE = 20.0;                ///< -max_evalue
  inline constexpr double GAP_PENALTY = 100.0;              ///< -gap_penalty
  inline constexpr const char* FIXED_MODIFICATIONS = "Carbamidomethyl (C)";  ///< -fixed_modifications
  // 1.12 E2 complement options (-complement_*): defaults are FASTag 1.11.
  inline constexpr const char* COMPLEMENT_RULE = "same_charge";  ///< -complement_rule
  inline constexpr double COMPLEMENT_TOLERANCE = 0.02;      ///< Da, unit Da
  inline constexpr double COMPLEMENT_TOL_FACTOR = 0.5;       ///< k, unit fragment
  inline constexpr const char* COMPLEMENT_TOLERANCE_UNIT = "Da";  ///< -complement_tolerance_unit
  inline constexpr bool COMPLEMENT_MIDP = false;  ///< -complement_midp is a flag, off

  /**
    @brief Converts a -complement_rule value to the library's rule.
    @param[in] s "precursor", "both" or "same_charge"
    @return the rule; unknown values (TOPPBase refuses them first) map to SameCharge
  */
  inline ComplementRule complementRuleFromString(std::string_view s)
  {
    if (s == "precursor") return ComplementRule::PRECURSOR;
    if (s == "both") return ComplementRule::BOTH;
    return ComplementRule::SAME_CHARGE;
  }

  /**
    @brief Applies -complement_tolerance (Da), -complement_tol_factor (k) and -complement_tolerance_unit to @p p.

    The unit selects the one in force: Da uses the absolute window, fragment
    k*(fragment tol at m + at the partner). Each value has its own default,
    so "-complement_tolerance_unit fragment" alone runs at the library's
    k = 0.5, not at the Da default 0.02.

    @param[out] p the Param whose complement tolerance fields are set
    @param[in] tol_da the absolute tolerance (Da)
    @param[in] factor the factor k on the fragment tolerance
    @param[in] unit "fragment" selects the factor; anything else the Da window
  */
  inline void setComplementTolerance(Param& p, double tol_da, double factor, std::string_view unit)
  {
    p.complement_tol = tol_da;
    p.complement_tol_factor = factor;
    p.complement_tol_mode = unit == "fragment" ? ComplementTolMode::FRAGMENT : ComplementTolMode::DA;
  }

  /**
    @brief The Param the tool runs with when no option is given.

    The complement options (1.12 E2) are set to their registered defaults,
    which equal the library's: same-charge rule, 0.02 Da (k 0.5 in the
    fragment unit), no mid-p.

    @param[in] resolve_mods when true, the default fixed modification is
      resolved through ModificationsDB exactly as the tool's resolveMods_
      resolves a residue modification (I folded to L); when false `mods`
      stays empty, which is what the tool wants before it resolves
      -fixed_modifications and -variable_modifications itself (and what
      keeps a run with -fixed_modifications "" from parsing UniMod)
    @return the default Param
  */
  inline Param cliDefaultParam(bool resolve_mods = true)
  {
    Param p;
    p.tag_length = TAG_LENGTH;
    p.max_extension = EXTENSION;
    p.max_gaps = GAPS;
    p.deisotope = DEISOTOPE;
    p.peaks_per_window = PEAKS_PER_WINDOW;
    p.frag_tol = FRAGMENT_TOLERANCE;
    p.tol_ppm = std::string_view(FRAGMENT_TOLERANCE_UNIT) == "ppm";
    p.max_peak_count = static_cast<size_t>(MAX_PEAKS);
    p.max_tag_count = MAX_TAGS;
    p.diversity = false;
    p.per_residue_conf = false;
    p.max_evalue = MAX_EVALUE;
    p.gap_penalty = GAP_PENALTY;
    p.complement_rule = complementRuleFromString(COMPLEMENT_RULE);
    setComplementTolerance(p, COMPLEMENT_TOLERANCE, COMPLEMENT_TOL_FACTOR, COMPLEMENT_TOLERANCE_UNIT);
    p.complement_midp = COMPLEMENT_MIDP;
    if (resolve_mods)
    {
      const OpenMS::ResidueModification* mod =
          OpenMS::ModificationsDB::getInstance()->getModification(FIXED_MODIFICATIONS);
      ModSpec ms;
      ms.residue = mod->getOrigin() == 'I' ? 'L' : mod->getOrigin();
      ms.delta = mod->getDiffMonoMass();
      ms.name = mod->getId();
      ms.variable = false;
      p.mods.push_back(ms);
    }
    return p;
  }

  /// @brief The "parameter: <name>" entries FASTag 1.11 (78390cd) writes into the
  /// processing info of an -out_spectra mzML, in the order it writes them:
  /// its 71 tool options and TOPPBase's 6 common ones. Equal to the header of
  /// the refs-1.10.0 gate reference out_spectra_mzml (checked on 2026-11-06).
  ///
  /// FROZEN. An option registered after 1.11 is left out of that list while
  /// it holds its registered default (TOPPFASTag::outSpectraProcessingInfo_),
  /// so adding options keeps the exported bytes; a non-default value is
  /// listed, so the provenance stays truthful whenever an option acted.
  /// out_spectra_params_test checks that the tool writes exactly this list at
  /// defaults.
  inline constexpr std::array<std::string_view, 77> LEGACY_OUT_SPECTRA_PARAMETERS = {
      "in", "out", "fasta", "out_spectra", "tag_length", "tag_lengths", "extension", "gaps",
      "no_deisotope", "fragment_tolerance", "fragment_tolerance_unit", "max_peaks",
      "peaks_per_window", "max_tags", "subsample_spectra", "subsample_fraction",
      "mzpeak_read_memory", "subsample_seed", "progress", "stream", "diversity", "proforma",
      "res_conf", "usi_collection", "entrapment_fasta", "recon_out", "recon_fasta",
      "recon_missed_cleavages", "recon_min_length", "recon_localize", "delta_out",
      "recon_id_out", "species", "glyco", "glyco_out", "glyco_min_fraction", "digest_out",
      "label_out", "massgap_out", "digest_models", "digest_tag_min", "digest_window",
      "digest_background_share", "digest_silac_min", "massgap_window", "massgap_window_da",
      "massgap_min_spectra", "massgap_min_share", "massgap_min_bin", "massgap_max_mods",
      "massgap_top", "massgap_silac_share", "massgap_silac_min", "taxdb", "taxonomy_nodes",
      "taxonomy_names", "species_out", "species_min_len", "species_max_kmer_share",
      "species_min_margin", "species_use_gapped", "species_deconvolve", "species_evidence",
      "species_rank", "max_evalue", "gap_penalty", "isobaric_tolerance", "min_filter_length",
      "orientation", "fixed_modifications", "variable_modifications", "log", "debug",
      "threads", "no_progress", "force", "test"};

  /**
    @brief Whether @p name is one of LEGACY_OUT_SPECTRA_PARAMETERS.
    @param[in] name a parameter name
    @return true when listed
  */
  inline bool isLegacyOutSpectraParameter(std::string_view name)
  {
    for (std::string_view n : LEGACY_OUT_SPECTRA_PARAMETERS)
      if (n == name) return true;
    return false;
  }
}

namespace FASTag
{
  using Cli::cliDefaultParam;
}
