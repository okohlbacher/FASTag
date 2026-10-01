// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "FASTagger.h"
#include "AveragineDeisotoper.h"
#include "PeakGrid.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>

#include <boost/math/distributions/hypergeometric.hpp>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <numeric>
#include <map>
#include <set>
#include <tuple>
#include <random>
#include <utility>

using namespace OpenMS;

namespace FASTag
{
  /// Peak ceiling used when max_peak_count is 0. Tables and prepare() must agree:
  /// intensityP() returns 1.0 above the table extent, silently disabling the
  /// intensity subscore rather than erroring.
  static constexpr size_t PEAK_CEILING = 1024;

  /// Width of the selection window in Da. Fixed rather than exposed: it only
  /// sets the granularity at which the quota is applied, and the quota itself is
  /// the knob worth turning.
  static constexpr double PEAK_WINDOW_MZ = 100.0;

  /// Cap on spellings emitted for one gap. At the tolerances this tool is used
  /// at the real count is 1 composition x 2 orders; the cap only stops a
  /// pathologically wide tolerance from turning one path into hundreds of rows.
  static constexpr int MAX_GAP_SPELLINGS = 8;

  /// Peaks above precursor mass + proton + this (Da) are dropped.
  static constexpr double PRECURSOR_TOL = 1.5;

  /// Highest fragment charge the deisotoper tries.
  static constexpr int DEISOTOPE_MAX_CHARGE = 3;

  /// The m/z-fidelity null is Monte Carlo: this many samples per peak count,
  /// from a fixed seed so every run scores identically.
  static constexpr unsigned MZ_NULL_SEED = 20080717u;
  static constexpr int MZ_NULL_SAMPLES = 10000;

  // There is deliberately no minimum-flank rule for gaps (ordinary residues
  // required on both sides of one). Against SAGE ground truth at tag_length 6,
  // spectra gaining a correctly placed tag fell monotonically with the flank
  // required -- +44.7% with none, +27.1% with 1, +13.7% with 2 -- at no better
  // rescue-to-loss ratio. The contiguous tags an unconstrained gap evicts
  // through the per-spectrum cap are near-noise (~0.6% accurate, against 6.2%
  // for the gapped ones replacing them).
  //
  // The constraint that matters already exists: a gap spends 2 of tag_length's
  // residue budget, so a longer tag necessarily observes more of what it spells.
  // A short tag_length with gaps gives a high inferred fraction; that is the
  // caller's trade.

  /// The residue and pair tables the graph walks, built once per run from the
  /// active modifications. Held by Tables and passed read-only into the tagger.
  ///
  /// With no modifications this is the canonical "Natural19WithoutI" set (I
  /// and L are isobaric, so a spectrum cannot tell them apart and enumerating
  /// both would only double the output), mass-sorted so the DFS emits
  /// deterministically. Fixed mods shift a residue's mass;
  /// variable mods append a modified alternative.
  struct Alphabet
  {
    struct Res { char base; double mass; std::string mod; };  ///< mod "" = unmodified
    struct Pair { double mass; uint8_t a, b; };

    std::vector<Res>  res;    ///< base residues first (mass-sorted), variables after
    std::vector<Pair> pairs;  ///< two-residue sums over the BASE residues only
    uint8_t           n_base = 0;

    explicit Alphabet(const std::vector<ModSpec>& mods)
    {
      // Base residues, with fixed-mod mass shifts folded in.
      for (const Residue* r : ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
      {
        char c = r->getOneLetterCode()[0];
        double m = r->getMonoWeight(Residue::Internal);
        for (const ModSpec& mod : mods)
          if (!mod.variable && mod.residue == c) m += mod.delta;
        res.push_back({c, m, ""});
      }
      // Mass-sorted keeps the graph edges ordered (deterministic emission).
      std::sort(res.begin(), res.end(), [](const Res& a, const Res& b) { return a.mass < b.mass; });
      n_base = static_cast<uint8_t>(res.size());

      // Pairs over the base residues only. Gaps already assert a lot; letting a
      // variable-modified residue also be an unobserved gap member would multiply
      // that uncertainty for little gain, so modified residues take ordinary
      // edges only. 190 pairs over 19 residues; three-residue sums are omitted
      // for the same reason DirecTag omits them (they match a random difference
      // 40-60% of the time, asserting almost nothing).
      for (uint8_t i = 0; i < n_base; ++i)
        for (uint8_t j = i; j < n_base; ++j)
          pairs.push_back({res[i].mass + res[j].mass, i, j});
      std::sort(pairs.begin(), pairs.end(), [](const Pair& x, const Pair& y) { return x.mass < y.mass; });

      // Variable mods: one appended entry per (mod, matching base residue),
      // carrying base_mass + delta and the mod name for inline annotation.
      // Appended after the base set so pair indices (which reference base
      // residues) stay valid. Deterministic order: input mod order, then residue.
      for (const ModSpec& mod : mods)
      {
        if (!mod.variable) continue;
        for (uint8_t i = 0; i < n_base; ++i)
          if (res[i].base == mod.residue)
            res.push_back({mod.residue, res[i].mass + mod.delta, mod.name});
      }
    }
  };

  namespace
  {
    /// One traversal step: an ordinary edge carries one residue, a gap edge
    /// carries a two-residue sum whose split is not observed.
    struct Step
    {
      uint16_t pair = 0;   ///< index into Alphabet::pairs when gap
      uint8_t  res = 0;    ///< index into Alphabet::res otherwise
      bool     gap = false;
      bool     swap = false;  ///< gap only: which arrangement of the pair to spell
    };

    inline double stepMass(const Alphabet& A, const Step& st)
    {
      return st.gap ? A.pairs[st.pair].mass : A.res[st.res].mass;
    }

    inline int stepResidues(const Step& st) { return st.gap ? 2 : 1; }

    /// Append one residue's spelling: base letter, plus [ModName] if modified.
    inline void spellRes(std::string& out, const Alphabet::Res& r)
    {
      out.push_back(r.base);
      if (!r.mod.empty()) { out.push_back('['); out.append(r.mod); out.push_back(']'); }
    }

    /// Spell a path N->C.
    ///
    /// Traversal runs low->high m/z, which is C->N under the y assumption, so the
    /// path is walked backwards. That reversal is real and matters for ordinary
    /// steps. A gap's two residues are never observed separately, so they have no
    /// order to preserve -- emit() spells both arrangements instead of guessing.
    /// Gap members are base residues (pairs are built over base residues only),
    /// so they never carry a bracket.
    std::string spell(const Alphabet& A, const std::vector<Step>& path)
    {
      std::string out;
      for (int i = static_cast<int>(path.size()) - 1; i >= 0; --i)
      {
        const Step& st = path[static_cast<size_t>(i)];
        if (!st.gap) { spellRes(out, A.res[st.res]); continue; }
        const auto& pe = A.pairs[st.pair];
        out.push_back(A.res[st.swap ? pe.a : pe.b].base);
        out.push_back(A.res[st.swap ? pe.b : pe.a].base);
      }
      return out;
    }

