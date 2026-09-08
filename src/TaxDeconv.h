// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// TaxDeconv.h -- subtract the evidence a taxon only earns by resembling another.
//
// THE PROBLEM. Counting tags per taxon cannot separate near neighbours. On a
// human run Macaca, Bos and Sus land within a few percent of Homo; on a
// Pectobacterium run Escherichia, Salmonella and Yersinia rank high. They are
// not present -- they score because mammalian proteomes share most 7-mers, and
// conserved bacterial proteins share them across Enterobacterales. No per-node
// significance test fixes this: the counts really are there, they are just not
// independent evidence.
//
// THE MODEL. Let N_j be the number of spectra genuinely contributed by taxon j
// and E_i the number observed for taxon i. A spectrum contributed by j is also
// counted for i whenever the tag's k-mers happen to live in i as well, which
// happens with probability
//
//     P[i][j] = P(k-mer in taxon i | k-mer in taxon j) = |kmers(i) & kmers(j)|
//                                                        -------------------
//                                                          |kmers(j)|
//
// so E = P N, and the quantity actually wanted is N = P^-1 E, constrained to be
// non-negative because a count cannot be. Homo's column then explains most of
// Macaca's observed count and Macaca's own estimate collapses, which is the
// point.
//
// This follows MARLOWE (Sci Rep 2026, s41598-026-50102-3), which introduced it
// for de novo tags -- the same input class FASTag has, not identified peptides.
// Two deliberate differences: MARLOWE builds P over ~5,851 near-duplicate KEGG
// genomes and never discusses conditioning, whereas FASTag's reference is ~50
// one-per-genus proteomes, which is the well-conditioned regime; and MARLOWE
// leaves the solver unstated, so the choice below is ours.
//
// WHAT IT IS NOT. The estimate is only as good as the reference. Overlap
// measured against 50 proteomes OVERSTATES specificity -- a k-mer looks unique
// because there are only 50 genomes available to contradict it -- so N is a
// correction, not a calibrated abundance. An absent taxon still presents as its
// nearest represented relative; deconvolution cannot invent a column for a
// genome that is not in the index.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace FASTag
{
  /// Column-conditional matrix from a pairwise overlap matrix (row-major, n x n).
  ///
  /// P[i][j] = overlap(i,j) / overlap(j,j), so every column j sums the chance
  /// that a k-mer of j is also seen in i, and P[j][j] == 1. A taxon with no
  /// postings gets a unit column, which leaves it estimated from its own count
  /// alone rather than dividing by zero.
  std::vector<double> conditionalMatrix(const std::vector<uint64_t>& overlap, std::size_t n);

  /// Non-negative least squares: minimise ||A x - b||^2 subject to x >= 0.
  ///
  /// Projected coordinate descent on the normal equations, which for a system
  /// this small is exact enough and, unlike an active-set method, cannot cycle.
  /// Deterministic: same inputs, same output, no RNG and no threading.
  /// @p max_iter bounds the sweeps; convergence is declared when no coordinate
  /// moves by more than @p tol.
  /// @p tol is RELATIVE to the largest estimate, so it means the same thing on a
  /// run of 100 spectra and one of 100,000.
  std::vector<double> nnls(const std::vector<double>& A, const std::vector<double>& b,
                           std::size_t n, int max_iter = 2000, double tol = 1e-12);

  /// observed -> deconvolved counts, both indexed like the overlap matrix.
  ///
  /// Returns @p observed unchanged when n is 0 or the matrix is degenerate, so a
  /// caller can always use the result and a broken index costs accuracy rather
  /// than correctness.
  std::vector<double> deconvolve(const std::vector<uint64_t>& overlap,
                                 const std::vector<double>& observed, std::size_t n);
}
