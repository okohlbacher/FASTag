// The per-spectrum census (FASTag 1.12, item #11 phase A, "F6 census v1").
//
// With -census, FASTag writes one row per MS2 spectrum it reads (the sampled
// ones when subsampling), including the spectra that give no tag, and a run
// summary. The census reports counts and facts; it makes no quality call and
// no acquisition call ("tagged" is not "good"; raw-DIA detection is #7's job
// and never a census status).
//
// Everything here is side-effect free: FASTag.cpp collects the facts of a
// spectrum it is tagging anyway and hands them to classify() and appendRow().
// The tagging gate, the n_ms2 count and every existing output stay as they
// are, with or without -census.
//
// Status, first matching rule wins (append-only: a new status gets a new
// enum value at the end and bumps TABLE_VERSION):
//   empty          the spectrum has no peaks (the tagging gate; not in n_ms2)
//   no_precursor   no Precursor (the tagging gate; not in n_ms2)
//   no_signal      peaks, but none with a positive, finite intensity
//   bad_precursor  the precursor m/z is not finite or <= 0 (tagSpectrum refuses it)
//   too_few_peaks  after preprocessing, fewer peaks than any seed length needs
//   no_tags        graphs were built, no tag passed -max_evalue
//   filtered       tags were found, -fasta rejected all and no entrapment row was written
//   placed         at least one -recon_out placement (only with -recon_out)
//   tagged         at least one reported row and no placement
// Statuses from no_signal on are the spectra the tagger processed: their sum
// is the "N MS2 spectra" of the log.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Digest.h"
#include "NumFormat.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <type_traits>
#include <string>
#include <utility>
#include <vector>

namespace FASTag::Census
{
  /// Census format version, written as `census_version` in the summary.
  /// 2 (after 1.15.7): the columns max_len and res_cover after tag_cover, and the
  /// summary row run/max_tags.
  /// 3: res_cover places b and c reads by their orientation (addResidueSpans),
  /// and the column res_cover_exact after res_cover says whether every
  /// orientation was known (1) or res_cover is the folded lower bound (0).
  inline constexpr int TABLE_VERSION = 3;

  /**
    @brief Per-spectrum status.

    Append-only (see the file comment); the first matching rule wins.
  */
  enum class Status : std::uint8_t
  {
    EMPTY = 0,     ///< no peaks
    NO_PRECURSOR,   ///< no Precursor
    NO_SIGNAL,      ///< peaks, but none with a positive, finite intensity
    BAD_PRECURSOR,  ///< precursor m/z not finite or <= 0
    TOO_FEW_PEAKS,   ///< too few peaks after preprocessing
    NO_TAGS,        ///< no tag passed -max_evalue
    FILTERED,      ///< tags found, all rejected by -fasta
    PLACED,        ///< at least one -recon_out placement
    TAGGED,        ///< at least one reported row and no placement
  };
  /// Number of Status values.
  inline constexpr std::size_t STATUS_COUNT = 9;

  /**
    @brief The name of a status as written in the census.

    @param[in] s Status.
    @return The status name, or "unknown" for a value out of range.
  */
  inline const char* name(Status s)
  {
    static constexpr const char* names[STATUS_COUNT] = {
        "empty", "no_precursor", "no_signal", "bad_precursor", "too_few_peaks",
        "no_tags", "filtered", "placed", "tagged"};
    const auto i = static_cast<std::size_t>(s);
    return i < STATUS_COUNT ? names[i] : "unknown";
  }

  /**
    @brief Whether a status belongs to a spectrum the tagger processed.

    @param[in] s Status.
    @return True for the statuses of spectra the tagger processed (counted in n_ms2).
  */
  inline bool processed(Status s) { return s != Status::EMPTY && s != Status::NO_PRECURSOR; }

  /**
    @brief What the tagging loop knows about one MS2 spectrum.
  */
  struct Facts
  {
    bool empty = false;           ///< spec.empty()
    bool has_precursor = false;   ///< at least one Precursor
    std::size_t n_peaks = 0;      ///< peaks with finite m/z and positive, finite intensity
    double precursor_mz = 0;      ///< the first precursor's m/z
    bool enough_peaks = false;    ///< SpectrumDiag::enough_peaks
    std::size_t n_found = 0;      ///< tags the tagger returned (before -fasta)
    std::size_t n_reported = 0;   ///< rows written to the tag TSV
    std::size_t n_placed = 0;     ///< -recon_out placements
    bool count_placements = false;  ///< -recon_out is written
  };

