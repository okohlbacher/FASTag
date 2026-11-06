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
  inline constexpr int kTagLength = 3;
  inline constexpr int kExtension = 0;
  inline constexpr int kGaps = 1;
  inline constexpr bool kDeisotope = true;  ///< -no_deisotope is a flag, off
  inline constexpr int kPeaksPerWindow = 10;
  inline constexpr double kFragmentTolerance = 20.0;
  inline constexpr const char* kFragmentToleranceUnit = "ppm";
  inline constexpr int kMaxPeaks = 400;
  inline constexpr int kMaxTags = 50;
  inline constexpr double kMaxEvalue = 20.0;
  inline constexpr double kGapPenalty = 100.0;
  inline constexpr const char* kFixedModifications = "Carbamidomethyl (C)";
  // 1.12 E2 complement options (-complement_*): defaults are FASTag 1.11.
  inline constexpr const char* kComplementRule = "same_charge";
  inline constexpr double kComplementTolerance = 0.02;
  inline constexpr const char* kComplementToleranceUnit = "Da";
  inline constexpr bool kComplementMidp = false;  ///< -complement_midp is a flag, off

  /// -complement_rule value to the library's rule; unknown values (TOPPBase
  /// refuses them first) map to SameCharge.
  inline ComplementRule complementRuleFromString(std::string_view s)
  {
    if (s == "precursor") return ComplementRule::Precursor;
    if (s == "both") return ComplementRule::Both;
    return ComplementRule::SameCharge;
  }

  /// Applies -complement_tolerance in its unit: Da sets the absolute window,
  /// fragment sets the factor k of k*(fragment tol at m + at the partner).
  inline void setComplementTolerance(Param& p, double value, std::string_view unit)
  {
    if (unit == "fragment")
    {
      p.complement_tol_mode = ComplementTolMode::Fragment;
      p.complement_tol_factor = value;
    }
    else
    {
      p.complement_tol_mode = ComplementTolMode::Da;
      p.complement_tol = value;
    }
  }

  /// The Param the tool runs with when no option is given.
  ///
  /// The complement options (1.12 E2) are set to their registered defaults,
  /// which equal the library's: same-charge rule, 0.02 Da, no mid-p.
  /// With @p resolve_mods the default fixed modification is resolved through
  /// ModificationsDB exactly as the tool's resolveMods_ resolves a residue
  /// modification (I folded to L); without it `mods` stays empty, which is
  /// what the tool wants before it resolves -fixed_modifications and
  /// -variable_modifications itself (and what keeps a run with
  /// -fixed_modifications "" from parsing UniMod).
  inline Param cliDefaultParam(bool resolve_mods = true)
  {
    Param p;
    p.tag_length = kTagLength;
    p.max_extension = kExtension;
    p.max_gaps = kGaps;
    p.deisotope = kDeisotope;
    p.peaks_per_window = kPeaksPerWindow;
    p.frag_tol = kFragmentTolerance;
    p.tol_ppm = std::string_view(kFragmentToleranceUnit) == "ppm";
    p.max_peak_count = static_cast<size_t>(kMaxPeaks);
    p.max_tag_count = kMaxTags;
    p.diversity = false;
    p.per_residue_conf = false;
    p.max_evalue = kMaxEvalue;
    p.gap_penalty = kGapPenalty;
    p.complement_rule = complementRuleFromString(kComplementRule);
    setComplementTolerance(p, kComplementTolerance, kComplementToleranceUnit);
    p.complement_midp = kComplementMidp;
    if (resolve_mods)
    {
      const OpenMS::ResidueModification* mod =
          OpenMS::ModificationsDB::getInstance()->getModification(kFixedModifications);
      ModSpec ms;
      ms.residue = mod->getOrigin() == 'I' ? 'L' : mod->getOrigin();
      ms.delta = mod->getDiffMonoMass();
      ms.name = mod->getId();
      ms.variable = false;
      p.mods.push_back(ms);
    }
    return p;
  }

  /// The "parameter: <name>" entries FASTag 1.11 (78390cd) writes into the
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
  inline constexpr std::array<std::string_view, 77> kLegacyOutSpectraParameters = {
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

  /// True if @p name is one of kLegacyOutSpectraParameters.
  inline bool isLegacyOutSpectraParameter(std::string_view name)
  {
    for (std::string_view n : kLegacyOutSpectraParameters)
      if (n == name) return true;
    return false;
  }
}

namespace FASTag
{
  using Cli::cliDefaultParam;
}
