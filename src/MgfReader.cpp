// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "MgfReader.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/DATASTRUCTURES/StringUtils.h>
#include <OpenMS/FORMAT/FileTypes.h>
#include <OpenMS/METADATA/IonSource.h>
#include <OpenMS/METADATA/SourceFile.h>
#include <OpenMS/SYSTEM/File.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <limits>
#include <stdexcept>

#ifdef _OPENMP
#include <omp.h>
#endif

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    constexpr std::string_view kBegin = "BEGIN IONS";
    constexpr std::string_view kEnd = "END IONS";
    /// A block buffer above this is released after use, so one huge block
    /// does not stay resident in every thread.
    constexpr std::size_t kKeepBuffer = std::size_t{4} << 20;

    /// What OpenMS's trim() removes, less '\n', which ends the line.
    bool is_trim(char c) { return c == ' ' || c == '\t' || c == '\r'; }

    std::string_view trim(std::string_view s)
    {
      while (!s.empty() && (is_trim(s.front()) || s.front() == '\n')) s.remove_prefix(1);
      while (!s.empty() && (is_trim(s.back()) || s.back() == '\n')) s.remove_suffix(1);
      return s;
    }

    /// One UTF-8 sequence at @p p (of @p n bytes left): its length, or 0 when
    /// it is not valid (overlong, surrogate, above U+10FFFF, truncated).
    std::size_t utf8_len(const unsigned char* p, std::size_t n)
    {
      const unsigned char c = p[0];
      if (c < 0x80) return 1;
      std::size_t len = 0;
      std::uint32_t cp = 0;
      if (c >= 0xC2 && c <= 0xDF) { len = 2; cp = c & 0x1F; }
      else if (c >= 0xE0 && c <= 0xEF) { len = 3; cp = c & 0x0F; }
      else if (c >= 0xF0 && c <= 0xF4) { len = 4; cp = c & 0x07; }
      else return 0;
      if (n < len) return 0;
      for (std::size_t k = 1; k < len; ++k)
      {
        if ((p[k] & 0xC0) != 0x80) return 0;
        cp = (cp << 6) | (p[k] & 0x3F);
      }
      if ((len == 3 && cp < 0x800) || (len == 4 && (cp < 0x10000 || cp > 0x10FFFF))) return 0;
      if (cp >= 0xD800 && cp <= 0xDFFF) return 0;
      return len;
    }

    /// @p s with C0 control bytes other than tab, and every byte of an invalid
    /// UTF-8 sequence, replaced by '?', so it stays valid XML in an mzML.
    std::string sanitise(std::string_view s, bool& changed)
    {
      std::string out;
      out.reserve(s.size());
      const auto* p = reinterpret_cast<const unsigned char*>(s.data());
      for (std::size_t i = 0; i < s.size();)
      {
        if (p[i] < 0x20 && p[i] != '\t') { out += '?'; changed = true; ++i; continue; }
        const std::size_t len = utf8_len(p + i, s.size() - i);
        if (len == 0) { out += '?'; changed = true; ++i; continue; }
        out.append(s.data() + i, len);
        i += len;
      }
      return out;
    }

    /// The TITLE line of @p block, for a message: sanitised and cut to
    /// kTitleInMessages bytes on a character boundary. Empty when none.
    std::string title_for_message(std::string_view block)
    {
      std::size_t pos = 0;
      while (pos < block.size())
      {
        std::size_t nl = block.find('\n', pos);
        if (nl == std::string_view::npos) nl = block.size();
        const std::string_view line = trim(block.substr(pos, nl - pos));
        pos = nl + 1;
        if (line.substr(0, 6) != "TITLE=") continue;
        bool changed = false;
        std::string t = sanitise(trim(line.substr(6)), changed);
        if (t.size() > MgfReader::kTitleInMessages)
        {
          std::size_t cut = MgfReader::kTitleInMessages;
          while (cut > 0 && (static_cast<unsigned char>(t[cut]) & 0xC0) == 0x80) --cut;
          t.resize(cut);
          t += "...";
        }
        return t;
      }
      return {};
    }

    [[noreturn]] void block_error(const std::string& source, Size index, std::uint64_t offset,
                                  std::string_view block, const std::string& reason)
    {
      const std::string title = title_for_message(block);
      throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, source,
                                  "MGF block " + std::to_string(index) + " (byte " + std::to_string(offset) +
                                      (title.empty() ? std::string() : ", TITLE=" + title) + "): " + reason);
    }

    /// @p line, quoted for a message and cut short.
    std::string quoted(std::string_view line)
    {
      bool changed = false;
      std::string s = sanitise(line.substr(0, 80), changed);
      return "'" + s + (line.size() > 80 ? "...'" : "'");
    }

    bool is_space(char c) { return c == ' ' || c == '\t' || c == '\r'; }

    /// Whitespace-separated tokens of @p s.
    std::vector<std::string_view> tokens(std::string_view s)
    {
      std::vector<std::string_view> out;
      std::size_t i = 0;
      while (i < s.size())
      {
        while (i < s.size() && is_space(s[i])) ++i;
        const std::size_t b = i;
        while (i < s.size() && !is_space(s[i])) ++i;
        if (i > b) out.push_back(s.substr(b, i - b));
      }
      return out;
    }

    /// A double filling all of @p t, through the OpenMS parser
    /// MascotGenericFile uses (StringUtils::toDouble shares it).
    bool whole_double(std::string_view t, double& v)
    {
      const char* p = t.data();
      const char* e = p + t.size();
      return !t.empty() && StringUtils::extractDouble(p, e, v) && p == e;
    }

    /// A line without '=' that is a peak line gone wrong rather than text:
    /// it starts with a sign or a '.', or its first word is nan or inf.
    /// OpenMS reads a peak line only when it starts with a digit.
    bool peak_like(std::string_view line)
    {
      if (line.empty() || line.find('=') != std::string_view::npos) return false;
      if (line[0] == '+' || line[0] == '-' || line[0] == '.') return true;
      std::size_t n = 0;
      while (n < line.size() && !is_space(line[n])) ++n;
      std::string word(line.substr(0, n));
      std::transform(word.begin(), word.end(), word.begin(),
                     [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      return word == "nan" || word == "inf" || word == "infinity";
    }

    bool whole_int(std::string_view t, int& v)
    {
      const char* p = t.data();
      const char* e = p + t.size();
      return !t.empty() && StringUtils::extractInt(p, e, v) && p == e;
    }

    /// The bytes of one file, through a stream: a piece read whole plus
    /// 4 KiB pages fetched around it when a line runs past the piece.
    struct Bytes
    {
      std::ifstream& in;
      std::uint64_t size;
      std::string_view piece;
      std::uint64_t piece_at = 0;
      std::string page;
      std::uint64_t page_at = std::numeric_limits<std::uint64_t>::max();

      char at(std::uint64_t pos)
      {
        if (pos >= piece_at && pos - piece_at < piece.size()) return piece[static_cast<std::size_t>(pos - piece_at)];
        if (page_at == std::numeric_limits<std::uint64_t>::max() || pos < page_at || pos - page_at >= page.size())
        {
          const std::uint64_t base = pos & ~std::uint64_t{4095};
          const std::uint64_t n = std::min<std::uint64_t>(4096, size - base);
          page.resize(static_cast<std::size_t>(n));
          in.clear();
          in.seekg(static_cast<std::streamoff>(base));
          in.read(page.data(), static_cast<std::streamsize>(n));
          if (!in) throw std::runtime_error("read failed");
          page_at = base;
        }
        return page[static_cast<std::size_t>(pos - page_at)];
      }
    };

    /// A marker line, in one word: where a BEGIN IONS line starts, or the
    /// byte past an END IONS line (past its '\n'), which is all the merge
    /// needs of each, with kEndBit set for END IONS. 16 bytes per block while
    /// the scan runs instead of 48.
    using Marker = std::uint64_t;
    constexpr Marker kEndBit = Marker{1} << 63;
    std::uint64_t marker_at(Marker m) { return m & ~kEndBit; }
    bool is_end(Marker m) { return (m & kEndBit) != 0; }
    /// File order. An END IONS line's end can be the next BEGIN IONS line's
    /// start; the END comes first.
    bool marker_less(Marker a, Marker b)
    {
      return marker_at(a) < marker_at(b) || (marker_at(a) == marker_at(b) && is_end(a) && !is_end(b));
    }

    /// A trimmed line outside the blocks that looks like spectrum content:
    /// a peak line or a per-spectrum key (not CHARGE=, which a Mascot header
    /// may set for the file).
    bool spectrum_like(std::string_view line)
    {
      if (line.empty()) return false;
      if (line[0] >= '0' && line[0] <= '9') return true;
      for (const std::string_view key : {"PEPMASS=", "TITLE=", "RTINSECONDS=", "SCANS="})
        if (line.substr(0, key.size()) == key) return true;
      return false;
    }

    struct ScanPiece
    {
      std::vector<Marker> markers;
      bool read = true;
    };

    /// The first @p n bytes at @p offset, for a message about that block.
    std::string read_some(const std::string& path, std::uint64_t offset, std::uint64_t n)
    {
      std::ifstream in(path, std::ios::binary);
      std::string s(static_cast<std::size_t>(n), '\0');
      in.seekg(static_cast<std::streamoff>(offset));
      in.read(s.data(), static_cast<std::streamsize>(n));
      s.resize(static_cast<std::size_t>(std::max<std::streamsize>(0, in.gcount())));
      return s;
    }
  }

  /****************************************************************************/
  MgfReader::Blocks MgfReader::scanBlocks(const std::string& path, std::size_t chunk_bytes,
                                          std::uint64_t max_block)
  {
    std::uint64_t size = 0;
    {
      std::ifstream f(path, std::ios::binary | std::ios::ate);
      if (!f) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
      const std::streamoff end = f.tellg();
      if (end < 0) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
      size = static_cast<std::uint64_t>(end);
    }
    Blocks out;
    if (size == 0) throw Exception::FileEmpty(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
    {
      std::ifstream f(path, std::ios::binary);
      char bom[3] = {0, 0, 0};
      f.read(bom, 3);
      if (f.gcount() == 3 && bom[0] == '\xEF' && bom[1] == '\xBB' && bom[2] == '\xBF') out.data_start = 3;
    }

    // Read past each piece's end by one needle length less a byte, so a marker
    // whose first byte is in the piece is seen whole by that piece.
    constexpr std::size_t OVERLAP = kBegin.size() - 1;
    chunk_bytes = std::max<std::size_t>(chunk_bytes, 64);
    const std::uint64_t n_pieces = (size + chunk_bytes - 1) / chunk_bytes;
    std::vector<ScanPiece> pieces(static_cast<std::size_t>(n_pieces));
    const std::uint64_t data_start = out.data_start;

    int threads = 1;
#ifdef _OPENMP
    threads = std::max(1, std::min(omp_get_max_threads(), 16));
#endif
#pragma omp parallel num_threads(threads)
    {
      std::ifstream in(path, std::ios::binary);
      std::string buf;
#pragma omp for schedule(dynamic, 1)
      for (std::int64_t p = 0; p < static_cast<std::int64_t>(n_pieces); ++p)
      {
        ScanPiece& piece = pieces[static_cast<std::size_t>(p)];
        // No exception may leave the parallel region (std::terminate): a
        // piece that fails is marked unread and reported after the join.
        try
        {
          const std::uint64_t begin = static_cast<std::uint64_t>(p) * chunk_bytes;
          const std::uint64_t own = std::min<std::uint64_t>(chunk_bytes, size - begin);
          const std::uint64_t len = std::min<std::uint64_t>(own + OVERLAP, size - begin);
          buf.resize(static_cast<std::size_t>(len));
          in.clear();
          in.seekg(static_cast<std::streamoff>(begin));
          in.read(buf.data(), static_cast<std::streamsize>(len));
          if (!in)
          {
            piece.read = false;
            continue;
          }
          Bytes bytes{in, size, std::string_view(buf), begin, {}, std::numeric_limits<std::uint64_t>::max()};
          const std::string_view v(buf);
          for (const bool is_begin : {true, false})
          {
            const std::string_view needle = is_begin ? kBegin : kEnd;
            for (std::size_t k = v.find(needle); k != std::string_view::npos && k < own; k = v.find(needle, k + 1))
            {
              const std::uint64_t at = begin + k;
              if (at < data_start) continue;
              // Only trim characters back to the line start, however far that
              // is (an indented marker can straddle a piece boundary) ...
              std::uint64_t line_begin = at;
              bool ok = true;
              while (line_begin > data_start)
              {
                const char c = bytes.at(line_begin - 1);
                if (c == '\n') break;
                if (!is_trim(c)) { ok = false; break; }
                --line_begin;
              }
              if (!ok) continue;
              // ... and up to the line end.
              std::uint64_t line_end = at + needle.size();
              while (line_end < size)
              {
                const char c = bytes.at(line_end);
                if (c == '\n') { ++line_end; break; }
                if (!is_trim(c)) { ok = false; break; }
                ++line_end;
              }
              if (ok) piece.markers.push_back(is_begin ? line_begin : (line_end | kEndBit));
            }
          }
          std::sort(piece.markers.begin(), piece.markers.end(), marker_less);
        }
        catch (...)
        {
          piece.read = false;
        }
      }
    }
    for (const ScanPiece& piece : pieces)
    {
      if (!piece.read) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
    }

    // In file order, so an error names the lowest bad block.
    const auto structural = [&](std::uint64_t at, const std::string& reason) {
      block_error(path, out.begin.size() - 1, at, read_some(path, at, kHeaderScan), reason);
    };
    // Sized once (an upper bound: a block per BEGIN IONS), so the offsets do
    // not double while the markers are still held; each piece's markers are
    // released as soon as they are merged.
    {
      std::size_t n_begin = 0;
      for (const ScanPiece& piece : pieces)
        n_begin += static_cast<std::size_t>(std::count_if(piece.markers.begin(), piece.markers.end(),
                                                          [](Marker m) { return !is_end(m); }));
      out.begin.reserve(n_begin);
      out.end.reserve(n_begin);
    }
    bool inside = false;
    for (ScanPiece& piece : pieces)
    {
      for (const Marker m : piece.markers)
      {
        if (!inside)
        {
          // A stray END IONS between blocks is ignored, as OpenMS does, but
          // counted: it is the end of a block whose BEGIN IONS is lost.
          if (!is_end(m))
          {
            out.begin.push_back(m);
            inside = true;
          }
          else if (out.stray_ends++ == 0)
          {
            out.first_stray_end = marker_at(m);
          }
          continue;
        }
        const std::uint64_t b = out.begin.back();
        if (!is_end(m))
        {
          structural(b, "no END IONS before the next BEGIN IONS at byte " + std::to_string(m) +
                            " (a truncated or concatenated file?)");
        }
        const std::uint64_t e = marker_at(m);
        if (e - b > max_block)
        {
          structural(b, "the block is " + std::to_string(e - b) + " bytes, more than the " +
                            std::to_string(max_block) + " bytes a block may have");
        }
        out.end.push_back(e);
        inside = false;
      }
      std::vector<Marker>().swap(piece.markers);
    }
    if (inside) structural(out.begin.back(), "no END IONS before the end of the file (a truncated file?)");
    if (out.begin.empty()) throw Exception::FileEmpty(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);

    // The text outside the blocks is ignored, as OpenMS ignores it. A
    // spectrum there (a block whose BEGIN IONS line is lost, or both its
    // markers) would be dropped without a word, so a stretch that looks like
    // one is counted. Most gaps are empty or one line break and cost nothing.
    {
      std::ifstream in(path, std::ios::binary);
      std::string text;
      const auto look = [&](std::uint64_t from, std::uint64_t to) {
        if (to <= from + 2) return;
        const std::uint64_t n = std::min<std::uint64_t>(to - from, kHeaderScan);
        text.resize(static_cast<std::size_t>(n));
        in.clear();
        in.seekg(static_cast<std::streamoff>(from));
        in.read(text.data(), static_cast<std::streamsize>(n));
        if (!in) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
        for (std::size_t pos = 0; pos < text.size();)
        {
          std::size_t nl = text.find('\n', pos);
          if (nl == std::string::npos) nl = text.size();
          if (spectrum_like(trim(std::string_view(text).substr(pos, nl - pos))))
          {
            std::size_t lead = pos;
            while (lead < nl && is_trim(text[lead])) ++lead;
            if (out.loose_regions++ == 0) out.first_loose = from + lead;
            return;
          }
          pos = nl + 1;
        }
      };
      look(out.data_start, out.begin.front());
      for (std::size_t k = 0; k + 1 < out.begin.size(); ++k) look(out.end[k], out.begin[k + 1]);
      look(out.end.back(), size);
    }
    return out;
  }

  /****************************************************************************/
  void MgfReader::parseBlock(std::string_view block, Size index, std::uint64_t offset, const std::string& source,
                             MSSpectrum& spec, Counts& counts)
  {
    // OpenMS's defaults for every block (MascotGenericFile::getNextSpectrum_).
    spec.clear(true);
    spec.setMSLevel(2);
    spec.getPrecursors().resize(1);
    spec.setType(SpectrumSettings::SpectrumType::CENTROID);
    spec.setNativeID("index=" + std::to_string(index));
    Precursor& prec = spec.getPrecursors()[0];
    const auto bad = [&](const std::string& reason) { block_error(source, index, offset, block, reason); };

    bool begun = false, ended = false, in_peaks = false, pepmass_ok = false, has_charge = false;
    std::size_t pos = 0;
    while (pos < block.size())
    {
      std::size_t nl = block.find('\n', pos);
      if (nl == std::string_view::npos) nl = block.size();
      const std::string_view line = trim(block.substr(pos, nl - pos));
      pos = nl + 1;
      if (line.empty()) continue;
      if (!begun)
      {
        begun = line == kBegin;
        continue;
      }
      if (line == kEnd)
      {
        ended = true;
        break;
      }
      if (line == kBegin) bad("a second BEGIN IONS inside the block");
      const char c0 = line[0];
      // Mascot's comment characters, anywhere in a block.
      if (c0 == '#' || c0 == ';' || c0 == '!' || c0 == '/') continue;
      // Before the first peak line too: skipping it would drop a peak
      // silently, where the same line after a peak is an error.
      if (peak_like(line))
        bad("the line " + quoted(line) + " looks like a peak line, but a peak line starts with a digit "
            "(its m/z)");
      if (c0 >= '0' && c0 <= '9')
      {
        // "m/z intensity [charge]": the third column and anything after it is
        // ignored, as in OpenMS. Intensity is parsed as a double and stored as
        // a float, as OpenMS does.
        in_peaks = true;
        const char* p = line.data();
        const char* e = p + line.size();
        double mz = 0, intensity = 0;
        if (!StringUtils::extractDouble(p, e, mz) || (p != e && !is_space(*p)))
          bad("the peak line " + quoted(line) + " does not start with a number");
        while (p != e && is_space(*p)) ++p;
        if (p == e) bad("the peak line " + quoted(line) + " has one value; expected m/z and intensity");
        if (!StringUtils::extractDouble(p, e, intensity) || (p != e && !is_space(*p)))
          bad("the intensity in the peak line " + quoted(line) + " is not a number");
        spec.push_back(Peak1D(mz, static_cast<float>(intensity)));
        continue;
      }
      if (in_peaks) bad("the line " + quoted(line) + " follows the peaks; keys must come before the first peak line");
      const std::size_t eq = line.find('=');
      if (eq == std::string_view::npos) continue; // not a key: ignored, as OpenMS does
      const std::string_view key = line.substr(0, eq);
      const std::string_view value = trim(line.substr(eq + 1));

      if (key == "PEPMASS")
      {
        const auto t = tokens(value);
        if (t.empty() || t.size() > 2)
          bad("PEPMASS " + quoted(value) + " has " + std::to_string(t.size()) +
              " values; expected m/z and an optional intensity");
        double mz = 0;
        if (!whole_double(t[0], mz)) bad("PEPMASS " + quoted(t[0]) + " is not a number");
        pepmass_ok = std::isfinite(mz) && mz > 0;
        prec.setMZ(std::isfinite(mz) ? mz : 0.0);
        if (t.size() == 2)
        {
          double it = 0;
          if (!whole_double(t[1], it)) bad("the PEPMASS intensity " + quoted(t[1]) + " is not a number");
          prec.setIntensity(static_cast<float>(it));
        }
      }
      else if (key == "CHARGE")
      {
        has_charge = true;
        // One value, or several: "2+ and 3+", "2+,3+", "2,3". A value is
        // [+-]digits[+-]; a '-' on either side is negative mode.
        std::string list(value);
        std::replace(list.begin(), list.end(), ',', ' ');
        std::vector<int> charges;
        bool negative = false;
        for (std::string_view tok : tokens(list))
        {
          if (tok == "and" || tok == "AND" || tok == "And") continue;
          char lead = 0, trail = 0;
          if (tok.front() == '+' || tok.front() == '-') { lead = tok.front(); tok.remove_prefix(1); }
          if (!tok.empty() && (tok.back() == '+' || tok.back() == '-')) { trail = tok.back(); tok.remove_suffix(1); }
          int z = 0;
          if ((lead && trail && lead != trail) || tok.empty() || tok.front() == '+' || tok.front() == '-' ||
              !whole_int(tok, z))
          {
            bad("CHARGE " + quoted(value) + " is not a charge or a list of charges");
          }
          negative = negative || lead == '-' || trail == '-';
          if (std::find(charges.begin(), charges.end(), z) == charges.end()) charges.push_back(z);
        }
        if (charges.size() == 1)
        {
          prec.setCharge(charges[0]);
          prec.setPossibleChargeStates({});
        }
        else
        {
          // Several possible charges: none is THE charge (tagged as 2+, as a
          // precursor without one is), and the list is kept.
          std::vector<Int> possible;
          for (const int z : charges)
            if (z > 0) possible.push_back(z);
          prec.setCharge(0);
          prec.setPossibleChargeStates(possible);
        }
        if (negative) spec.getInstrumentSettings().setPolarity(IonSource::Polarity::NEGATIVE);
      }
      else if (key == "RTINSECONDS")
      {
        // One time, or a range "a-b", which gives its midpoint.
        const char* p = value.data();
        const char* e = p + value.size();
        double a = 0, b = 0;
        bool ok = StringUtils::extractDouble(p, e, a);
        if (ok && p != e)
        {
          ok = *p == '-';
          ++p;
          ok = ok && StringUtils::extractDouble(p, e, b) && p == e;
          a = (a + b) / 2;
        }
        if (!ok) bad("RTINSECONDS " + quoted(value) + " is not a time or a range of times");
        // nan or inf: no time (an mzML cannot carry it either), counted.
        if (std::isfinite(a)) spec.setRT(a);
        else ++counts.rt_not_finite;
      }
      else if (key == "MSLEVEL")
      {
        int level = 0;
        if (!whole_int(value, level) || level < 1) bad("MSLEVEL " + quoted(value) + " is not an MS level");
        spec.setMSLevel(static_cast<UInt>(level));
      }
      else if (key == "TITLE")
      {
        bool changed = false;
        spec.setMetaValue("TITLE", sanitise(value, changed));
        counts.titles_sanitised += changed;
      }
      else if (key == "SCANS")
      {
        // Sanitised like TITLE: it is written to -out_spectra's XML.
        bool changed = false;
        spec.setMetaValue("Scan_ID", sanitise(value, changed));
        counts.scans_sanitised += changed;
      }
      // Every other key is ignored.
    }
    if (!ended) bad("no END IONS"); // scanBlocks has ruled this out for a file
    if (!pepmass_ok) ++counts.no_pepmass;
    if (!has_charge) ++counts.no_charge_key;
  }

  /****************************************************************************/
  struct MgfReader::Impl
  {
    std::string path;
    std::shared_ptr<const Blocks> blocks;
    std::shared_ptr<const ExperimentalSettings> settings;
    std::ifstream in;
    std::string buffer;
    Counts counts;
    bool header_charge = false;
  };

  MgfReader::MgfReader(const std::string& path, std::size_t chunk_bytes, std::uint64_t max_block)
    : impl_(std::make_unique<Impl>())
  {
    impl_->path = path;
    impl_->blocks = std::make_shared<const Blocks>(scanBlocks(path, chunk_bytes, max_block));
    // The text before the first block, at most kHeaderScan bytes of it: a
    // file-level CHARGE= there is a Mascot default this reader does not apply.
    {
      const Blocks& b = *impl_->blocks;
      const std::string head =
          read_some(path, b.data_start, std::min<std::uint64_t>(b.begin[0] - b.data_start, kHeaderScan));
      std::size_t pos = 0;
      while (pos < head.size() && !impl_->header_charge)
      {
        std::size_t nl = head.find('\n', pos);
        if (nl == std::string::npos) nl = head.size();
        impl_->header_charge = trim(std::string_view(head).substr(pos, nl - pos)).substr(0, 7) == "CHARGE=";
        pos = nl + 1;
      }
    }
    auto settings = std::make_shared<ExperimentalSettings>();
    SourceFile sf;
    sf.setNameOfFile(File::basename(path));
    sf.setPathToFile(File::toFileURI(File::path(File::absolutePath(path))));
    sf.setFileType(FileTypes::typeToMZML(FileTypes::MGF));
    sf.setNativeIDType("multiple peak list nativeID format");
    sf.setNativeIDTypeAccession("MS:1000774");
    settings->getSourceFiles().push_back(sf);
    impl_->settings = settings;
    impl_->in.open(path, std::ios::binary);
    if (!impl_->in) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path);
  }

  MgfReader::MgfReader(const MgfReader& other)
    : impl_(std::make_unique<Impl>())
  {
    impl_->path = other.impl_->path;
    impl_->blocks = other.impl_->blocks;
    impl_->settings = other.impl_->settings;
    impl_->header_charge = other.impl_->header_charge;
    impl_->in.open(impl_->path, std::ios::binary);
    if (!impl_->in) throw Exception::FileNotReadable(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, impl_->path);
  }

  MgfReader::~MgfReader() = default;

  Size MgfReader::getNrSpectra() const { return impl_->blocks->begin.size(); }

  MSSpectrum MgfReader::getSpectrum(Size i)
  {
    const Blocks& b = *impl_->blocks;
    MSSpectrum spec;
    if (i >= b.begin.size()) return spec;
    const std::uint64_t n = b.end[i] - b.begin[i];
    std::string& buf = impl_->buffer;
    buf.resize(static_cast<std::size_t>(n));
    impl_->in.clear();
    impl_->in.seekg(static_cast<std::streamoff>(b.begin[i]));
    impl_->in.read(buf.data(), static_cast<std::streamsize>(n));
    if (!impl_->in)
    {
      throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, impl_->path,
                                  "MGF block " + std::to_string(i) + " (byte " + std::to_string(b.begin[i]) +
                                      "): its bytes could not be read (the file changed after it was scanned?)");
    }
    parseBlock(buf, i, b.begin[i], impl_->path, spec, impl_->counts);
    if (buf.capacity() > kKeepBuffer) std::string().swap(buf);
    return spec;
  }

  const ExperimentalSettings& MgfReader::settings() const { return *impl_->settings; }
  const MgfReader::Counts& MgfReader::counts() const { return impl_->counts; }
  const MgfReader::Blocks& MgfReader::blocks() const { return *impl_->blocks; }
  bool MgfReader::hasBom() const { return impl_->blocks->data_start > 0; }
  bool MgfReader::headerCharge() const { return impl_->header_charge; }
  std::uint64_t MgfReader::headerBytes() const { return impl_->blocks->begin[0] - impl_->blocks->data_start; }
  std::size_t MgfReader::bufferCapacity() const { return impl_->buffer.capacity(); }
}
