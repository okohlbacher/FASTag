// See SpeciesCall.h. RED stub: every function returns a neutral value until
// the implementation lands.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "SpeciesCall.h"

namespace FASTag::SpeciesCall
{
  bool loadParams(const std::string&, Params&, std::string*) { return false; }
  const char* callName(Call) { return ""; }
  double poissonUpperTail(uint64_t, double) { return 1.0; }
  double randomExpected(uint64_t, int, uint64_t) { return 0.0; }
  std::vector<double> qValues(const std::vector<double>& p, double) { return p; }
  double estimatePi0(const std::vector<double>&) { return 1.0; }
  std::vector<uint64_t> rollUpOverlap(const std::vector<uint64_t>&, std::size_t,
                                      const std::vector<int>&, std::size_t n_groups)
  { return std::vector<uint64_t>(n_groups * n_groups, 0); }
  std::vector<double> rollUpConditional(const std::vector<uint64_t>&, std::size_t,
                                        const std::vector<int>&, std::size_t n_groups)
  { return std::vector<double>(n_groups * n_groups, 0.0); }
  std::vector<GenusStat> callGenera(const std::vector<GenusInput>& genera, const std::vector<double>&,
                                    const RunInput&, const Params&)
  {
    std::vector<GenusStat> out(genera.size());
    for (std::size_t i = 0; i < genera.size(); ++i) out[i].taxid = genera[i].taxid;
    return out;
  }
}
