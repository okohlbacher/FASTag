// The peaks and native id of one mzML <spectrum> element, decoded without
// building an XML tree.
//
// WHY THIS EXISTS: OpenMS's MzMLSpectrumDecoder::domParseSpectrum builds a
// libxml2 document per spectrum (hundreds of node and string allocations),
// copies each base64 text into a new string, and inflates every zlib array
// through a fresh inflate state (a 32 KB window allocated and freed per
// array). That is most of FASTag's read cost, and on Windows the allocations
// also contend between threads. This decoder reads the same bytes with a
// small scanner and keeps its base64, inflate and output buffers between
// calls, so a reader that decodes many spectra allocates nothing large after
// the first ones (the returned spectrum's peak vector aside).
//
// SCOPE: exactly what domParseSpectrum fills for the spectra FASTag reads:
// the <spectrum> id and the peaks of one "m/z array" and one "intensity
// array", 32- or 64-bit float, uncompressed or zlib. decode() returns false,
// and leaves the spectrum's peaks untouched, for ANYTHING else -- numpress,
// zstd, integer or string arrays, extra arrays (ion mobility, ...), unknown
// or unit-carrying cvParams, userParams or other elements among the arrays,
// param group refs, CDATA, entities in the values it uses, malformed base64,
// a broken zlib stream, a decoded length that differs from
// defaultArrayLength, or a failed allocation -- and the caller uses
// domParseSpectrum, which then also prints or throws whatever OpenMS prints
// or throws for that input.
//
// WELL-FORMEDNESS: OpenMS parses the element with libxml2 in non-recovering
// mode and throws on any fatal error before the root ends, so the run fails.
// To fail the same way, decode() checks the WHOLE element, the metadata it
// does not use included, and declines (so OpenMS throws) on: start and end
// tags that do not match, attributes without whitespace between them or
// given twice, '<' or an unknown entity or character reference in text or
// values, "]]>" in text, invalid UTF-8 or characters XML does not allow, and
// a binaryDataArrayList that is not closed before </spectrum>. Valid XML it
// does not handle (comments among the arrays, namespace prefixes, processing
// instructions) is declined too, and OpenMS reads it as before.
//
// The accepted subset is the one where both paths give the same spectrum
// bit for bit; indexed_mzml_test checks that spectrum by spectrum, malformed
// spectra and an inflated defaultArrayLength included.
//
// MEMORY: defaultArrayLength is the file's claim and sizes nothing up
// front: the first inflate buffer follows the compressed size and grows by
// doubling, and inflating stops (declined) once the output passes the
// claimed length.
//
// One instance per thread: the buffers are reused, not shared.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstddef>
#include <memory>
#include <string_view>

namespace FASTag
{
  class MzMLDirectDecoder
  {
  public:
    MzMLDirectDecoder();
    ~MzMLDirectDecoder();
    MzMLDirectDecoder(const MzMLDirectDecoder&) = delete;
    MzMLDirectDecoder& operator=(const MzMLDirectDecoder&) = delete;

    /// Appends the peaks of the <spectrum> element at the start of @p xml to
    /// @p spec and sets its native id, as domParseSpectrum does; bytes after
    /// the element's end tag are ignored. False when the element is outside
    /// the supported subset (see above): @p spec is then unchanged.
    bool decode(std::string_view xml, OpenMS::MSSpectrum& spec);

    /// True when FASTAG_OPENMS_DECODER is set (to anything but "0"): every
    /// spectrum then goes through OpenMS, for comparison runs.
    static bool disabledByEnvironment();

  private:
    bool decode_(std::string_view xml, OpenMS::MSSpectrum& spec);
    struct Impl;
    std::unique_ptr<Impl> impl_;
  };
}