    const double WATER = EmpiricalFormula("H2O").getMonoWeight();
    const double PROTON = Constants::PROTON_MASS_U;

    inline double tolAt(const Param& p, double mz)
    {
      return p.tol_ppm ? mz * p.frag_tol * 1e-6 : p.frag_tol;
    }

    /// Combine independent-ish p-values by Fisher's method.
    ///
    /// The three subscores are computed from the same peaks and are therefore not
    /// independent, so the chi-square tail is optimistic. That is inherited from
    /// DirecTag and is why the result is reported as an E-value for ranking rather
    /// than as a calibrated probability.
    ///
    /// The tail is closed-form: for 2k degrees of freedom, integer k, it is
    /// exp(-t) * sum_{i<k} t^i / i! with t = x/2 -- the finite sum Boost's
    /// gamma_q itself evaluates for integer shape once t >= k-1, in the same
    /// operation order, but in double rather than Boost's long double (~25x
    /// slower on x86-64). It differs by at most 4.4e-16 relative, below the
    /// printed precision. exp(-t) underflows only for a p-value product below
    /// ~1e-323, far under what the subscores' floors allow.
    double fisher(double p1, double p2, double p3, int k)
    {
      auto safe = [](double v) { return std::log(std::max(v, 1e-300)); };
      const double x = -2.0 * (safe(p1) + safe(p2) + (k == 3 ? safe(p3) : 0.0));
      if (x <= 0) return 1.0;
      const double t = x / 2;
      double term = std::exp(-t), sum = term;
      for (int i = 1; i < k; ++i) { term /= i; term *= t; sum += term; }
      return std::min(sum, 1.0);
    }
  }

  // ---------------------------------------------------------------- Tables

  // A gap spends one fewer peak than it spells residues, so the realised peak
  // count runs from tag_length + 1 - max_gaps upward. The tables must start
  // there: intensityP() returns 1.0 outside its range and mzFidelityP() clamps
  // to the nearest built k, so a gapped tag below the table would silently lose
  // one subscore and read the wrong null for another.
  Tables::Tables(const Param& p)
    : k_min_(std::max(2, p.tag_length + 1 - std::max(0, p.max_gaps))),
      k_max_(std::max(2, p.tag_length + 1 + 2 * std::max(0, p.max_extension))),
      n_max_(p.max_peak_count > 0 ? p.max_peak_count : PEAK_CEILING),
      alpha_(std::make_shared<const Alphabet>(p.mods))
  {
    ranksum_.resize(static_cast<size_t>(k_max_ - k_min_ + 1));
    for (int k = k_min_; k <= k_max_; ++k)
      ranksum_[static_cast<size_t>(k - k_min_)] = ranksumCdfs(k, static_cast<int>(n_max_));

    // The m/z-fidelity null has no closed form: it is the distribution of the
    // sum of squared deviations of k uniform errors about their own mean.
    // Sampled, with an explicit seed -- DirecTag leaves this unseeded, so two of
    // its runs disagree with each other.
    //
    // Sampled in UNITS OF THE TOLERANCE, on [-1, 1], and the observed SSE is
    // divided by tol^2 before lookup, so one null is valid at every m/z and in
    // both tolerance units. (Sampling on [-frag_tol, frag_tol] would, in ppm,
    // span +-20 Da against observed deviations of ~1e-4 Da, pinning every tag
    // to the null's floor.)
    mz_null_.resize(static_cast<size_t>(k_max_ - k_min_ + 1));
    for (int k = k_min_; k <= k_max_; ++k)
    {
      std::mt19937 rng(MZ_NULL_SEED + static_cast<unsigned>(k) * 2654435761u);
      std::uniform_real_distribution<double> err(-1.0, 1.0);
      auto& v = mz_null_[static_cast<size_t>(k - k_min_)];
      v.reserve(static_cast<size_t>(MZ_NULL_SAMPLES));
      std::vector<double> e(static_cast<size_t>(k));
      for (int s = 0; s < MZ_NULL_SAMPLES; ++s)
      {
        double mean = 0;
        for (int i = 0; i < k; ++i) { e[i] = err(rng); mean += e[i]; }
        mean /= k;
        double sse = 0;
        for (int i = 0; i < k; ++i) { const double d = e[i] - mean; sse += d * d; }
        v.push_back(sse);
      }
      std::sort(v.begin(), v.end());
    }
  }

  double Tables::intensityP(int tag_peaks, int npeaks, int ranksum) const
  {
    if (tag_peaks < k_min_ || tag_peaks > k_max_) return 1.0;
    if (npeaks < 0 || static_cast<size_t>(npeaks) > n_max_) return 1.0;
    const auto& c = ranksum_[static_cast<size_t>(tag_peaks - k_min_)][static_cast<size_t>(npeaks)];
    if (c.empty()) return 1.0;
    if (ranksum < 0) return 0.0;
    if (static_cast<size_t>(ranksum) >= c.size()) return 1.0;
    return c[static_cast<size_t>(ranksum)];
  }

  double Tables::mzFidelityP(int tag_peaks, double sse) const
  {
    const int k = std::min(std::max(tag_peaks, k_min_), k_max_);
    const auto& v = mz_null_[static_cast<size_t>(k - k_min_)];
    if (!std::isfinite(sse)) return 1.0;   // a non-finite SSE is not evidence
    // upper_bound, not lower_bound: the claim is P(SSE <= observed), and
    // lower_bound counts only the samples strictly below it.
    const size_t r = static_cast<size_t>(std::upper_bound(v.begin(), v.end(), sse) - v.begin());
    return std::max(1.0 / v.size(), static_cast<double>(r) / v.size());
  }

  // ------------------------------------------------------------- internals

  namespace
  {
    /// Preprocessed spectrum: peaks sorted by m/z with intensity ranks and
    /// per-charge complement flags.
    struct Prepared
    {
      MSSpectrum spec;                 ///< filtered, m/z sorted
      std::vector<int> rank;           ///< 1 = most intense
      std::vector<uint8_t> has_compl;  ///< bit z-1 set if a complement exists at charge z
      double precursor_mass = 0;
      int n_frag_charges = 1;
      std::vector<int> n_with_compl;   ///< indexed by fragment charge
      /// Nearest-peak index over spec, for complements and buildGraph. Points at
      /// prepare()'s per-thread grid, so valid until the next prepare() on this
      /// thread -- tagSpectrum holds one Prepared at a time.
      const PeakGrid* grid = nullptr;
    };

