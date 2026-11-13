// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "IndexedMzMLReader.h"
#include "MzMLDirectDecoder.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/HANDLERS/MzMLSpectrumDecoder.h>
#include <OpenMS/IONMOBILITY/IMTypes.h>
#include <OpenMS/METADATA/MetaInfoInterface.h>
#include <OpenMS/METADATA/MetaInfoRegistry.h>
#include <OpenMS/METADATA/Precursor.h>
#include <OpenMS/METADATA/ScanWindow.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <charconv>
#include <cstring>
#include <fstream>
#include <limits>
#include <memory>
#include <new>
#include <locale.h>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

#ifdef _OPENMP
#include <omp.h>
#endif

#if defined(__APPLE__)
#include <xlocale.h>
#endif

#ifdef _WIN32
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#else
#  include <cerrno>
#  include <fcntl.h>
#  include <unistd.h>
#endif

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
    constexpr std::string_view kScanLow = "accession=\"MS:1000501\"";
    constexpr std::string_view kScanHigh = "accession=\"MS:1000500\"";
    constexpr std::string_view kInvK0 = "accession=\"MS:1002815\"";
    constexpr std::string_view kDriftTime = "accession=\"MS:1002476\"";
    constexpr std::string_view kFaimsCV = "accession=\"MS:1001581\"";
    // Step 0 (1.12): fields OpenMS's MzMLHandler reads and this reader did not.
    constexpr std::string_view kCentroid = "accession=\"MS:1000127\"";
    constexpr std::string_view kProfile = "accession=\"MS:1000128\"";
    constexpr std::string_view kPossibleCharge = "accession=\"MS:1000633\"";
    constexpr std::string_view kFilterString = "accession=\"MS:1000512\"";
    constexpr std::string_view kActivationEnergy = "accession=\"MS:1000509\"";
    constexpr std::string_view kArrays = "<binaryDataArrayList";
    constexpr std::string_view kValue = "value";
    constexpr std::string_view kUnit = "unitAccession";

    /// xml.find(what, from) if that starts before @p to, else npos -- without
    /// scanning past @p to (1.12.2). A match may still END after @p to, as
    /// `k = xml.find(...); k < to` allows, so every `find ... k < to` test
    /// can use this instead and give the same answer. An absent needle used
    /// to cost a scan of the whole spectrum head.
    ///
    /// memmem where the C library has it: the needles here are mostly
    /// `accession="MS:..."`, whose first letter recurs every few bytes of a
    /// cvParam, and string_view::find stops at each one to compare; glibc's
    /// memmem skips ahead. Same answer, the first occurrence.
    std::size_t find_before(std::string_view xml, std::string_view what, std::size_t from, std::size_t to)
    {
      to = std::min(to, xml.size());
      if (from >= to || what.empty()) return std::string_view::npos;
      const std::size_t lim = std::min(xml.size(), to + what.size() - 1);
#if defined(__GLIBC__) || defined(__APPLE__)
      const void* hit = ::memmem(xml.data() + from, lim - from, what.data(), what.size());
      return hit ? static_cast<std::size_t>(static_cast<const char*>(hit) - xml.data()) : std::string_view::npos;
#else
      return xml.substr(0, lim).find(what, from);
#endif
    }

    /// `value` of the first cvParam matching @p needle in [from, to).
    std::string_view cv_value(std::string_view xml,
                              std::string_view needle,
                              std::size_t from,
                              std::size_t to,
                              std::string_view attr = kValue)
    {
      const std::size_t k = find_before(xml, needle, from, to);
      if (k == std::string_view::npos) return {};
      return tag_attr(xml, k, attr);
    }

    /// The accession inside a needle such as `accession="MS:1000511"`.
    constexpr std::string_view needle_accession(std::string_view needle)
    {
      return needle.substr(11, needle.size() - 12);
    }

    /// The dissociation methods of an <activation>, as OpenMS's MzMLHandler
    /// maps them (70cebcd144): the supplemental terms MS:1002678/1002679 give
    /// EThcD/ETciD, as there. MS:1002680 (supplemental collision energy) and
    /// the other meta-value-only terms are not mapped.
    struct ActivationTerm
    {
      std::string_view accession;
      Precursor::ActivationMethod method;
    };
    constexpr ActivationTerm kActivationTerms[] = {
        {"MS:1000133", Precursor::ActivationMethod::CID},   {"MS:1000134", Precursor::ActivationMethod::PD},
        {"MS:1000135", Precursor::ActivationMethod::PSD},   {"MS:1000136", Precursor::ActivationMethod::SID},
        {"MS:1000242", Precursor::ActivationMethod::BIRD},  {"MS:1000250", Precursor::ActivationMethod::ECD},
        {"MS:1000262", Precursor::ActivationMethod::IMD},   {"MS:1000282", Precursor::ActivationMethod::SORI},
        {"MS:1000422", Precursor::ActivationMethod::HCD},   {"MS:1002472", Precursor::ActivationMethod::TRAP},
        {"MS:1002481", Precursor::ActivationMethod::HCID},  {"MS:1000433", Precursor::ActivationMethod::LCID},
        {"MS:1000435", Precursor::ActivationMethod::PHD},   {"MS:1000598", Precursor::ActivationMethod::ETD},
        {"MS:1002679", Precursor::ActivationMethod::ETciD}, {"MS:1002678", Precursor::ActivationMethod::EThcD},
        {"MS:1003182", Precursor::ActivationMethod::ETciD}, {"MS:1002631", Precursor::ActivationMethod::EThcD},
        {"MS:1000599", Precursor::ActivationMethod::PQD},   {"MS:1001880", Precursor::ActivationMethod::INSOURCE},
        {"MS:1002000", Precursor::ActivationMethod::LIFT},
    };

    /// @p v with the XML entities a writer may put in an attribute value
    /// (the five predefined ones and numeric character references) decoded,
    /// as Xerces hands them to OpenMS. Anything malformed is kept verbatim.
    std::string xml_unescape(std::string_view v)
    {
      if (v.find('&') == std::string_view::npos) return std::string(v);
      std::string out;
      out.reserve(v.size());
      for (std::size_t i = 0; i < v.size(); ++i)
      {
        const std::size_t semi = v[i] == '&' ? v.find(';', i) : std::string_view::npos;
        if (semi == std::string_view::npos || semi - i > 10)
        {
          out += v[i];
          continue;
        }
        const std::string_view e = v.substr(i + 1, semi - i - 1);
        unsigned long cp = 0;
        bool ok = true;
        if (e == "amp") cp = '&';
        else if (e == "lt") cp = '<';
        else if (e == "gt") cp = '>';
        else if (e == "quot") cp = '"';
        else if (e == "apos") cp = '\'';
        else if (e.size() > 1 && e[0] == '#')
        {
          const bool hex = e[1] == 'x' || e[1] == 'X';
          const std::string_view digits = e.substr(hex ? 2 : 1);
          const auto r = std::from_chars(digits.data(), digits.data() + digits.size(), cp, hex ? 16 : 10);
          ok = !digits.empty() && r.ec == std::errc() && r.ptr == digits.data() + digits.size() && cp > 0 &&
               cp <= 0x10FFFF;
        }
        else ok = false;
        if (!ok)
        {
          out += v[i];
          continue;
        }
        // UTF-8, as Xerces' transcoding to the std::string OpenMS keeps.
        if (cp < 0x80) out += static_cast<char>(cp);
        else if (cp < 0x800)
        {
          out += static_cast<char>(0xC0 | (cp >> 6));
          out += static_cast<char>(0x80 | (cp & 0x3F));
        }
        else if (cp < 0x10000)
        {
          out += static_cast<char>(0xE0 | (cp >> 12));
          out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
          out += static_cast<char>(0x80 | (cp & 0x3F));
        }
        else
        {
          out += static_cast<char>(0xF0 | (cp >> 18));
          out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
          out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
          out += static_cast<char>(0x80 | (cp & 0x3F));
        }
        i = semi;
      }
      return out;
    }

    // The C-locale strtod, spelled per platform rather than through macros
    // that would leak into everything included after them.