  /**
    @brief The status of a spectrum from its facts (first matching rule wins).

    @param[in] f Facts of the spectrum.
    @return The status.
  */
  inline Status classify(const Facts& f)
  {
    if (f.empty) return Status::EMPTY;
    if (!f.has_precursor) return Status::NO_PRECURSOR;
    if (f.n_peaks == 0) return Status::NO_SIGNAL;
    if (!(f.precursor_mz > 0) || !std::isfinite(f.precursor_mz)) return Status::BAD_PRECURSOR;
    if (!f.enough_peaks) return Status::TOO_FEW_PEAKS;
    if (f.n_found == 0) return Status::NO_TAGS;
    if (f.n_reported == 0) return Status::FILTERED;
    if (f.count_placements && f.n_placed > 0) return Status::PLACED;
    return Status::TAGGED;
  }

  /**
    @brief Sorts non-negative, finite floats ascending.

    +0.0 and -0.0 must already be one value: signal() stores +0.0. LSD radix
    sort on the bit patterns, which order exactly as the values do for
    non-negative floats: the census sorts every spectrum's intensities, and
    at a few hundred peaks or more std::sort was most of the -census cost.
    The result equals std::sort's.

    @param[in,out] v Values to sort in place.
  */
  inline void sortNonNegative(std::vector<float>& v)
  {
    const std::size_t n = v.size();
    if (n < 128)
    {
      std::sort(v.begin(), v.end());
      return;
    }
    static thread_local std::vector<std::uint32_t> a, b;
    a.resize(n);
    b.resize(n);
    std::memcpy(a.data(), v.data(), n * sizeof(float));
    for (int shift = 0; shift < 32; shift += 8)
    {
      std::size_t count[257] = {};
      for (const std::uint32_t x : a) ++count[((x >> shift) & 0xFFu) + 1];
      if (count[((a[0] >> shift) & 0xFFu) + 1] == n) continue;  // one bucket: nothing to move
      for (int k = 0; k < 256; ++k) count[k + 1] += count[k];
      for (const std::uint32_t x : a) b[count[(x >> shift) & 0xFFu]++] = x;
      a.swap(b);
    }
    std::memcpy(v.data(), a.data(), n * sizeof(float));
  }

  /**
    @brief Gini coefficient of a set of values.

    0 for equal values, 1 - 1/n for one non-zero value among n. The values
    must be >= 0 with a positive sum.

    @param[in,out] v Values; sorted in place.
    @return The Gini coefficient; 0 when the sum is not positive.
  */
  template <typename T>
  double gini(std::vector<T>& v)
  {
    if constexpr (std::is_same_v<T, float>) sortNonNegative(v);
    else std::sort(v.begin(), v.end());
    const double n = static_cast<double>(v.size());
    double sum = 0, weighted = 0;
    for (std::size_t i = 0; i < v.size(); ++i)
    {
      sum += static_cast<double>(v[i]);
      weighted += static_cast<double>(i + 1) * static_cast<double>(v[i]);
    }
    if (!(sum > 0)) return 0.0;
    return 2.0 * weighted / (n * sum) - (n + 1.0) / n;
  }

  /**
    @brief Peak facts read from the input spectrum itself.
  */
  struct Signal
  {
    std::size_t n_peaks = 0;  ///< finite m/z, positive and finite intensity
    bool has_gini = false;    ///< false when no intensity is positive
    double gini = 0;          ///< int_gini
  };

