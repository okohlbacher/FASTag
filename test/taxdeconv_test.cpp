// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// taxdeconv_test.cpp -- self-contained self-test for FASTag::TaxDeconv.
//
// The case that matters is the last one: a taxon whose entire observed count is
// explained by sharing k-mers with a stronger relative must deconvolve to ~0,
// while the relative keeps its count. That is the Homo/Macaca failure the
// species detector documents, reduced to numbers that can be checked by hand.
//
// No test framework. Prints "taxdeconv_test: all checks passed" and returns 0.

#include "TaxDeconv.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace
{
  int failures = 0;

  void check(bool ok, const char* what)
  {
    if (!ok) { std::printf("FAIL: %s\n", what); ++failures; }
  }

  void close(double got, double want, double eps, const char* what)
  {
    if (std::fabs(got - want) > eps)
    {
      std::printf("FAIL: %s (got %.6f, want %.6f)\n", what, got, want);
      ++failures;
    }
  }
}

int main()
{
  using namespace FASTag;

  // ---- conditionalMatrix -------------------------------------------------
  {
    // Two taxa, 1000 k-mers each, 900 shared.
    const std::vector<uint64_t> ov = {1000, 900,
                                      900, 1000};
    const auto p = conditionalMatrix(ov, 2);
    close(p[0], 1.0, 1e-12, "P[0][0] is 1");
    close(p[3], 1.0, 1e-12, "P[1][1] is 1");
    close(p[1], 0.9, 1e-12, "P[0][1] = shared/|kmers(1)|");
    close(p[2], 0.9, 1e-12, "P[1][0] = shared/|kmers(0)|");
    std::printf("1. conditionalMatrix: unit diagonal, column-normalised\n");
  }
  {
    // Asymmetric sizes must give an ASYMMETRIC P: a small taxon inside a large
    // one is fully explained by it, but not the other way round.
    const std::vector<uint64_t> ov = {1000, 100,
                                      100, 100};
    const auto p = conditionalMatrix(ov, 2);
    close(p[1], 1.0, 1e-12, "all of the small taxon's k-mers are in the large one");
    close(p[2], 0.1, 1e-12, "only a tenth of the large taxon's are in the small one");
    std::printf("2. conditionalMatrix: asymmetric, as the model requires\n");
  }
  {
    // A taxon with no postings must not divide by zero.
    const std::vector<uint64_t> ov = {10, 0,
                                      0, 0};
    const auto p = conditionalMatrix(ov, 2);
    close(p[3], 1.0, 1e-12, "empty taxon gets a unit column");
    check(std::isfinite(p[1]) && std::isfinite(p[2]), "no NaN or inf from an empty taxon");
    std::printf("3. conditionalMatrix: empty taxon does not poison the matrix\n");
  }

  // ---- nnls ---------------------------------------------------------------
  {
    // Identity system: the solution is the right-hand side.
    const std::vector<double> a = {1, 0,
                                   0, 1};
    const std::vector<double> b = {3, 7};
    const auto x = nnls(a, b, 2);
    close(x[0], 3.0, 1e-9, "identity system recovers b[0]");
    close(x[1], 7.0, 1e-9, "identity system recovers b[1]");
    std::printf("4. nnls: identity system\n");
  }
  {
    // The unconstrained least-squares answer here is negative in x[1]; the
    // constraint must clamp it to zero rather than returning it.
    const std::vector<double> a = {1.0, 0.9,
                                   0.9, 1.0};
    const std::vector<double> b = {1.0, 0.0};
    const auto x = nnls(a, b, 2);
    check(x[0] > 0.0, "the supported coordinate stays positive");
    close(x[1], 0.0, 1e-9, "the negative coordinate is clamped to zero");
    std::printf("5. nnls: non-negativity actually binds\n");
  }

  // ---- deconvolve: the Homo/Macaca case ----------------------------------
  {
    // Two genera sharing 90% of their k-mers. Only taxon 0 is genuinely
    // present, with 100 spectra. Taxon 1 is observed 90 times purely by
    // resemblance -- exactly what "Macaca lands within a few percent of Homo"
    // means. E = P N with N = (100, 0).
    const std::vector<uint64_t> ov = {1000, 900,
                                      900, 1000};
    const std::vector<double> observed = {100.0, 90.0};
    const auto n = deconvolve(ov, observed, 2);
    close(n[0], 100.0, 1e-3, "the present taxon keeps its count");
    close(n[1], 0.0, 1e-3, "the near neighbour deconvolves to zero");
    check(n[0] > n[1] * 100.0, "the ranking gap is now decisive, not a few percent");
    std::printf("6. deconvolve: a taxon explained entirely by a relative goes to ~0\n");
  }
  {
    // ...and a genuinely present second taxon must SURVIVE. Same pair plus a
    // third, distinct genus sharing only 5%. True N = (100, 0, 40).
    const std::vector<uint64_t> ov = {1000, 900,  50,
                                      900, 1000,  50,
                                       50,   50, 1000};
    const std::vector<double> p = conditionalMatrix(ov, 3);
    const std::vector<double> truth = {100.0, 0.0, 40.0};
    std::vector<double> observed(3, 0.0);
    for (std::size_t i = 0; i < 3; ++i)
      for (std::size_t j = 0; j < 3; ++j) observed[i] += p[i * 3 + j] * truth[j];

    const auto n = deconvolve(ov, observed, 3);
    close(n[0], 100.0, 1e-3, "present taxon 0 recovered");
    close(n[1], 0.0, 1e-3, "absent near neighbour removed");
    close(n[2], 40.0, 1e-3, "present but weaker taxon 2 SURVIVES");
    std::printf("7. deconvolve: real low-abundance signal is not swallowed\n");
  }
  {
    // Every estimate must be >= 0: a count cannot be negative, and a solver that
    // returned one would produce a nonsense report rather than an error.
    const std::vector<uint64_t> ov = {100, 95,
                                      95, 100};
    const std::vector<double> observed = {5.0, 100.0};  // deliberately lopsided
    const auto n = deconvolve(ov, observed, 2);
    check(n[0] >= 0.0 && n[1] >= 0.0, "no negative estimates");
    std::printf("8. deconvolve: non-negative on adversarial input\n");
  }
  {
    // A degenerate matrix must return the observed counts untouched, so a broken
    // index costs accuracy and not correctness.
    const std::vector<uint64_t> ov = {0, 0, 0, 0};
    const std::vector<double> observed = {7.0, 3.0};
    const auto n = deconvolve(ov, observed, 2);
    close(n[0], 7.0, 1e-12, "degenerate overlap passes observed through");
    close(n[1], 3.0, 1e-12, "degenerate overlap passes observed through");
    const auto empty = deconvolve({}, {}, 0);
    check(empty.empty(), "n = 0 is handled");
    std::printf("9. deconvolve: degenerate input falls back to observed\n");
  }

  if (failures != 0)
  {
    std::printf("taxdeconv_test: %d check(s) FAILED\n", failures);
    return 1;
  }
  std::printf("taxdeconv_test: all checks passed\n");
  return 0;
}
