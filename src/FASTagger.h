// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// Reimplements the DirecTag algorithm (Tabb et al., J Proteome Res 2008, 7:3838)
// from its publication. No code was copied from the reference implementation.
//
// Residue masses, modifications and the spectrum type come from OpenMS; the
// hypergeometric tail of the complement test comes from Boost. Kept in this
// project: the rank-sum null (ranksum.h), the Monte Carlo m/z-fidelity null,
// the Fisher combination of the p-values, the tie-stable peak selection and
// the averagine deisotoper ported from OpenMS (AveragineDeisotoper.h).
#pragma once

#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <FASTag/ranksum.h>

#include "IonSeries.h"

#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace FASTag
{
  struct Alphabet;  ///< residue/pair tables built from Param.mods; defined in the .cpp

  /// One residue-specific modification, resolved to a mass by the TOPP tool
  /// (from OpenMS ModificationsDB) so this library needs no modification
  /// database of its own.
  ///
  /// Terminal modifications are NOT represented here: a fixed N- or C-terminal
  /// mod shifts the whole precursor mass and is therefore absorbed into the
  /// reported flanking masses automatically, with no effect on which internal
  /// edges the graph has. Only residue-specific mods change the alphabet.
  struct ModSpec
  {
    char        residue;   ///< the residue this applies to (e.g. 'C', 'S', 'K')
    double      delta;     ///< monoisotopic mass shift
    std::string name;      ///< display name, e.g. "Phospho", "Carbamidomethyl"
    bool        variable;  ///< true: adds a modified alternative to the residue;
                           ///< false: shifts the residue's mass unconditionally
  };

  /// Which fragment pairs count as complements (Param::complement_rule).
  enum class ComplementRule
  {
    /// Both partners carry the fragment charge z: partner at M/z + 2p - m.
    /// FASTag 1.11's rule and the default.
    SameCharge,
    /// The partner carries the remaining c - z charges of a charge-c
    /// precursor (DirecTag's rule): (M + c*p - z*m)/(c - z); none when z >= c.
    Precursor,
    /// A peak has a partner when either rule finds one.
    Both,
  };

  /// How the complement tolerance is set (Param::complement_tol_mode).
  enum class ComplementTolMode
  {
    Da,        ///< complement_tol, absolute; FASTag 1.11's mode and the default
    Fragment,  ///< complement_tol_factor * (fragment tol at m + at the partner)
  };

  /// Tagging parameters, set by the TOPP tool (src/CliParam.h holds the
  /// values it starts from).
  struct Param
  {
    int    tag_length     = 3;      ///< seed length in residues
    int    max_extension  = 0;      ///< residues appended per terminus; 0 = off
    int    max_gaps       = 0;      ///< gap edges allowed per tag; 0 = off, 1 = max
    /// Collapse isotope clusters (charges 1-3) to their monoisotopic peak
    /// before selecting peaks, and move multiply-charged fragments onto the
    /// singly-charged scale.
    bool   deisotope      = false;
    double frag_tol       = 20.0;   ///< fragment tolerance
    bool   tol_ppm        = true;
    double complement_tol = 0.02;   ///< absolute (Da); used when complement_tol_mode is Da
    /// Which fragment pairs count as complements. SameCharge is FASTag 1.11.
    ComplementRule complement_rule = ComplementRule::SameCharge;
    /// Da: complement_tol. Fragment: complement_tol_factor times the sum of
    /// the fragment tolerance at the peak and at its partner, so the window
    /// follows the run's own -fragment_tolerance.
    ComplementTolMode complement_tol_mode = ComplementTolMode::Da;
    double complement_tol_factor = 0.5;  ///< k of the Fragment mode
    /// Complement p-value as DirecTag's mid-p P(X > c) + P(X = c)/2 of the
    /// hypergeometric for tags with c <= kComplementMidpMaxCount (0 or 1)
    /// complemented peaks; larger counts keep the plain tail P(X >= c).
    /// Off reproduces 1.11.
    bool   complement_midp = false;
    /// The ion series the spectrum is read as (1.12 #15 phase B): b/y, as
    /// FASTag 1.11, or c/z-dot for electron activation. Sets the flanking
    /// masses' terminal offsets, the complement partner (ComplementSpec) and,
    /// for c/z, the ETD precursor filter. The tags themselves are spelled
    /// from residue differences, the same in every series.
    IonSeries::IonPair ion_pair = IonSeries::ionPair(IonSeries::Series::BY);
    size_t max_peak_count = 100;   ///< hard ceiling; also bounds the null tables
    /// Peaks kept per 100 Da window; 0 selects the strongest max_peak_count
    /// overall instead. Windowed selection makes the effective budget scale with
    /// the spectrum's own m/z range rather than being a constant.
    int    peaks_per_window = 0;
    int    max_tag_count  = 50;     ///< 0 = unlimited
    double max_evalue     = 20.0;   ///< 0 = no cutoff
    /// Diversify which tags occupy the max_tag_count slots on chimeric
    /// spectra: near-duplicate re-reads of an already-kept tag's peak set
    /// (same charge, sharing all but at most one peak) are DEFERRED behind
    /// non-duplicates, then backfilled in rank order. Orders slot occupancy,
    /// never filters -- output size and rank 1 are unchanged; only which
    /// tags survive the cap. Off by default (not provably recall-neutral
    /// under a cap).
    bool   diversity      = false;
    /// Emit per-residue confidences (Tag::res_conf). Off by default so the
    /// hot path allocates nothing extra and the TSV schema is unchanged.
    bool   per_residue_conf = false;
    /// Multiplier applied to a gapped tag's E-value for RANKING. 1.0 disables it.
    ///
    /// Gapped tags are systematically over-scored against contiguous ones: a gap
    /// edge is chosen as the best fit from a 190-entry two-residue table where an
    /// ordinary edge tests 19 residues, and it spends one fewer peak to spell one
    /// more residue. Left uncorrected, gapped tags took 95% of rank-1 slots while
    /// being 3.6x less likely to be right.
    ///
    /// The multiplicity argument gives |pairs|/|residues| = 10 as a LOWER bound.
    /// Measurement says the real over-scoring is larger: rank-1 accuracy keeps
    /// improving to ~100 and is flat above it, consistently across all four
    /// benchmark profiles and tag lengths 3-5 (bench/benchmark.cpp). 100 is
    /// therefore calibrated, not derived -- and calibrated on synthetic spectra,
    /// which is the weakest part of the claim. It is a knob for that reason.
    ///
    /// Ranking only: the E-value cutoff is applied to the UNCORRECTED value, so
    /// this never removes a tag, only reorders. See tagSpectrum().
    double gap_penalty    = 100.0;
    /// Residue-specific modifications. Fixed mods shift a residue's mass;
    /// variable mods add a modified alternative that the graph may also use.
    /// Empty means the unmodified 19-residue alphabet. Resolved by the TOPP
    /// tool; the default it passes is a single fixed Carbamidomethyl (C).
    std::vector<ModSpec> mods;
  };

  /// One tag. Flanking masses assume the low-m/z peak is a C-terminal ion (y,
  /// or z-dot under Param::ion_pair c/z), as DirecTag does for y; a tag read off
  /// the N-terminal series (b, c) therefore reads reversed relative to the
  /// peptide and its flanks carry the offset ion_pair.reversedOffset() (one
  /// water for b/y).
  struct Tag
  {
    std::string seq;            ///< N->C. Modified residues are written inline as
                                ///< X[ModName] (e.g. "GS[Phospho]TK"), so seq is
                                ///< not one char per residue -- use n_res.
    size_t n_res = 0;           ///< residue count (bracket annotations excluded)
    double nterm_mass = 0;      ///< residue mass N-terminal to the tag
    double cterm_mass = 0;      ///< residue mass C-terminal to the tag
    int    charge = 1;          ///< fragment charge the tag was read at
    double p_intensity = 1, p_mzfidelity = 1, p_complement = 1;
    double evalue = 1;          ///< combined p-value x tags enumerated
    /// Per-edge confidence in [0,1], summarised. Each edge (one residue, or two
    /// for a gap) scores m/z fit x endpoint intensity; min_conf is the weakest
    /// edge (the residue most likely wrong), mean_conf the average. The E-value
    /// is the primary, validated tag confidence; these localise WHERE a tag is
    /// weak, which the single E-value cannot.
    float  min_conf = 1.0f;
    float  mean_conf = 1.0f;
    /// Per-RESIDUE confidence 0..100, N->C, one entry per residue (n_res of
    /// them), only when Param::per_residue_conf. A gap edge's single pair
    /// score is written to BOTH its residues: the mass evidence supports the
    /// pair, not either identity or their order -- consumers of assembly-style
    /// exports should read gap residues as sharing one observation.
    std::vector<uint8_t> res_conf;
    bool   extended = false;
    bool   gapped = false;      ///< crossed a missing peak; two residues are a
                                ///< mass-only inference, not two observed steps
    double low_mz = 0;          ///< lowest peak; also the output tie-break
    double high_mz = 0;         ///< highest path peak (census tag_cover); not serialised
    float  peak_tic = 0;        ///< summed intensity of the path peaks (census best_tic); not serialised
    /// The series the tag was read as (Param::ion_pair.kind); every consumer
    /// of the flanks takes the reversed-read offset from it.
    IonSeries::Series ion_series = IonSeries::Series::BY;
  };

  /// What tagSpectrum saw of one spectrum, for the census (-census). Filled
  /// only when a pointer is passed; passing one never changes the tags.
  struct SpectrumDiag
  {
    bool bad_precursor = false;  ///< precursor m/z not finite or <= 0: nothing was prepared
    bool prepared = false;       ///< preprocessing ran; the counts below are valid
    std::size_t n_kept = 0;      ///< peaks after the precursor cut, m/z collapse,
                                 ///< deisotoping and the peak budget
    std::size_t n_edges = 0;     ///< ordinary graph edges, summed over fragment
                                 ///< charges; 0 when no graph was built
    std::size_t n_compl = 0;     ///< kept peaks with a complement at fragment charge 1
    bool enough_peaks = false;   ///< n_kept reaches the minimum of some seed length
  };

  /// Partner m/z of a fragment at m/z @p mz and fragment charge @p z, from
  /// a precursor of neutral mass @p M and charge @p prec_charge under one
  /// rule (SameCharge or Precursor; Both is a pair of these calls, not a
  /// formula of its own). NaN when the rule has no partner: Precursor with
  /// z >= prec_charge. The SameCharge branch is the expression FASTag 1.11
  /// evaluates, so its doubles are unchanged; at prec_charge 2, z 1 the two
  /// rules give the same value bit for bit.
  inline double complementMz(double M, int prec_charge, int z, double mz, ComplementRule rule)
  {
    const double kProton = OpenMS::Constants::PROTON_MASS_U;
    if (rule == ComplementRule::Precursor)
    {
      if (z >= prec_charge) return std::numeric_limits<double>::quiet_NaN();
      return (M + prec_charge * kProton - z * mz) / (prec_charge - z);
    }
    return M / z + 2.0 * kProton - mz;
  }

  /// The complement test of one Param, built once per Param (Tables holds
  /// it): the rule, the tolerance and the ion-pair mass deltas. A pair's
  /// neutral masses sum to M + delta; b/y gives the single delta 0. Later
  /// ion series (#15) and precursor hypotheses (#6) add entries here.
  struct ComplementSpec
  {
    ComplementRule rule = ComplementRule::SameCharge;
    ComplementTolMode tol_mode = ComplementTolMode::Da;
    double tol_da = 0.02;          ///< Da mode
    double tol_factor = 0.5;       ///< Fragment mode
    double frag_tol = 20.0;        ///< the run's fragment tolerance, Fragment mode
    bool   frag_tol_ppm = true;
    std::vector<double> pair_deltas{0.0};
    /// Charges the pair lost against the precursor (IonPair::charge_loss):
    /// the Precursor rule looks for a partner at prec_charge - charge_loss
    /// minus the fragment's charge. b/y 0 (1.11's expression); c/z-dot 1.
    int    charge_loss = 0;
    bool   midp = false;

    static ComplementSpec fromParam(const Param& p)
    {
      ComplementSpec c;
      c.rule = p.complement_rule;
      c.tol_mode = p.complement_tol_mode;
      c.tol_da = p.complement_tol;
      c.tol_factor = p.complement_tol_factor;
      c.frag_tol = p.frag_tol;
      c.frag_tol_ppm = p.tol_ppm;
      c.midp = p.complement_midp;
      // b/y keeps the single delta 0 (1.11's doubles); c/z-dot pairs sum to
      // M + H (IonSeries::IonPair::compl_delta).
      if (p.ion_pair.kind != IonSeries::Series::BY)
      {
        c.pair_deltas = {p.ion_pair.compl_delta};
        c.charge_loss = p.ion_pair.charge_loss;
      }
      return c;
    }

    /// Search window around the partner m/z @p cmz of a peak at @p mz.
    double tol(double mz, double cmz) const
    {
      if (tol_mode == ComplementTolMode::Da) return tol_da;
      const auto at = [this](double x) { return frag_tol_ppm ? x * frag_tol * 1e-6 : frag_tol; };
      return tol_factor * (at(mz) + at(cmz));
    }
  };

  /// Scope of Param::complement_midp (PLAN-data-types E2 item 3: "DirecTag's
  /// mid-p for 0 or 1 complemented peaks"): counts up to this use mid-p,
  /// larger ones the plain tail. The p-value stays monotone in the count:
  /// mid-p at 1 is P(X>1) + P(X=1)/2 >= P(X>=2), the plain value at 2.
  inline constexpr unsigned kComplementMidpMaxCount = 1;

  /// Whether a tag with @p obs complemented peaks is scored with mid-p.
  inline bool complementMidpApplies(bool midp, unsigned obs)
  {
    return midp && obs <= kComplementMidpMaxCount;
  }

  /// P-value of @p obs complemented peaks among @p n drawn from @p N, of
  /// which @p K are complemented (hypergeometric). Plain: P(X >= obs);
  /// @p midp: P(X > obs) + P(X = obs)/2. Outside the support [max(0,
  /// n+K-N), min(K, n)] the plain tail is resolved analytically (1 at or
  /// below the lower end, 0 above the upper end), as FASTag 1.11 does; mid-p
  /// gives 1 below the lower end and 0 above the upper one.
  double complementPValue(unsigned N, unsigned K, unsigned n, unsigned obs, bool midp);

  /// The complement population of one spectrum as tagSpectrum prepares it:
  /// entry z (1 .. the fragment charges tried) counts the kept peaks with a
  /// partner at fragment charge z; entry 0 is the number of kept peaks. For
  /// tests and diagnostics; the charge is defaulted as tagSpectrum does.
  std::vector<int> complementPopulation(const OpenMS::MSSpectrum& spec, double precursor_mz,
                                        int charge, const Param& p);

  /// Precomputed nulls, built once and shared read-only.
  ///
  /// Eager construction is what lets several spectra be tagged concurrently: a
  /// lazily-filled cache would be written from every thread. Everything needed is
  /// known from Param, since the realised tag length spans
  /// [tag_length+1, tag_length+1+2*max_extension] peaks.
  class Tables
  {
  public:
    explicit Tables(const Param& p);

    /// P(rank sum <= observed) for a tag of @p tag_peaks peaks among @p npeaks.
    /// Conservative (1.0) outside the built range rather than out-of-bounds.
    double intensityP(int tag_peaks, int npeaks, int ranksum) const;

    /// P(SSE <= observed) for the m/z-fidelity statistic.
    double mzFidelityP(int tag_peaks, double sse) const;

    /// The residue/pair alphabet for this run, built once from Param.mods.
    const Alphabet& alphabet() const { return *alpha_; }

    /// The complement test for this run, built once from Param.
    const ComplementSpec& complement() const { return compl_; }

  private:
    int k_min_, k_max_;
    size_t n_max_;
    std::vector<std::vector<std::vector<float>>> ranksum_;  ///< [k][npeaks] -> CDF
    std::vector<std::vector<double>> mz_null_;              ///< [k] -> sorted SSE samples
    std::shared_ptr<const Alphabet> alpha_;                 ///< residue + pair tables
    ComplementSpec compl_;                                  ///< complement rule and tolerance
  };

  /// Infer sequence tags from one centroided MS/MS spectrum.
  ///
  /// @param spec       fragment spectrum; must be sorted by m/z
  /// @param precursor_mz  precursor m/z
  /// @param charge     precursor charge; <= 0 is treated as 2
  /// @return tags ordered by E-value, best first
  /// @param diag       optional; filled with what the census reads
  /// @param multiplicity  factor on every E-value with the seed count, before
  ///                   the max_evalue cut and the max_tag_count cap: the number
  ///                   of precursor hypotheses tagged for this spectrum (1.12
  ///                   #6, src/PrecursorHypotheses.h). 1 changes nothing.
  std::vector<Tag> tagSpectrum(const OpenMS::MSSpectrum& spec, double precursor_mz,
                               int charge, const Param& p, const Tables& tables,
                               SpectrumDiag* diag = nullptr, double multiplicity = 1.0);

  /// Tag one spectrum at several seed lengths, preprocessing it and building
  /// its graphs once. Entry i is exactly tagSpectrum(spec, precursor_mz,
  /// charge, params[i], tables[i]).
  ///
  /// @param params  one per length; they may differ in tag_length only
  /// @param tables  built from the matching params entry
  /// @param diag    optional; one preprocessing serves every length, so one
  ///                diag; enough_peaks when some length has enough
  /// @param multiplicity  as for the single-length overload
  std::vector<std::vector<Tag>> tagSpectrum(const OpenMS::MSSpectrum& spec, double precursor_mz,
                                            int charge, const std::vector<Param>& params,
                                            const std::vector<Tables>& tables,
                                            SpectrumDiag* diag = nullptr, double multiplicity = 1.0);

  /// One spectrum's rows for a multi-length run, from its per-length tag lists
  /// (ascending length, as the overload above returns them). A tag several
  /// lengths report -- the same seq as written, charge, flanking masses and
  /// gapped flag -- is kept only from the length whose best (lowest) E-value
  /// for it is lowest, ties to the shorter length, with every row that length
  /// has for it; the other lengths' rows for it are dropped. Rows otherwise
  /// keep their order: ascending length, each length's own order within it.
  ///
  /// Masses and E-values are compared exactly: a reading's values come from one
  /// computation whatever the seed length, so its copies compare equal, while
  /// two readings that merely print alike (e.g. a gap placed one residue
  /// apart, ~1e-6 Da) stay two tags.
  std::vector<Tag> mergeLengths(std::vector<std::vector<Tag>> per_length);

  /// Strip inline modification annotations, leaving one base residue per
  /// position: "GS[Phospho]TK[TMT6plex]" -> "GSTK". Used for FASTA matching,
  /// which is against unmodified protein sequences.
  inline std::string baseSequence(const std::string& annotated)
  {
    std::string out;
    out.reserve(annotated.size());
    int depth = 0;
    for (char c : annotated)
    {
      if (c == '[') { ++depth; continue; }
      if (c == ']') { if (depth > 0) --depth; continue; }
      if (depth == 0) out.push_back(c);
    }
    return out;
  }

  /// Per base residue of @p annotated (N->C), the mass shift of its variable
  /// modification ("X[Name]" with a variable ModSpec of that name on X), 0
  /// otherwise. One entry per baseSequence() residue.
  inline std::vector<double> variableModShifts(const std::string& annotated,
                                               const std::vector<ModSpec>& mods)
  {
    std::vector<double> out;
    for (size_t i = 0; i < annotated.size(); ++i)
    {
      const char c = annotated[i];
      if (c == '[' || c == ']') continue;
      double shift = 0.0;
      if (i + 1 < annotated.size() && annotated[i + 1] == '[')
      {
        const size_t close = annotated.find(']', i + 2);
        const std::string name = annotated.substr(i + 2, close == std::string::npos
                                                             ? std::string::npos : close - i - 2);
        for (const ModSpec& m : mods)
          if (m.variable && m.residue == c && m.name == name) { shift = m.delta; break; }
        i = close == std::string::npos ? annotated.size() : close;
      }
      out.push_back(shift);
    }
    return out;
  }
}
