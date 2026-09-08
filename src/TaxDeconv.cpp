// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// See TaxDeconv.h for the model and its limits.

#include "TaxDeconv.h"

#include <algorithm>
#include <cmath>

namespace FASTag
{
  std::vector<double> conditionalMatrix(const std::vector<uint64_t>& overlap, std::size_t n)
  {
    std::vector<double> p(n * n, 0.0);
    if (n == 0 || overlap.size() < n * n) return p;
    for (std::size_t j = 0; j < n; ++j)
    {
      const double denom = static_cast<double>(overlap[j * n + j]);
      if (denom <= 0.0)
      {
        // No postings for j: it shares nothing with anyone, so its column is the
        // identity and its estimate reduces to its own observed count. Dividing
        // by zero here would poison the whole solve, not just this taxon.
        p[j * n + j] = 1.0;
        continue;
      }
      for (std::size_t i = 0; i < n; ++i)
        p[i * n + j] = static_cast<double>(overlap[i * n + j]) / denom;
    }
    return p;
  }

  std::vector<double> nnls(const std::vector<double>& A, const std::vector<double>& b,
                           std::size_t n, int max_iter, double tol)
  {
    std::vector<double> x(n, 0.0);
    if (n == 0 || A.size() < n * n || b.size() < n) return x;

    // Normal equations: G = A^T A (symmetric PSD), h = A^T b. Forming them costs
    // n^3/n^2 once and turns every sweep into an O(n) update; at n ~ 50 the whole
    // solve is microseconds.
    std::vector<double> g(n * n, 0.0), h(n, 0.0);
    for (std::size_t i = 0; i < n; ++i)
      for (std::size_t j = 0; j < n; ++j)
      {
        double s = 0.0;
        for (std::size_t r = 0; r < n; ++r) s += A[r * n + i] * A[r * n + j];
        g[i * n + j] = s;
      }
    for (std::size_t i = 0; i < n; ++i)
    {
      double s = 0.0;
      for (std::size_t r = 0; r < n; ++r) s += A[r * n + i] * b[r];
      h[i] = s;
    }

    // r = h - G x, maintained incrementally so a coordinate update is O(n)
    // rather than a fresh matrix-vector product.
    std::vector<double> r = h;
    for (int it = 0; it < max_iter; ++it)
    {
      double max_move = 0.0;
      for (std::size_t j = 0; j < n; ++j)
      {
        const double gjj = g[j * n + j];
        if (gjj <= 0.0) continue;                    // empty column: nothing to solve for
        const double want = x[j] + r[j] / gjj;
        const double next = want > 0.0 ? want : 0.0; // the projection onto x >= 0
        const double move = next - x[j];
        if (move == 0.0) continue;
        x[j] = next;
        for (std::size_t i = 0; i < n; ++i) r[i] -= g[i * n + j] * move;
        max_move = std::max(max_move, std::fabs(move));
      }
      // Scale-relative, not absolute: counts here run to thousands, so a fixed
      // 1e-9 on the coordinate move is ~1e-13 relative and the loop only ever
      // stops at max_iter. Measuring the move against the largest estimate makes
      // the tolerance mean the same thing whatever the run size.
      double scale = 1.0;
      for (std::size_t j = 0; j < n; ++j) scale = std::max(scale, std::fabs(x[j]));
      if (max_move <= tol * scale) break;
    }
    return x;
  }

  std::vector<double> deconvolve(const std::vector<uint64_t>& overlap,
                                 const std::vector<double>& observed, std::size_t n)
  {
    if (n == 0 || observed.size() < n || overlap.size() < n * n) return observed;
    const std::vector<double> p = conditionalMatrix(overlap, n);

    // A degenerate matrix means the overlap scan produced nothing usable (an
    // empty or corrupt index). Returning the raw counts keeps the report honest
    // instead of replacing it with zeros.
    double diag = 0.0;
    for (std::size_t i = 0; i < n; ++i) diag += p[i * n + i];
    if (!(diag > 0.0)) return observed;

    return nnls(p, observed, n);
  }
}