#if defined(_WIN32)
    using c_locale_t = _locale_t;
    inline c_locale_t make_c_locale() { return _create_locale(LC_NUMERIC, "C"); }
    inline double strtod_c(const char* s, char** end, c_locale_t loc)
    {
      return _strtod_l(s, end, loc);
    }
#else
    using c_locale_t = locale_t;
    inline c_locale_t make_c_locale() { return newlocale(LC_NUMERIC_MASK, "C", nullptr); }
    inline double strtod_c(const char* s, char** end, c_locale_t loc)
    {
      return strtod_l(s, end, loc);
    }
#endif

    /// The "C" locale, once: mzML numbers always use '.' as the decimal
    /// point, and a locale-sensitive strtod would read 465.2078 as 465
    /// wherever the process locale says otherwise (de_DE and friends).
    c_locale_t c_locale()
    {
      static c_locale_t loc = make_c_locale();
      return loc;
    }

    /// Strict: the whole view must be the number, or it is treated as absent
    /// rather than guessed at.
    ///
    /// Integers go through from_chars, which is exact and available
    /// everywhere. Doubles do NOT: libc++ deletes the floating-point
    /// overload, so Apple clang rejects it outright. strtod_l is used
    /// instead -- correctly rounded, like from_chars, which a hand-rolled
    /// mantissa-and-exponent parser would not be, and a 1-ULP difference in
    /// a precursor m/z can move a tag across the tolerance.
    bool to_number(std::string_view s, double& out)
    {
      if (s.empty() || s.size() >= 64) return false;
      char buf[64];
      std::memcpy(buf, s.data(), s.size());
      buf[s.size()] = '\0';
      char* endp = nullptr;
      errno = 0;
      const double v = strtod_c(buf, &endp, c_locale());
      if (endp != buf + s.size() || errno == ERANGE) return false;
      out = v;
      return true;
    }

    template <typename T>
    bool to_number(std::string_view s, T& out)
    {
      if (s.empty()) return false;
      const auto r = std::from_chars(s.data(), s.data() + s.size(), out);
      return r.ec == std::errc() && r.ptr == s.data() + s.size();
    }

    std::size_t find_or(std::string_view xml, std::string_view what, std::size_t from,
                        std::size_t fallback)
    {
      const std::size_t k = xml.find(what, from);
      return k == std::string_view::npos ? fallback : k;
    }

    /// A tag name ends at whitespace or '>': <spectrum is not <spectrumList.
    bool is_name_end(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '>'; }

    /// "no offset here", for the scan's per-piece bookkeeping below.  At file
    /// scope, not inside scanSpectrumOffsets: MSVC refuses to construct a
    /// vector of a function-local struct whose member initialisers name a
    /// constant of the enclosing function.
    constexpr std::uint64_t kNoOffset = std::numeric_limits<std::uint64_t>::max();

    constexpr std::size_t kPage = 4096;
    struct AlignedDelete
    {
      void operator()(char* p) const { ::operator delete[](p, std::align_val_t{kPage}); }
    };

    /// A file read at explicit offsets: one call per read (pread, or
    /// ReadFile with an offset), where a stream needs a seek and a read and
    /// copies through its own buffer.
    class PositionedFile
    {
    public:
      PositionedFile() = default;
      PositionedFile(const PositionedFile&) = delete;
      PositionedFile& operator=(const PositionedFile&) = delete;
      ~PositionedFile() { close(); }

      bool open(const std::string& path)
      {
        close();
#ifdef _WIN32
        // Shared as std::ifstream shares; CreateFileA, as it opens a narrow path: under FASTag's
        // UTF-8 code page manifest both take UTF-8. No FILE_FLAG_RANDOM_ACCESS: the scan reads
        // pieces in ascending order and the readers walk forward through blocks of spectra, so
        // the cache manager's sequential read-ahead (on for the std::ifstream this replaces)
        // helps; switching it off is unmeasured on Windows, cold or over SMB.
        h_ = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
        return h_ != INVALID_HANDLE_VALUE;
#else
        fd_ = ::open(path.c_str(), O_RDONLY);
        return fd_ >= 0;
#endif
      }

      /// Exactly @p n bytes at @p offset into @p dst; false on an error or
      /// end of file, with the reason in error().
      bool read(std::uint64_t offset, char* dst, std::size_t n)
      {
        // At most 1 GiB per call: ReadFile takes a DWORD, and Darwin's pread
        // fails with EINVAL above INT_MAX bytes (Linux shortens the read).
        constexpr std::size_t kMaxCall = std::size_t{1} << 30;
        while (n > 0)
        {
#ifdef _WIN32
          OVERLAPPED ov{};
          ov.Offset = static_cast<DWORD>(offset & 0xffffffffu);
          ov.OffsetHigh = static_cast<DWORD>(offset >> 32);
          const DWORD want = static_cast<DWORD>(std::min(n, kMaxCall));
          DWORD got = 0;
          if (!ReadFile(h_, dst, want, &got, &ov))
          {
            const DWORD e = GetLastError();
            error_ = e == ERROR_HANDLE_EOF ? std::string("a short read (end of file)")
                                           : "a read error (Windows error " + std::to_string(e) + ")";
            return false;
          }
          if (got == 0)
          {
            error_ = "a short read (end of file)";
            return false;
          }
#else
          const ssize_t got = ::pread(fd_, dst, std::min(n, kMaxCall), static_cast<off_t>(offset));
          if (got < 0 && errno == EINTR) continue;
          if (got < 0)
          {
            error_ = std::string("a read error (") + std::strerror(errno) + ")";
            return false;
          }
          if (got == 0)
          {
            error_ = "a short read (end of file)";
            return false;
          }
#endif
          dst += got;
          offset += static_cast<std::uint64_t>(got);
          n -= static_cast<std::size_t>(got);
        }
        return true;
      }

      /// Why the last read() failed.
      const std::string& error() const { return error_; }

    private:
      void close()
      {
#ifdef _WIN32
        if (h_ != INVALID_HANDLE_VALUE) CloseHandle(h_);
        h_ = INVALID_HANDLE_VALUE;
#else
        if (fd_ >= 0) ::close(fd_);
        fd_ = -1;
#endif
      }
#ifdef _WIN32
      HANDLE h_ = INVALID_HANDLE_VALUE;
#else
      int fd_ = -1;
#endif
      std::string error_;
    };

    /// A page-aligned byte buffer that keeps its storage and never zero-fills.
    struct AlignedBuffer
    {
      std::unique_ptr<char[], AlignedDelete> data;
      std::size_t cap = 0;

      /// At least @p n bytes, the first @p keep of them preserved. False when
      /// the memory is not there.
      bool reserve(std::size_t n, std::size_t keep)
      {
        if (n <= cap) return true;
        std::size_t c = cap ? cap : 65536;
        while (c < n) c *= 2;
        std::unique_ptr<char[], AlignedDelete> p(
            static_cast<char*>(::operator new[](c, std::align_val_t{kPage}, std::nothrow)));
        if (!p) return false;
        if (keep) std::memcpy(p.get(), data.get(), keep);
        data = std::move(p);
        cap = c;
        return true;
      }
    };

    /// What one piece of the file contributes to the scan.
    struct Piece
    {
      std::vector<std::uint64_t> spectra;
      std::uint64_t list_open = kNoOffset;  ///< first <spectrumList starting in this piece
      std::uint64_t list_close = kNoOffset; ///< first </spectrumList starting in this piece
      bool read = true;
    };
  }

  namespace
  {
    /// One cvParam of a <referenceableParamGroup>, its attributes raw (the
    /// value is unescaped where it is used as a string).
    struct GroupParam
    {
      std::string accession, value, unit;
    };
    /// <referenceableParamGroup> id -> its cvParams, in file order.
    using ParamGroups = std::unordered_map<std::string, std::vector<GroupParam>>;

    /// The file's referenceableParamGroupList, read from the bytes before the
    /// first spectrum (@p head_len of them, the run header). Empty when the
    /// file has none or the head cannot be read; never throws.
    std::shared_ptr<const ParamGroups> read_param_groups(const std::string& path, std::uint64_t head_len)
    {
      auto groups = std::make_shared<ParamGroups>();
      try
      {
        // The header of a real mzML is a few KB; a file whose first spectrum
        // starts beyond this cap keeps no groups rather than a huge read.
        constexpr std::uint64_t kMaxHead = std::uint64_t{64} << 20;
        if (head_len == 0 || head_len > kMaxHead) return groups;
        std::ifstream f(path, std::ios::binary);
        if (!f) return groups;
        std::string head(static_cast<std::size_t>(head_len), '\0');
        f.read(head.data(), static_cast<std::streamsize>(head_len));
        if (!f) return groups;
        const std::string_view h(head);
        const std::size_t lb = h.find("<referenceableParamGroupList");
        if (lb == std::string_view::npos) return groups;
        const std::size_t le = find_or(h, "</referenceableParamGroupList>", lb, h.size());
        constexpr std::string_view kGroup = "<referenceableParamGroup";
        for (std::size_t g = h.find(kGroup, lb + 1); g != std::string_view::npos && g < le;
             g = h.find(kGroup, g + kGroup.size()))
        {
          // Not <referenceableParamGroupList> or a ...Ref.
          if (g + kGroup.size() >= h.size() || !is_name_end(h[g + kGroup.size()])) continue;
          const std::string_view id = tag_attr(h, g + 1, "id");
          const std::size_t ge = find_or(h, "</referenceableParamGroup>", g, le);
          std::vector<GroupParam>& params = (*groups)[std::string(id)];
          for (std::size_t c = h.find("<cvParam", g); c != std::string_view::npos && c < ge;
               c = h.find("<cvParam", c + 8))
          {
            GroupParam gp;
            gp.accession = std::string(tag_attr(h, c + 1, "accession"));
            gp.value = std::string(tag_attr(h, c + 1, "value"));
            gp.unit = std::string(tag_attr(h, c + 1, "unitAccession"));
            if (!gp.accession.empty()) params.push_back(std::move(gp));
          }
        }
      }
      catch (...)
      {
        groups->clear();
      }
      return groups;
    }
  }

  /****************************************************************************/
  struct IndexedMzMLReader::Impl
  {
    std::string path;
    /// Byte offset of each spectrum, ascending, plus a terminator: the offset
    /// one past the last spectrum, so every spectrum has an end.
    std::shared_ptr<const std::vector<std::uint64_t>> offsets;
    PositionedFile in;
    /// The spectrum being read, at the start of `raw`: page-aligned, never
    /// zero-filled, reused. The kernel copies into it from the page cache,
    /// and that copy is slow into a destination that is not aligned (see the
    /// offset scan). Placing the bytes at the same offset within a page as
    /// in the file was measured too: 7% slower reads than the old
    /// std::string, against 7% faster for this. `bytes` views them.
    AlignedBuffer raw;
    std::string_view bytes;
    MzMLSpectrumDecoder decoder;
    /// Peaks without a DOM (see MzMLDirectDecoder.h); OpenMS's decoder above
    /// takes every spectrum this one declines.
    MzMLDirectDecoder direct;
    bool direct_on = !MzMLDirectDecoder::disabledByEnvironment();
    std::size_t n_direct = 0;   ///< MS2 peaks decoded directly
    std::size_t n_openms = 0;   ///< MS2 peaks decoded by OpenMS
    std::size_t n_bad_mz = 0;   ///< getSpectrum() reads with a selected-ion m/z <= 0 or not finite
    std::size_t n_bad_mz_target = 0;  ///< ... of them given the isolation target instead
    bool ok = false;
    bool rebuilt = false; ///< offsets came from a scan, not the file's index
    /// The file's referenceableParamGroups, read once at open and shared by
    /// every per-thread copy; never null once the reader is ok().
    std::shared_ptr<const ParamGroups> groups;

    explicit Impl(std::string p) : path(std::move(p)) {}
  };

  namespace
  {
    /// The offsets the file's own index gives, plus the end of the last
    /// spectrum; null when there is no index or it does not describe this
    /// file's bytes. Stream @p f is open on a file of @p size bytes.
    std::shared_ptr<const std::vector<std::uint64_t>> offsets_from_index(std::ifstream& f,
                                                                         std::int64_t size)
    {
      // indexListOffset sits in the last few hundred bytes of an indexed mzML.
      const std::int64_t tail_len = std::min<std::int64_t>(size, 4096);
      std::string tail(static_cast<std::size_t>(tail_len), '\0');
      f.seekg(size - tail_len);
      f.read(tail.data(), tail_len);
      if (!f) return nullptr;

      const std::size_t tb = tail.rfind("<indexListOffset>");
      const std::size_t te = tail.rfind("</indexListOffset>");
      if (tb == std::string::npos || te == std::string::npos || te <= tb) return nullptr;
      std::uint64_t index_offset = 0;
      const std::size_t vb = tb + std::string("<indexListOffset>").size();
      if (!to_number(std::string_view(tail).substr(vb, te - vb), index_offset)) return nullptr;
      if (index_offset == 0 || index_offset >= static_cast<std::uint64_t>(size)) return nullptr;

      // The index itself: small next to the run, so it is read whole.
      std::string index(static_cast<std::size_t>(size - static_cast<std::int64_t>(index_offset)), '\0');
      f.seekg(static_cast<std::streamoff>(index_offset));
      f.read(index.data(), static_cast<std::streamsize>(index.size()));
      if (!f) return nullptr;

      const std::size_t sb = index.find("<index name=\"spectrum\"");
      if (sb == std::string::npos) return nullptr;
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
        if (!to_number(std::string_view(index).substr(gt + 1, lt - gt - 1), off)) return nullptr;
        // Ascending is what makes [offset[i], offset[i+1]) a spectrum; an index
        // that is not ordered is not one this reader can use.
        if (!offsets->empty() && off <= offsets->back()) return nullptr;
        offsets->push_back(off);
        k = lt;
      }
      if (offsets->empty()) return nullptr;
      if (offsets->back() >= index_offset) return nullptr;

      // The terminator: the last spectrum ends where the list does.
      {
        const std::int64_t probe_len =
            std::min<std::int64_t>(static_cast<std::int64_t>(index_offset) -
                                       static_cast<std::int64_t>(offsets->back()),
                                   std::int64_t{1} << 22);
        std::string probe(static_cast<std::size_t>(probe_len), '\0');
        f.seekg(static_cast<std::streamoff>(offsets->back()));
        f.read(probe.data(), probe_len);
        if (!f) return nullptr;
        const std::size_t end = probe.find("</spectrum>");
        if (end == std::string::npos) return nullptr;
        const std::size_t after = end + std::string("</spectrum>").size();

        // The index must list EVERY spectrum, not merely valid ones: a
        // truncated index parses cleanly and would quietly shorten the run.
        // After the last one the list must close, with no further spectrum
        // in between.
        const std::size_t close = probe.find("</spectrumList>", after);
        const std::size_t next = probe.find("<spectrum", after);
        if (close == std::string::npos) return nullptr;      // list never closes in view
        if (next != std::string::npos && next < close) return nullptr; // more spectra than offsets

        offsets->push_back(offsets->back() + after);
      }

      // 33 evenly spaced offsets, first and last included, must point
      // exactly at a <spectrum tag, which is what the mzML index defines an
      // offset to be.
      //
      // An index that is stale -- a file edited, concatenated or truncated
      // after it was written -- otherwise decodes garbage, and garbage here is
      // the worst kind of failure: domParseSpectrum throws per spectrum, every
      // spectrum comes back empty, and the run reports a clean zero. Refused
      // here, such a file has its offsets rebuilt by a scan instead.
      //
      // Exactly, not "a tag somewhere nearby": from an index shifted by a few
      // bytes every range starts inside the previous spectrum and stops short
      // of its own closing tag -- empty spectra, silently. Spread across the
      // run, because an edit in the middle shifts only the offsets after it;
      // 33 probes cost 33 reads of 16 bytes.
      // Known limit: sampled, not exhaustive -- an edit that shifts no sampled
      // offset still gets through; check every offset if one ever does.
      {
        const std::size_t last = offsets->size() - 2; // -1 is the terminator
        std::string head(16, '\0');
        for (std::size_t j = 0; j <= 32; ++j)
        {
          const std::size_t k = last * j / 32;
          f.seekg(static_cast<std::streamoff>((*offsets)[k]));
          f.read(head.data(), static_cast<std::streamsize>(head.size()));
          if (!f || head.compare(0, 9, "<spectrum") != 0 || !is_name_end(head[9])) return nullptr;
        }
      }
      return offsets;
    }
  }

  /****************************************************************************/
  IndexedMzMLReader::IndexedMzMLReader(const std::string& path)
    : impl_(std::make_unique<Impl>(path))
  {
    std::shared_ptr<const std::vector<std::uint64_t>> offsets;
    {
      std::ifstream f(path, std::ios::binary);
      if (!f) return;
      f.seekg(0, std::ios::end);
      const std::int64_t size = f.tellg();
      if (size <= 0) return;
      offsets = offsets_from_index(f, size);
    }
    // No index, or a stale one: find the spectra in the bytes themselves.
    if (!offsets)
    {
      auto scanned = scanSpectrumOffsets(path);
      if (scanned.size() < 2) return; // no spectrumList, or an empty one
      offsets = std::make_shared<const std::vector<std::uint64_t>>(std::move(scanned));
      impl_->rebuilt = true;
    }

    impl_->offsets = offsets;
    impl_->groups = read_param_groups(path, offsets->front());
    impl_->ok = impl_->in.open(path);
  }

  std::vector<std::uint64_t> IndexedMzMLReader::scanSpectrumOffsets(const std::string& path,
                                                                     std::size_t chunk_bytes)
  {
    constexpr std::string_view kOpen = "<spectrum";
    constexpr std::string_view kListOpen = "<spectrumList";
    constexpr std::string_view kListClose = "</spectrumList";
    // Read past each piece's end by more than the longest needle plus the
    // byte after it, so a tag that starts in this piece is always seen whole.
    constexpr std::size_t kOverlap = 32;

    std::uint64_t size = 0;
    {
      std::ifstream f(path, std::ios::binary | std::ios::ate);
      if (!f) return {};
      const std::streamoff end = f.tellg();
      if (end <= 0) return {};
      size = static_cast<std::uint64_t>(end);
    }
    chunk_bytes = std::max(chunk_bytes, kOverlap);
    const std::uint64_t n_pieces = (size + chunk_bytes - 1) / chunk_bytes;

    std::vector<Piece> pieces(static_cast<std::size_t>(n_pieces));
    auto tag_at = [](std::string_view v, std::size_t k, std::string_view name) {
      return v.compare(k, name.size(), name) == 0 && k + name.size() < v.size() &&
             is_name_end(v[k + name.size()]);
    };

    // Up to 16 threads: the scan is bound by reading the file, not by the
    // search, and each thread holds one piece in memory.
    int threads = 1;
#ifdef _OPENMP
    threads = std::max(1, std::min(omp_get_max_threads(), 16));
#endif
#pragma omp parallel num_threads(threads)
    {
      // One read call per piece. Through std::ifstream, MSVC's runtime
      // splits each piece into 4 KB ReadFile calls, about 790k for a 3.2 GB
      // file, and every one takes the file's cache-map lock: past 4 threads
      // on Windows the scan got slower, not faster (ETW traces of the 1.9.0
      // scan). On Linux one call per piece is what the stream did already.
      PositionedFile in;
      const bool opened = in.open(path);
      // Page-aligned and never zero-filled. The kernel's copy from the page
      // cache into a std::string (malloc'd, 16 bytes past a page boundary)
      // ran at half the speed: a 3.2 GB scan took 1.69 s against 0.77 s on
      // one thread and 0.141 s against 0.078 s on 16 (AMD EPYC 7763,
      // ibminode05).
      const std::size_t cap = static_cast<std::size_t>(std::min<std::uint64_t>(chunk_bytes + kOverlap, size));
      std::unique_ptr<char[], AlignedDelete> buf(
          static_cast<char*>(::operator new[](cap, std::align_val_t{kPage}, std::nothrow)));
#pragma omp for schedule(dynamic, 1)
      for (std::int64_t p = 0; p < static_cast<std::int64_t>(n_pieces); ++p)
      {
        Piece& piece = pieces[static_cast<std::size_t>(p)];
        // No exception may leave the parallel region (std::terminate), and
        // this reader promises not to throw: a piece that fails is unread.
        try
        {
          const std::uint64_t begin = static_cast<std::uint64_t>(p) * chunk_bytes;
          const std::uint64_t own = std::min<std::uint64_t>(chunk_bytes, size - begin);
          const std::uint64_t len = std::min<std::uint64_t>(own + kOverlap, size - begin);
          if (!opened || !buf || !in.read(begin, buf.get(), static_cast<std::size_t>(len)))
          {
            piece.read = false;
            continue;
          }
          const std::string_view v(buf.get(), static_cast<std::size_t>(len));
          for (std::size_t k = v.find('<'); k != std::string_view::npos && k < own; k = v.find('<', k + 1))
          {
            if (tag_at(v, k, kOpen)) piece.spectra.push_back(begin + k);
            else if (piece.list_open == kNoOffset && tag_at(v, k, kListOpen)) piece.list_open = begin + k;
            else if (piece.list_close == kNoOffset && tag_at(v, k, kListClose)) piece.list_close = begin + k;
          }
        }
        catch (...)
        {
          piece.read = false;
        }
      }
    }

    std::uint64_t list_open = kNoOffset, list_close = kNoOffset;
    for (const Piece& piece : pieces)
    {
      if (!piece.read) return {};
      if (list_open == kNoOffset) list_open = piece.list_open;
      if (list_open != kNoOffset && list_close == kNoOffset && piece.list_close != kNoOffset &&
          piece.list_close > list_open)
      {
        list_close = piece.list_close;
      }
    }
    if (list_open == kNoOffset || list_close == kNoOffset) return {};

    std::vector<std::uint64_t> offsets;
    for (const Piece& piece : pieces)
    {
      for (const std::uint64_t off : piece.spectra)
      {
        if (off > list_open && off < list_close) offsets.push_back(off);
      }
    }
    if (offsets.empty()) return {};
    offsets.push_back(list_close);
    return offsets;
  }

  IndexedMzMLReader::IndexedMzMLReader(const IndexedMzMLReader& other)
    : impl_(std::make_unique<Impl>(other.impl_->path))
  {
    impl_->offsets = other.impl_->offsets;
    impl_->groups = other.impl_->groups;
    impl_->rebuilt = other.impl_->rebuilt;
    impl_->direct_on = other.impl_->direct_on;
    if (!other.impl_->ok) return;
    impl_->ok = impl_->in.open(impl_->path);
  }

  IndexedMzMLReader::~IndexedMzMLReader() = default;

  bool IndexedMzMLReader::ok() const { return impl_->ok; }

  bool IndexedMzMLReader::indexRebuilt() const { return impl_->rebuilt; }

  void IndexedMzMLReader::setDirectDecoding(bool on) { impl_->direct_on = on; }

  std::size_t IndexedMzMLReader::directDecoded() const { return impl_->n_direct; }

  std::size_t IndexedMzMLReader::openmsDecoded() const { return impl_->n_openms; }

  std::size_t IndexedMzMLReader::invalidSelectedMz() const { return impl_->n_bad_mz; }

  std::size_t IndexedMzMLReader::invalidSelectedMzFromTarget() const { return impl_->n_bad_mz_target; }

  bool needsSelectedIonTarget(const MSSpectrum& spec)
  {
    for (const Precursor& p : spec.getPrecursors())
    {
      const double mz = p.getMZ();
      if (!(mz > 0 && std::isfinite(mz)) && p.metaValueExists("isolation window target m/z"))
      {
        const double t = p.getMetaValue("isolation window target m/z");
        if (t > 0 && std::isfinite(t)) return true;
      }
    }
    return false;
  }

  bool useSelectedIonTarget(MSSpectrum& spec)
  {
    bool changed = false;
    for (Precursor& p : spec.getPrecursors())
    {
      const double mz = p.getMZ();
      if ((mz > 0 && std::isfinite(mz)) || !p.metaValueExists("isolation window target m/z")) continue;
      const double t = p.getMetaValue("isolation window target m/z");
      if (!(t > 0 && std::isfinite(t))) continue;
      // As OpenMS leaves a precursor without MS:1000744: the target as its
      // m/z and no target meta value.
      p.setMZ(t);
      p.removeMetaValue("isolation window target m/z");
      changed = true;
    }
    return changed;
  }

  Size IndexedMzMLReader::getNrSpectra() const
  {
    // One offset per spectrum plus the terminator.
    return impl_->ok ? static_cast<Size>(impl_->offsets->size() - 1) : 0;
  }

  /****************************************************************************/
  MSSpectrum IndexedMzMLReader::getSpectrum(Size i, unsigned fields) { return read_(i, /*want_peaks=*/true, fields); }

  MSSpectrum IndexedMzMLReader::getSpectrumAnyLevel(Size i)
  {
    return read_(i, /*want_peaks=*/true, kAllFields, /*any_level=*/true);
  }

  MSSpectrum IndexedMzMLReader::getSpectrumMetadata(Size i, unsigned fields)
  {
    return read_(i, /*want_peaks=*/false, fields);
  }

  std::pair<std::uint64_t, std::uint64_t> IndexedMzMLReader::spectrumByteRange(Size i) const
  {
    if (!impl_->ok || i + 1 >= impl_->offsets->size()) return {0, 0};
    return {(*impl_->offsets)[i], (*impl_->offsets)[i + 1]};
  }

  bool IndexedMzMLReader::reportsSpectrumMetadata()
  {
    // Up to the FIRST MS2, not a fixed 64: a DDA run can open with minutes of
    // MS1-only scans (loading, void volume), and a fixed 64-spectrum window
    // would reject this reader for a file it reads correctly.
    // The head-only read is cheap; the cap bounds an MS1-only file.
    const Size probe = std::min<Size>(getNrSpectra(), kMetadataProbe);
    bool any_level = false;
    for (Size i = 0; i < probe; ++i)
    {
      const MSSpectrum s = read_(i, /*want_peaks=*/false, kAllFields);
      if (s.getMSLevel() == 2) return !s.getPrecursors().empty();
      any_level = any_level || s.getMSLevel() > 0;
    }
    // No MS2 within the cap: the scrape read MS levels, so it works; a run
    // with nothing to tag there costs nothing either way.
    return any_level;
  }

  MSSpectrum IndexedMzMLReader::read_(Size i, bool want_peaks, unsigned fields, bool any_level)
  {
    MSSpectrum spec;
    if (!impl_->ok || i + 1 >= impl_->offsets->size()) return spec;
    const std::uint64_t begin = (*impl_->offsets)[i];
    const std::uint64_t end = (*impl_->offsets)[i + 1];
    // A spectrum the tagging loop wants but cannot read is an error, as it
    // is on OpenMS's reader: returned empty, it would be skipped as "not MS2"
    // and the run would exit 0 with its tags missing. The metadata
    // probe (want_peaks false) stays lenient.
    const auto unreadable = [&](const std::string& why) -> MSSpectrum {
      if (!want_peaks) return MSSpectrum();
      throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION,
                                  "spectrum index " + std::to_string(i),
                                  why + " in " + impl_->path);
    };
    if (end <= begin) return unreadable("an empty byte range");

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
    if (!impl_->raw.reserve(static_cast<std::size_t>(head_len), 0))
      return unreadable("no memory for " + std::to_string(head_len) + " bytes");
    if (!impl_->in.read(begin, impl_->raw.data.get(), static_cast<std::size_t>(head_len)))
      return unreadable(impl_->in.error());
    impl_->bytes = std::string_view(impl_->raw.data.get(), static_cast<std::size_t>(head_len));

    // The head is only known to hold the whole metadata region once the
    // arrays have been seen; otherwise fall back to the full element rather
    // than scrape a truncated one. Empty on success, else why it failed: a
    // file that is intact must not be reported as truncated when memory ran
    // out.
    auto read_rest = [&]() -> std::string {
      const std::size_t have = impl_->bytes.size();
      if (have >= len) return {};
      if (!impl_->raw.reserve(static_cast<std::size_t>(len), have))
        return "no memory for a spectrum of " + std::to_string(len) + " bytes";
      if (!impl_->in.read(begin + have, impl_->raw.data.get() + have, static_cast<std::size_t>(len) - have))
        return impl_->in.error();
      impl_->bytes = std::string_view(impl_->raw.data.get(), static_cast<std::size_t>(len));
      return {};
    };
    std::size_t cut = impl_->bytes.find(kArrays);
    std::size_t cut_in = impl_->bytes.size();  ///< the buffer size `cut` was searched in
    if (cut == std::string_view::npos && len > head_len)
    {
      if (const std::string why = read_rest(); !why.empty()) return unreadable(why);
    }

    // The metadata region of whatever is in the buffer NOW: everything this
    // reader scrapes appears before <binaryDataArrayList>, and the arrays
    // after it are base64 that makes up almost the whole element. Taken
    // fresh each time because read_rest() may have grown the buffer. The
    // cut is searched once (1.12.2): read_rest() only appends, so a cut
    // found in the head stays the first one, and only a cut not found yet
    // is searched again in a grown buffer.
    auto meta = [this, &cut, &cut_in]() -> std::string_view {
      const std::string_view all = impl_->bytes;
      if (cut == std::string_view::npos && all.size() != cut_in)
      {
        cut = all.find(kArrays);
        cut_in = all.size();
      }
      return cut == std::string_view::npos ? all : all.substr(0, cut);
    };

    // referenceableParamGroups (step 0, 1.12). OpenMS's MzMLHandler applies
    // a group's cvParams as if they stood in the element holding the
    // <referenceableParamGroupRef>, before that element's own cvParams. Here
    // an element's OWN cvParam is looked up first and a group only when the
    // element has none: the same result for the single-valued fields read
    // below, since the schema puts references before cvParams and OpenMS
    // keeps the last value it sees.
    //
    // Groups are resolved for the step-0 fields ONLY (type, filter string,
    // activation, possible charge states, the isolation-target meta value).
    // The fields 1.11 already read and the tagger consumes -- MS level,
    // selected-ion m/z, charge and intensity, the isolation window target
    // and offsets -- are still read from the element's own cvParams, as in
    // 1.11, so tags stay byte-identical. Resolving them from groups too
    // changes tags on mzMLs that keep them in a group (1.11: an MS level only
    // in a group is no MS2, a charge only in a group is tagged as 2+); that
    // is a separate, declared output-changing item, not part of step 0.
    static const ParamGroups kNoGroups;
    const ParamGroups& groups = impl_->groups ? *impl_->groups : kNoGroups;
    // The cvParam with accession @p acc in a group referenced directly in
    // [from, to) of @p xml, or null. The caller bounds the range to the
    // element whose references count.
    auto group_param = [&groups](std::string_view xml, std::string_view acc, std::size_t from,
                                 std::size_t to) -> const GroupParam* {
      if (groups.empty()) return nullptr;
      constexpr std::string_view kRef = "<referenceableParamGroupRef";
      for (std::size_t r = find_before(xml, kRef, from, to); r != std::string_view::npos;
           r = find_before(xml, kRef, r + kRef.size(), to))
      {
        const auto it = groups.find(std::string(tag_attr(xml, r + 1, "ref")));
        if (it == groups.end()) continue;
        for (const GroupParam& gp : it->second)
          if (gp.accession == acc) return &gp;
      }
      return nullptr;
    };
    // Every group cvParam with an accession in a referenced group, in order.
    auto for_group_params = [&groups](std::string_view xml, std::size_t from, std::size_t to, auto&& fn) {
      if (groups.empty()) return;
      constexpr std::string_view kRef = "<referenceableParamGroupRef";
      for (std::size_t r = find_before(xml, kRef, from, to); r != std::string_view::npos;
           r = find_before(xml, kRef, r + kRef.size(), to))
      {
        const auto it = groups.find(std::string(tag_attr(xml, r + 1, "ref")));
        if (it == groups.end()) continue;
        for (const GroupParam& gp : it->second) fn(gp);
      }
    };
    // cv_value() with the group fallback: the element's own cvParam if it
    // has one, else the referenced group's.
    auto cvg = [&](std::string_view xml, std::string_view needle, std::size_t from, std::size_t to,
                   std::string_view attr = kValue) -> std::string_view {
      const std::size_t k = find_before(xml, needle, from, to);
      if (k != std::string_view::npos) return tag_attr(xml, k, attr);
      const GroupParam* gp = group_param(xml, needle_accession(needle), from, to);
      if (!gp) return {};
      return attr == kUnit ? std::string_view(gp->unit) : std::string_view(gp->value);
    };
    // Where the spectrum's own cvParams and references end: at its first
    // child list (the arrays are already cut off by meta()). One walk over
    // the tags from the start (1.12.2), not three searches of which the one
    // for an absent <productList> read the whole head: the first '<' that
    // opens any of the three is where the earliest of the three searches
    // would have stopped.
    auto spectrum_params_end = [](std::string_view xml) {
      constexpr std::string_view kChildren[] = {"<scanList", "<precursorList", "<productList"};
      for (std::size_t k = xml.find('<'); k != std::string_view::npos; k = xml.find('<', k + 1))
      {
        const std::string_view rest = xml.substr(k);
        for (const std::string_view c : kChildren)
          if (rest.starts_with(c)) return k;
      }
      return xml.size();
    };

    // MS level first: it decides whether the body is worth reading at all.
    int ms_level = 0;
    {
      const std::string_view h = meta();
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
    if ((ms_level == 2 || any_level) && want_peaks)
    {
      if (const std::string why = read_rest(); !why.empty()) return unreadable(why);
      if (impl_->direct_on && impl_->direct.decode(impl_->bytes, spec))
      {
        ++impl_->n_direct;
      }
      else
      {
        ++impl_->n_openms;
        // A file the direct decoder cannot read (numpress, say) is left to
        // OpenMS for good once its first spectra all came back declined, so
        // such a file does not pay for a failed scan per spectrum.
        if (impl_->direct_on && impl_->n_direct == 0 && impl_->n_openms >= kDirectProbe)
          impl_->direct_on = false;
        try
        {
          // domParseSpectrum wants a std::string. A local one: a copy kept in
          // the reader would hold the largest spectrum's bytes per thread.
          const std::string copy(impl_->bytes.data(), impl_->bytes.size());
          impl_->decoder.domParseSpectrum(copy, spec);
          // domParseSpectrum resets the spectrum, so the level goes back on.
          spec.setMSLevel(static_cast<UInt>(ms_level));
        }
        catch (const Exception::BaseException& e)
        {
          return unreadable(std::string("an undecodable spectrum (") + e.what() + ")");
        }
      }
    }
    else
    {
      // Native id still travels: a caller may report on a spectrum it does
      // not tag.
      const std::string_view h = meta();
      const std::size_t st = h.find("<spectrum");
      if (st != std::string_view::npos)
      {
        const std::string_view id = tag_attr(h, st + 1, "id");
        if (!id.empty()) spec.setNativeID(std::string(id));
      }
    }

    // The rest of the metadata, from the buffer in its final state.
    const std::string_view xml = meta();
    const std::size_t n = xml.size();

    double rt = 0;
    if (to_number(cv_value(xml, kScanTime, 0, n), rt))
    {
      // mzML records the unit; OpenMS wants seconds. As OpenMS's MzMLHandler
      // reads it: minutes (UO:0000031) are converted and anything else is
      // taken as seconds -- an absent unit included -- so RTs in -recon_id_out
      // match the OpenMS path that -out_spectra takes.
      const std::string_view unit = cv_value(xml, kScanTime, 0, n, kUnit);
      spec.setRT(unit == "UO:0000031" ? rt * 60.0 : rt);
    }

    // The scan windows and the scan's ion mobility, as OpenMS's mzML reader
    // sets them (-digest_out reads them). Searched in the scanList only: a
    // precursor's selected ion can carry an ion mobility of its own.
    const std::size_t plb = xml.find("<precursorList");
    // The scan list and its end, found once for the windows and the filter
    // string (1.12.2; each searched for them itself before).
    const std::size_t slb = xml.find("<scanList");
    const bool has_scans = slb != std::string_view::npos && slb < std::min(plb, n);
    const std::size_t sle = has_scans ? find_or(xml, "</scanList>", slb, n) : n;
    if (has_scans)
    {
      for (std::size_t w = find_before(xml, "<scanWindow", slb, sle); w != std::string_view::npos;
           w = find_before(xml, "<scanWindow", w + 11, sle))
      {
        if (w + 11 >= n || !(is_name_end(xml[w + 11]) || xml[w + 11] == '/')) continue;  // <scanWindowList
        const std::size_t we = find_or(xml, "</scanWindow>", w, sle);
        ScanWindow win;
        if (to_number(cv_value(xml, kScanLow, w, we), win.begin))
        {
          to_number(cv_value(xml, kScanHigh, w, we), win.end);
          spec.getInstrumentSettings().getScanWindows().push_back(win);
        }
      }
      double im = 0;
      if (to_number(cv_value(xml, kInvK0, slb, sle), im))
      {
        spec.setDriftTime(im);
        spec.setDriftTimeUnit(DriftTimeUnit::VSSC);
      }
      else if (to_number(cv_value(xml, kDriftTime, slb, sle), im))
      {
        spec.setDriftTime(im);
        spec.setDriftTimeUnit(DriftTimeUnit::MILLISECOND);
      }
    }
    // FAIMS: the compensation voltage among the spectrum's own cvParams.
    if (double cv = 0; spec.getDriftTimeUnit() == DriftTimeUnit::NONE &&
                       to_number(cv_value(xml, kFaimsCV, 0, std::min(plb, n)), cv))
    {
      spec.setDriftTime(cv);
      spec.setDriftTimeUnit(DriftTimeUnit::FAIMS_COMPENSATION_VOLTAGE);
    }

    // Spectrum representation (step 0): MS:1000127/128 among the spectrum's
    // own cvParams, the later one winning as in OpenMS, else from a group it
    // references. Neither leaves the type UNKNOWN, as OpenMS does.
    if (fields & kStep0Type)
    {
      const std::size_t se = spectrum_params_end(xml);
      // Bounded to se (1.12.2): only a hit before se counts below, and the
      // absent one of the two no longer reads the rest of the head.
      const auto before_se = [&](std::string_view needle) {
        const std::size_t k = find_before(xml, needle, 0, se);
        return k == std::string_view::npos ? se : k;
      };
      const std::size_t c = before_se(kCentroid), pr = before_se(kProfile);
      if (c < se || pr < se)
        spec.setType(pr >= se || (c < se && c > pr) ? SpectrumSettings::SpectrumType::CENTROID
                                                     : SpectrumSettings::SpectrumType::PROFILE);
      else if (group_param(xml, needle_accession(kCentroid), 0, se))
        spec.setType(SpectrumSettings::SpectrumType::CENTROID);
      else if (group_param(xml, needle_accession(kProfile), 0, se))
        spec.setType(SpectrumSettings::SpectrumType::PROFILE);
    }

    // The filter string (step 0) of the first <scan>, as the meta value
    // "filter string" OpenMS gives the spectrum.
    if ((fields & kStep0FilterString) && has_scans)
    {
      std::size_t sc = find_before(xml, "<scan", slb + 9, sle);
      while (sc != std::string_view::npos && !(sc + 5 < n && (is_name_end(xml[sc + 5]) || xml[sc + 5] == '/')))
        sc = find_before(xml, "<scan", sc + 5, sle);
      if (sc != std::string_view::npos)
      {
        // The scan's own params end at its window list or its end tag. Both
        // searched within the scan list first (1.12.2); only when neither is
        // there (not well-formed) the unbounded searches decide, as before.
        const std::size_t wl = find_before(xml, "<scanWindowList", sc, sle), se_ = find_before(xml, "</scan>", sc, sle);
        const std::size_t sce = wl != std::string_view::npos || se_ != std::string_view::npos
                                    ? std::min(wl, se_)
                                    : std::min(find_or(xml, "<scanWindowList", sc, sle), find_or(xml, "</scan>", sc, sle));
        const std::size_t k = find_before(xml, kFilterString, sc, sce);
        const GroupParam* gp = k != std::string_view::npos ? nullptr : group_param(xml, needle_accession(kFilterString), sc, sce);
        if (k != std::string_view::npos || gp)
        {
          static const UInt kFilterIdx = MetaInfoInterface::metaRegistry().registerName("filter string");
          spec.setMetaValue(kFilterIdx, DataValue(xml_unescape(gp ? std::string_view(gp->value) : tag_attr(xml, k, kValue))));
        }
      }
    }

    // Precursors: one OpenMS Precursor per SELECTED ION, matching the mzPeak
    // reader, so a window with several ions keeps all of them.
    if (plb == std::string_view::npos) return spec;
    // A selected-ion m/z read as absent (see below), counted once per
    // spectrum and only on the tagging loop's reads, getSpectrum().
    bool bad_mz = false, bad_mz_target = false;
    const std::size_t ple = find_or(xml, "</precursorList>", plb, n);

    // Element matching is by NAME, not by "<name " with a space: a writer may
    // emit <precursor> or <selectedIon> with no attributes at all. Both loops
    // move forward on every iteration whatever they find -- one that does not
    // appends a precursor per turn until memory runs out.
    auto element_at = [&](std::size_t at, std::string_view name) {
      if (at == std::string_view::npos || at + name.size() >= n) return false;
      // <selectedIonList> must not match <selectedIon>.
      const char after = xml[at + name.size()];
      return is_name_end(after) || after == '/';
    };

    // The element searches below are bounded to the list, precursor or ion
    // they belong to (1.12.2): each loop's last search, for an element that
    // is not there, used to read the rest of the head.
    std::size_t p = plb;
    while (true)
    {
      p = find_before(xml, "<precursor", p, ple);
      if (p == std::string_view::npos) break;
      if (!element_at(p, "<precursor")) { p += 10; continue; }

      // This precursor runs to the next one, or to the end of the list.
      std::size_t p_end = ple;
      for (std::size_t q = p + 10; q < ple;)
      {
        q = find_before(xml, "<precursor", q, ple);
        if (q == std::string_view::npos) break;
        if (element_at(q, "<precursor")) { p_end = q; break; }
        q += 10;
      }

      // The window as 1.11 reads it (own cvParams only, see above); the
      // target again with the group fallback for the step-0 meta value only.
      double target = 0, lower = 0, upper = 0, meta_target = 0;
      bool has_meta_target = false;
      const std::size_t iwb = find_before(xml, "<isolationWindow", p, p_end);
      if (iwb != std::string_view::npos)
      {
        const std::size_t iwe = find_or(xml, "</isolationWindow>", iwb, p_end);
        to_number(cv_value(xml, kIsoTarget, iwb, iwe), target);
        to_number(cv_value(xml, kIsoLower, iwb, iwe), lower);
        to_number(cv_value(xml, kIsoUpper, iwb, iwe), upper);
        if (fields & kStep0TargetMeta) has_meta_target = to_number(cvg(xml, kIsoTarget, iwb, iwe), meta_target);
      }

      // The activation (step 0): dissociation methods and activation energy,
      // the same for every selected ion of this precursor.
      std::set<Precursor::ActivationMethod> methods;
      double activation_energy = 0;
      bool has_activation_energy = false;
      std::size_t acb = (fields & (kStep0Activation | kStep0ActivationEnergy)) ? find_before(xml, "<activation", p, p_end)
                                                                       : std::string_view::npos;
      while (acb != std::string_view::npos && !element_at(acb, "<activation"))
        acb = find_before(xml, "<activation", acb + 11, p_end);
      if (acb != std::string_view::npos)
      {
        const std::size_t ace = find_or(xml, "</activation>", acb, p_end);
        if (fields & kStep0Activation)
        {
          auto add_method = [&methods](std::string_view acc) {
            for (const ActivationTerm& t : kActivationTerms)
              if (t.accession == acc) methods.insert(t.method);
          };
          for_group_params(xml, acb, ace, [&](const GroupParam& gp) { add_method(gp.accession); });
          for (std::size_t c = find_before(xml, "<cvParam", acb, ace); c != std::string_view::npos;
               c = find_before(xml, "<cvParam", c + 8, ace))
            add_method(tag_attr(xml, c + 1, "accession"));
        }
        if (fields & kStep0ActivationEnergy)
          has_activation_energy = to_number(cvg(xml, kActivationEnergy, acb, ace), activation_energy);
      }
      auto set_activation = [&](Precursor& prec) {
        if (!methods.empty()) prec.setActivationMethods(methods);
        if (has_activation_energy) prec.setActivationEnergy(activation_energy);
      };

      bool any_ion = false;
      std::size_t s = p;
      while (true)
      {
        s = find_before(xml, "<selectedIon", s, p_end);
        if (s == std::string_view::npos) break;
        if (!element_at(s, "<selectedIon")) { s += 12; continue; }
        const std::size_t s_end = find_or(xml, "</selectedIon>", s, p_end);

        Precursor prec;
        double mz = 0;
        int charge = 0;
        double intensity = 0;
        const bool has_mz = to_number(cv_value(xml, kSelectedMz, s, s_end), mz);
        // A selected-ion m/z of 0, below 0 or not finite is no m/z:
        // it is read as a missing MS:1000744, so the isolation target stands
        // in for it. A converter writes 0 for a precursor without a
        // monoisotopic m/z (mzpeak-convert 0.18 from a Bruker .d). OpenMS's
        // MzMLFile keeps the 0, and the spectrum would yield no tags.
        const bool valid_mz = has_mz && mz > 0 && std::isfinite(mz);
        if (has_mz && !valid_mz)
        {
          bad_mz = true;
          bad_mz_target = bad_mz_target || target > 0;
        }
        if (valid_mz)
        {
          prec.setMZ(mz);
          // The isolation target kept as OpenMS keeps it (step 0): as the
          // meta value "isolation window target m/z" whenever the selected
          // ion moved the precursor m/z away from it -- 0 when the window
          // gave no target, as there.
          const double window_mz = has_meta_target ? meta_target : 0.0;
          if ((fields & kStep0TargetMeta) && mz != window_mz)
          {
            static const UInt kTargetIdx =
                MetaInfoInterface::metaRegistry().registerName("isolation window target m/z");
            prec.setMetaValue(kTargetIdx, DataValue(window_mz));
          }
        }
        else if (target > 0) prec.setMZ(target);
        if (to_number(cv_value(xml, kChargeState, s, s_end), charge)) prec.setCharge(charge);
        if (to_number(cv_value(xml, kPeakIntensity, s, s_end), intensity))
          prec.setIntensity(static_cast<float>(intensity));
        // Possible charge states (MS:1000633, step 0), every one listed, in
        // the order OpenMS reads them: referenced groups, then own cvParams.
        if (fields & kStep0PossibleCharges)
        {
          const std::string_view acc = needle_accession(kPossibleCharge);
          for_group_params(xml, s, s_end, [&](const GroupParam& gp) {
            if (int z = 0; gp.accession == acc && to_number(std::string_view(gp.value), z))
              prec.getPossibleChargeStates().push_back(z);
          });
          for (std::size_t k = find_before(xml, kPossibleCharge, s, s_end); k != std::string_view::npos;
               k = find_before(xml, kPossibleCharge, k + kPossibleCharge.size(), s_end))
          {
            if (int z = 0; to_number(tag_attr(xml, k, kValue), z)) prec.getPossibleChargeStates().push_back(z);
          }
        }
        if (lower > 0) prec.setIsolationWindowLowerOffset(lower);
        if (upper > 0) prec.setIsolationWindowUpperOffset(upper);
        set_activation(prec);
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
        set_activation(prec);
        spec.getPrecursors().push_back(std::move(prec));
      }
      p = p_end > p ? p_end : p + 10;
    }
    if (bad_mz && want_peaks && !any_level)
    {
      ++impl_->n_bad_mz;
      impl_->n_bad_mz_target += bad_mz_target;
    }
    return spec;
  }
}
