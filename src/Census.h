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
// enum value at the end and bumps kVersion):
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
  inline constexpr int kVersion = 1;

  /// Per-spectrum status. Append-only (see the file comment).
  enum class Status : std::uint8_t
  {
    Empty = 0,
    NoPrecursor,
    NoSignal,
    BadPrecursor,
    TooFewPeaks,
    NoTags,
    Filtered,
    Placed,
    Tagged,
  };
  inline constexpr std::size_t kStatusCount = 9;

  inline const char* name(Status s)
  {
    static constexpr const char* names[kStatusCount] = {
        "empty", "no_precursor", "no_signal", "bad_precursor", "too_few_peaks",
        "no_tags", "filtered", "placed", "tagged"};
    const auto i = static_cast<std::size_t>(s);
    return i < kStatusCount ? names[i] : "unknown";
  }

  /// True for the statuses of spectra the tagger processed (counted in n_ms2).
  inline bool processed(Status s) { return s != Status::Empty && s != Status::NoPrecursor; }

  /// What the tagging loop knows about one MS2 spectrum.
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

  inline Status classify(const Facts& f)
  {
    if (f.empty) return Status::Empty;
    if (!f.has_precursor) return Status::NoPrecursor;
    if (f.n_peaks == 0) return Status::NoSignal;
    if (!(f.precursor_mz > 0) || !std::isfinite(f.precursor_mz)) return Status::BadPrecursor;
    if (!f.enough_peaks) return Status::TooFewPeaks;
    if (f.n_found == 0) return Status::NoTags;
    if (f.n_reported == 0) return Status::Filtered;
    if (f.count_placements && f.n_placed > 0) return Status::Placed;
    return Status::Tagged;
  }

  /// Sort non-negative, finite floats ascending (+0.0 and -0.0 must already
  /// be one value: signal() stores +0.0). LSD radix sort on the bit patterns,
  /// which order exactly as the values do for non-negative floats: the census
  /// sorts every spectrum's intensities, and at a few hundred peaks or more
  /// std::sort was most of the -census cost. The result equals std::sort's.
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

  /// Gini coefficient of @p v (sorted in place): 0 for equal values, 1 - 1/n
  /// for one non-zero value among n. The values must be >= 0 with a positive
  /// sum.
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

  /// Peak facts read from the input spectrum itself.
  struct Signal
  {
    std::size_t n_peaks = 0;  ///< finite m/z, positive and finite intensity
    bool has_gini = false;    ///< false when no intensity is positive
    double gini = 0;          ///< int_gini
  };

  /// n_peaks and int_gini of @p spec. int_gini is over every peak with a
  /// finite m/z and a finite, non-negative intensity: zero-intensity peaks
  /// (profile padding) are part of the population, NaN and negative ones are
  /// not. It is our own training-free signal, not Xrea.
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

  /// The facts of one reported tag that the census reads.
  struct TagView
  {
    double evalue = 0;
    double low_mz = 0, high_mz = 0;
    std::size_t n_res = 0;
    float min_conf = 0, mean_conf = 0;
    float peak_tic = 0;  ///< summed intensity of the tag's path peaks (BestTagTIC)
    bool cz = false;     ///< read as c/z-dot ions (1.12 #15 phase B), else b/y
    bool ax = false;     ///< read as a/x ions (1.13 item 11)
  };

  inline constexpr std::size_t kNone = static_cast<std::size_t>(-1);

  /// The reported tag with the minimum E-value, ties to the first output
  /// position; kNone for none. Multi-length rows are ordered by length, so
  /// this is not necessarily row 0. The rows are not reordered.
  inline std::size_t bestTag(const std::vector<TagView>& rows)
  {
    std::size_t best = kNone;
    for (std::size_t i = 0; i < rows.size(); ++i)
      if (best == kNone || rows[i].evalue < rows[best].evalue) best = i;
    return best;
  }

  /// Total length of the union of the intervals [lo, hi] in @p iv (sorted in place).
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

  /// Total length of the union of the intervals [lo, hi].
  inline double tagCover(std::vector<std::pair<double, double>> iv) { return unionLength(iv); }

  /// tag_cover of the reported rows: the union of their [low_mz, high_mz].
  inline double tagCoverOf(const std::vector<TagView>& rows)
  {
    static thread_local std::vector<std::pair<double, double>> iv;
    iv.clear();
    for (const TagView& t : rows) iv.emplace_back(t.low_mz, t.high_mz);
    return unionLength(iv);
  }

  /// One census row. Fields that were not computed for a spectrum are written
  /// empty (see appendRow).
  struct Row
  {
    std::size_t index = 0;      ///< input index
    double rt = 0;
    bool has_precursor = false;
    double precursor_mz = 0;
    int charge_given = 0;       ///< 0 = none
    int charge_used = 0;        ///< 2 when none was given
    std::size_t n_peaks = 0;
    bool has_gini = false;
    double gini = 0;
    bool prepared = false;      ///< n_kept, n_edges and n_compl are valid
    std::size_t n_kept = 0, n_edges = 0, n_compl = 0;
    Status status = Status::Empty;
    std::size_t n_found = 0, n_reported = 0;
    bool has_best = false;      ///< best and tag_cover are valid
    TagView best;
    double tag_cover = 0;
  };

  /// The census TSV header line with or without best_ion_series (@p
  /// ion_series: a run that can read c/z, IonSeries::seriesColumn).
  inline std::string header(bool ion_series)
  {
    return std::string("index\tspectrum\trt\tprecursor_mz\tcharge_given\tcharge_used\tn_peaks\tn_peaks_kept"
                       "\tn_edges\tn_compl\tint_gini\tstatus\tn_found\tn_reported\tbest_evalue\tbest_len"
                       "\tbest_min_conf\tbest_mean_conf\tbest_tic\ttag_cover")
         + (ion_series ? "\tbest_ion_series\n" : "\n");
  }

  /// The run's optional census columns: one run-level setting, set once by
  /// the tool before the census table opens (and before any thread starts),
  /// read by header(). A reader of the census that takes header() as the
  /// layout (-census_ids, CensusIds::joinTable) thus sees the columns this
  /// run writes, with no argument of its own (PLAN-INTEGRATION 2.3/2). The
  /// default is the 1.11 layout.
  struct RunColumns
  {
    bool ion_series = false;  ///< best_ion_series (#15 phase B)
  };
  inline RunColumns& runColumns()
  {
    static RunColumns c;
    return c;
  }

  /// The census TSV header line of this run (runColumns()).
  inline std::string header() { return header(runColumns().ion_series); }

  /// Free text as one TSV field: a tab, CR or LF becomes a space.
  inline void appendField(std::string& buf, const std::string& text)
  {
    if (text.find_first_of("\t\r\n") == std::string::npos) { buf += text; return; }
    for (char c : text) buf += (c == '\t' || c == '\r' || c == '\n') ? ' ' : c;
  }

  /// Append one census row (20 fields, 21 with @p ion_series, and a newline).
  inline void appendRow(std::string& buf, const Row& r, const std::string& native_id, bool ion_series = false)
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
      appendNum(buf, r.tag_cover, fixed, 4);
    }
    else buf += "\t\t\t\t\t";
    if (ion_series)
    {
      buf += '\t';
      if (r.has_best) buf += r.best.cz ? "cz" : r.best.ax ? "ax" : "by";
    }
    buf += '\n';
  }

  /// Linear-interpolation quantile (type 7, numpy's default) of @p v, sorted
  /// in place; NaN for none.
  inline double quantile(std::vector<double>& v, double q)
  {
    if (v.empty()) return std::numeric_limits<double>::quiet_NaN();
    std::sort(v.begin(), v.end());
    const double h = (static_cast<double>(v.size()) - 1.0) * q;
    const std::size_t lo = static_cast<std::size_t>(std::floor(h));
    if (lo + 1 >= v.size()) return v.back();
    return v[lo] + (h - static_cast<double>(lo)) * (v[lo + 1] - v[lo]);
  }

  /// Run-level counts and samples, one per thread, merged in thread order.
  struct Tally
  {
    std::array<std::uint64_t, kStatusCount> by_status{};
    std::uint64_t ms2_seen = 0;   ///< rows written
    std::uint64_t no_charge = 0;  ///< processed spectra without a precursor charge
    std::vector<double> best_evalue;  ///< tagged and placed spectra
    std::vector<double> n_kept;       ///< processed spectra that were prepared
    std::vector<double> gini;         ///< processed spectra with a Gini

    void add(const Row& r)
    {
      ++by_status[static_cast<std::size_t>(r.status)];
      ++ms2_seen;
      if (!processed(r.status)) return;
      if (r.charge_given <= 0) ++no_charge;
      if (r.prepared) n_kept.push_back(static_cast<double>(r.n_kept));
      if (r.has_gini) gini.push_back(r.gini);
      if (r.has_best && (r.status == Status::Tagged || r.status == Status::Placed))
        best_evalue.push_back(r.best.evalue);
    }
    void merge(const Tally& o)
    {
      for (std::size_t i = 0; i < kStatusCount; ++i) by_status[i] += o.by_status[i];
      ms2_seen += o.ms2_seen;
      no_charge += o.no_charge;
      best_evalue.insert(best_evalue.end(), o.best_evalue.begin(), o.best_evalue.end());
      n_kept.insert(n_kept.end(), o.n_kept.begin(), o.n_kept.end());
      gini.insert(gini.end(), o.gini.begin(), o.gini.end());
    }
    /// Spectra the tagger processed: the "N MS2 spectra" of the log.
    std::uint64_t n_processed() const
    {
      std::uint64_t n = 0;
      for (std::size_t i = 0; i < kStatusCount; ++i)
        if (Census::processed(static_cast<Status>(i))) n += by_status[i];
      return n;
    }
  };

  /// The `census` section of -census_summary_out (after the run rows).
  /// @p input_spectra counts every input spectrum, all MS levels (the
  /// subsampling basis); @p subsampled is -subsample_spectra/-subsample_fraction.
  inline std::vector<Digest::Row> summaryRows(const Tally& t, std::uint64_t input_spectra, bool subsampled)
  {
    using Digest::num;
    const std::string sec = "census";
    const std::string seen = num(t.ms2_seen);
    std::vector<Digest::Row> r;
    r.push_back({sec, "census_version", std::to_string(kVersion), "-",
                 "The census follows format " + std::to_string(kVersion) +
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
    for (std::size_t i = 0; i < kStatusCount; ++i)
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
