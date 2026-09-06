// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "IndexedMzMLReader.h"

#include <OpenMS/FORMAT/HANDLERS/MzMLSpectrumDecoder.h>
#include <OpenMS/METADATA/Precursor.h>

#include <algorithm>
#include <charconv>
#include <fstream>
#include <string_view>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    /// The value of attribute @p name inside the single XML tag containing
    /// @p at, or empty when the tag does not carry it.
    ///
    /// The tag is delimited first, then its attributes are read, because
    /// attribute ORDER is not fixed by the schema: searching forward from an
    /// accession for `value="` would read the next element's value whenever a
    /// writer puts value before accession.
    std::string_view tag_attr(std::string_view xml, std::size_t at, std::string_view name)
    {
      const std::size_t begin = xml.rfind('<', at);
      std::size_t end = xml.find('>', at);
      if (begin == std::string_view::npos || end == std::string_view::npos) return {};
      const std::string_view tag = xml.substr(begin, end - begin);
      // name + '=' + '"', matched without building a string.
      std::size_t k = tag.find(name);
      while (k != std::string_view::npos &&
             (k + name.size() + 1 >= tag.size() || tag[k + name.size()] != '=' ||
              tag[k + name.size() + 1] != '"'))
      {
        k = tag.find(name, k + 1);
      }
      if (k == std::string_view::npos) return {};
      const std::size_t vb = k + name.size() + 2;
      const std::size_t ve = tag.find('"', vb);
      if (ve == std::string_view::npos) return {};
      return tag.substr(vb, ve - vb);
    }

    // The needles are spelled out so nothing is built per call: a spectrum
    // scrape runs a dozen of these, and constructing a std::string each time
    // cost more than the searches did.
    constexpr std::string_view kMsLevel = "accession=\"MS:1000511\"";
    constexpr std::string_view kScanTime = "accession=\"MS:1000016\"";
    constexpr std::string_view kSelectedMz = "accession=\"MS:1000744\"";
    constexpr std::string_view kChargeState = "accession=\"MS:1000041\"";
    constexpr std::string_view kPeakIntensity = "accession=\"MS:1000042\"";
    constexpr std::string_view kIsoTarget = "accession=\"MS:1000827\"";
    constexpr std::string_view kIsoLower = "accession=\"MS:1000828\"";
    constexpr std::string_view kIsoUpper = "accession=\"MS:1000829\"";
    constexpr std::string_view kValue = "value";
    constexpr std::string_view kUnit = "unitAccession";

    /// `value` of the first cvParam matching @p needle in [from, to).
    std::string_view cv_value(std::string_view xml,
                              std::string_view needle,
                              std::size_t from,
                              std::size_t to,
                              std::string_view attr = kValue)
    {
      const std::size_t k = xml.find(needle, from);
      if (k == std::string_view::npos || k >= to) return {};
      return tag_attr(xml, k, attr);
    }

    template <typename T>
    bool to_number(std::string_view s, T& out)
    {
      if (s.empty()) return false;
      // from_chars does not accept a leading '+' or surrounding space, which
      // no mzML writer emits; anything it rejects is treated as absent rather
      // than guessed at.
      const auto r = std::from_chars(s.data(), s.data() + s.size(), out);
      return r.ec == std::errc() && r.ptr == s.data() + s.size();
    }

    std::size_t find_or(std::string_view xml, std::string_view what, std::size_t from,
                        std::size_t fallback)
    {
      const std::size_t k = xml.find(what, from);
      return k == std::string_view::npos ? fallback : k;
    }
  }

  /****************************************************************************/
  struct IndexedMzMLReader::Impl
  {
    std::string path;
    /// Byte offset of each spectrum, ascending, plus a terminator: the offset
    /// one past the last spectrum, so every spectrum has an end.
    std::shared_ptr<const std::vector<std::uint64_t>> offsets;
    std::ifstream in;
    MzMLSpectrumDecoder decoder;
    std::string buffer;
    bool ok = false;

    explicit Impl(std::string p) : path(std::move(p)) {}
  };

  /****************************************************************************/
  IndexedMzMLReader::IndexedMzMLReader(const std::string& path)
    : impl_(std::make_unique<Impl>(path))
  {
    std::ifstream f(path, std::ios::binary);
    if (!f) return;
    f.seekg(0, std::ios::end);
    const std::int64_t size = f.tellg();
    if (size <= 0) return;

    // indexListOffset sits in the last few hundred bytes of an indexed mzML.
    const std::int64_t tail_len = std::min<std::int64_t>(size, 4096);
    std::string tail(static_cast<std::size_t>(tail_len), '\0');
    f.seekg(size - tail_len);
    f.read(tail.data(), tail_len);
    if (!f) return;

    const std::size_t tb = tail.rfind("<indexListOffset>");
    const std::size_t te = tail.rfind("</indexListOffset>");
    if (tb == std::string::npos || te == std::string::npos || te <= tb) return;
    std::uint64_t index_offset = 0;
    const std::size_t vb = tb + std::string("<indexListOffset>").size();
    if (!to_number(std::string_view(tail).substr(vb, te - vb), index_offset)) return;
    if (index_offset == 0 || index_offset >= static_cast<std::uint64_t>(size)) return;

    // The index itself: small next to the run, so it is read whole.
    std::string index(static_cast<std::size_t>(size - static_cast<std::int64_t>(index_offset)), '\0');
    f.seekg(static_cast<std::streamoff>(index_offset));
    f.read(index.data(), static_cast<std::streamsize>(index.size()));
    if (!f) return;

    const std::size_t sb = index.find("<index name=\"spectrum\"");
    if (sb == std::string::npos) return;
    // Bounded by whichever comes first: this index's end, or the next index.
    // A file whose spectrum index is not closed would otherwise swallow the
    // chromatogram offsets and report them as spectra.
    const std::size_t se =
        std::min(find_or(index, "</index>", sb, index.size()),
                 find_or(index, "<index name=", sb + 1, index.size()));

    auto offsets = std::make_shared<std::vector<std::uint64_t>>();
    std::size_t k = sb;
    while (true)
    {
      k = index.find("<offset", k);
      if (k == std::string::npos || k >= se) break;
      const std::size_t gt = index.find('>', k);
      if (gt == std::string::npos) break;
      const std::size_t lt = index.find('<', gt);
      if (lt == std::string::npos) break;
      std::uint64_t off = 0;
      if (!to_number(std::string_view(index).substr(gt + 1, lt - gt - 1), off)) return;
      // Ascending is what makes [offset[i], offset[i+1]) a spectrum; an index
      // that is not ordered is not one this reader can use.
      if (!offsets->empty() && off <= offsets->back()) return;
      offsets->push_back(off);
      k = lt;
    }
    if (offsets->empty()) return;
    if (offsets->back() >= index_offset) return;

    // The terminator: the last spectrum ends where the list does.
    {
      const std::int64_t probe_len =
          std::min<std::int64_t>(static_cast<std::int64_t>(index_offset) -
                                     static_cast<std::int64_t>(offsets->back()),
                                 std::int64_t{1} << 22);
      std::string probe(static_cast<std::size_t>(probe_len), '\0');
      f.seekg(static_cast<std::streamoff>(offsets->back()));
      f.read(probe.data(), probe_len);
      if (!f) return;
      const std::size_t end = probe.find("</spectrum>");
      if (end == std::string::npos) return;
      const std::size_t after = end + std::string("</spectrum>").size();

      // The index must list EVERY spectrum, not merely valid ones: a
      // truncated index parses cleanly and would quietly shorten the run.
      // After the last one the list must close, with no further spectrum
      // in between.
      const std::size_t close = probe.find("</spectrumList>", after);
      const std::size_t next = probe.find("<spectrum", after);
      if (close == std::string::npos) return;      // list never closes in view
      if (next != std::string::npos && next < close) return; // more spectra than offsets

      offsets->push_back(offsets->back() + after);
    }

    // Three offsets are checked to actually point at a spectrum: first,
    // middle and last.
    //
    // An index that is stale -- a file edited, concatenated or truncated
    // after it was written -- otherwise decodes garbage, and garbage here is
    // the worst kind of failure: domParseSpectrum throws per spectrum, every
    // spectrum comes back empty, and the run reports a clean zero. Checking
    // one offset would pass on a file whose header is intact and whose body
    // has shifted; checking three costs two extra reads.
    {
      const std::size_t last = offsets->size() - 2; // -1 is the terminator
      for (const std::size_t k : {std::size_t{0}, last / 2, last})
      {
        std::string head(64, '\0');
        f.seekg(static_cast<std::streamoff>((*offsets)[k]));
        f.read(head.data(), static_cast<std::streamsize>(head.size()));
        if (!f || head.find("<spectrum") == std::string::npos) return;
      }
    }

    impl_->offsets = offsets;
    impl_->in.open(path, std::ios::binary);
    impl_->ok = impl_->in.good();
  }

  IndexedMzMLReader::IndexedMzMLReader(const IndexedMzMLReader& other)
    : impl_(std::make_unique<Impl>(other.impl_->path))
  {
    impl_->offsets = other.impl_->offsets;
    if (!other.impl_->ok) return;
    impl_->in.open(impl_->path, std::ios::binary);
    impl_->ok = impl_->in.good();
  }

  IndexedMzMLReader::~IndexedMzMLReader() = default;

  bool IndexedMzMLReader::ok() const { return impl_->ok; }

  Size IndexedMzMLReader::getNrSpectra() const
  {
    // One offset per spectrum plus the terminator.
    return impl_->ok ? static_cast<Size>(impl_->offsets->size() - 1) : 0;
  }

  /****************************************************************************/
  MSSpectrum IndexedMzMLReader::getSpectrum(Size i) { return read_(i, /*want_peaks=*/true); }

  bool IndexedMzMLReader::reportsSpectrumMetadata(Size n)
  {
    const Size probe = std::min<Size>(getNrSpectra(), n);
    for (Size i = 0; i < probe; ++i)
    {
      const MSSpectrum s = read_(i, /*want_peaks=*/false);
      if (s.getMSLevel() == 2 && !s.getPrecursors().empty()) return true;
    }
    return false;
  }

  MSSpectrum IndexedMzMLReader::read_(Size i, bool want_peaks)
  {
    MSSpectrum spec;
    if (!impl_->ok || i + 1 >= impl_->offsets->size()) return spec;
    const std::uint64_t begin = (*impl_->offsets)[i];
    const std::uint64_t end = (*impl_->offsets)[i + 1];
    if (end <= begin) return spec;

    // Two-stage read: the HEAD first, and the body only if this spectrum's
    // peaks are actually wanted.
    //
    // All the metadata sits before <binaryDataArrayList>, and on a run with
    // profile MS1 the arrays are almost the whole element (57 KB of a 58 KB
    // spectrum). Reading every spectrum whole to discover it is an MS1 and
    // then discarding it moved 81 MB per run for nothing.
    const std::uint64_t len = end - begin;
    constexpr std::uint64_t kHead = 16384;
    const std::uint64_t head_len = std::min(len, kHead);
    impl_->buffer.assign(static_cast<std::size_t>(head_len), '\0');
    impl_->in.clear();
    impl_->in.seekg(static_cast<std::streamoff>(begin));
    impl_->in.read(impl_->buffer.data(), static_cast<std::streamsize>(head_len));
    if (!impl_->in) return spec;

    // The head is only known to hold the whole metadata region once the
    // arrays have been seen; otherwise fall back to the full element rather
    // than scrape a truncated one.
    auto read_rest = [&]() {
      if (impl_->buffer.size() >= len) return true;
      impl_->buffer.resize(static_cast<std::size_t>(len), '\0');
      impl_->in.clear();
      impl_->in.seekg(static_cast<std::streamoff>(begin + head_len));
      impl_->in.read(impl_->buffer.data() + head_len,
                     static_cast<std::streamsize>(len - head_len));
      return static_cast<bool>(impl_->in);
    };
    if (impl_->buffer.find("<binaryDataArrayList") == std::string::npos && len > head_len)
    {
      if (!read_rest()) return spec;
    }

    // MS level first, from whatever is in the buffer now: it decides whether
    // the body is worth reading at all.
    constexpr std::string_view kArrays = "<binaryDataArrayList";
    int ms_level = 0;
    {
      const std::string_view head_view(impl_->buffer);
      const std::size_t cut = head_view.find(kArrays);
      const std::string_view h = cut == std::string_view::npos ? head_view : head_view.substr(0, cut);
      if (to_number(cv_value(h, kMsLevel, 0, h.size()), ms_level) && ms_level > 0)
        spec.setMSLevel(static_cast<UInt>(ms_level));
    }

    // Peaks through OpenMS's own decoder, so the binary encodings (zlib,
    // numpress, 32/64 bit) stay its problem -- but only for MS2, since that
    // is all the caller tags. Skipping the rest avoids a DOM parse and a
    // zlib inflate per MS1: on a run whose MS1 spectra are 57 KB each that
    // is most of the file's bytes, never used.
    //
    // This may GROW the buffer, so every view below is taken afterwards.
    if (ms_level == 2 && want_peaks)
    {
      if (!read_rest()) return MSSpectrum();
      try
      {
        impl_->decoder.domParseSpectrum(impl_->buffer, spec);
        // domParseSpectrum resets the spectrum, so the level goes back on.
        spec.setMSLevel(static_cast<UInt>(ms_level));
      }
      catch (const Exception::BaseException&)
      {
        return MSSpectrum();
      }
    }
    else
    {
      // Native id still travels: a caller may report on a spectrum it does
      // not tag.
      const std::string_view head_view(impl_->buffer);
      const std::size_t st = head_view.find("<spectrum");
      if (st != std::string_view::npos)
      {
        const std::string_view id = tag_attr(head_view, st + 1, "id");
        if (!id.empty()) spec.setNativeID(std::string(id));
      }
    }

    // The rest of the metadata, from the buffer in its final state. Only the
    // HEAD is scanned: everything here appears before <binaryDataArrayList>,
    // and the arrays after it are base64 that makes up almost the whole
    // element. Searching the whole element cost more, on small files, than
    // the metadata pre-pass this reader exists to avoid.
    const std::string_view whole(impl_->buffer);
    const std::size_t head = whole.find(kArrays);
    const std::string_view xml =
        head == std::string_view::npos ? whole : whole.substr(0, head);
    const std::size_t n = xml.size();

    double rt = 0;
    if (to_number(cv_value(xml, kScanTime, 0, n), rt))
    {
      // mzML records the unit; minutes are the common one and OpenMS wants
      // seconds. An absent unit is treated as minutes, which is what the
      // mzML specification's own example uses and what OpenMS assumes.
      const std::string_view unit = cv_value(xml, kScanTime, 0, n, kUnit);
      spec.setRT(unit == "UO:0000010" ? rt : rt * 60.0);
    }

    // Precursors: one OpenMS Precursor per SELECTED ION, matching the mzPeak
    // reader, so a window with several ions keeps all of them.
    const std::size_t plb = xml.find("<precursorList");
    if (plb == std::string_view::npos) return spec;
    const std::size_t ple = find_or(xml, "</precursorList>", plb, n);

    // Element matching is by NAME, not by "<name " with a space: a writer may
    // emit <precursor> or <selectedIon> with no attributes at all, and both
    // loops must still advance. An earlier version searched for the
    // space-suffixed form with a fallback to the bare one, and on a file that
    // used the bare form the fallback restarted from the same position every
    // iteration -- an infinite loop that appended a precursor each time and
    // ran a 1.8 GB file to 36 GB of memory before it was killed.
    auto element_at = [&](std::size_t at, std::string_view name) {
      if (at == std::string_view::npos || at + name.size() >= n) return false;
      const char after = xml[at + name.size()];
      // <selectedIonList> must not match <selectedIon>.
      return after == '>' || after == ' ' || after == '\t' || after == '\n' ||
             after == '\r' || after == '/';
    };

    std::size_t p = plb;
    while (true)
    {
      p = xml.find("<precursor", p);
      if (p == std::string_view::npos || p >= ple) break;
      if (!element_at(p, "<precursor")) { p += 10; continue; }

      // This precursor runs to the next one, or to the end of the list.
      std::size_t p_end = ple;
      for (std::size_t q = p + 10; q < ple;)
      {
        q = xml.find("<precursor", q);
        if (q == std::string_view::npos || q >= ple) break;
        if (element_at(q, "<precursor")) { p_end = q; break; }
        q += 10;
      }

      double target = 0, lower = 0, upper = 0;
      const std::size_t iwb = xml.find("<isolationWindow", p);
      if (iwb != std::string_view::npos && iwb < p_end)
      {
        const std::size_t iwe = find_or(xml, "</isolationWindow>", iwb, p_end);
        to_number(cv_value(xml, kIsoTarget, iwb, iwe), target);
        to_number(cv_value(xml, kIsoLower, iwb, iwe), lower);
        to_number(cv_value(xml, kIsoUpper, iwb, iwe), upper);
      }

      bool any_ion = false;
      std::size_t s = p;
      while (true)
      {
        s = xml.find("<selectedIon", s);
        if (s == std::string_view::npos || s >= p_end) break;
        if (!element_at(s, "<selectedIon")) { s += 12; continue; }
        const std::size_t s_end = find_or(xml, "</selectedIon>", s, p_end);

        Precursor prec;
        double mz = 0;
        int charge = 0;
        double intensity = 0;
        if (to_number(cv_value(xml, kSelectedMz, s, s_end), mz)) prec.setMZ(mz);
        else if (target > 0) prec.setMZ(target);
        if (to_number(cv_value(xml, kChargeState, s, s_end), charge)) prec.setCharge(charge);
        if (to_number(cv_value(xml, kPeakIntensity, s, s_end), intensity))
          prec.setIntensity(static_cast<float>(intensity));
        if (lower > 0) prec.setIsolationWindowLowerOffset(lower);
        if (upper > 0) prec.setIsolationWindowUpperOffset(upper);
        spec.getPrecursors().push_back(std::move(prec));
        any_ion = true;
        // Always forward, whatever was or was not found.
        s = s_end > s ? s_end : s + 12;
      }

      // A precursor with no selected ion still describes an isolation window.
      if (!any_ion && target > 0)
      {
        Precursor prec;
        prec.setMZ(target);
        if (lower > 0) prec.setIsolationWindowLowerOffset(lower);
        if (upper > 0) prec.setIsolationWindowUpperOffset(upper);
        spec.getPrecursors().push_back(std::move(prec));
      }
      p = p_end > p ? p_end : p + 10;
    }
    return spec;
  }
}