  /**
    @brief n_peaks and int_gini of a spectrum.

    int_gini is over every peak with a finite m/z and a finite, non-negative
    intensity: zero-intensity peaks (profile padding) are part of the
    population, NaN and negative ones are not. It is our own training-free
    signal, not Xrea.

    @param[in] spec Input spectrum (peaks with getMZ() and getIntensity()).
    @return The signal facts.
  */
  template <typename Spectrum>
  Signal signal(const Spectrum& spec)
  {
    Signal s;
    // Intensities are floats: sorting them as floats orders them exactly as
    // doubles would, at half the memory traffic; the sums are in double.
    static thread_local std::vector<float> scratch;
    scratch.clear();
    for (const auto& pk : spec)
    {
      const double mz = pk.getMZ();
      const float in = static_cast<float>(pk.getIntensity());
      if (!std::isfinite(mz) || !std::isfinite(in) || in < 0) continue;
      scratch.push_back(in == 0 ? 0.0f : in);  // -0.0 as +0.0 (sortNonNegative)
      if (in > 0) ++s.n_peaks;
    }
    if (s.n_peaks > 0)
    {
      s.has_gini = true;
      s.gini = gini(scratch);
    }
    return s;
  }

  /**
    @brief The facts of one reported tag that the census reads.
  */
  struct TagView
  {
    double evalue = 0;               ///< E-value
    double low_mz = 0, high_mz = 0;  ///< m/z range the tag covers
    std::size_t n_res = 0;           ///< tag length (residues)
    float min_conf = 0, mean_conf = 0;  ///< minimum and mean residue confidence
    float peak_tic = 0;  ///< summed intensity of the tag's path peaks (BestTagTIC)
    bool cz = false;     ///< read as c/z-dot ions (1.12 #15 phase B), else b/y
  };

  /// Index value meaning "no tag".
  inline constexpr std::size_t NO_INDEX = static_cast<std::size_t>(-1);

  /**
    @brief The reported tag with the minimum E-value.

    Ties to the first output position. Multi-length rows are ordered by
    length, so this is not necessarily row 0. The rows are not reordered.

    @param[in] rows Reported tags.
    @return Index of the best tag; NO_INDEX for none.
  */
  inline std::size_t bestTag(const std::vector<TagView>& rows)
  {
    std::size_t best = NO_INDEX;
    for (std::size_t i = 0; i < rows.size(); ++i)
      if (best == NO_INDEX || rows[i].evalue < rows[best].evalue) best = i;
    return best;
  }

  /**
    @brief Total length of the union of intervals.

    @param[in,out] iv Intervals [lo, hi]; sorted in place.
    @return Total length of the union of the intervals in @p iv.
  */
  inline double unionLength(std::vector<std::pair<double, double>>& iv)
  {
    std::sort(iv.begin(), iv.end());
    double total = 0, lo = 0, hi = 0;
    bool open = false;
    for (const auto& [a, b] : iv)
    {
      if (!open || a > hi)
      {
        if (open) total += hi - lo;
        lo = a;
        hi = b;
        open = true;
      }
      else hi = std::max(hi, b);
    }
    if (open) total += hi - lo;
    return total;
  }

  /**
    @brief Total length of the union of the intervals [lo, hi].

    @param[in] iv Intervals [lo, hi] (copied).
    @return Total length of their union.
  */
  inline double tagCover(std::vector<std::pair<double, double>> iv) { return unionLength(iv); }

  /**
    @brief tag_cover of the reported rows.

    @param[in] rows Reported tags.
    @return The length of the union of their [low_mz, high_mz].
  */
  inline double tagCoverOf(const std::vector<TagView>& rows)
  {
    static thread_local std::vector<std::pair<double, double>> iv;
    iv.clear();
    for (const TagView& t : rows) iv.emplace_back(t.low_mz, t.high_mz);
    return unionLength(iv);
  }

  /**
    @brief Which way a tag reads along the peptide (res_cover, census 3).

    The tagger writes every tag as if its low peak were a C-terminal ion (y,
    or z-dot under c/z); a tag read off the N-terminal series (b, or c) reads
    the peptide backwards. A -fasta match says which: a forward match is a y
    or z-dot read, a reverse-only match a b or c read. Without one the
    orientation is not known.
  */
  enum class Orientation : std::uint8_t
  {
    Forward,    ///< a y or z-dot read (forward database match)
    Reversed,   ///< a b or c read (reverse-only database match)
    Unresolved  ///< no database match to tell (no -fasta)
  };