    Prepared prepare(const MSSpectrum& in, double precursor_mz, int charge, const Param& p)
    {
      Prepared s;
      s.precursor_mass = precursor_mz * charge - charge * PROTON;
      // +2 fragments are only sought from precursors of charge >= 3, as the paper
      // specifies.
      // Capped at 8: has_compl is a uint8_t bitmask, so bit z-1 for z > 8 is
      // silently lost, and 1u << (z-1) is undefined well before that. Fragment
      // charges above 8 are not a real regime for peptide MS/MS, so bound it
      // rather than widen the mask.
      s.n_frag_charges = std::min(8, std::max(1, charge - 1));

      // Drop everything above the precursor, then keep the n most intense.
      //
      // NOT OpenMS::NLargest, deliberately: it sorts by intensity with an
      // unstable sort and no secondary key. Peaks carry integer detector
      // counts, so ties at the cut are common (23% of timsTOF spectra at 100
      // peaks), and which one survives would depend on the standard library.
      // The total order below (intensity desc, m/z desc) makes it reproducible.
      MSSpectrum work;
      work.reserve(in.size());
      const double max_mz = s.precursor_mass + PROTON + PRECURSOR_TOL;
      for (const auto& pk : in)
      {
        if (!std::isfinite(pk.getMZ()) || !std::isfinite(pk.getIntensity())) continue;
        if (pk.getIntensity() <= 0 || pk.getMZ() > max_mz) continue;
        work.push_back(pk);
      }

      // Collapse peaks sharing an m/z, keeping the strongest.
      //
      // diaTracer emits them routinely (a median 22 per spectrum). They are
      // indistinguishable to the graph, but each still consumes a slot in the
      // peak budget and shifts every intensity rank, and they let the same tag
      // be enumerated more than once.
      if (!work.empty())
      {
        work.sortByPosition();
        std::vector<Peak1D> uniq;
        uniq.reserve(work.size());
        for (const auto& pk : work)
        {
          if (!uniq.empty() && pk.getMZ() == uniq.back().getMZ())
          {
            if (pk.getIntensity() > uniq.back().getIntensity()) uniq.back() = pk;
          }
          else uniq.push_back(pk);
        }
        work.clear(false);
        for (const auto& pk : uniq) work.push_back(pk);
      }

      // Optional: collapse isotope clusters before anything competes for the
      // peak budget.
      //
      // Dense spectra hit the cap, so every isotope peak spends a slot a
      // monoisotopic peak could have had. Moving +2 and +3 fragments onto the
      // +1 scale also puts a whole series into one coordinate system instead of
      // splitting it across the per-charge graphs. Unclustered peaks are kept:
      // a real fragment whose isotopes fell under the noise floor is exactly
      // what a sensitive prefilter must keep. Peak count is left to the cap.
      if (p.deisotope && work.size() > 2)
      {
        // Clamp to what the deisotoper accepts (it throws above 100 ppm or
        // 0.1 Da; 0.3 Da is a normal ion-trap setting). Clamping is the
        // conservative direction: a tighter tolerance collapses FEWER
        // clusters and never merges peaks that are not isotopes, whereas
        // skipping would silently ignore an option the user asked for.
        const double deiso_tol = p.tol_ppm ? std::min(p.frag_tol, 100.0)
                                           : std::min(p.frag_tol, 0.1);
        // OpenMS's Deisotoper::deisotopeWithAveragineModel, ported and bit-identical
        // (AveragineDeisotoper.h): charges 1..max, no peak cap, unclustered peaks
        // kept, 2..10 isotope peaks, monoisotopic peaks moved to charge 1.
        deisotopeAveragine(work, deiso_tol, p.tol_ppm, DEISOTOPE_MAX_CHARGE);
        work.sortByPosition();
      }

      // order, keep and kept are scratch reused across spectra (thread_local:
      // each OMP thread prepares its own), so they keep their capacity.
      static thread_local std::vector<size_t> order;
      order.resize(work.size());
      std::iota(order.begin(), order.end(), 0);
      std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        if (work[a].getIntensity() != work[b].getIntensity())
          return work[a].getIntensity() > work[b].getIntensity();
        return work[a].getMZ() > work[b].getMZ();
      });
      // max_peak_count == 0 means "use the safety ceiling", NOT "unlimited":
      // the rank-sum tables stop at the same ceiling (see PEAK_CEILING).
      const size_t cap = p.max_peak_count > 0 ? p.max_peak_count : PEAK_CEILING;

      // Windowed selection: keep the strongest peaks_per_window peaks in each
      // PEAK_WINDOW_MZ-wide slice, instead of the strongest N overall.
      //
      // A global top-N is a fixed budget, and the right budget is not a constant:
      // it depends on how many real fragments a spectrum has, which scales with
      // the peptide, and one intense region can spend all of it.
      //
      // A per-window quota scales the effective total with the m/z range the
      // spectrum actually covers, which tracks precursor mass, and it spreads
      // selection across the range so a single dominant region cannot crowd out
      // a whole series. Sparse spectra keep everything they have.
      //
      // order is sorted by (intensity desc, m/z desc), so walking it in order and
      // admitting a peak when its window still has room selects exactly the
      // strongest per window while keeping the existing total order for ranks.
      if (p.peaks_per_window > 0)
      {
        std::map<long, int> used;
        static thread_local std::vector<size_t> keep;
        keep.clear();
        keep.reserve(std::min(order.size(), cap));
        for (size_t i : order)
        {
          const long w = static_cast<long>(work[i].getMZ() / PEAK_WINDOW_MZ);
          int& n = used[w];
          if (n >= p.peaks_per_window) continue;
          ++n;
          keep.push_back(i);
          if (keep.size() >= cap) break;   // cap remains a hard ceiling
        }
        order.swap(keep);
      }
      else if (order.size() > cap) order.resize(cap);

      // Keep the rank alongside the peak, then restore m/z order: the graph and
      // findNearest both need a sorted spectrum.
      static thread_local std::vector<std::pair<Peak1D, int>> kept;
      kept.clear();
      kept.reserve(order.size());
      for (size_t r = 0; r < order.size(); ++r)
        kept.emplace_back(work[order[r]], static_cast<int>(r) + 1);
      std::sort(kept.begin(), kept.end(), [](const auto& a, const auto& b) {
        return a.first.getMZ() < b.first.getMZ();
      });

      s.spec.reserve(kept.size());
      s.rank.reserve(kept.size());
      for (const auto& kv : kept) { s.spec.push_back(kv.first); s.rank.push_back(kv.second); }
      const size_t n = s.spec.size();

      // One index over the kept peaks answers every nearest-peak query below and
      // in buildGraph, for all fragment charges.
      static thread_local PeakGrid grid;
      grid.build(s.spec);
      s.grid = &grid;

