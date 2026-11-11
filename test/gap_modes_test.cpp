// Optional gap alphabets: isolated missing-cleavage evidence and extension.
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "FASTagger.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << '\n'; ++failures; }
}

static double mass(const std::string& peptide)
{
  return OpenMS::AASequence::fromString(peptide).getMonoWeight(OpenMS::Residue::Internal);
}

static FASTag::Param params(int length)
{
  FASTag::Param p;
  p.tag_length = length;
  p.max_gaps = 1;
  p.frag_tol = 0.0001;
  p.tol_ppm = false;
  p.max_evalue = 0;
  p.max_tag_count = 0;
  p.per_residue_conf = true;
  return p;
}

static OpenMS::MSSpectrum spectrum(std::initializer_list<double> steps)
{
  OpenMS::MSSpectrum s;
  double mz = 250.0;
  s.emplace_back(mz, 1000.0f);
  for (double step : steps) { mz += step; s.emplace_back(mz, 900.0f); }
  return s;
}

static std::vector<FASTag::Tag> tags(const OpenMS::MSSpectrum& s, const FASTag::Param& p)
{
  return FASTag::tagSpectrum(s, 1000.0, 2, p, FASTag::Tables(p));
}

static const FASTag::Tag* find(const std::vector<FASTag::Tag>& ts, const std::string& seq)
{
  const auto it = std::find_if(ts.begin(), ts.end(), [&](const auto& t) { return t.seq == seq; });
  return it == ts.end() ? nullptr : &*it;
}

static void checkMassAndScores(const std::vector<FASTag::Tag>& ts, const std::string& label)
{
  // The sequence's own theoretical mass must close the precursor, even when
  // several approximate isobars share the observed gap endpoints.
  const double residue_mass = 2000.0 - 2 * OpenMS::Constants::PROTON_MASS_U
                              - OpenMS::EmpiricalFormula("H2O").getMonoWeight();
  for (const auto& t : ts)
  {
    std::string seq = t.seq;
    std::replace(seq.begin(), seq.end(), '[', '(');
    std::replace(seq.begin(), seq.end(), ']', ')');
    check(std::fabs(t.nterm_mass + mass(seq) + t.cterm_mass - residue_mass) < 1e-7,
          label + ": own theoretical mass for " + t.seq);
    check(std::isfinite(t.evalue) && t.evalue > 0 &&
          std::isfinite(t.p_mzfidelity) && t.p_mzfidelity >= 0 && t.p_mzfidelity <= 1 &&
          std::isfinite(t.p_intensity) && t.p_intensity >= 0 && t.p_intensity <= 1,
          label + ": finite scores for " + t.seq);
    check(t.res_conf.size() == t.n_res, label + ": one confidence per residue");
  }
}