  /**
    @brief Folds one tag's residue spans onto the lower half of the peptide.

    When the midpoint of the whole span [first, last) lies above axis / 2,
    each span [a, b] becomes [axis - b, axis - a]. The fold is symmetric
    about axis / 2, so a b read and the complementary y read of the same
    residues (or an exactly placed read of them) give one image; folding a
    folded block again changes nothing. The block is folded as a whole, so
    its own residues stay distinct.

    @param[in,out] spans Residue intervals.
    @param[in] first First span of the tag.
    @param[in] last One past the tag's last span.
    @param[in] axis The mirror axis (Da), see addResidueSpans.
  */
  inline void foldResidueSpans(std::vector<std::pair<double, double>>& spans, std::size_t first, std::size_t last,
                               double axis)
  {
    if (last <= first) return;
    double lo = spans[first].first, hi = spans[first].second;
    for (std::size_t i = first; i < last; ++i)
    {
      lo = std::min(lo, spans[i].first);
      hi = std::max(hi, spans[i].second);
    }
    if (0.5 * (lo + hi) > 0.5 * axis)
      for (std::size_t i = first; i < last; ++i)
        spans[i] = {axis - spans[i].second, axis - spans[i].first};
  }

  /**
    @brief Appends the residues of one tag to a residue-cover list.

    The spans are first built as the tag TSV writes the tag (the low peak a
    y ion, or a z-dot ion under c/z): its N-terminal end lies @p nterm_mass
    of residue mass from the peptide's N-terminus, a position the precursor
    mass of the tag's hypothesis gives. Walking from that end, each path step
    (the m/z difference of two path peaks times the fragment charge) holds
    step_res residues, a gap's two residues sharing its mass equally. Each
    residue is a [start, end] in residue mass from the N-terminus.

    A b or c read placed so lands at its mirror image about @p axis: residues
    i..j of the peptide come out at [axis - P(j), axis - P(i-1)], P the
    prefix residue sum, with axis = M - H2O + IonSeries::IonPair::
    reversedOffset() (for b/y the precursor's neutral mass M, for c/z-dot
    M - H2O + offC - offN). Then, by @p orient:
    - Forward: the spans are kept.
    - Reversed: each span [a, b] becomes [axis - b, axis - a], the exact
      placement of the b or c read.
    - Unresolved: the tag is folded onto the lower half: when the midpoint
      of its whole span lies above axis / 2 every span is mirrored. A b read
      and the complementary y read of the same residues then land on one
      interval, so res_cover is a lower bound (residues that mirror each
      other about the centre count once). The tag is folded as a whole, so
      its own residues never merge and res_cover stays >= max_len.

    When any tag of a spectrum is Unresolved, the caller folds the known
    (Forward and Reversed) tags too, after their exact placement, with
    foldResidueSpans: a known read and an unresolved read of the same
    residues then share one lower-half image and count once, and res_cover
    is the lower bound. When every orientation is known nothing is folded.

    @param[in,out] spans Residue intervals appended to.
    @param[in] nterm_mass The tag's nterm_mass (Da).
    @param[in] path_mz The path peaks' m/z, ascending.
    @param[in] step_res Residues per path step, ascending m/z like @p path_mz
      (empty: one residue per step when that gives @p n_res).
    @param[in] charge Fragment charge of the tag.
    @param[in] n_res Tag length (residues).
    @param[in] res_mass Summed residue mass of the tag (Da); used, split
      evenly over @p n_res, when the path does not describe the residues.
    @param[in] orient The tag's orientation (Forward: the 1.15 placement).
    @param[in] axis The mirror axis (Da); unused for Forward.
  */
  inline void addResidueSpans(std::vector<std::pair<double, double>>& spans, double nterm_mass,
                              const std::vector<double>& path_mz, const std::vector<std::uint8_t>& step_res,
                              int charge, std::size_t n_res, double res_mass,
                              Orientation orient = Orientation::Forward, double axis = 0.0)
  {
    if (n_res == 0) return;
    const std::size_t first = spans.size();
    const std::size_t steps = path_mz.size() > 1 ? path_mz.size() - 1 : 0;
    std::size_t total = 0;
    if (step_res.size() == steps)
      for (const std::uint8_t k : step_res) total += k;
    const bool by_steps = steps > 0 && charge > 0 &&
        ((step_res.size() == steps && total == n_res) || (step_res.empty() && steps == n_res));
    if (!by_steps)
    {
      const double w = res_mass / static_cast<double>(n_res);
      for (std::size_t i = 0; i < n_res; ++i)
        spans.emplace_back(nterm_mass + w * static_cast<double>(i), nterm_mass + w * static_cast<double>(i + 1));
    }
    else
    {
      const double z = static_cast<double>(charge);
      const double high = path_mz.back();
      for (std::size_t k = steps; k-- > 0;)  // from the high-m/z (N-terminal) end
      {
        const double a = nterm_mass + (high - path_mz[k + 1]) * z;
        const double b = nterm_mass + (high - path_mz[k]) * z;
        const std::size_t r = step_res.empty() ? 1 : step_res[k];
        for (std::size_t i = 0; i < r; ++i)
          spans.emplace_back(a + (b - a) * static_cast<double>(i) / static_cast<double>(r),
                             a + (b - a) * static_cast<double>(i + 1) / static_cast<double>(r));
      }
    }
    if (orient == Orientation::Reversed)
      for (std::size_t i = first; i < spans.size(); ++i)
        spans[i] = {axis - spans[i].second, axis - spans[i].first};
    else if (orient == Orientation::Unresolved)
      foldResidueSpans(spans, first, spans.size(), axis);
  }