      // Complements: b + y = M + 2*proton, so a fragment at m/z m has its partner
      // at M/z + 2*proton - m.
      s.has_compl.assign(n, 0);
      for (size_t i = 0; i < n; ++i)
        for (int z = 1; z <= s.n_frag_charges; ++z)
        {
          // Two fragments of the same charge z satisfy
          //   m/z(b) + m/z(y) = (Nb + z*proton)/z + (Ny + z*proton)/z
          //                   = M/z + 2*proton,      because Nb + Ny = M.
          // Note the proton term is NOT divided by z.
          const double cmz = s.precursor_mass / z + 2.0 * PROTON - s.spec[i].getMZ();
          // j != i: a peak at the midpoint would otherwise be its own partner,
          // manufacturing complement evidence from a single ion and inflating
          // both the population and the observed count.
          const int j = grid.nearest(cmz, p.complement_tol);
          if (j >= 0 && static_cast<size_t>(j) != i)
            s.has_compl[i] |= static_cast<uint8_t>(1u << (z - 1));
        }
      // Counted PER CHARGE, not pooled across charges: scorePath draws its
      // observed count from one fragment charge, so the hypergeometric's
      // population must be that same charge. Pooling would inflate K and leave
      // the tail too permissive for precursors of charge >= 3.
      s.n_with_compl.assign(static_cast<size_t>(s.n_frag_charges) + 1, 0);
      for (size_t i = 0; i < n; ++i)
        for (int z = 1; z <= s.n_frag_charges; ++z)
          if (s.has_compl[i] & (1u << (z - 1))) ++s.n_with_compl[static_cast<size_t>(z)];
      return s;
    }

    /// Residue-gap graph in compressed-sparse-row form, per fragment charge.
    struct Graph
    {
      std::vector<uint32_t> off, dst;   ///< forward edges, toward higher m/z
      std::vector<uint8_t>  res;
      std::vector<uint32_t> roff, rsrc; ///< reverse edges, so C-terminal
      std::vector<uint8_t>  rres;       ///< extension is O(degree) too
      std::vector<uint32_t> goff, gdst; ///< gap edges, empty unless max_gaps > 0
      std::vector<uint16_t> gpair;      ///< matched entry in Alphabet::pairs
    };

    Graph buildGraph(const Prepared& s, const Param& p, const Alphabet& A, int charge)
    {
      const size_t n = s.spec.size();
      Graph g;
      g.off.assign(n + 1, 0);
      g.roff.assign(n + 1, 0);
      // Scratch reused across calls (one buildGraph per spectrum x charge inside
      // the parallel loop): the inner vectors keep their capacity, turning ~2n
      // allocations per call into ~zero once warm. thread_local because each OMP
      // thread runs its own spectra.
      static thread_local std::vector<std::vector<std::pair<uint32_t, uint8_t>>> adj, radj;
      if (adj.size() < n) { adj.resize(n); radj.resize(n); }
      for (size_t i = 0; i < n; ++i) { adj[i].clear(); radj[i].clear(); }
      // Residue steps at this charge, divided once per call instead of once per
      // peak -- the same quotients, so the same targets.
      static thread_local std::vector<double> step;
      step.resize(A.res.size());
      for (size_t r = 0; r < step.size(); ++r) step[r] = A.res[r].mass / charge;
      const PeakGrid& grid = *s.grid;
      // One walk per peak through the residue-difference table for this charge,
      // built on a thread's first spectrum and reused. It must cover the largest
      // tolerance any target here can ask for: tolAt() grows with m/z in ppm,
      // and no target lies above the top peak plus the heaviest step. A table
      // that cannot serve (see StepTable::fit) leaves the grid, one lookup per
      // residue. Either way the answer is findNearest's, in (i, r) order.
      static thread_local std::vector<StepTable> tables;
      if (tables.size() <= static_cast<size_t>(charge)) tables.resize(static_cast<size_t>(charge) + 1);
      StepTable& dt = tables[static_cast<size_t>(charge)];
      const bool walk = n > 0 && !step.empty()
          && dt.fit(step, tolAt(p, grid.mz.back() + *std::max_element(step.begin(), step.end())));
      static thread_local std::vector<int> hit;
      // Every residue -- base and variable-modified -- is a candidate single
      // edge, so a variable mod simply adds more edges to try.
      for (size_t i = 0; i < n; ++i)
      {
        if (walk) dt.nearestAbove(grid.mz, i, [&p](double t) { return tolAt(p, t); }, hit);
        for (uint8_t r = 0; r < A.res.size(); ++r)
        {
          int j;
          if (walk) j = hit[r];
          else
          {
            const double target = s.spec[i].getMZ() + step[r];
            j = grid.nearest(target, tolAt(p, target));
          }
          if (j > static_cast<int>(i))
          {
            adj[i].emplace_back(static_cast<uint32_t>(j), r);
            radj[static_cast<size_t>(j)].emplace_back(static_cast<uint32_t>(i), r);
          }
        }
      }
      uint32_t t = 0, rt = 0;
      for (size_t i = 0; i < n; ++i)
      { g.off[i] = t; t += adj[i].size(); g.roff[i] = rt; rt += radj[i].size(); }
      g.off[n] = t; g.roff[n] = rt;
      g.dst.reserve(t); g.res.reserve(t); g.rsrc.reserve(rt); g.rres.reserve(rt);
      for (size_t i = 0; i < n; ++i)
        for (const auto& e : adj[i]) { g.dst.push_back(e.first); g.res.push_back(e.second); }
      for (size_t i = 0; i < n; ++i)
        for (const auto& e : radj[i]) { g.rsrc.push_back(e.first); g.rres.push_back(e.second); }

      // Gap edges: peak pairs separated by a two-residue sum, i.e. a series with
      // one member missing. Built by walking peak pairs and binary-searching the
      // sorted table -- n^2/2 = 5k searches at the 100-peak cap, against the
      // n * 190 = 19k findNearest calls the per-residue construction above would
      // need. Peaks are m/z sorted, so the inner loop stops as soon as the
      // difference exceeds the heaviest pair.
      if (p.max_gaps > 0 && n > 1)
      {
        const auto& P = A.pairs;
        const double p_lo = P.front().mass, p_hi = P.back().mass;
        static thread_local std::vector<std::vector<std::pair<uint32_t, uint16_t>>> gadj;
        if (gadj.size() < n) gadj.resize(n);
        for (size_t i = 0; i < n; ++i) gadj[i].clear();
        for (size_t i = 0; i < n; ++i)
          for (size_t j = i + 1; j < n; ++j)
          {
            const double d = (s.spec[j].getMZ() - s.spec[i].getMZ()) * charge;
            const double tol = tolAt(p, s.spec[j].getMZ()) * charge;
            if (d + tol < p_lo) continue;
            if (d - tol > p_hi) break;
            int best = -1; double best_err = tol;
            for (auto it = std::lower_bound(P.begin(), P.end(), d - tol,
                     [](const Alphabet::Pair& x, double v) { return x.mass < v; });
                 it != P.end() && it->mass <= d + tol; ++it)
            {
              const double err = std::fabs(it->mass - d);
              if (err < best_err) { best_err = err; best = static_cast<int>(it - P.begin()); }
            }
            if (best >= 0)
              gadj[i].emplace_back(static_cast<uint32_t>(j), static_cast<uint16_t>(best));
          }
        g.goff.assign(n + 1, 0);
        uint32_t gt = 0;
        for (size_t i = 0; i < n; ++i) { g.goff[i] = gt; gt += gadj[i].size(); }
        g.goff[n] = gt;
        g.gdst.reserve(gt); g.gpair.reserve(gt);
        for (size_t i = 0; i < n; ++i)
          for (const auto& e : gadj[i]) { g.gdst.push_back(e.first); g.gpair.push_back(e.second); }
      }
      return g;
    }

