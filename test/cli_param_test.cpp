// src/CliParam.h: cliDefaultParam() is the Param the tool runs with at its
// defaults, and the frozen -out_spectra parameter list is well formed.
//
// With --print-legacy-out-spectra-parameters it prints that list, one name a
// line, for out_spectra_params_test.sh to compare with what the tool writes.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "CliParam.h"

#include <cmath>
#include <cstring>
#include <iostream>
#include <set>
#include <string>

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::strcmp(argv[1], "--print-legacy-out-spectra-parameters") == 0)
  {
    for (std::string_view n : FASTag::Cli::kLegacyOutSpectraParameters) std::cout << n << "\n";
    return 0;
  }

  const FASTag::Param lib;
  const FASTag::Param p = FASTag::cliDefaultParam();
  // The values the tool registers (FASTag.cpp registerOptions_), spelled out
  // here so a change to a default is a deliberate edit in two places.
  check(p.tag_length == 3, "tag_length 3");
  check(p.max_extension == 0, "extension 0");
  check(p.max_gaps == 1, "gaps 1 (the library default is 0)");
  check(p.deisotope, "deisotoping on (the library default is off)");
  check(p.peaks_per_window == 10, "peaks_per_window 10");
  check(p.frag_tol == 20.0 && p.tol_ppm, "fragment tolerance 20 ppm");
  check(p.max_peak_count == 400, "max_peaks 400");
  check(p.max_tag_count == 50, "max_tags 50");
  check(!p.diversity && !p.per_residue_conf, "diversity and res_conf off");
  check(p.max_evalue == 20.0, "max_evalue 20");
  check(p.gap_penalty == 100.0, "gap_penalty 100");
  check(p.complement_tol == lib.complement_tol, "complement_tol is the library's: the CLI never sets it");
  check(p.mods.size() == 1, "one default modification");
  if (p.mods.size() == 1)
  {
    const FASTag::ModSpec& m = p.mods.front();
    check(m.residue == 'C' && !m.variable && m.name == "Carbamidomethyl",
          "fixed Carbamidomethyl on C (" + m.name + ")");
    check(std::fabs(m.delta - 57.021464) < 1e-5, "Carbamidomethyl adds 57.021464 Da");
  }
  check(FASTag::cliDefaultParam(false).mods.empty(), "without resolving, no modifications");

  // The frozen list: 77 distinct names, the tool's own options first and
  // TOPPBase's six common ones last, as 1.11 writes them.
  const auto& names = FASTag::Cli::kLegacyOutSpectraParameters;
  std::set<std::string_view> distinct(names.begin(), names.end());
  check(names.size() == 77 && distinct.size() == 77, "77 distinct legacy -out_spectra parameters");
  check(names.front() == "in" && names[names.size() - 6] == "log" && names.back() == "test",
        "legacy list starts at -in and ends with the common options");
  check(FASTag::Cli::isLegacyOutSpectraParameter("species_evidence"), "species_evidence (1.10) is legacy");
  check(!FASTag::Cli::isLegacyOutSpectraParameter("acquisition_check"), "a 1.12 option is not legacy");

  if (failures == 0) std::cout << "cli_param_test: all checks passed\n";
  return failures ? 1 : 0;
}
