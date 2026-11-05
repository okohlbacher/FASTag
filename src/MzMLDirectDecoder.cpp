// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MzMLDirectDecoder.h"

#include <OpenMS/KERNEL/Peak1D.h>

#include <zlib.h>

#include <algorithm>
#include <array>
#include <bit>
#include <charconv>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>
#include <string>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    /// A growable byte buffer that keeps its storage and never zero-fills.
    struct Buffer
    {
      std::unique_ptr<unsigned char[]> data;
      std::size_t cap = 0;
      std::size_t size = 0;

      /// At least @p n bytes of storage, keeping the first @p keep bytes.
      void reserve(std::size_t n, std::size_t keep = 0)
      {
        if (n <= cap) return;
        std::size_t c = cap ? cap : 4096;
        while (c < n) c *= 2;
        std::unique_ptr<unsigned char[]> p(new unsigned char[c]);
        if (keep) std::memcpy(p.get(), data.get(), keep);
        data = std::move(p);
        cap = c;
      }
    };

    bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

    /// Characters that end an XML name.
    bool is_name_end(char c) { return is_space(c) || c == '>' || c == '/'; }

    /// One tag starting at a '<': its name (without a leading '/'), its
    /// attribute text, and the position after its '>'.
    struct Tag
    {
      std::string_view name;
      std::string_view attrs;
      std::size_t end = 0;
      bool closing = false;
      bool self_closing = false;
    };

    /// Reads the tag at @p lt (xml[lt] == '<'). '>' inside a quoted
    /// attribute value does not end the tag. False on anything that is not a
    /// plain start, end or empty-element tag (comments, CDATA, processing
    /// instructions, a tag that does not end).
    bool read_tag(std::string_view xml, std::size_t lt, Tag& tag)
    {
      std::size_t k = lt + 1;
      if (k >= xml.size()) return false;
      tag.closing = xml[k] == '/';
      if (tag.closing) ++k;
      const std::size_t nb = k;
      while (k < xml.size() && !is_name_end(xml[k]))
      {
        const char c = xml[k];
        if (c == '<' || c == '!' || c == '?' || c == '"' || c == '\'' || c == '=' || c == '&') return false;
        ++k;
      }
      if (k == nb || k >= xml.size()) return false;
      tag.name = xml.substr(nb, k - nb);
      const std::size_t ab = k;
      char quote = 0;
      for (; k < xml.size(); ++k)
      {
        const char c = xml[k];
        if (quote)
        {
          if (c == quote) quote = 0;
          else if (c == '<') return false; // not well-formed XML
        }
        else if (c == '"' || c == '\'') quote = c;
        else if (c == '<') return false;
        else if (c == '>') break;
      }
      if (k >= xml.size()) return false;
      tag.self_closing = k > ab && xml[k - 1] == '/';
      tag.attrs = xml.substr(ab, (tag.self_closing ? k - 1 : k) - ab);
      tag.end = k + 1;
      if (tag.closing && (tag.self_closing || tag.attrs.find_first_not_of(" \t\n\r") != std::string_view::npos))
        return false;
      return true;
    }

    /// One XML character of @p s at @p k, decoded from UTF-8; @p k moves past
    /// it. False on invalid UTF-8 (overlong forms and surrogates included) and
    /// on code points XML 1.0 does not allow (control characters, U+FFFE, ...):
    /// libxml2 stops on both with a fatal error.
    bool next_char(std::string_view s, std::size_t& k, std::uint32_t& cp)
    {
      const unsigned char c = static_cast<unsigned char>(s[k]);
      std::size_t len = 0;
      if (c < 0x80) { cp = c; len = 1; }
      else if (c >= 0xC2 && c <= 0xDF) { cp = c & 0x1Fu; len = 2; }
      else if (c >= 0xE0 && c <= 0xEF) { cp = c & 0x0Fu; len = 3; }
      else if (c >= 0xF0 && c <= 0xF4) { cp = c & 0x07u; len = 4; }
      else return false;
      if (s.size() - k < len) return false;
      for (std::size_t i = 1; i < len; ++i)
      {
        const unsigned char d = static_cast<unsigned char>(s[k + i]);
        if ((d & 0xC0) != 0x80) return false;
        cp = (cp << 6) | (d & 0x3Fu);
      }
      if ((len == 3 && cp < 0x800) || (len == 4 && (cp < 0x10000 || cp > 0x10FFFF))) return false; // overlong
      k += len;
      return cp == 0x9 || cp == 0xA || cp == 0xD || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) ||
             cp >= 0x10000;
    }

    /// The reference at @p s[k] == '&' is one libxml2 resolves without a DTD:
    /// one of the five predefined entities, or a character reference to an
    /// XML character. @p k moves past its ';'.
    bool next_reference(std::string_view s, std::size_t& k)
    {
      const std::size_t semi = s.find(';', k);
      if (semi == std::string_view::npos || semi - k > 12) return false;
      const std::string_view ref = s.substr(k + 1, semi - k - 1);
      k = semi + 1;
      if (ref == "lt" || ref == "gt" || ref == "amp" || ref == "quot" || ref == "apos") return true;
      if (ref.size() < 2 || ref[0] != '#') return false;
      const bool hex = ref[1] == 'x';
      const std::string_view digits = ref.substr(hex ? 2 : 1);
      std::uint32_t cp = 0;
      const auto r = std::from_chars(digits.data(), digits.data() + digits.size(), cp, hex ? 16 : 10);
      if (digits.empty() || r.ec != std::errc() || r.ptr != digits.data() + digits.size()) return false;
      return cp == 0x9 || cp == 0xA || cp == 0xD || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) ||
             (cp >= 0x10000 && cp <= 0x10FFFF);
    }

    /// Character data or an attribute value as libxml2 accepts it without a
    /// fatal error: XML characters in valid UTF-8, '&' only in a reference
    /// next_reference() accepts, no '<', and in character data no "]]>".
    bool well_formed_text(std::string_view s, bool attribute)
    {
      std::size_t k = 0;
      while (k < s.size())
      {
        const char c = s[k];
        if (c == '&')
        {
          if (!next_reference(s, k)) return false;
        }
        else if (c == '<') return false;
        else if (static_cast<unsigned char>(c) >= 0x20 && static_cast<unsigned char>(c) < 0x80)
        {
          if (!attribute && c == '>' && k >= 2 && s[k - 1] == ']' && s[k - 2] == ']') return false;
          ++k;
        }
        else
        {
          std::uint32_t cp;
          if (!next_char(s, k, cp)) return false;
        }
      }
      return true;
    }

    /// An element or attribute name this decoder takes: ASCII, no namespace
    /// prefix (both are valid XML that mzML spectra do not use; declined).
    bool plain_name(std::string_view n)
    {
      if (n.empty()) return false;
      const auto alpha = [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; };
      if (!alpha(n[0])) return false;
      for (const char c : n)
        if (!alpha(c) && !(c >= '0' && c <= '9') && c != '-' && c != '.') return false;
      return true;
    }

    /// The attributes of a tag, one at a time, checked as libxml2 checks
    /// them: a valid name, a quoted value that is well-formed text,
    /// whitespace before every further attribute, and no name twice; `bad`
    /// is set on the first violation. Values are returned raw; the caller
    /// refuses any that would need entity or whitespace normalisation.
    struct AttrReader
    {
      std::string_view s;
      std::size_t k = 0;
      bool bad = false;
      std::array<std::string_view, 32> seen{};
      std::size_t n_seen = 0;

      bool next(std::string_view& name, std::string_view& value)
      {
        while (k < s.size() && is_space(s[k])) ++k;
        if (k >= s.size()) return false;
        const std::size_t nb = k;
        while (k < s.size() && s[k] != '=' && !is_space(s[k])) ++k;
        name = s.substr(nb, k - nb);
        while (k < s.size() && is_space(s[k])) ++k;
        if (!plain_name(name) || k >= s.size() || s[k] != '=') { bad = true; return false; }
        ++k;
        while (k < s.size() && is_space(s[k])) ++k;
        if (k >= s.size() || (s[k] != '"' && s[k] != '\'')) { bad = true; return false; }
        const char q = s[k++];
        const std::size_t ve = s.find(q, k);
        if (ve == std::string_view::npos) { bad = true; return false; }
        value = s.substr(k, ve - k);
        k = ve + 1;
        // "a='1'b='2'" is a fatal error in libxml2; so is a repeated name.
        if (k < s.size() && !is_space(s[k])) { bad = true; return false; }
        if (!well_formed_text(value, true)) { bad = true; return false; }
        for (std::size_t i = 0; i < n_seen; ++i)
          if (seen[i] == name) { bad = true; return false; }
        if (n_seen == seen.size()) { bad = true; return false; } // more than this decoder tracks: declined
        seen[n_seen++] = name;
        return true;
      }

      /// Every remaining attribute, checked; true when all are well-formed.
      bool check_rest()
      {
        std::string_view n, v;
        while (next(n, v)) {}
        return !bad;
      }
    };

    /// A value libxml2 would hand over unchanged: no entity or character
    /// reference, and no whitespace it would normalise to a space.
    bool literal(std::string_view v)
    {
      for (const char c : v)
        if (c == '&' || c == '\t' || c == '\n' || c == '\r' || c == '<') return false;
      return true;
    }

    /// 0..63 for the base64 alphabet, 64 for '=', 65 for whitespace, 255 else.
    constexpr std::array<unsigned char, 256> make_b64_table()
    {
      std::array<unsigned char, 256> t{};
      for (auto& v : t) v = 255;
      constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      for (unsigned i = 0; i < 64; ++i) t[static_cast<unsigned char>(alphabet[i])] = static_cast<unsigned char>(i);
      t[static_cast<unsigned char>('=')] = 64;
      t[static_cast<unsigned char>(' ')] = 65;
      t[static_cast<unsigned char>('\t')] = 65;
      t[static_cast<unsigned char>('\n')] = 65;
      t[static_cast<unsigned char>('\r')] = 65;
      return t;
    }
    constexpr std::array<unsigned char, 256> kB64 = make_b64_table();

    /// Strict base64 into @p out, whitespace skipped as OpenMS strips it.
    /// False on a character outside the alphabet, a length (whitespace
    /// excluded) that is not a multiple of 4, or '=' anywhere but in the last
    /// two places. Fewer than 4 characters decode to nothing, as in OpenMS.
    bool decode_base64(std::string_view in, Buffer& out)
    {
      out.size = 0;
      out.reserve(in.size() / 4 * 3 + 3);
      unsigned char* o = out.data.get();
      std::uint32_t acc = 0;
      int have = 0;      // characters in acc
      std::size_t n = 0; // non-whitespace characters
      int pad = 0;
      const unsigned char* p = reinterpret_cast<const unsigned char*>(in.data());
      const unsigned char* const e = p + in.size();

      // Fast path: four alphabet characters at a time, no whitespace, no '='.
      while (e - p >= 4)
      {
        const unsigned a = kB64[p[0]], b = kB64[p[1]], c = kB64[p[2]], d = kB64[p[3]];
        if ((a | b | c | d) >= 64) break;
        const std::uint32_t v = (a << 18) | (b << 12) | (c << 6) | d;
        o[0] = static_cast<unsigned char>(v >> 16);
        o[1] = static_cast<unsigned char>(v >> 8);
        o[2] = static_cast<unsigned char>(v);
        o += 3;
        p += 4;
        n += 4;
      }
      for (; p < e; ++p)
      {
        const unsigned v = kB64[*p];
        if (v == 65) continue;
        if (v == 255) return false;
        ++n;
        if (v == 64)
        {
          ++pad;
          acc <<= 6;
        }
        else
        {
          if (pad) return false; // data after '='
          acc = (acc << 6) | v;
        }
        if (++have == 4)
        {
          o[0] = static_cast<unsigned char>(acc >> 16);
          o[1] = static_cast<unsigned char>(acc >> 8);
          o[2] = static_cast<unsigned char>(acc);
          o += 3;
          acc = 0;
          have = 0;
        }
      }
      if (n % 4 != 0 || pad > 2) return false;
      if (n < 4) { out.size = 0; return true; }
      out.size = static_cast<std::size_t>(o - out.data.get()) - static_cast<std::size_t>(pad);
      return true;
    }

    /// One binaryDataArray as the scanner saw it.
    struct Array
    {
      std::string_view base64;
      std::string_view name;   ///< "name" of its m/z or intensity cvParam
      int bits = 0;            ///< 32 or 64; 0: no float type given
      bool zlib = false;
      bool has_binary = false;
    };
  }

  /****************************************************************************/
  struct MzMLDirectDecoder::Impl
  {
    Buffer b64;
    Buffer bytes[2];
    z_stream zs{};
    bool z_ready = false;

    ~Impl()
    {
      if (z_ready) inflateEnd(&zs);
    }

    /// Inflates @p in into @p out; @p expect is the size the array should
    /// have. True only for a stream that ends (Z_STREAM_END), as OpenMS's
    /// loop requires; input after the end is ignored, as there.
    bool inflate_into(const unsigned char* in, std::size_t n, Buffer& out, std::size_t expect)
    {
      if (n > std::numeric_limits<uInt>::max()) return false;
      if (!z_ready)
      {
        zs = z_stream{};
        if (inflateInit(&zs) != Z_OK) return false;
        z_ready = true;
      }
      else if (inflateReset(&zs) != Z_OK)
      {
        return false;
      }
      out.size = 0;
      // The first allocation follows the input, not defaultArrayLength: that
      // is the file's claim, and a wrong or garbage one (2^31 peaks) must not
      // allocate gigabytes up front. The buffer doubles as needed below.
      out.reserve(std::min(expect, n * 4 + 4096) + 64);
      zs.next_in = const_cast<Bytef*>(in);
      zs.avail_in = static_cast<uInt>(n);
      while (true)
      {
        // An array longer than defaultArrayLength is declined anyway (OpenMS
        // then warns about it); stop rather than inflate it to the end and
        // keep a buffer that large for the rest of the run.
        if (out.size > expect) return false;
        if (out.size == out.cap) out.reserve(out.cap * 2, out.size);
        const std::size_t room = std::min<std::size_t>(out.cap - out.size, std::numeric_limits<uInt>::max());
        zs.next_out = out.data.get() + out.size;
        zs.avail_out = static_cast<uInt>(room);
        const int ret = inflate(&zs, Z_NO_FLUSH);
        out.size += room - zs.avail_out;
        if (ret == Z_STREAM_END) return out.size <= expect;
        if (ret == Z_OK) continue;
        if (ret == Z_BUF_ERROR && zs.avail_out == 0) continue; // more room needed
        return false; // Z_BUF_ERROR with input exhausted (truncated), data or memory errors
      }
    }

    /// The decoded bytes of @p a into @p out.
    bool bytes_of(const Array& a, Buffer& out, std::size_t expect_bytes)
    {
      if (!a.zlib) return decode_base64(a.base64, out);
      if (!decode_base64(a.base64, b64)) return false;
      if (b64.size == 0)
      {
        // OpenMS skips inflate for fewer than 4 base64 characters.
        out.size = 0;
        return true;
      }
      return inflate_into(b64.data.get(), b64.size, out, expect_bytes);
    }
  };

  MzMLDirectDecoder::MzMLDirectDecoder() : impl_(std::make_unique<Impl>()) {}
  MzMLDirectDecoder::~MzMLDirectDecoder() = default;

  bool MzMLDirectDecoder::disabledByEnvironment()
  {
    const char* e = std::getenv("FASTAG_OPENMS_DECODER");
    return e != nullptr && std::strcmp(e, "0") != 0;
  }

  bool MzMLDirectDecoder::decode(std::string_view xml, MSSpectrum& spec)
  {
    // A failed allocation (a huge array, a thread short of memory) declines:
    // OpenMS's path then runs, with whatever it does for that spectrum.
    // `spec` is only touched after the last allocation that can fail here.
    try
    {
      return decode_(xml, spec);
    }
    catch (const std::bad_alloc&)
    {
      return false;
    }
  }

  bool MzMLDirectDecoder::decode_(std::string_view xml, MSSpectrum& spec)
  {
    // mzML stores little-endian arrays; this decoder copies them as they are.
    if constexpr (std::endian::native != std::endian::little) return false;

    // The root: <spectrum ...>, its id and defaultArrayLength.
    Tag root;
    if (xml.size() < 10 || xml.compare(0, 9, "<spectrum") != 0 || !read_tag(xml, 0, root) ||
        root.closing || root.self_closing || root.name != "spectrum")
      return false;
    std::string_view id, length_text;
    bool has_length = false;
    {
      AttrReader ar{root.attrs};
      std::string_view n, v;
      while (ar.next(n, v))
      {
        if (n == "id") id = v;
        else if (n == "defaultArrayLength") { length_text = v; has_length = true; }
      }
      if (ar.bad || !has_length || !literal(id)) return false;
    }
    std::int32_t length = 0;
    {
      const auto r = std::from_chars(length_text.data(), length_text.data() + length_text.size(), length);
      if (r.ec != std::errc() || r.ptr != length_text.data() + length_text.size() || length < 0) return false;
    }

    // The whole element, start to </spectrum>, must be well-formed as far as
    // libxml2 (non-recovering, as domParseSpectrum runs it) checks: OpenMS
    // throws on any fatal error before the root ends, and a spectrum it
    // cannot read must not be read here. So every tag is matched against an
    // element stack, every attribute and every text checked, also in the
    // metadata this decoder does not otherwise use. The metadata may hold any
    // elements and comments; from <binaryDataArrayList> on, every tag must
    // be one this decoder understands and text between tags whitespace; and
    // after </binaryDataArrayList> only </spectrum> may follow.
    enum class Region { meta, arrays, after };
    Region region = Region::meta;
    std::array<std::string_view, 32> stack{};
    std::size_t depth = 0;
    stack[depth++] = root.name;
    std::size_t pos = root.end;
    std::array<Array, 2> arrays;
    int n_arrays = 0;
    Array* cur = nullptr;
    const auto blank = [](std::string_view t) { return t.find_first_not_of(" \t\n\r") == std::string_view::npos; };
    while (depth > 0)
    {
      const std::size_t lt = xml.find('<', pos);
      if (lt == std::string_view::npos) return false; // the root never ends
      const std::string_view text = xml.substr(pos, lt - pos);
      if (region == Region::meta ? !well_formed_text(text, false) : !blank(text)) return false;

      if (xml.compare(lt, 4, "<!--") == 0)
      {
        // A comment, in the metadata only: XML characters, no "--" inside.
        const std::size_t ce = xml.find("--", lt + 4);
        if (region != Region::meta || ce == std::string_view::npos || xml.compare(ce, 3, "-->") != 0) return false;
        const std::string_view body = xml.substr(lt + 4, ce - lt - 4);
        for (std::size_t k = 0; k < body.size();)
        {
          std::uint32_t cp;
          if (!next_char(body, k, cp)) return false;
        }
        pos = ce + 3;
        continue;
      }

      Tag t;
      if (!read_tag(xml, lt, t) || !plain_name(t.name)) return false; // CDATA, PIs, DOCTYPE: declined
      pos = t.end;
      if (t.closing)
      {
        if (stack[depth - 1] != t.name) return false; // mismatched or unclosed element
        if (--depth == 0) break; // </spectrum>
      }
      else if (!t.self_closing)
      {
        if (depth == stack.size()) return false;
        stack[depth++] = t.name;
      }

      if (region == Region::meta)
      {
        if (t.name == "binaryDataArrayList" && !t.closing)
        {
          if (depth != 2 || t.self_closing) return false; // a direct child of <spectrum>, with arrays
          region = Region::arrays;
        }
        // OpenMS decodes a <binaryDataArray> wherever it sits.
        else if (t.name == "binaryDataArray" || t.name == "binary" || t.name == "binaryDataArrayList") return false;
        if (!AttrReader{t.attrs}.check_rest()) return false;
        continue;
      }
      if (region == Region::after) return false; // only </spectrum>, which ends the loop

      if (t.name == "binaryDataArrayList")
      {
        if (!t.closing || cur) return false;
        region = Region::after;
      }
      else if (t.name == "binaryDataArray")
      {
        if (t.closing)
        {
          if (!cur || !cur->has_binary) return false;
          cur = nullptr;
        }
        else
        {
          if (cur || t.self_closing || n_arrays == 2) return false; // more than two arrays
          if (!AttrReader{t.attrs}.check_rest()) return false;
          cur = &arrays[static_cast<std::size_t>(n_arrays++)];
        }
      }
      else if (t.name == "cvParam")
      {
        if (!cur || t.closing) return false;
        std::string_view accession, name, unit;
        bool has_unit = false;
        AttrReader ar{t.attrs};
        std::string_view an, av;
        while (ar.next(an, av))
        {
          if (an == "accession") accession = av;
          else if (an == "name") name = av;
          else if (an == "unitAccession") { unit = av; has_unit = true; }
        }
        // The unit is compared as text below; one written with a character
        // reference (UO&#58;0000269) is the same unit to libxml2.
        if (ar.bad || !literal(accession) || !literal(name) || (has_unit && !literal(unit))) return false;
        // A unit on anything but the m/z or intensity term becomes a meta
        // value in OpenMS; absorbance intensities do too.
        if (accession == "MS:1000514" || accession == "MS:1000515")
        {
          if (accession == "MS:1000515" && unit == "UO:0000269") return false;
          cur->name = name;
        }
        else if (has_unit && !unit.empty()) return false;
        else if (accession == "MS:1000523") cur->bits = 64;
        else if (accession == "MS:1000521") cur->bits = 32;
        else if (accession == "MS:1000574") cur->zlib = true;
        else if (accession == "MS:1000576") cur->zlib = false;
        else return false; // numpress, zstd, integer/string types, other arrays, unknown terms
        if (!t.self_closing)
        {
          // <cvParam ...></cvParam>: only whitespace may come before the end tag.
          const std::size_t e = xml.find('<', pos);
          Tag et;
          if (e == std::string_view::npos || !read_tag(xml, e, et) || !et.closing || et.name != "cvParam" ||
              !blank(xml.substr(pos, e - pos)))
            return false;
          pos = et.end;
          --depth;
        }
      }
      else if (t.name == "binary")
      {
        if (!cur || t.closing || cur->has_binary) return false; // OpenMS concatenates repeats
        if (!AttrReader{t.attrs}.check_rest()) return false;
        cur->has_binary = true;
        if (t.self_closing) continue;
        // The base64 text: decode_base64 refuses anything outside its
        // alphabet and whitespace, '&' and non-ASCII bytes included.
        const std::size_t e = xml.find('<', pos);
        Tag et;
        if (e == std::string_view::npos || !read_tag(xml, e, et) || !et.closing || et.name != "binary") return false;
        cur->base64 = xml.substr(pos, e - pos);
        pos = et.end;
        --depth;
      }
      else
      {
        return false; // </spectrum> before </binaryDataArrayList>, userParam, referenceableParamGroupRef, ...
      }
    }
    if (region != Region::after) return false; // no arrays

    // Exactly one m/z and one intensity array, both float.
    if (n_arrays != 2) return false;
    int mz_i = -1, int_i = -1;
    for (int i = 0; i < 2; ++i)
    {
      const Array& a = arrays[static_cast<std::size_t>(i)];
      if (a.bits == 0) return false;
      if (a.name == "m/z array" && mz_i < 0) mz_i = i;
      else if (a.name == "intensity array" && int_i < 0) int_i = i;
    }
    if (mz_i < 0 || int_i < 0) return false;
    const Array& mz = arrays[static_cast<std::size_t>(mz_i)];
    const Array& in = arrays[static_cast<std::size_t>(int_i)];

    const std::size_t n = static_cast<std::size_t>(length);
    if (!impl_->bytes_of(mz, impl_->bytes[0], n * static_cast<std::size_t>(mz.bits / 8)) ||
        !impl_->bytes_of(in, impl_->bytes[1], n * static_cast<std::size_t>(in.bits / 8)))
      return false;
    const Buffer& mb = impl_->bytes[0];
    const Buffer& ib = impl_->bytes[1];
    const std::size_t mw = static_cast<std::size_t>(mz.bits / 8), iw = static_cast<std::size_t>(in.bits / 8);
    // A zlib array whose bytes are not whole values makes OpenMS throw; an
    // array whose length differs from defaultArrayLength makes it warn.
    // Either way: OpenMS's path, with its messages.
    if (mz.zlib && mb.size % mw != 0) return false;
    if (in.zlib && ib.size % iw != 0) return false;
    if (mb.size / mw != n || ib.size / iw != n) return false;

    // The peaks, converted as OpenMS's fillDataArray does: m/z to double,
    // intensity to float. The allocations come first: a bad_alloc in either
    // leaves the peaks of `spec` as they were.
    spec.reserve(spec.size() + n);
    spec.setNativeID(std::string(id));
    Peak1D peak;
    const unsigned char* mp = mb.data.get();
    const unsigned char* ip = ib.data.get();
    for (std::size_t k = 0; k < n; ++k)
    {
      double m;
      if (mw == 8) std::memcpy(&m, mp + k * 8, 8);
      else
      {
        float f;
        std::memcpy(&f, mp + k * 4, 4);
        m = f;
      }
      if (iw == 8)
      {
        double d;
        std::memcpy(&d, ip + k * 8, 8);
        peak.setIntensity(static_cast<Peak1D::IntensityType>(d));
      }
      else
      {
        float f;
        std::memcpy(&f, ip + k * 4, 4);
        peak.setIntensity(f);
      }
      peak.setMZ(m);
      spec.push_back(peak);
    }
    return true;
  }
}