    Tag scorePath(const Prepared& s, const Param& p, const Tables& tab,
                  const std::vector<uint32_t>& peaks, const std::vector<Step>& path,
                  int charge)
    {
      const Alphabet& A = tab.alphabet();
      const int k = static_cast<int>(peaks.size());
      Tag t;
      t.charge = charge;

      // Back-project every peak onto an estimate of the first peak's position.
      // The spread of those estimates is the m/z-fidelity statistic.
      //
      // A gap step advances by its matched two-residue sum, so the statistic
      // keeps measuring how well the observed peaks fit ideal masses. Every null
      // stays valid because Tables is keyed on PEAK count, not residue count: a
      // gapped tag spends the same number of peaks and draws the same null, it
      // just spells more residues with them.
      static thread_local std::vector<double> est;
      est.assign(static_cast<size_t>(k), 0.0);
      double cum = 0;
      est[0] = s.spec[peaks[0]].getMZ();
      for (int i = 0; i < k - 1; ++i)
      {
        cum += stepMass(A, path[static_cast<size_t>(i)]) / charge;
        est[static_cast<size_t>(i) + 1] = s.spec[peaks[static_cast<size_t>(i) + 1]].getMZ() - cum;
      }
      const double avg = std::accumulate(est.begin(), est.end(), 0.0) / k;
      double sse = 0;
      for (double e : est) { const double d = e - avg; sse += d * d; }
      // Express the deviation in tolerance units, so the null is scale-free and
      // one table serves every m/z and both tolerance modes.
      const double tol = tolAt(p, avg);
      t.p_mzfidelity = tab.mzFidelityP(k, tol > 0 ? sse / (tol * tol) : sse);

      int ranksum = 0, n_compl = 0;
      for (int i = 0; i < k; ++i)
      {
        ranksum += s.rank[peaks[static_cast<size_t>(i)]];
        if (s.has_compl[peaks[static_cast<size_t>(i)]] & (1u << (charge - 1))) ++n_compl;
      }
      t.p_intensity = tab.intensityP(k, static_cast<int>(s.spec.size()), ranksum);

      // Per-edge confidence: how well each residue is actually supported.
      //
      // The E-value scores the whole tag; this localises the weak link. Each edge
      // i (peaks[i]..peaks[i+1]) carries one residue, or two for a gap. Its
      // confidence multiplies two independent things that both have to hold:
      //   mz_fit   -- the observed peak gap matches the residue/pair mass, falling
      //               linearly from 1 at a perfect fit to 0 at the tolerance;
      //   int_fit  -- BOTH endpoint peaks are intense (1 - the worse endpoint's
      //               rank fraction), so a residue resting on a near-noise peak is
      //               marked weak even if its mass fits.
      // min over edges is the residue most likely wrong; mean is the overall.
      {
        const double npk = static_cast<double>(std::max<size_t>(1, s.spec.size()));
        double conf_sum = 0.0, conf_min = 1.0;
        if (p.per_residue_conf) t.res_conf.reserve(static_cast<size_t>(k) + 1);
        for (int i = 0; i + 1 < k; ++i)
        {
          const double gap = (s.spec[peaks[static_cast<size_t>(i) + 1]].getMZ()
                              - s.spec[peaks[static_cast<size_t>(i)]].getMZ()) * charge;
          const double expect = stepMass(A, path[static_cast<size_t>(i)]);
          const double etol = tolAt(p, s.spec[peaks[static_cast<size_t>(i) + 1]].getMZ()) * charge;
          const double mz_fit = etol > 0 ? std::max(0.0, 1.0 - std::fabs(gap - expect) / etol) : 0.0;
          const double worse_rank = std::max(s.rank[peaks[static_cast<size_t>(i)]],
                                             s.rank[peaks[static_cast<size_t>(i) + 1]]);
          const double int_fit = std::max(0.0, 1.0 - worse_rank / npk);
          const double c = mz_fit * int_fit;
          conf_sum += c;
          conf_min = std::min(conf_min, c);
          if (p.per_residue_conf)
          {
            const auto v = static_cast<uint8_t>(std::lround(100.0 * c));
            t.res_conf.push_back(v);
            if (path[static_cast<size_t>(i)].gap) t.res_conf.push_back(v);  // pair shares one score
          }
        }
        const int n_edge = k - 1;
        t.min_conf = n_edge > 0 ? static_cast<float>(conf_min) : 1.0f;
        t.mean_conf = n_edge > 0 ? static_cast<float>(conf_sum / n_edge) : 1.0f;
      }

      // Probability of seeing at least this many complemented peaks among k drawn
      // from the spectrum. Dropped when the spectrum has no complements at all.
      const size_t zi = static_cast<size_t>(charge);
      const int compl_pop = zi < s.n_with_compl.size() ? s.n_with_compl[zi] : 0;
      const bool use_compl = compl_pop > 0;
      if (use_compl && n_compl > 0)
      {
        const unsigned N = static_cast<unsigned>(s.spec.size());
        const unsigned K = static_cast<unsigned>(compl_pop);
        const unsigned n = static_cast<unsigned>(k);
        // The support is [max(0, n+K-N), min(K, n)], not [0, n]: when most peaks
        // are complemented, a tag CANNOT have few. Boost throws on an argument
        // outside it, so resolve the ends analytically instead of clamping into
        // a distribution that does not cover them.
        const unsigned lo = (n + K > N) ? n + K - N : 0u;
        const unsigned hi = std::min(K, n);
        const unsigned obs = static_cast<unsigned>(n_compl);
        if (obs <= lo)      t.p_complement = 1.0;   // cannot do worse; no evidence
        else if (obs > hi)  t.p_complement = 0.0;   // impossible under the null
        else
        {
          boost::math::hypergeometric_distribution<double> h(K, n, N);
          t.p_complement = boost::math::cdf(boost::math::complement(h, obs - 1u));
        }
      }

      t.evalue = fisher(t.p_intensity, t.p_mzfidelity, t.p_complement, use_compl ? 3 : 2);

      // Flanking masses from the FITTED positions, not the raw ones: they are the
      // only consumer of the fit, and they are what a downstream search matches on.
      // The low peak is assumed to be a y ion, so a b-derived tag reads reversed
      // and its flanks carry a one-water offset.
      t.cterm_mass = std::max(0.0, avg * charge - PROTON * charge - WATER);
      t.nterm_mass = std::max(0.0, s.precursor_mass - ((avg + cum) * charge - PROTON * charge));

      t.seq = spell(A, path);
      for (const Step& st : path) { t.n_res += stepResidues(st); t.gapped = t.gapped || st.gap; }
      if (p.per_residue_conf)
      {
        // The path was traversed C->N and seq is stored N->C (see spell()), so
        // the residue confidences must flip too -- a mistake here mirrors
        // every tag's confidences and NO mass or length check would catch it.
        std::reverse(t.res_conf.begin(), t.res_conf.end());
        assert(t.res_conf.size() == t.n_res);
      }
      t.low_mz = s.spec[peaks.front()].getMZ();
      return t;
    }

