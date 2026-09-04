// Stream an mzPeak archive into an OpenMS consumer using the external
// mzpeak-openms library (github.com/okohlbacher/mzpeak-openms).
//
// WHY THIS EXISTS: OpenMS's own MzPeakFile implements the pre-0.7.0 mzPeak
// layout -- packed nested metadata, point-only signal, `data_kind: "data
// arrays"`. The format moved (spec rev e7f3447, reference impl 474a7c2,
// converter 0.7.0) to split-facet metadata with bare column names, a chunked
// signal layout with delta/Numpress encodings, and `data_kind: "data_arrays"`.
// Every archive written by the current converter therefore read back as ZERO
// spectra through OpenMS -- silently, exit code 0. Measured on a run that
// exists in both formats: the mzML gave 6,103 MS2 and 122,098 tags, the
// mzPeak twin gave 0 and 0.
//
// The external library reads BOTH layouts and is validated against the Rust
// reference implementation in both directions, so it replaces the reader
// rather than sitting beside it.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#ifdef FASTAG_HAVE_MZPEAK_LIB

#include <OpenMS/INTERFACES/IMSDataConsumer.h>

#include <string>

namespace FASTag
{
  /// Read @p path and push every spectrum to @p consumer, one at a time.
  ///
  /// Streaming is the contract: the library decodes peaks lazily per spectrum,
  /// so a run is traversed in memory proportional to one spectrum plus the
  /// consumer's own buffer -- not to the file. The consumer sees exactly what
  /// the mzML path gives it (m/z, intensity, MS level, retention time,
  /// precursors, native ID), so subsampling, chunking and progress reporting
  /// are unchanged.
  ///
  /// @throws OpenMS::Exception::ParseError with the library's message when the
  ///   archive cannot be read. A silent empty result is never acceptable here:
  ///   that is the exact failure this reader replaces.
  /// @param centroid_profile  centroid PROFILE spectra as they are read.
  ///   mzPeak archives converted from raw files routinely carry profile MS2
  ///   with an empty centroid entry, and tagging profile SAMPLES rather than
  ///   peaks costs real recall (measured on one run: 80,990 tags from the
  ///   profile mzPeak against 122,098 from the same run supplied as centroided
  ///   mzML). Picking on read closes that gap without a separate conversion
  ///   step. Off means the caller gets the archive's own representation.
  void streamMzPeak(const std::string& path,
                    OpenMS::Interfaces::IMSDataConsumer& consumer,
                    bool centroid_profile = true);
}

#endif  // FASTAG_HAVE_MZPEAK_LIB