  /**
    @brief Number of distinct residues among residue intervals (res_cover).

    A residue whose midpoint lies inside a residue already counted is that
    residue (residues of one peptide never overlap); the intervals are taken
    in midpoint order.

    @param[in,out] spans Residue intervals [start, end]; sorted in place.
    @return The number of distinct residues.
  */
  inline std::size_t residueCover(std::vector<std::pair<double, double>>& spans)
  {
    const auto mid = [](const std::pair<double, double>& s) { return 0.5 * (s.first + s.second); };
    std::sort(spans.begin(), spans.end(),
              [&](const auto& x, const auto& y) { return mid(x) < mid(y) || (mid(x) == mid(y) && x < y); });
    std::size_t n = 0;
    double reach = -std::numeric_limits<double>::infinity();
    for (const auto& s : spans)
    {
      if (mid(s) < reach) continue;
      ++n;
      reach = std::max(reach, s.second);
    }
    return n;
  }

  /**
    @brief One census row.

    Fields that were not computed for a spectrum are written empty (see
    appendRow).
  */
  struct Row
  {
    std::size_t index = 0;      ///< input index
    double rt = 0;              ///< retention time (seconds)
    bool has_precursor = false; ///< the spectrum has a precursor
    double precursor_mz = 0;    ///< precursor m/z
    int charge_given = 0;       ///< 0 = none
    int charge_used = 0;        ///< 2 when none was given
    std::size_t n_peaks = 0;    ///< peaks with finite m/z and positive, finite intensity
    bool has_gini = false;      ///< gini is valid
    double gini = 0;            ///< int_gini
    bool prepared = false;      ///< n_kept, n_edges and n_compl are valid
    std::size_t n_kept = 0, n_edges = 0, n_compl = 0;  ///< SpectrumDiag: peaks kept, graph edges, kept peaks with a complement at charge 1
    Status status = Status::EMPTY;  ///< census status
    std::size_t n_found = 0, n_reported = 0;  ///< tags found, and rows reported
    bool has_best = false;      ///< best and tag_cover are valid
    TagView best;               ///< the best reported tag
    double tag_cover = 0;       ///< tag_cover of the reported rows
    std::size_t max_len = 0;    ///< the longest reported tag (residues; census 2)
    std::size_t res_cover = 0;  ///< residues the reported tags cover (residueCover; census 2)
    bool res_cover_exact = true;  ///< every reported tag's orientation was known (census 3)
    /// -census_score (1.16 item 4): the best of ALL tags of the selected
    /// hypothesis, before any database filter (-fasta), and their tag_cover.
    bool has_pre = false;       ///< pre_best and pre_tag_cover are valid
    TagView pre_best;           ///< best tag before database filters
    double pre_tag_cover = 0;   ///< tag_cover of all tags before database filters
  };