    /// Greedily extend one terminus. Selection is by smallest |m/z error|, tied
    /// on better intensity rank, then peak index -- all three are needed, since
    /// ties at equal error are common and a partial order leaves the output
    /// dependent on traversal accidents.
    ///
    /// Extension deliberately walks ordinary edges only, even when the seed
    /// carries no gap. A gap here would let one tag rest on two unobserved
    /// splits at opposite ends, and the sequence it spells would be mostly
    /// inference; the seed-level gap already reaches the disjoint runs this is
    /// meant to recover. Measured with gapped extension on three profiles at
    /// extension 2 and 4: rank-1 accuracy fell by 4.6 to 13.1 points and total
    /// recall did not move -- it reaches no peptide the seed gap does not, and
    /// only turns contiguous tags into gapped ones (~3.6x less often correct).
    int extendPath(const Prepared& s, const Param& p, const Alphabet& A, const Graph& g,
                   std::vector<uint32_t>& peaks, std::vector<Step>& path,
                   int charge, bool forward)
    {
      const auto& R = A.res;
      int added = 0;
      static thread_local std::vector<bool> used;   // scratch, as in tagSpectrum
      used.assign(s.spec.size(), false);
      for (uint32_t i : peaks) used[i] = true;

      while (added < p.max_extension)
      {
        const uint32_t cur = forward ? peaks.back() : peaks.front();
        const uint32_t e0 = forward ? g.off[cur] : g.roff[cur];
        const uint32_t e1 = forward ? g.off[cur + 1] : g.roff[cur + 1];
        int best = -1; uint8_t best_r = 0; double best_err = 0;
        for (uint32_t e = e0; e < e1; ++e)
        {
          const uint32_t cand = forward ? g.dst[e] : g.rsrc[e];
          const uint8_t rr = forward ? g.res[e] : g.rres[e];
          if (used[cand]) continue;
          const double err = forward
              ? std::fabs(s.spec[cand].getMZ() - (s.spec[cur].getMZ() + R[rr].mass / charge))
              : std::fabs(s.spec[cur].getMZ() - (s.spec[cand].getMZ() + R[rr].mass / charge));
          const bool better = best < 0 || err < best_err - 1e-12 ||
              (std::fabs(err - best_err) <= 1e-12 &&
               (s.rank[cand] < s.rank[static_cast<size_t>(best)] ||
                (s.rank[cand] == s.rank[static_cast<size_t>(best)] &&
                 cand < static_cast<uint32_t>(best))));
          if (better) { best = static_cast<int>(cand); best_r = rr; best_err = err; }
        }
        if (best < 0) break;
        used[static_cast<size_t>(best)] = true;
        if (forward)
        {
          peaks.push_back(static_cast<uint32_t>(best));
          path.push_back(Step{0, best_r, false});
        }
        else
        {
          peaks.insert(peaks.begin(), static_cast<uint32_t>(best));
          path.insert(path.begin(), Step{0, best_r, false});
        }
        ++added;
      }
      return added;
    }

    /// A scored tag plus the indices (into Prepared::spec) of the peaks that
    /// spelled it -- the exact, integer signature -diversity needs to tell a
    /// re-read of the same ladder from genuinely different evidence. Filled
    /// only under -diversity, its one reader: a copy per tag is a heap
    /// allocation per tag.
    struct ScoredTag
    {
      Tag tag;
      std::vector<uint32_t> peaks;
    };

    /// Push one scored path as one or more tags.
    ///
    /// A gap edge asserts a two-residue SUM, not a split, so every composition
    /// within tolerance of the observed difference -- in both orders -- is an
    /// equally supported reading, and all of them are emitted. Keeping only the
    /// closest match would be wrong on a systematic class rather than a random
    /// one: AD and GE both weigh 186.064 exactly, so the correct spelling would
    /// be dropped about half the time whenever that gap occurs.
    ///
    /// n_seeds counts emitted TAGS, not paths, so the E-value's multiple-testing
    /// factor stays honest when one path spells several.
    void emit(std::vector<ScoredTag>& out, size_t& n_seeds, Tag t, const Prepared& s,
              const Param& p, const Tables& tab, const std::vector<uint32_t>& peaks,
              const std::vector<Step>& path, int charge)
    {
      const auto sig = [&]() { return p.diversity ? peaks : std::vector<uint32_t>(); };
      if (!t.gapped) { ++n_seeds; out.push_back({std::move(t), sig()}); return; }

      size_t gi = 0;   // the gap step; peaks has one entry more than path
      while (!path[gi].gap) ++gi;

      const double d = (s.spec[peaks[gi + 1]].getMZ() - s.spec[peaks[gi]].getMZ()) * charge;
      const double tol = tolAt(p, s.spec[peaks[gi + 1]].getMZ()) * charge;

      // Each spelling is rescored against ITS OWN pair mass rather than
      // inheriting the best match's flanks.
      //
      // Sharing them looks harmless -- alternatives sit within the tolerance --
      // but it breaks the row's internal arithmetic: nterm + mass(seq) + cterm
      // must equal the precursor residue mass, and with another composition's
      // mass it misses by their difference. A consumer that checks that identity,
      // or uses the flank as a precursor constraint, would see rows contradicting
      // their own sequence. The alternative masses are exact numbers, so
      // recomputing asserts no precision the data lacks; it is arithmetic
      // consistency, and it costs one rescore of a path a few peaks long.
      const auto& P = tab.alphabet().pairs;
      static thread_local std::vector<Step> alt;   // scratch, as in tagSpectrum
      alt = path;
      int emitted = 0;
      for (auto it = std::lower_bound(P.begin(), P.end(), d - tol,
               [](const Alphabet::Pair& x, double v) { return x.mass < v; });
           it != P.end() && it->mass <= d + tol; ++it)
      {
        const int orders = (it->a == it->b) ? 1 : 2;
        // Admit a composition only if BOTH its orders fit the budget. Stopping
        // part-way through one would emit a single arbitrary order and silently
        // drop the other, which is the one case where the caller could end up
        // with only the wrong spelling of a correct composition.
        if (emitted + orders > MAX_GAP_SPELLINGS) break;
        alt[gi].pair = static_cast<uint16_t>(it - P.begin());
        for (int o = 0; o < orders; ++o)
        {
          alt[gi].swap = (o == 1);
          Tag v = scorePath(s, p, tab, peaks, alt, charge);
          v.extended = t.extended;
          ++n_seeds;
          out.push_back({std::move(v), sig()});
          ++emitted;
        }
      }
      if (emitted == 0) { ++n_seeds; out.push_back({std::move(t), sig()}); }
    }

