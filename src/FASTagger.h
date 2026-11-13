// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /// @brief Residue/pair tables built from Param.mods; defined in the .cpp.
  struct Alphabet;

  /**
    @brief One residue-specific modification, resolved to a mass.

    Resolved by the TOPP tool (from OpenMS ModificationsDB) so this library
    needs no modification database of its own.

    Terminal modifications are NOT represented here: a fixed N- or C-terminal
    mod shifts the whole precursor mass and is therefore absorbed into the
    reported flanking masses automatically, with no effect on which internal
    edges the graph has. Only residue-specific mods change the alphabet.
  */
  struct ModSpec
  {
    char        residue;   ///< the residue this applies to (e.g. 'C', 'S', 'K')
    double      delta;     ///< monoisotopic mass shift
    std::string name;      ///< display name, e.g. "Phospho", "Carbamidomethyl"
    bool        variable;  ///< true: adds a modified alternative to the residue;
                           ///< false: shifts the residue's mass unconditionally
  };

  /**
    @brief Which fragment pairs count as complements (Param::complement_rule).
  */
  enum class ComplementRule
  {
    /// Both partners carry the fragment charge z: partner at M/z + 2p - m.
    /// FASTag 1.11's rule and the default.
    SAME_CHARGE,
    /// The partner carries the remaining c - z charges of a charge-c
    /// precursor (DirecTag's rule): (M + c*p - z*m)/(c - z); none when z >= c.
    PRECURSOR,
    /// A peak has a partner when either rule finds one.
    BOTH,
  };

  /**
    @brief How the complement tolerance is set (Param::complement_tol_mode).
  */
  enum class ComplementTolMode
  {
    DA,        ///< complement_tol, absolute; FASTag 1.11's mode and the default
    FRAGMENT,  ///< complement_tol_factor * (fragment tol at m + at the partner)
  };

  /**
    @brief Tagging parameters, set by the TOPP tool.

    src/CliParam.h holds the values it starts from.
  */
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
    bool   tol_ppm        = true;   ///< frag_tol in ppm (true) or Da (false)
    double complement_tol = 0.02;   ///< absolute (Da); used when complement_tol_mode is Da
    /// Which fragment pairs count as complements. SameCharge is FASTag 1.11.
    ComplementRule complement_rule = ComplementRule::SAME_CHARGE;
    /// Da: complement_tol. Fragment: complement_tol_factor times the sum of
    /// the fragment tolerance at the peak and at its partner, so the window
    /// follows the run's own -fragment_tolerance.
    ComplementTolMode complement_tol_mode = ComplementTolMode::DA;
    double complement_tol_factor = 0.5;  ///< k of the Fragment mode
    /// Complement p-value as DirecTag's mid-p P(X > c) + P(X = c)/2 of the
    /// hypergeometric for tags with c <= COMPLEMENT_MIDP_MAX_COUNT (0 or 1)
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
    /// Experimental TMT6/10 endpoint-artifact filters. The CLI resolves auto
    /// detection before tagging. No scores or candidate multiplicities change.
    bool   tmt_pseudo_filter = false;    ///< TMT pseudo-tag endpoint filter
    bool   tmt_reporter_filter = false;  ///< TMT reporter-region endpoint filter
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

  /**
    @brief One sequence tag of one spectrum.

    Flanking masses assume the low-m/z peak is a C-terminal ion (y, or z-dot
    under Param::ion_pair c/z), as DirecTag does for y; a tag read off the
    N-terminal series (b, c) therefore reads reversed relative to the peptide
    and its flanks carry the offset ion_pair.reversedOffset() (one water for
    b/y).
  */
  struct Tag
  {
    std::string seq;            ///< N->C. Modified residues are written inline as
                                ///< X[ModName] (e.g. "GS[Phospho]TK"), so seq is
                                ///< not one char per residue -- use n_res.
    size_t n_res = 0;           ///< residue count (bracket annotations excluded)
    double nterm_mass = 0;      ///< residue mass N-terminal to the tag
    double cterm_mass = 0;      ///< residue mass C-terminal to the tag
    int    charge = 1;          ///< fragment charge the tag was read at
    double p_intensity = 1, p_mzfidelity = 1, p_complement = 1;  ///< intensity, m/z-fidelity and complement p-values
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
    bool   extended = false;    ///< extended beyond the seed (Param::max_extension)
    bool   gapped = false;      ///< crossed a missing peak; two residues are a
                                ///< mass-only inference, not two observed steps
    double low_mz = 0;          ///< lowest peak; also the output tie-break
    double high_mz = 0;         ///< highest path peak (census tag_cover); not serialised
    float  peak_tic = 0;        ///< summed intensity of the path peaks (census best_tic); not serialised
    /// The series the tag was read as (Param::ion_pair.kind); every consumer
    /// of the flanks takes the reversed-read offset from it.
    IonSeries::Series ion_series = IonSeries::Series::BY;
  };

  /**
    @brief What tagSpectrum saw of one spectrum, for the census (-census).

    Filled only when a pointer is passed; passing one never changes the tags.
  */
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

  /**
    @brief Partner m/z of a fragment under one complement rule.

    Rule SameCharge or Precursor; Both is a pair of these calls, not a
    formula of its own (any rule other than Precursor is evaluated as
    SameCharge). The SameCharge branch is the expression FASTag 1.11
    evaluates, so its doubles are unchanged; at prec_charge 2, z 1 the two
    rules give the same value bit for bit.

    @param[in] M precursor neutral mass (Da)
    @param[in] prec_charge precursor charge
    @param[in] z fragment charge
    @param[in] mz fragment m/z
    @param[in] rule the complement rule
    @return the partner m/z; NaN when the rule has no partner (Precursor
            with z >= prec_charge)
  */
  inline double complementMz(double M, int prec_charge, int z, double mz, ComplementRule rule)
  {
    const double PROTON_MASS = OpenMS::Constants::PROTON_MASS_U;
    if (rule == ComplementRule::PRECURSOR)
    {
      if (z >= prec_charge) return std::numeric_limits<double>::quiet_NaN();
      return (M + prec_charge * PROTON_MASS - z * mz) / (prec_charge - z);
    }
    return M / z + 2.0 * PROTON_MASS - mz;
  }

  /**
    @brief The complement test of one Param: rule, tolerance and ion-pair mass deltas.

    Built once per Param (Tables holds it). A pair's neutral masses sum to
    M + delta; b/y gives the single delta 0. Later ion series (#15) and
    precursor hypotheses (#6) add entries here.
  */
  struct ComplementSpec
  {
    ComplementRule rule = ComplementRule::SAME_CHARGE;  ///< which pairs count
    ComplementTolMode tol_mode = ComplementTolMode::DA;  ///< how the tolerance is set
    double tol_da = 0.02;          ///< Da mode
    double tol_factor = 0.5;       ///< Fragment mode
    double frag_tol = 20.0;        ///< the run's fragment tolerance, Fragment mode
    bool   frag_tol_ppm = true;   ///< frag_tol in ppm (true) or Da (false)
    std::vector<double> pair_deltas{0.0};  ///< pair mass deltas: neutral masses sum to M + delta
    /// Charges the pair lost against the precursor (IonPair::charge_loss):
    /// the Precursor rule looks for a partner at prec_charge - charge_loss
    /// minus the fragment's charge. b/y 0 (1.11's expression); c/z-dot 1.
    int    charge_loss = 0;
    bool   midp = false;          ///< mid-p complement p-value (Param::complement_midp)

    /**
      @brief The complement test of @p p.

      @param[in] p the tagging parameters
      @return the complement test; non-b/y series take their pair deltas and
              charge loss from Param::ion_pair
    */
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
      // M + H (IonSeries::IonPair::compl_deltas).
      if (p.ion_pair.kind != IonSeries::Series::BY)
      {
        c.pair_deltas = p.ion_pair.compl_deltas;
        c.charge_loss = p.ion_pair.charge_loss;
      }
      return c;
    }

    /**
      @brief Search window around the partner m/z of a peak.

      @param[in] mz the peak's m/z
      @param[in] cmz the partner m/z
      @return the half-width of the window (Da): tol_da in Da mode, else
              tol_factor times the sum of the fragment tolerance at both m/z
    */
    double tol(double mz, double cmz) const
    {
      if (tol_mode == ComplementTolMode::DA) return tol_da;
      const auto at = [this](double x) { return frag_tol_ppm ? x * frag_tol * 1e-6 : frag_tol; };
      return tol_factor * (at(mz) + at(cmz));
    }
  };

  /// @brief Scope of Param::complement_midp (PLAN-data-types E2 item 3: "DirecTag's
  /// mid-p for 0 or 1 complemented peaks"): counts up to this use mid-p,
  /// larger ones the plain tail. The p-value stays monotone in the count:
  /// mid-p at 1 is P(X>1) + P(X=1)/2 >= P(X>=2), the plain value at 2.
  inline constexpr unsigned COMPLEMENT_MIDP_MAX_COUNT = 1;

  /**
    @brief Whether a tag with @p obs complemented peaks is scored with mid-p.

    @param[in] midp Param::complement_midp
    @param[in] obs the number of complemented peaks of the tag
    @return true when @p midp is set and @p obs <= COMPLEMENT_MIDP_MAX_COUNT
  */
  inline bool complementMidpApplies(bool midp, unsigned obs)
  {
    return midp && obs <= COMPLEMENT_MIDP_MAX_COUNT;
  }

  /**
    @brief Hypergeometric p-value of a tag's complemented peak count.

    Plain: P(X >= obs); @p midp: P(X > obs) + P(X = obs)/2. Outside the
    support [max(0, n+K-N), min(K, n)] the plain tail is resolved
    analytically (1 at or below the lower end, 0 above the upper end), as
    FASTag 1.11 does; mid-p gives 1 below the lower end and 0 above the
    upper one.

    @param[in] N the number of peaks
    @param[in] K the number of complemented peaks among them
    @param[in] n the number of peaks drawn (the tag's peaks)
    @param[in] obs the number of complemented peaks among the drawn
    @param[in] midp use mid-p instead of the plain tail
    @return the p-value
  */
  double complementPValue(unsigned N, unsigned K, unsigned n, unsigned obs, bool midp);

  /**
    @brief The complement population of one spectrum as tagSpectrum prepares it.

    For tests and diagnostics; the charge is defaulted as tagSpectrum does.

    @param[in] spec fragment spectrum
    @param[in] precursor_mz precursor m/z
    @param[in] charge precursor charge; <= 0 is treated as 2
    @param[in] p the tagging parameters
    @return entry z (1 .. the fragment charges tried) counts the kept peaks
            with a partner at fragment charge z; entry 0 is the number of
            kept peaks
  */
  std::vector<int> complementPopulation(const OpenMS::MSSpectrum& spec, double precursor_mz,
                                        int charge, const Param& p);

  /**
    @brief The peaks tagSpectrum tags of a spectrum (1.12 -dump_spectrum).

    The precursor cut, the m/z collapse, deisotoping (Param::deisotope) and
    the peak budget, m/z sorted, exactly as tagSpectrum prepares them. The
    charge is defaulted as tagSpectrum does. Reads no tag_length, so any
    Param of a run serves.

    @param[in] spec fragment spectrum
    @param[in] precursor_mz precursor m/z
    @param[in] charge precursor charge; <= 0 is treated as 2
    @param[in] p the tagging parameters
    @return the prepared peaks; empty when tagSpectrum would prepare nothing
            (no peaks, a precursor m/z that is not finite and positive)
  */
  OpenMS::MSSpectrum preparedPeaks(const OpenMS::MSSpectrum& spec, double precursor_mz, int charge,
                                   const Param& p);

  /**
    @brief Precomputed nulls, built once and shared read-only.

    Eager construction is what lets several spectra be tagged concurrently: a
    lazily-filled cache would be written from every thread. Everything needed is
    known from Param, since the realised tag length spans
    [tag_length+1, tag_length+1+2*max_extension] peaks.
  */
  class Tables
  {
  public:
    /**
      @brief Build the null tables, the alphabet and the complement test for @p p.

      @param[in] p the tagging parameters
    */
    explicit Tables(const Param& p);

    /**
      @brief P(rank sum <= observed) for a tag of @p tag_peaks peaks among @p npeaks.

      Conservative (1.0) outside the built range rather than out-of-bounds.

      @param[in] tag_peaks the number of peaks of the tag
      @param[in] npeaks the number of peaks of the spectrum
      @param[in] ranksum the observed intensity rank sum
      @return the cumulative probability
    */
    double intensityP(int tag_peaks, int npeaks, int ranksum) const;

    /**
      @brief P(SSE <= observed) for the m/z-fidelity statistic.

      @param[in] tag_peaks the number of peaks of the tag
      @param[in] sse the observed sum of squared m/z errors
      @return the cumulative probability
    */
    double mzFidelityP(int tag_peaks, double sse) const;

    /// @brief The residue/pair alphabet for this run, built once from Param.mods.
    /// @return the alphabet
    const Alphabet& alphabet() const { return *alpha_; }

    /// @brief The complement test for this run, built once from Param.
    /// @return the complement test
    const ComplementSpec& complement() const { return compl_; }

  private:
    int k_min_, k_max_;
    size_t n_max_;
    std::vector<std::vector<std::vector<float>>> ranksum_;  ///< [k][npeaks] -> CDF
    std::vector<std::vector<double>> mz_null_;              ///< [k] -> sorted SSE samples
    std::shared_ptr<const Alphabet> alpha_;                 ///< residue + pair tables
    ComplementSpec compl_;                                  ///< complement rule and tolerance
  };

  /**
    @brief Infer sequence tags from one centroided MS/MS spectrum.

    @param[in] spec fragment spectrum; must be sorted by m/z
    @param[in] precursor_mz precursor m/z
    @param[in] charge precursor charge; <= 0 is treated as 2
    @param[in] p the tagging parameters
    @param[in] tables the nulls built from @p p
    @param[out] diag optional; reset, then filled with what the census reads
    @param[in] multiplicity factor on every E-value with the seed count, before
               the max_evalue cut and the max_tag_count cap: the number
               of precursor hypotheses tagged for this spectrum (1.12
               #6, src/PrecursorHypotheses.h). 1 changes nothing.
    @return tags ordered by E-value, best first
  */
  std::vector<Tag> tagSpectrum(const OpenMS::MSSpectrum& spec, double precursor_mz,
                               int charge, const Param& p, const Tables& tables,
                               SpectrumDiag* diag = nullptr, double multiplicity = 1.0);

  /**
    @brief Tag one spectrum at several seed lengths, preprocessing it and building its graphs once.

    Entry i is exactly tagSpectrum(spec, precursor_mz, charge, params[i],
    tables[i]).

    @param[in] spec fragment spectrum; must be sorted by m/z
    @param[in] precursor_mz precursor m/z
    @param[in] charge precursor charge; <= 0 is treated as 2
    @param[in] params one per length; they may differ in tag_length only
    @param[in] tables built from the matching params entry
    @param[out] diag optional; one preprocessing serves every length, so one
                diag; enough_peaks when some length has enough
    @param[in] multiplicity as for the single-length overload
    @return per length (the order of @p params), tags ordered by E-value
  */
  std::vector<std::vector<Tag>> tagSpectrum(const OpenMS::MSSpectrum& spec, double precursor_mz,
                                            int charge, const std::vector<Param>& params,
                                            const std::vector<Tables>& tables,
                                            SpectrumDiag* diag = nullptr, double multiplicity = 1.0);

  /**
    @brief One spectrum's rows for a multi-length run, deduplicated across lengths.

    From its per-length tag lists (ascending length, as the multi-length
    tagSpectrum returns them). A tag several
    lengths report -- the same seq as written, charge, flanking masses and
    gapped flag -- is kept only from the length whose best (lowest) E-value
    for it is lowest, ties to the shorter length, with every row that length
    has for it; the other lengths' rows for it are dropped. Rows otherwise
    keep their order: ascending length, each length's own order within it.

    Masses and E-values are compared exactly: a reading's values come from one
    computation whatever the seed length, so its copies compare equal, while
    two readings that merely print alike (e.g. a gap placed one residue
    apart, ~1e-6 Da) stay two tags.

    @param[in] per_length the tag lists, ascending length
    @return the merged rows
  */
  std::vector<Tag> mergeLengths(std::vector<std::vector<Tag>> per_length);

  /**
    @brief One hybrid spectrum's rows from its b/y and its c/z-dot pass.

    1.13 item 10, -ion_series_hybrid both: both lists in one, stably sorted
    by E-value (ties: b/y first, each pass's own order within it), cut to the
    @p cap best rows. Every row keeps its Tag::ion_series; nothing is
    deduplicated across passes, since the same peaks read as b/y and as c/z
    give different flanks (two readings, not one).

    @param[in] by the b/y pass's tags
    @param[in] cz the c/z-dot pass's tags
    @param[in] cap the maximum number of rows; 0 = no cap
    @return the merged rows
  */
  std::vector<Tag> mergeSeriesPasses(std::vector<Tag> by, std::vector<Tag> cz, size_t cap);

  /**
    @brief Strip inline modification annotations, leaving one base residue per position.

    "GS[Phospho]TK[TMT6plex]" -> "GSTK". Used for FASTA matching, which is
    against unmodified protein sequences.

    @param[in] annotated a tag sequence with inline X[ModName] annotations
    @return the base residues
  */
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

  /**
    @brief Per base residue, the mass shift of its variable modification.

    The shift of "X[Name]" with a variable ModSpec of that name on X, 0
    otherwise.

    @param[in] annotated a tag sequence with inline X[ModName] annotations (N->C)
    @param[in] mods the run's modifications
    @return one entry per baseSequence() residue (Da)
  */
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