int main()
{
  // A variable modification is usable on ordinary edges already. The option
  // extends it to pairs; it does not silently enable an unconfigured mod.
  auto p = params(2);
  p.mods = {{'M', 15.994915, "Oxidation", true}};
  const auto modified = spectrum({mass("M(Oxidation)W")});
  check(!find(tags(modified, p), "M[Oxidation]W"), "modified pair absent by default");
  p.gap_variable_mods = true;
  const auto mt = tags(modified, p);
  check(find(mt, "M[Oxidation]W") && find(mt, "WM[Oxidation]"),
        "both modified-pair orders emitted");
  checkMassAndScores(mt, "modified pair");
  p.mods.clear();
  check(!find(tags(modified, p), "M[Oxidation]W"), "only configured variable mods admitted");
  p.mods = {{'M', 15.994915, "Oxidation", true}};
  check(!find(tags(spectrum({mass("M(Oxidation)M(Oxidation)")}), p),
              "M[Oxidation]M[Oxidation]"), "at most one variable mod in a pair");

  // An isolated three-residue span supplies two peaks. All six permutations
  // describe the same observation; enabling pairs alone cannot infer it.
  p = params(3);
  const auto triple = spectrum({mass("AFW")});
  check(tags(triple, p).empty(), "triplet absent by default");
  p.max_gap_residues = 3;
  const auto tt = tags(triple, p);
  std::string perm = "AFW";
  do { check(find(tt, perm), "triplet permutation " + perm); }
  while (std::next_permutation(perm.begin(), perm.end()));
  for (const auto& t : tt)
  {
    check(t.gapped && t.n_res == 3, "two peaks produce exactly three inferred residues");
    check(t.res_conf.size() == 3 && t.res_conf[0] == t.res_conf[1] && t.res_conf[1] == t.res_conf[2],
          "triplet shares one edge confidence across its three residues");
  }
  checkMassAndScores(tt, "triplet");
  const FASTag::Tables two_peak_tables(p);
  check(std::fabs(two_peak_tables.intensityP(2, 4, 3) - 1.0 / 6.0) < 1e-7,
        "two-peak intensity null counts one minimum-rank pair among six");
  // For two U[-1,1] errors SSE = (x-y)^2/2, hence P(SSE <= 0.5) = 0.75.
  // This checks the new k=2 null rather than merely accepting a finite k=3 fallback.
  check(std::fabs(two_peak_tables.mzFidelityP(2, 0.5) - 0.75) < 0.03,
        "two-peak Monte Carlo null matches its analytic distribution");
  p.max_gaps = 0;
  check(tags(triple, p).empty(), "gap count zero overrides triplet option");
  p.max_gaps = 1;
  p.tag_length = 2;
  const auto too_short = tags(triple, p);
  check(std::none_of(too_short.begin(), too_short.end(), [](const auto& t) { return t.n_res > 2; }),
        "triplet cannot exceed seed residue budget");
  p.tag_length = 4;
  check(tags(triple, p).empty(), "two peaks cannot fill a four-residue seed");

  // G+G is isobaric with N. Thus N+W and G+G+W share endpoints, but
  // their residue counts differ. Both must remain available for their length.
  const auto isobar = spectrum({mass("NW"), mass("A")});
  p = params(3);
  p.max_gap_residues = 3;
  const auto it = tags(isobar, p);
  check(find(it, "ANW") && find(it, "AWN"), "pair preserved alongside isobaric triplet");
  check(find(it, "GGW") && find(it, "GWG") && find(it, "WGG"),
        "triplet preserved alongside isobaric pair");
  checkMassAndScores(it, "different-length isobars");

  // K and Q are close, not exactly isobaric. Keeping both aliases must not
  // copy the best-fitting mass/flanks onto the other spelling.
  p = params(3);
  p.max_gap_residues = 3;
  p.frag_tol = 0.05;
  const auto approximate = tags(spectrum({mass("AFQ")}), p);
  check(find(approximate, "AFQ") && find(approximate, "AFK"),
        "distinct approximate triplet isobars admitted");
  checkMassAndScores(approximate, "approximate triplet isobars");

  // Triple inference does not absorb a neighbouring measured single step:
  // extension remains ordinary-edge-only and grows by the requested bound.
  p = params(3);
  p.max_gap_residues = 3;
  const auto extended_spectrum = spectrum({mass("AFW"), mass("R")});
  p.max_extension = 1;
  const auto et = tags(extended_spectrum, p);
  const auto* extension = find(et, "RAFW");
  check(extension && extension->extended && extension->gapped && extension->n_res == 4,
        "ordinary edge extends a triplet seed by one residue");
  checkMassAndScores(et, "extension");
  const auto two_gaps = tags(spectrum({mass("AFW"), mass("FW")}), p);
  const auto* no_extension = find(two_gaps, "AFW");
  check(no_extension && !no_extension->extended && no_extension->n_res == 3,
        "extension cannot cross another gap");

  // Reusing one graph for several lengths preserves both its residue budget
  // and its per-length null distribution, including the new two-peak case.
  const auto mixed_spectrum = spectrum({mass("AFW"), mass("R"), mass("E")});
  std::vector<FASTag::Param> ps{params(3), params(5)};
  std::vector<FASTag::Tables> tables;
  for (auto& q : ps) { q.max_gap_residues = 3; tables.emplace_back(q); }
  const auto together = FASTag::tagSpectrum(mixed_spectrum, 1000.0, 2, ps, tables);
  for (size_t k = 0; k < ps.size(); ++k)
  {
    const auto alone = tags(mixed_spectrum, ps[k]);
    bool same = together[k].size() == alone.size();
    for (size_t j = 0; same && j < alone.size(); ++j)
      same = together[k][j].seq == alone[j].seq && together[k][j].evalue == alone[j].evalue &&
             together[k][j].nterm_mass == alone[j].nterm_mass && together[k][j].n_res == alone[j].n_res;
    check(!alone.empty() && same, "single and multi-length triplet calls agree at L" + std::to_string(ps[k].tag_length));
  }

  // Complete ladders should not create redundant gap re-readings.
  p = params(3);
  p.max_gap_residues = 3;
  p.gap_variable_mods = true;
  const auto complete = tags(spectrum({mass("A"), mass("F"), mass("W")}), p);
  check(find(complete, "WFA"), "ordinary complete ladder still read");
  check(std::none_of(complete.begin(), complete.end(), [](const auto& t) { return t.gapped; }),
        "complete ladder has no artificial gaps");

  bool rejected = false;
  p.max_gap_residues = 4;
  try { FASTag::Tables invalid(p); } catch (const std::invalid_argument&) { rejected = true; }
  check(rejected, "unsupported gap span rejected at library boundary");
  if (!failures) std::cout << "gap modes: all checks passed\n";
  return failures ? 1 : 0;
}