  /**
    @brief The census TSV header line with or without best_ion_series.

    @param[in] ion_series Whether to include best_ion_series (a run that can
      read c/z, IonSeries::seriesColumn).
    @return The header line, ending in a newline.
  */
  inline std::string header(bool ion_series, bool score = false)
  {
    return std::string("index\tspectrum\trt\tprecursor_mz\tcharge_given\tcharge_used\tn_peaks\tn_peaks_kept"
                       "\tn_edges\tn_compl\tint_gini\tstatus\tn_found\tn_reported\tbest_evalue\tbest_len"
                       "\tbest_min_conf\tbest_mean_conf\tbest_tic\ttag_cover\tmax_len\tres_cover\tres_cover_exact")
         + (ion_series ? "\tbest_ion_series" : "")
         + (score ? "\tpre_best_evalue\tpre_best_len\tpre_best_mean_conf\tpre_tag_cover" : "") + "\n";
  }

  /**
    @brief The run's optional census columns.

    One run-level setting, set once by the tool before the census table
    opens (and before any thread starts), read by header(). A reader of the
    census that takes header() as the layout (-census_ids,
    CensusIds::joinTable) thus sees the columns this run writes, with no
    argument of its own (PLAN-INTEGRATION 2.3/2). The default is the 1.11
    layout.
  */
  struct RunColumns
  {
    bool ion_series = false;  ///< best_ion_series (#15 phase B)
    bool score = false;       ///< the pre_* columns of -census_score (1.16 item 4)
  };
  /**
    @brief The process-wide RunColumns setting.

    @return A reference to the single RunColumns instance.
  */
  inline RunColumns& runColumns()
  {
    static RunColumns c;
    return c;
  }

  /**
    @brief The census TSV header line of this run (runColumns()).

    @return The header line, ending in a newline.
  */
  inline std::string header() { return header(runColumns().ion_series, runColumns().score); }

  /**
    @brief Appends free text as one TSV field.

    A tab, CR or LF becomes a space.

    @param[in,out] buf Buffer appended to.
    @param[in] text Text to append.
  */
  inline void appendField(std::string& buf, const std::string& text)
  {
    if (text.find_first_of("\t\r\n") == std::string::npos) { buf += text; return; }
    for (char c : text) buf += (c == '\t' || c == '\r' || c == '\n') ? ' ' : c;
  }

  /**
    @brief Appends one census row.

    23 fields, one more with @p ion_series, four more with @p score, and a newline.

    @param[in,out] buf Buffer appended to.
    @param[in] r The row.
    @param[in] native_id Native ID of the spectrum (the spectrum column).
    @param[in] ion_series Whether to write the best_ion_series column.
    @param[in] score Whether to write the four pre_* columns (-census_score).
  */
  inline void appendRow(std::string& buf, const Row& r, const std::string& native_id, bool ion_series = false,
                        bool score = false)
  {
    constexpr auto fixed = std::chars_format::fixed;
    constexpr auto general = std::chars_format::general;
    const bool proc = processed(r.status);
    appendNum(buf, r.index); buf += '\t';
    appendField(buf, native_id); buf += '\t';
    appendShortest(buf, r.rt); buf += '\t';
    if (r.has_precursor)
    {
      appendShortest(buf, r.precursor_mz); buf += '\t';
      appendNum(buf, r.charge_given); buf += '\t';
      appendNum(buf, r.charge_used); buf += '\t';
    }
    else buf += "\t\t\t";
    appendNum(buf, r.n_peaks); buf += '\t';
    if (r.prepared)
    {
      appendNum(buf, r.n_kept); buf += '\t';
      appendNum(buf, r.n_edges); buf += '\t';
      appendNum(buf, r.n_compl); buf += '\t';
    }
    else buf += "\t\t\t";
    if (r.has_gini) appendNum(buf, r.gini, fixed, 4);
    buf += '\t';
    buf += name(r.status); buf += '\t';
    if (proc)
    {
      appendNum(buf, r.n_found); buf += '\t';
      appendNum(buf, r.n_reported); buf += '\t';
    }
    else buf += "\t\t";
    if (r.has_best)
    {
      appendNum(buf, r.best.evalue, general, 6); buf += '\t';
      appendNum(buf, r.best.n_res); buf += '\t';
      appendNum(buf, r.best.min_conf, fixed, 3); buf += '\t';
      appendNum(buf, r.best.mean_conf, fixed, 3); buf += '\t';
      appendNum(buf, r.best.peak_tic, general, 6); buf += '\t';
      appendNum(buf, r.tag_cover, fixed, 4); buf += '\t';
      appendNum(buf, r.max_len); buf += '\t';
      appendNum(buf, r.res_cover); buf += '\t';
      buf += r.res_cover_exact ? '1' : '0';
    }
    else buf += "\t\t\t\t\t\t\t\t";
    if (ion_series)
    {
      buf += '\t';
      if (r.has_best) buf += r.best.cz ? "cz" : "by";
    }
    if (score)
    {
      if (r.has_pre)
      {
        buf += '\t'; appendNum(buf, r.pre_best.evalue, general, 6);
        buf += '\t'; appendNum(buf, r.pre_best.n_res);
        buf += '\t'; appendNum(buf, r.pre_best.mean_conf, fixed, 3);
        buf += '\t'; appendNum(buf, r.pre_tag_cover, fixed, 4);
      }
      else buf += "\t\t\t\t";
    }
    buf += '\n';
  }

