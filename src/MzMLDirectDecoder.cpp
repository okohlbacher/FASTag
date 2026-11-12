// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MzMLDirectDecoder.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/MSNumpressCoder.h>
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
#include <vector>

#if defined(__SSE2__) || defined(_M_X64)
#define FASTAG_DECODER_SSE2 1
#include <emmintrin.h>
#endif

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

    /// Byte classes for the one-pass scanner below.
    enum : unsigned char
    {
      kSpace = 1,     ///< XML whitespace: ' ', '\t', '\n', '\r'
      kNameStart = 2, ///< first character of a name this decoder takes
      kName = 4,      ///< further characters of such a name
      kTextStop = 8,  ///< character data: anything but plain ASCII needs a closer look
      kValueStop = 16 ///< attribute values: likewise, quotes included
    };

    constexpr std::array<unsigned char, 256> make_class_table()
    {
      std::array<unsigned char, 256> t{};
      for (unsigned c = 0; c < 256; ++c)
      {
        unsigned v = 0;
        const bool space = c == ' ' || c == '\t' || c == '\n' || c == '\r';
        const bool alpha = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
        // XML characters that stand for themselves: printable ASCII and the
        // three whitespace controls. Other controls and every byte >= 0x80
        // go through next_char() (UTF-8 and the XML character ranges).
        const bool plain = (c >= 0x20 && c < 0x80) || space;
        if (space) v |= kSpace;
        if (alpha) v |= kNameStart | kName;
        if ((c >= '0' && c <= '9') || c == '-' || c == '.') v |= kName;
        if (!plain || c == '&' || c == '<' || c == '>') v |= kTextStop;
        if (!plain || c == '&' || c == '<' || c == '"' || c == '\'') v |= kValueStop;
        t[c] = static_cast<unsigned char>(v);
      }
      return t;
    }
    constexpr std::array<unsigned char, 256> kClass = make_class_table();

    inline unsigned char cls(const char* p) { return kClass[static_cast<unsigned char>(*p)]; }

    /// The first byte from @p p on whose class has @p Stop (kTextStop or
    /// kValueStop), or @p e. With SSE2, 16 bytes per step: a signed compare
    /// against 0x20 finds controls and bytes >= 0x80 at once, whitespace
    /// controls are taken out again, and the few stop characters are
    /// compared directly. The table loop does the rest, and the same.
    template <unsigned char Stop>
    inline const char* skip_plain(const char* p, const char* e)
    {
#ifdef FASTAG_DECODER_SSE2
      const auto eq = [](__m128i v, char c) { return _mm_cmpeq_epi8(v, _mm_set1_epi8(c)); };
      while (e - p >= 16)
      {
        const __m128i v = _mm_loadu_si128(reinterpret_cast<const __m128i*>(p));
        __m128i m = _mm_cmplt_epi8(v, _mm_set1_epi8(0x20));
        m = _mm_andnot_si128(_mm_or_si128(_mm_or_si128(eq(v, '\t'), eq(v, '\n')), eq(v, '\r')), m);
        m = _mm_or_si128(m, _mm_or_si128(eq(v, '&'), eq(v, '<')));
        if constexpr (Stop == kTextStop) m = _mm_or_si128(m, eq(v, '>'));
        else m = _mm_or_si128(m, _mm_or_si128(eq(v, '"'), eq(v, '\'')));
        const unsigned bits = static_cast<unsigned>(_mm_movemask_epi8(m));
        if (bits) return p + std::countr_zero(bits);
        p += 16;
      }
#endif
      while (p < e && !(cls(p) & Stop)) ++p;
      return p;
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

    /// The reference at @p p ('&'), as next_reference(); @p p moves past it.
    /// A reference that would run past the end of its text or value cannot
    /// be valid: none of the accepted ones holds '<' or a quote.
    bool skip_reference(const char*& p, const char* e)
    {
      std::size_t k = 0;
      if (!next_reference(std::string_view(p, static_cast<std::size_t>(std::min<std::ptrdiff_t>(e - p, 13))), k))
        return false;
      p += k;
      return true;
    }

    /// The (non-ASCII or control) character at @p p, as next_char(); @p p
    /// moves past it. A UTF-8 sequence cannot run into the '<' or quote that
    /// ends its text: those are not continuation bytes.
    bool skip_char(const char*& p, const char* e)
    {
      std::size_t k = 0;
      std::uint32_t cp;
      if (!next_char(std::string_view(p, static_cast<std::size_t>(e - p)), k, cp)) return false;
      p += k;
      return true;
    }

    /// Character data from @p p on, checked as libxml2 checks it: XML
    /// characters in valid UTF-8, '&' only in a reference next_reference()
    /// accepts, and no "]]>". The position of the '<' that ends it, or null
    /// on a violation or when no '<' follows.
    const char* scan_text(const char* p, const char* e)
    {
      const char* const b = p;
      while (true)
      {
        p = skip_plain<kTextStop>(p, e);
        if (p == e) return nullptr;
        const char c = *p;
        if (c == '<') return p;
        if (c == '>')
        {
          if (p - b >= 2 && p[-1] == ']' && p[-2] == ']') return nullptr;
          ++p;
        }
        else if (c == '&' ? !skip_reference(p, e) : !skip_char(p, e)) return nullptr;
      }
    }

    /// XML characters in valid UTF-8 (a comment's body).
    bool xml_chars(std::string_view s)
    {
      const char* p = s.data();
      const char* const e = p + s.size();
      while (p < e)
      {
        const unsigned char c = static_cast<unsigned char>(*p);
        if ((c >= 0x20 && c < 0x80) || c == '\t' || c == '\n' || c == '\r') ++p;
        else if (!skip_char(p, e)) return false;
      }
      return true;
    }

    /// One tag starting at a '<', read and checked in one pass, as libxml2
    /// checks it: a name this decoder takes (ASCII, no namespace prefix:
    /// valid XML that mzML spectra do not use, declined); for an end tag only
    /// whitespace before its '>'; for a start or empty-element tag
    /// attributes with a name of that kind, '=' and a quoted value that is
    /// well-formed text (XML characters in valid UTF-8, no '<', '&' only in a
    /// reference next_reference() accepts), whitespace before every further
    /// attribute, and no name twice. Comments, CDATA, processing
    /// instructions and a tag that does not end are refused. Values are
    /// kept raw; the caller refuses any that would need entity or whitespace
    /// normalisation.
    struct Tag
    {
      struct Attr
      {
        const char* name;
        const char* value;
        std::uint32_t name_len;
        std::uint32_t value_len;
      };
      static constexpr std::size_t kMaxAttrs = 32; ///< more are declined

      std::string_view name;
      const char* end = nullptr; ///< past its '>'
      bool closing = false;
      bool self_closing = false;
      std::size_t n_attrs = 0;
      Attr attrs[kMaxAttrs]; // filled up to n_attrs; left uninitialised on purpose

      std::string_view attr_name(std::size_t i) const { return {attrs[i].name, attrs[i].name_len}; }
      std::string_view attr_value(std::size_t i) const { return {attrs[i].value, attrs[i].value_len}; }

      bool read(const char* lt, const char* e)
      {
        const char* p = lt + 1;
        n_attrs = 0;
        if (p < e && *p == '/') { closing = true; ++p; }
        else closing = false;
        self_closing = false;
        const char* const nb = p;
        if (p == e || !(cls(p) & kNameStart)) return false;
        ++p;
        while (p < e && (cls(p) & kName)) ++p;
        if (p == e) return false;
        name = std::string_view(nb, static_cast<std::size_t>(p - nb));
        if (closing)
        {
          while (p < e && (cls(p) & kSpace)) ++p;
          if (p == e || *p != '>') return false;
          end = p + 1;
          return true;
        }
        // After the name or a value: '>', "/>" or whitespace (then perhaps
        // another attribute); anything else is not well-formed.
        while (true)
        {
          if (*p == '>') { end = p + 1; return true; }
          if (*p == '/')
          {
            if (e - p < 2 || p[1] != '>') return false;
            self_closing = true;
            end = p + 2;
            return true;
          }
          if (!(cls(p) & kSpace)) return false;
          do ++p; while (p < e && (cls(p) & kSpace));
          if (p == e) return false;
          if (*p == '>' || *p == '/') continue;

          // name = "value" (or 'value')
          const char* const an = p;
          if (!(cls(p) & kNameStart)) return false;
          ++p;
          while (p < e && (cls(p) & kName)) ++p;
          const std::size_t an_len = static_cast<std::size_t>(p - an);
          while (p < e && (cls(p) & kSpace)) ++p;
          if (p == e || *p != '=') return false;
          ++p;
          while (p < e && (cls(p) & kSpace)) ++p;
          if (p == e || (*p != '"' && *p != '\'')) return false;
          const char q = *p++;
          const char* const vb = p;
          while (true)
          {
            p = skip_plain<kValueStop>(p, e);
            if (p == e) return false;
            const char c = *p;
            if (c == q) break;
            if (c == '"' || c == '\'') ++p; // the other quote
            else if (c == '<') return false;
            else if (c == '&' ? !skip_reference(p, e) : !skip_char(p, e)) return false;
          }
          const std::size_t vlen = static_cast<std::size_t>(p - vb);
          if (vlen > std::numeric_limits<std::uint32_t>::max()) return false;
          ++p; // the closing quote
          if (p == e) return false;
          // "a='1' a='2'" is a fatal error in libxml2.
          for (std::size_t i = 0; i < n_attrs; ++i)
            if (attrs[i].name_len == an_len && std::memcmp(attrs[i].name, an, an_len) == 0) return false;
          if (n_attrs == kMaxAttrs) return false;
          attrs[n_attrs++] = Attr{an, vb, static_cast<std::uint32_t>(an_len), static_cast<std::uint32_t>(vlen)};
        }
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
      std::string_view name;   ///< "name" of its m/z or intensity cvParam, or the MS:1000786 value
      int bits = 0;            ///< 32 or 64; 0: no float type given
      int numpress = 0;        ///< 0 none, else kLinear, kPic, kSlof
      bool zlib = false;
      bool has_binary = false;
      bool standard = false;   ///< carries the m/z or intensity term
      bool other = false;      ///< carries MS:1000786, a non-standard array named by its value
    };
    enum { kLinear = 1, kPic, kSlof };
    /// More arrays than this in one spectrum are declined.
    constexpr std::size_t kMaxArrays = 8;
    /// The most bytes MS-Numpress writes for @p n values: 8 for the fixed
    /// point, at most 4.5 per value (linear and pic), 2 per value (slof). A
    /// longer stream cannot decode to n values.
    constexpr std::size_t numpress_bound(std::size_t n) { return 5 * n + 24; }
  }

  /****************************************************************************/
  struct MzMLDirectDecoder::Impl
  {
    Buffer b64;
    Buffer packed;   ///< the MS-Numpress bytes of one array
    Buffer bytes[2]; ///< m/z and intensity values
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

    bool values_of(const Array& a, Buffer& out, std::size_t n, std::size_t& width);
  };

  /// The values of @p a into @p out, @p width bytes each (8 after
  /// MS-Numpress, which always decodes to doubles, as in OpenMS). True only
  /// when there are exactly @p n of them.
  bool MzMLDirectDecoder::Impl::values_of(const Array& a, Buffer& out, std::size_t n, std::size_t& width)
  {
    if (a.numpress == 0)
    {
      width = static_cast<std::size_t>(a.bits / 8);
      if (!bytes_of(a, out, n * width)) return false;
      // A zlib array whose bytes are not whole values makes OpenMS throw; an
      // array whose length differs from defaultArrayLength makes it warn.
      // Either way: OpenMS's path, with its messages.
      if (a.zlib && out.size % width != 0) return false;
      return out.size / width == n;
    }
    // MS-Numpress, as MSNumpressCoder::decodeNP: base64, zlib if given, then
    // OpenMS's own decoder on the bytes. OpenMS does not compare a Numpress
    // array with defaultArrayLength; only arrays of that length are taken
    // here, which is also what bounds the work on a damaged stream.
    width = 8;
    if (!bytes_of(a, packed, numpress_bound(n)) || packed.size > numpress_bound(n)) return false;
    MSNumpressCoder::NumpressConfig config;
    config.np_compression = a.numpress == kLinear ? MSNumpressCoder::LINEAR
                          : a.numpress == kPic ? MSNumpressCoder::PIC : MSNumpressCoder::SLOF;
    // ponytail: decodeNPRaw is the public entry (the ms::numpress functions are
    // not exported from libOpenMS); it wants a std::string and zero-fills 16
    // bytes of output per input byte. Both are locals: kept per thread at
    // their largest they cost more memory than OpenMS's whole path (measured).
    // Decode in place if this shows in a profile.
    const std::string np_in(reinterpret_cast<const char*>(packed.data.get()), packed.size);
    std::vector<double> np_out;
    try
    {
      MSNumpressCoder().decodeNPRaw(np_in, np_out, config);
    }
    catch (const Exception::BaseException&)
    {
      return false; // corrupt: OpenMS's path, with its message
    }
    if (np_out.size() != n) return false;
    out.size = 0;
    out.reserve(n * 8 + 8);
    if (n) std::memcpy(out.data.get(), np_out.data(), n * 8);
    out.size = n * 8;
    return true;
  }

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
    const char* const xb = xml.data();
    const char* const xe = xb + xml.size();
    Tag root;
    if (xml.size() < 10 || xml.compare(0, 9, "<spectrum") != 0 || !root.read(xb, xe) || root.closing ||
        root.self_closing || root.name != "spectrum")
      return false;
    std::string_view id, length_text;
    bool has_length = false;
    for (std::size_t i = 0; i < root.n_attrs; ++i)
    {
      const std::string_view n = root.attr_name(i);
      if (n == "id") id = root.attr_value(i);
      else if (n == "defaultArrayLength") { length_text = root.attr_value(i); has_length = true; }
    }
    if (!has_length || !literal(id)) return false;
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
    //
    // One forward pass: scan_text() checks the character data while it looks
    // for the next '<', and Tag::read() checks names, attributes and values
    // while it reads them (a table lookup per plain ASCII byte; references,
    // controls and non-ASCII bytes take the slow path). The base64 text is
    // not scanned here: decode_base64 refuses any byte outside its alphabet.
    enum class Region { meta, arrays, after };
    Region region = Region::meta;
    std::array<std::string_view, 32> stack{};
    std::size_t depth = 0;
    stack[depth++] = root.name;
    const char* p = root.end;
    std::array<Array, kMaxArrays> arrays;
    int n_arrays = 0;
    Array* cur = nullptr;
    const auto blank = [](const char* b, const char* e)
    {
      for (; b < e; ++b)
        if (!(cls(b) & kSpace)) return false;
      return true;
    };
    // The next '<' from q on (whitespace only before it), or null.
    const auto next_lt_blank = [&](const char* q) -> const char*
    {
      const char* lt = static_cast<const char*>(std::memchr(q, '<', static_cast<std::size_t>(xe - q)));
      return lt && blank(q, lt) ? lt : nullptr;
    };
    Tag t;
    while (depth > 0)
    {
      const char* const lt = region == Region::meta ? scan_text(p, xe) : next_lt_blank(p);
      if (!lt) return false; // bad text, or the root never ends

      if (xe - lt >= 4 && std::memcmp(lt, "<!--", 4) == 0)
      {
        // A comment, in the metadata only: XML characters, no "--" inside.
        const std::size_t at = static_cast<std::size_t>(lt - xb);
        const std::size_t ce = xml.find("--", at + 4);
        if (region != Region::meta || ce == std::string_view::npos || xml.compare(ce, 3, "-->") != 0) return false;
        if (!xml_chars(xml.substr(at + 4, ce - at - 4))) return false;
        p = xb + ce + 3;
        continue;
      }

      if (!t.read(lt, xe)) return false; // CDATA, PIs, DOCTYPE: declined
      p = t.end;
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
          if (cur || t.self_closing || n_arrays == static_cast<int>(kMaxArrays)) return false;
          cur = &arrays[static_cast<std::size_t>(n_arrays++)];
        }
      }
      else if (t.name == "cvParam")
      {
        if (!cur || t.closing) return false;
        std::string_view accession, name, unit, value;
        bool has_unit = false, has_value = false;
        for (std::size_t i = 0; i < t.n_attrs; ++i)
        {
          const std::string_view an = t.attr_name(i);
          if (an == "accession") accession = t.attr_value(i);
          else if (an == "name") name = t.attr_value(i);
          else if (an == "unitAccession") { unit = t.attr_value(i); has_unit = true; }
          else if (an == "value") { value = t.attr_value(i); has_value = true; }
        }
        // The unit is compared as text below; one written with a character
        // reference (UO&#58;0000269) is the same unit to libxml2.
        if (!literal(accession) || !literal(name) || (has_unit && !literal(unit))) return false;
        // A unit on anything but the m/z or intensity term becomes a meta
        // value in OpenMS; absorbance intensities do too.
        if (accession == "MS:1000514" || accession == "MS:1000515")
        {
          if (accession == "MS:1000515" && unit == "UO:0000269") return false;
          cur->name = name;
          cur->standard = true;
        }
        else if (has_unit && !unit.empty()) return false;
        else if (accession == "MS:1000523") cur->bits = 64;
        else if (accession == "MS:1000521") cur->bits = 32;
        // Compression, in the order given, as handleBinaryDataArrayCVParam
        // applies it: a Numpress term leaves zlib as it is, the combined
        // terms set both, "no compression" clears both.
        else if (accession == "MS:1000574") cur->zlib = true;
        else if (accession == "MS:1000576") { cur->zlib = false; cur->numpress = 0; }
        else if (accession == "MS:1002312") cur->numpress = kLinear;
        else if (accession == "MS:1002313") cur->numpress = kPic;
        else if (accession == "MS:1002314") cur->numpress = kSlof;
        else if (accession == "MS:1002746") { cur->numpress = kLinear; cur->zlib = true; }
        else if (accession == "MS:1002747") { cur->numpress = kPic; cur->zlib = true; }
        else if (accession == "MS:1002748") { cur->numpress = kSlof; cur->zlib = true; }
        else if (accession == "MS:1000786")
        {
          // A non-standard array, named by its value (pwiz: "Ion Mobility").
          if (!has_value || !literal(value)) return false;
          cur->name = value;
          cur->other = true;
        }
        else return false; // zstd, integer/string types, CV-named other arrays, unknown terms
        if (!t.self_closing)
        {
          // <cvParam ...></cvParam>: only whitespace may come before the end tag.
          const char* const e = next_lt_blank(p);
          Tag et;
          if (!e || !et.read(e, xe) || !et.closing || et.name != "cvParam") return false;
          p = et.end;
          --depth;
        }
      }
      else if (t.name == "binary")
      {
        if (!cur || t.closing || cur->has_binary) return false; // OpenMS concatenates repeats
        cur->has_binary = true;
        if (t.self_closing) continue;
        // The base64 text: decode_base64 refuses anything outside its
        // alphabet and whitespace, '&' and non-ASCII bytes included.
        const char* const e = static_cast<const char*>(std::memchr(p, '<', static_cast<std::size_t>(xe - p)));
        Tag et;
        if (!e || !et.read(e, xe) || !et.closing || et.name != "binary") return false;
        cur->base64 = std::string_view(p, static_cast<std::size_t>(e - p));
        p = et.end;
        --depth;
      }
      else
      {
        return false; // </spectrum> before </binaryDataArrayList>, userParam, referenceableParamGroupRef, ...
      }
    }
    if (region != Region::after) return false; // no arrays

    // Exactly one m/z and one intensity array; any further array must be a
    // non-standard one (MS:1000786). All float. An array with both kinds of
    // name term, or none, is OpenMS's.
    int mz_i = -1, int_i = -1;
    for (int i = 0; i < n_arrays; ++i)
    {
      const Array& a = arrays[static_cast<std::size_t>(i)];
      if (a.bits == 0 || a.standard == a.other) return false;
      const bool is_mz = a.name == "m/z array", is_int = a.name == "intensity array";
      if (a.other)
      {
        if (is_mz || is_int) return false;
      }
      else if (is_mz && mz_i < 0) mz_i = i;
      else if (is_int && int_i < 0) int_i = i;
      else return false;
    }
    if (mz_i < 0 || int_i < 0) return false;
    const Array& mz = arrays[static_cast<std::size_t>(mz_i)];
    const Array& in = arrays[static_cast<std::size_t>(int_i)];

    const std::size_t n = static_cast<std::size_t>(length);
    // The further arrays, in file order, as OpenMS's fillDataArrayFloat
    // builds them: named, every value cast to float. Before the peaks, so
    // their values can pass through the m/z buffer.
    std::vector<MSSpectrum::FloatDataArray> others;
    for (int i = 0; i < n_arrays; ++i)
    {
      const Array& a = arrays[static_cast<std::size_t>(i)];
      if (!a.other) continue;
      std::size_t w = 0;
      if (!impl_->values_of(a, impl_->bytes[0], n, w)) return false;
      MSSpectrum::FloatDataArray& fda = others.emplace_back();
      fda.setName(std::string(a.name));
      fda.resize(n);
      const unsigned char* const vp = impl_->bytes[0].data.get();
      for (std::size_t k = 0; k < n; ++k)
      {
        if (w == 8)
        {
          double d;
          std::memcpy(&d, vp + k * 8, 8);
          fda[k] = static_cast<float>(d);
        }
        else std::memcpy(&fda[k], vp + k * 4, 4);
      }
    }

    std::size_t mw = 0, iw = 0;
    if (!impl_->values_of(mz, impl_->bytes[0], n, mw) || !impl_->values_of(in, impl_->bytes[1], n, iw)) return false;
    const Buffer& mb = impl_->bytes[0];
    const Buffer& ib = impl_->bytes[1];

    // The peaks, converted as OpenMS's fillDataArray does: m/z to double,
    // intensity to float. The allocations come first: a bad_alloc in either
    // leaves the peaks of `spec` as they were.
    spec.reserve(spec.size() + n);
    spec.getFloatDataArrays().reserve(spec.getFloatDataArrays().size() + others.size());
    spec.setNativeID(std::string(id));
    for (auto& fda : others) spec.getFloatDataArrays().push_back(std::move(fda));
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
