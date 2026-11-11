// Frozen TMT gate, endpoint rules, and cap refill with unchanged scores.
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "TmtPseudoFilter.h"
#include "RunMeta.h"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace TP = FASTag::TmtPseudo;
using FASTag::Tag;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
Tag tag(std::string seq, double n, double c)
{
  Tag t; t.seq = std::move(seq); t.nterm_mass = n; t.cterm_mass = c; t.evalue = 0.01; t.charge = 1; return t;
}
int main()
{
  FASTag::Param p;
  const Tag pseudo_g = tag("GPEP", TP::kLabel - TP::kG, 300);
  require(!TP::Filter(p).rejects(pseudo_g), "default must not filter");
  p.tmt_pseudo_filter = true;
  require(TP::Filter(p).rejects(pseudo_g), "G pseudo-prefix not filtered");
  require(TP::Filter(p).rejects(tag("APEP", TP::kLabel - TP::kA, 300)), "A pseudo-prefix not filtered");
  require(TP::Filter(p).rejects(tag("PEPG", 300, TP::kLabel - TP::kWater - TP::kG)), "G pseudo-suffix not filtered");
  require(TP::Filter(p).rejects(tag("PEPA", 300, TP::kLabel - TP::kWater - TP::kA)), "A pseudo-suffix not filtered");
  require(!TP::Filter(p).rejects(tag("PEPK", 300, TP::kLabel)), "terminal K with TMT mass in its flank rejected");
  // PXD037999 scan 15823: a sequence-correct rank-1 tag from
  // [TMT]-HSEVETDSK[TMT], lost by the former bare-K rejection.
  require(!TP::Filter(p).rejects(tag("TDSK", 810.4038, 229.1644)), "real terminal K regression rejected");
  require(!TP::Filter(p).rejects(tag("KPEP", TP::kLabel, 300)), "N-terminal K rejected");
  require(!TP::Filter(p).rejects(tag("GPEP", TP::kLabel, 300)), "real G prefix filtered without flank match");
  require(!TP::Filter(p).rejects(tag("FPEP", TP::kLabel - TP::kG, 300)), "flank alone caused rejection");
  require(!TP::Filter(p).rejects(tag("G[Label]PEP", TP::kLabel - TP::kG, 300)), "modified G rejected as bare G");
  require(!TP::Filter(p).rejects(tag("PEPK[Label]", 300, TP::kLabel)), "inline-modified terminal K rejected");
  p.mods.push_back({'K', TP::kLabel, "TMT6plex", false});
  require(!TP::Filter(p).rejects(tag("PEPK", 300, TP::kLabel)), "fixed TMT terminal K rejected");
  p.mods.push_back({'G', 1., "test", false});
  require(!TP::Filter(p).rejects(pseudo_g), "fixed modified G rejected as bare G");
  p.mods.clear();
  Tag cz = pseudo_g; cz.ion_series = FASTag::IonSeries::Series::CZ;
  require(!TP::Filter(p).rejects(cz), "c/z tag filtered using b/y formula");
  Tag reporter = tag("PEPF", 300, TP::kReporters[0] - TP::kWater - TP::kProton);
  require(!TP::Filter(p).rejects(reporter), "reporter filter ran without flag");
  p.tmt_reporter_filter = true;
  require(TP::Filter(p).rejects(reporter), "reporter endpoint not filtered");
  reporter.charge = 2;
  require(!TP::Filter(p).rejects(reporter), "reporter formula applied at wrong charge");

  const auto ordinary = tag("PEPF", 500, 600);
  const auto tmt = tag("PEPF", TP::kLabel, TP::kK + TP::kLabel);
  const auto pro = tag("PEPF", TP::kProLabel, TP::kK + TP::kProLabel);
  TP::ProbeCounts counts;
  for (int i = 0; i < 99; ++i) counts.add({tmt, tmt});
  require(counts.eligible == 99 && counts.tmt_n == 99, "counted tags instead of spectra");
  require(!counts.detected(true), "gate ignored minimum eligible spectra");
  counts.add({tmt});
  require(counts.detected(true), "TMT two-site evidence not detected");
  require(!counts.detected(false), "Da-tolerance probe enabled filter");
  TP::ProbeCounts negative, pro_only, mixed, edge;
  for (int i = 0; i < 100; ++i)
  {
    negative.add({ordinary}); pro_only.add({pro}); mixed.add({tmt, pro});
    edge.add({i < 19 ? tmt : ordinary});
  }
  require(!negative.detected(true), "label-free probe falsely detected TMT");
  require(!pro_only.detected(true) && !mixed.detected(true), "TMTpro safeguard failed");
  require(!edge.detected(true), "gate accepted 19 supporting spectra");
  edge.add({tmt}); require(edge.detected(true), "gate rejected 20 supporting spectra");

  // Conflicting 304-Da evidence has a lower, separate two-site threshold.
  // The 1001-spectra case also checks that the 1% requirement rounds up.
  for (const auto [eligible, veto] : {std::pair<std::size_t, std::size_t>{100, 5}, {1000, 10}, {1001, 11}})
  {
    TP::ProbeCounts boundary;
    boundary.eligible = eligible;
    boundary.tmt_n = boundary.tmt_k = 20;
    require(boundary.threshold() == 20 && boundary.vetoThreshold() == veto, "positive/veto thresholds changed");
    boundary.pro_n = boundary.pro_k = veto - 1;
    require(boundary.detected(true), "subthreshold 304-Da evidence vetoed TMT");
    boundary.pro_n = veto;
    require(boundary.detected(true), "N-site-only 304-Da evidence vetoed TMT");
    boundary.pro_k = veto;
    require(!boundary.detected(true), "two-site 304-Da evidence did not veto TMT");
    require(boundary.reason(true) == "conflicting_304Da_label_evidence", "veto incorrectly identifies a label chemistry");
    boundary.pro_n = veto - 1;
    require(boundary.detected(true), "K-site-only 304-Da evidence vetoed TMT");
  }
  require(counts.summary().find("veto_min=5") != std::string::npos, "veto threshold missing from diagnostics");

  // Two overlapping 4-residue paths share one spectrum. The stronger GPEP
  // starts inside the TMT mass; the weaker PEPQ starts at intact TMT.
  OpenMS::MSSpectrum spectrum;
  constexpr double massP = 97.052763875, massE = 129.042593135, massQ = 128.05857754;
  double mz = 300.0 - massQ + TP::kWater + TP::kProton;
  spectrum.emplace_back(mz, 1.0f);
  for (double mass : {massQ, massP, massE, massP, TP::kG})
  { mz += mass; spectrum.emplace_back(mz, 100.0f); }
  const double precursor = (TP::kLabel + 2 * massP + massE + 300.0 + TP::kWater + 2 * TP::kProton) / 2;
  p = FASTag::Param(); p.tag_length = 4; p.max_tag_count = 0; p.max_evalue = 0;
  const FASTag::Tables tables(p);
  const auto all = FASTag::tagSpectrum(spectrum, precursor, 2, p, tables);
  require(!all.empty() && all.front().seq == "GPEP", "synthetic rank-1 artifact fixture failed");
  const auto correct = std::find_if(all.begin(), all.end(), [](const Tag& t) { return t.seq == "PEPQ"; });
  require(correct != all.end(), "synthetic correct competing tag missing");
  p.max_tag_count = 1;
  const auto baseline = FASTag::tagSpectrum(spectrum, precursor, 2, p, tables);
  require(baseline.size() == 1 && baseline.front().seq == "GPEP", "baseline cap fixture failed");
  p.tmt_pseudo_filter = true;
  const auto filtered = FASTag::tagSpectrum(spectrum, precursor, 2, p, tables);
  require(filtered.size() == 1 && filtered.front().seq == "PEPQ", "filter did not refill cap with correct tag");
  require(filtered.front().evalue == correct->evalue, "filter altered surviving score or multiplicity");
  FASTag::RunReport::RunMeta meta; meta.tmt_filter_mode = "auto"; meta.tmt_filter_resolved = "on; test";
  const auto report = FASTag::RunReport::runRows(meta, FASTag::RunReport::Emit::Versioned);
  require(std::any_of(report.begin(), report.end(), [](const auto& r) { return r.key == "tmt_pseudo_filter_resolved"; }), "resolved gate missing from provenance");
  std::cout << "tmt_pseudo_test: all checks passed\n";
}