  /**
    @brief Linear-interpolation quantile (type 7, numpy's default).

    @param[in,out] v Values; sorted in place.
    @param[in] q Quantile in [0, 1].
    @return The quantile; NaN for none.
  */
  inline double quantile(std::vector<double>& v, double q)
  {
    if (v.empty()) return std::numeric_limits<double>::quiet_NaN();
    std::sort(v.begin(), v.end());
    const double h = (static_cast<double>(v.size()) - 1.0) * q;
    const std::size_t lo = static_cast<std::size_t>(std::floor(h));
    if (lo + 1 >= v.size()) return v.back();
    return v[lo] + (h - static_cast<double>(lo)) * (v[lo + 1] - v[lo]);
  }

  /**
    @brief Run-level counts and samples, one per thread, merged in thread order.
  */
  struct Tally
  {
    std::array<std::uint64_t, STATUS_COUNT> by_status{};  ///< rows per status
    std::uint64_t ms2_seen = 0;   ///< rows written
    std::uint64_t no_charge = 0;  ///< processed spectra without a precursor charge
    std::vector<double> best_evalue;  ///< tagged and placed spectra
    std::vector<double> n_kept;       ///< processed spectra that were prepared
    std::vector<double> gini;         ///< processed spectra with a Gini

    /**
      @brief Counts one census row.

      @param[in] r The row.
    */
    void add(const Row& r)
    {
      ++by_status[static_cast<std::size_t>(r.status)];
      ++ms2_seen;
      if (!processed(r.status)) return;
      if (r.charge_given <= 0) ++no_charge;
      if (r.prepared) n_kept.push_back(static_cast<double>(r.n_kept));
      if (r.has_gini) gini.push_back(r.gini);
      if (r.has_best && (r.status == Status::TAGGED || r.status == Status::PLACED))
        best_evalue.push_back(r.best.evalue);
    }
    /**
      @brief Adds the counts and samples of another tally (appended after this one's).

      @param[in] o Tally to add.
    */
    void merge(const Tally& o)
    {
      for (std::size_t i = 0; i < STATUS_COUNT; ++i) by_status[i] += o.by_status[i];
      ms2_seen += o.ms2_seen;
      no_charge += o.no_charge;
      best_evalue.insert(best_evalue.end(), o.best_evalue.begin(), o.best_evalue.end());
      n_kept.insert(n_kept.end(), o.n_kept.begin(), o.n_kept.end());
      gini.insert(gini.end(), o.gini.begin(), o.gini.end());
    }
    /// @brief Spectra the tagger processed: the "N MS2 spectra" of the log.
    /// @return The number of rows with a processed() status.
    std::uint64_t n_processed() const
    {
      std::uint64_t n = 0;
      for (std::size_t i = 0; i < STATUS_COUNT; ++i)
        if (Census::processed(static_cast<Status>(i))) n += by_status[i];
      return n;
    }
  };