    /// Fewest peaks that can carry a tag of p.tag_length residues. A gap
    /// spends one fewer peak than it spells residues, so a gapped tag of
    /// tag_length residues needs only tag_length peaks.
    size_t minPeaks(const Param& p)
    {
      return static_cast<size_t>(std::max(2, p.tag_length + 1 - std::max(0, p.max_gaps)));
    }

    /// One graph per fragment charge, graphs[z - 1] for charge z.
    std::vector<Graph> buildGraphs(const Prepared& s, const Param& p, const Alphabet& A)
    {
      std::vector<Graph> graphs;
      graphs.reserve(static_cast<size_t>(s.n_frag_charges));
      for (int z = 1; z <= s.n_frag_charges; ++z) graphs.push_back(buildGraph(s, p, A, z));
      return graphs;
    }
  }

  /// Everything that depends on the seed length -- the walk, extension,
  /// scoring and selection -- over a prepared spectrum and its graphs.
  static std::vector<Tag> tagPrepared(const Prepared& s, const std::vector<Graph>& graphs,
                                      const Param& p, const Tables& tables)
  {
    std::vector<Tag> out;
    // scored and the DFS state below are scratch reused across paths, charges
    // and spectra: thread_local, since each OMP thread tags its own spectra, so
    // clear() keeps their capacity instead of allocating per spectrum -- and,
    // for the DFS stack, per start peak.
    static thread_local std::vector<ScoredTag> scored;
    scored.clear();
    size_t n_seeds = 0;
    const Alphabet& A = tables.alphabet();

    for (int z = 1; z <= s.n_frag_charges; ++z)
    {
      const Graph& g = graphs[static_cast<size_t>(z) - 1];
      static thread_local std::vector<uint32_t> peaks, pk;
      static thread_local std::vector<Step> path, rs;
      // edge is a relative index over this node's ordinary edges followed by its
      // gap edges, so one counter walks both arrays.
      struct Frame { uint32_t node, edge; };
      static thread_local std::vector<Frame> st;

      for (uint32_t start = 0; start < s.spec.size(); ++start)
      {
        st.clear();
        peaks.clear(); path.clear();
        int n_res = 0;
        bool gap_used = false;
        peaks.push_back(start);
        st.push_back({start, 0});
        // Pop the deepest step, undoing exactly what pushing it did. At most one
        // gap is ever on the path, so clearing the flag on its pop is sufficient.
        auto pop_step = [&]() {
          if (path.empty()) return;
          const Step sp = path.back();
          path.pop_back(); peaks.pop_back();
          n_res -= stepResidues(sp);
          if (sp.gap) gap_used = false;
        };

        while (!st.empty())
        {
          if (n_res == p.tag_length)
          {
            pk = peaks;
            rs = path;
            int grew = 0;
            if (p.max_extension > 0)
              grew = extendPath(s, p, A, g, pk, rs, z, true)
                   + extendPath(s, p, A, g, pk, rs, z, false);
            // Rescore at the realised length: a seed's statistic does not
            // describe an extended tag, and the per-length nulls are already built.
            Tag t = scorePath(s, p, tables, pk, rs, z);
            t.extended = grew > 0;
            emit(scored, n_seeds, std::move(t), s, p, tables, pk, rs, z);
            pop_step(); st.pop_back();
            continue;
          }

          const uint32_t node = st.back().node;
          const uint32_t nn = g.off[node + 1] - g.off[node];
          const uint32_t ng = g.goff.empty() ? 0u : g.goff[node + 1] - g.goff[node];
          if (st.back().edge >= nn + ng)
          {
            st.pop_back();
            pop_step();
            continue;
          }
          const uint32_t ei = st.back().edge++;

          if (ei < nn)
          {
            const uint32_t e = g.off[node] + ei;
            peaks.push_back(g.dst[e]);
            path.push_back(Step{0, g.res[e], false, false});
            ++n_res;
            st.push_back({g.dst[e], 0});
          }
          else
          {
            // One gap per tag, and it must fit the remaining residue budget --
            // otherwise a gap taken at length-1 would overshoot to length+1 and
            // silently return tags longer than asked for.
            if (gap_used || n_res + 2 > p.tag_length) continue;
            const uint32_t e = g.goff[node] + (ei - nn);
            peaks.push_back(g.gdst[e]);
            path.push_back(Step{g.gpair[e], 0, true, false});
            n_res += 2;
            gap_used = true;
            st.push_back({g.gdst[e], 0});
          }
        }
      }
    }

    // E-value: expected number of tags this good by chance. Valid under arbitrary
    // dependence between tags, by linearity of expectation.
    //
    // Gapped tags additionally pay for the larger space their gap searched
    // (Param::gap_penalty). n_seeds cannot do that: it is one factor for every
    // tag of the spectrum, so it never reorders them, and the distortion --
    // gapped tags outranking contiguous ones they should sit below -- is within
    // a spectrum. A tag carries at most one gap (the DFS sets gap_used and
    // extension does not cross gaps), so the penalty applies once.
    const double gap_penalty = std::max(1.0, p.gap_penalty);
    for (ScoredTag& st : scored)
    {
      st.tag.evalue *= static_cast<double>(std::max<size_t>(n_seeds, 1));
      if (st.tag.gapped) st.tag.evalue *= gap_penalty;
    }

    // stable_sort, not sort: the comparator is not total (it ignores charge and
    // the flanks), so only stability makes the survivor among equals
    // well-defined. Sorted as indices, not objects: merging whole ScoredTags
    // moves a string and vectors per step, a measurable share of worker CPU.
    const auto rank_cmp = [](const Tag& a, const Tag& b) {
      if (a.evalue != b.evalue) return a.evalue < b.evalue;
      if (a.seq != b.seq) return a.seq < b.seq;
      return a.low_mz < b.low_mz;
    };
    const auto by_rank_cmp = [&](uint32_t a, uint32_t b) { return rank_cmp(scored[a].tag, scored[b].tag); };
    static thread_local std::vector<uint32_t> by_rank;
    by_rank.resize(scored.size());
    std::iota(by_rank.begin(), by_rank.end(), 0u);
    std::stable_sort(by_rank.begin(), by_rank.end(), by_rank_cmp);

    // Drop tags identical in every reported field, before the output cap so the
    // cap counts distinct results. Extension reaches the same physical tag by
    // different N/C splits (28% of rows at extension 6). Keying on the exact
    // reported values, not rounded ones, keeps the few that genuinely differ.
    std::set<std::tuple<std::string, int, double, double>> seen;

    // -diversity selection state. Near-duplicate = SAME CHARGE, both tags
    // spelled by >= 4 peaks, sharing all but at most one peak -- adjacent-
    // offset re-reads and gap respellings of one ladder, deliberately NOT
    // b-vs-y reads, charge variants, or distal windows. The >=4 floor keeps
    // the rule out of the degenerate short-tag regime (2-peak tags would
    // merge on ANY shared peak). Deferral is demotion, never deletion:
    // deferred tags backfill in rank order, and the kept set is re-sorted by
    // the rank comparator so the header's ordered-by-E-value contract holds.
    // Both hold indices into scored.
    std::vector<uint32_t> div_kept, div_deferred;
    auto near_dup = [](const ScoredTag& a, const ScoredTag& b) {
      if (a.tag.charge != b.tag.charge) return false;
      if (a.peaks.size() < 4 || b.peaks.size() < 4) return false;
      // peaks ascend: every graph edge, and so every path, runs to higher m/z.
      const std::vector<uint32_t>& pa = a.peaks;
      const std::vector<uint32_t>& pb = b.peaks;
      size_t i = 0, j = 0, shared = 0;
      while (i < pa.size() && j < pb.size())
      {
        if (pa[i] == pb[j]) { ++shared; ++i; ++j; }
        else if (pa[i] < pb[j]) ++i;
        else ++j;
      }
      return shared >= std::min(pa.size(), pb.size()) - 1;
    };

    for (const uint32_t i : by_rank)
    {
      ScoredTag& st = scored[i];
      Tag& t = st.tag;
      // The gap penalty ORDERS but does not FILTER. Tagging is a sensitive
      // prefilter: the cutoff answers "is this worth reporting at all" on the
      // uncorrected evidence, the corrected E-value "which should be tried
      // first". (Gating on the corrected value cost 19 points of recall on the
      // astral profile; ordering alone leaves recall unchanged.) A tag carries
      // at most one gap, so dividing once undoes the penalty.
      //
      // The list is sorted by the CORRECTED value, so raw values along it are
      // not monotone: `continue`, not `break`, on the raw cutoff. The early exit
      // uses the looser bound max_evalue * gap_penalty, beyond which no tag can
      // pass either.
      if (p.max_evalue > 0 && t.evalue > p.max_evalue * gap_penalty) break;
      const double raw = t.gapped ? t.evalue / gap_penalty : t.evalue;
      if (p.max_evalue > 0 && raw > p.max_evalue) continue;
      if (!seen.emplace(t.seq, t.charge, t.nterm_mass, t.cterm_mass).second) continue;
      if (!p.diversity || p.max_tag_count <= 0)
      {
        out.push_back(std::move(t));
        if (p.max_tag_count > 0 && static_cast<int>(out.size()) >= p.max_tag_count) break;
        continue;
      }
      // Diversity path: fill kept with non-near-duplicates first, park the
      // rest; both bounded at N so the walk still terminates early.
      const size_t N = static_cast<size_t>(p.max_tag_count);
      bool dup = false;
      for (const uint32_t k : div_kept)
        if (near_dup(scored[k], st)) { dup = true; break; }
      if (!dup && div_kept.size() < N) div_kept.push_back(i);
      else if (div_deferred.size() < N) div_deferred.push_back(i);
      if (div_kept.size() >= N) break;
    }
    if (p.diversity && p.max_tag_count > 0)
    {
      for (const uint32_t d : div_deferred)
      {
        if (div_kept.size() >= static_cast<size_t>(p.max_tag_count)) break;
        div_kept.push_back(d);
      }
      std::stable_sort(div_kept.begin(), div_kept.end(), by_rank_cmp);
      for (const uint32_t k : div_kept) out.push_back(std::move(scored[k].tag));
    }
    return out;
  }

  // ------------------------------------------------------------------ API

  std::vector<Tag> tagSpectrum(const MSSpectrum& in, double precursor_mz, int charge,
                               const Param& p, const Tables& tables)
  {
    if (p.tag_length < 1 || in.empty() || precursor_mz <= 0) return {};
    if (charge <= 0) charge = 2;

    const Prepared s = prepare(in, precursor_mz, charge, p);
    if (s.spec.size() < minPeaks(p)) return {};
    return tagPrepared(s, buildGraphs(s, p, tables.alphabet()), p, tables);
  }

  std::vector<std::vector<Tag>> tagSpectrum(const MSSpectrum& in, double precursor_mz, int charge,
                                            const std::vector<Param>& params,
                                            const std::vector<Tables>& tables)
  {
    std::vector<std::vector<Tag>> out(params.size());
    if (params.empty() || in.empty() || precursor_mz <= 0) return out;
    if (charge <= 0) charge = 2;

    // Neither the preprocessing nor the graphs read tag_length, so one of each
    // serves every length; built only once some length has enough peaks.
    const Prepared s = prepare(in, precursor_mz, charge, params[0]);
    std::vector<Graph> graphs;
    for (size_t i = 0; i < params.size(); ++i)
    {
      if (params[i].tag_length < 1 || s.spec.size() < minPeaks(params[i])) continue;
      if (graphs.empty()) graphs = buildGraphs(s, params[0], tables[0].alphabet());
      out[i] = tagPrepared(s, graphs, params[i], tables[i]);
    }
    return out;
  }

  std::vector<Tag> mergeLengths(std::vector<std::vector<Tag>> per_length)
  {
    using Key = std::tuple<std::string, int, double, double, bool>;
    const auto key = [](const Tag& t) {
      return Key(t.seq, t.charge, t.nterm_mass, t.cterm_mass, t.gapped);
    };
    std::map<Key, std::pair<double, size_t>> winner;  // best E-value, its length's index
    for (size_t i = 0; i < per_length.size(); ++i)
      for (const Tag& t : per_length[i])
      {
        const auto [it, fresh] = winner.try_emplace(key(t), t.evalue, i);
        if (!fresh && t.evalue < it->second.first) it->second = {t.evalue, i};
      }
    std::vector<Tag> rows;
    for (size_t i = 0; i < per_length.size(); ++i)
      for (Tag& t : per_length[i])
        if (winner.at(key(t)).second == i) rows.push_back(std::move(t));
    return rows;
  }
}
