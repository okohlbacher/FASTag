// TagFDR: recreated from the recovered assertion set of the original
// (deleted-uncommitted) test, plus checks for the weighted-decoy extension.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "TagFDR.h"

#include <cmath>
#include <iostream>
#include <string>
#include <vector>

using namespace FASTag;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }
}

int main()
{
  // 100 targets at 0.001..0.100; decoys start at 0.05 -- the recovered
  // fixture shape.
  std::vector<double> targets, decoys;
  for (int i = 1; i <= 100; ++i) targets.push_back(i * 0.001);
  for (int i = 0; i < 20; ++i) decoys.push_back(0.05 + i * 0.0025);

  {
    TagFDR f(targets, decoys, 1.0);
    check(f.qOf(0.001) < 0.01, "well-separated best target has ~0 q");
    double prev = -1;
    bool mono = true;
    for (double e = 0.0005; e <= 0.12; e += 0.0005)
    {
      const double q = f.qOf(e);
      if (q < prev - 1e-12) mono = false;
      prev = q;
    }
    check(mono, "q-value is monotone non-decreasing in E-value");
  }

  {
    // Same distribution for targets and decoys: accepting anything is ~all
    // noise.
    TagFDR f(targets, targets, 1.0);
    check(f.qOf(0.1) > 0.9, "indistinguishable target/decoy gives q near 1");
  }

  {
    TagFDR a(targets, decoys, 0.5), b(targets, decoys, 2.0);
    bool never_lower = true;
    for (double e = 0.001; e <= 0.1; e += 0.001)
      if (b.qOf(e) < a.qOf(e) - 1e-12) never_lower = false;
    check(never_lower, "larger decoy scale never lowers q");
  }

  {
    TagFDR f(targets, std::vector<double>{}, 1.0);
    bool all_zero = true;
    for (double e = 0.001; e <= 0.1; e += 0.001)
      if (f.qOf(e) != 0.0) all_zero = false;
    check(all_zero, "no decoys -> q 0 for any target");
    check(f.qOf(0.2) == 0.0, "beyond the worst target, the acceptance set is "
                             "unchanged and so is its q");
  }

  {
    // Tie convention: a decoy sitting EXACTLY on a target threshold counts
    // (<=), and off-grid queries step to the last threshold at or below e.
    std::vector<double> t3 = {1.0, 2.0, 3.0};
    TagFDR f(t3, std::vector<double>{2.0}, 1.0);
    // FDRs 0 / 0.5 / 1/3 monotonize (right-to-left min) to 0 / 1/3 / 1/3; a
    // '<' convention would leave q(2) at 0, so 1/3 pins the '<=' contract.
    check(std::fabs(f.qOf(2.0) - 1.0 / 3.0) < 1e-12, "decoy at a threshold counts (<=)");
    check(std::fabs(f.qOf(2.5) - 1.0 / 3.0) < 1e-12, "off-grid q equals the last threshold at or below");
    check(std::fabs(f.qOf(0.5) - f.qOf(1.0)) < 1e-12, "below the best target: conservative continuation");
  }

  {
    TagFDR f(std::vector<double>{}, decoys, 1.0);
    check(f.qOf(0.01) == 1.0, "no targets -> q 1");
  }

  {
    // Weighted extension: two decoys at weight 3 must equal six at weight 1.
    std::vector<std::pair<double, double>> w = {{0.05, 3.0}, {0.06, 3.0}};
    std::vector<double> six = {0.05, 0.05, 0.05, 0.06, 0.06, 0.06};
    TagFDR a(targets, std::move(w)), b(targets, six, 1.0);
    bool same = true;
    for (double e = 0.001; e <= 0.1; e += 0.001)
      if (std::fabs(a.qOf(e) - b.qOf(e)) > 1e-12) same = false;
    check(same, "weighted decoys equal replicated unit-weight decoys");
  }

  if (failures == 0) std::cout << "tagfdr_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