  /**
    @brief The run row `max_tags` of -census_summary_out (census 2).

    Written after the run rows: the cap n_found and n_reported stop at.

    @param[in] max_tags -max_tags (0 = no cap).
    @param[in] n_lengths Number of seed lengths (the cap applies per length).
    @return The row.
  */
  inline Digest::Row maxTagsRow(int max_tags, std::size_t n_lengths)
  {
    const std::string v = std::to_string(max_tags);
    if (max_tags <= 0)
      return {"run", "max_tags", v, "-", "No cap on the tags reported per spectrum (-max_tags 0)."};
    const std::string cap = std::to_string(static_cast<std::uint64_t>(max_tags) * n_lengths);
    return {"run", "max_tags", v, "-",
            "At most " + v + " tags per spectrum and seed length were kept (-max_tags), so n_found and "
            "n_reported are at most " + cap + "."};
  }

  /**
    @brief The `census` section of -census_summary_out (after the run rows).

    @param[in] t The run's tally.
    @param[in] input_spectra Every input spectrum, all MS levels (the
      subsampling basis).
    @param[in] subsampled Whether -subsample_spectra/-subsample_fraction was used.
    @return The summary rows.
  */
  inline std::vector<Digest::Row> summaryRows(const Tally& t, std::uint64_t input_spectra, bool subsampled)
  {
    using Digest::num;
    const std::string sec = "census";
    const std::string seen = num(t.ms2_seen);
    std::vector<Digest::Row> r;
    r.push_back({sec, "census_version", std::to_string(TABLE_VERSION), "-",
                 "The census follows format " + std::to_string(TABLE_VERSION) +
                     ": one row per MS2 spectrum read; statuses are append-only; no status is a quality call."});
    r.push_back({sec, "input_spectra", num(input_spectra), "-",
                 num(input_spectra) + " input spectra of all MS levels (the basis of subsampling)."});
    r.push_back({sec, "ms2_seen", seen, "-", seen + " MS2 spectra were read and have a census row."});
    r.push_back({sec, "ms2_processed", num(t.n_processed()), "-",
                 num(t.n_processed()) + " MS2 spectra had peaks and a precursor and went to the tagger "
                                      "(the 'MS2 spectra' count of the log)."});
    r.push_back({sec, "ms2_total", subsampled ? std::string() : seen, "-",
                 subsampled ? "Not known: masked spectra are never read when subsampling."
                            : "The input holds " + seen + " MS2 spectra."});
    r.push_back({sec, "subsampled", subsampled ? "1" : "0", "-",
                 subsampled ? "The spectra were subsampled." : "Every spectrum was read."});
    r.push_back({sec, "subsample_basis", "input_spectra", "-",
                 "Subsampling draws from the input spectra of all MS levels, not from MS2 only."});
    for (std::size_t i = 0; i < STATUS_COUNT; ++i)
    {
      const std::string nm = name(static_cast<Status>(i));
      const std::uint64_t c = t.by_status[i];
      r.push_back({sec, "count_" + nm, num(c), seen, num(c) + " MS2 spectra have status " + nm + "."});
      const std::string share = t.ms2_seen ? num(static_cast<double>(c) / static_cast<double>(t.ms2_seen)) : "";
      r.push_back({sec, "share_" + nm, share, seen,
                   "The share of the MS2 spectra read that have status " + nm + "."});
    }
    r.push_back({sec, "no_charge", num(t.no_charge), num(t.n_processed()),
                 num(t.no_charge) + " processed MS2 spectra carry no precursor charge (tagged as 2+)."});
    auto quantiles = [&](const char* key, std::vector<double> v, const std::string& what) {
      const std::string n = num(static_cast<std::uint64_t>(v.size()));
      for (const auto& [q, tag] : {std::pair{0.1, "p10"}, std::pair{0.5, "p50"}, std::pair{0.9, "p90"}})
      {
        const std::string value = v.empty() ? std::string() : num(quantile(v, q));
        r.push_back({sec, std::string(key) + "_" + tag, value, n,
                     std::string("The ") + tag + " of " + what + " over " + n + " spectra."});
      }
    };
    quantiles("best_evalue", t.best_evalue, "the best reported E-value of tagged and placed spectra");
    quantiles("n_peaks_kept", t.n_kept, "the peaks kept after preprocessing");
    quantiles("int_gini", t.gini, "the intensity Gini coefficient");
    return r;
  }
}
