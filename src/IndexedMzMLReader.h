// Random access over an indexed mzML that also fills spectrum METADATA.
//
// WHY THIS EXISTS: OpenMS's OnDiscMSExperiment gives random access, but its
// per-spectrum decoder (MzMLSpectrumDecoder::domParseSpectrum) fills the
// binary arrays and native id only -- MS level, retention time and precursors
// are dropped. FASTag needs all three, so OnDiscMSExperiment::openFile has to
// be told to load metadata, and that is a SERIAL Xerces parse of the entire
// file before any tagging starts: measured at 4.0 s of a 9.1 s run on a
// 1.8 GB file, single-threaded and immune to -threads.
//
// A patched OpenMS harvests those fields from the DOM domParseSpectrum
// already builds, which is why the pre-pass used to be skippable. The
// released binaries link bioconda's OpenMS, which carries no such patch, so
// since v1.1.0 every mzML run has paid the pre-pass.
//
// This reader removes it: the mzML index gives each spectrum's byte range,
// the bytes are handed to the same public domParseSpectrum for peaks, and the
// three missing fields are read from the same XML the decoder just parsed.
// Nothing is parsed twice and nothing is parsed up front.
//
// SCOPE: peaks, native id, MS level, retention time and precursors -- what
// tagging and -out_spectra consume. Run-level metadata (instrument, source
// files, software) is NOT read, so a run that needs it (-out_spectra) still
// goes through OnDiscMSExperiment.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace FASTag
{
  class IndexedMzMLReader
  {
  public:
    /// Reads the index. Never throws: check ok(), and fall back to
    /// OnDiscMSExperiment when it is false (no index, an index that does not
    /// point at spectra, an unreadable file).
    explicit IndexedMzMLReader(const std::string& path);
    /// A per-thread reader over the same file: shares the parsed index,
    /// opens its own handle and owns its own decoder. Safe to call
    /// concurrently; the copies must not be used from more than one thread.
    IndexedMzMLReader(const IndexedMzMLReader& other);
    IndexedMzMLReader& operator=(const IndexedMzMLReader&) = delete;
    ~IndexedMzMLReader();

    bool ok() const;
    OpenMS::Size getNrSpectra() const;

    /// Spectrum @p i with native id, MS level, retention time (in SECONDS, as
    /// OpenMS wants) and precursors.
    ///
    /// PEAKS ARE DECODED FOR MS2 ONLY. Decoding is the expensive half of a
    /// read (a DOM parse plus zlib per spectrum) and FASTag tags MS2, so an
    /// MS1 comes back with its metadata and no peaks -- the same bargain the
    /// mzPeak reader strikes. That makes this reader unsuitable for anything
    /// that needs MS1 signal, which is why -out_spectra does not use it.
    ///
    /// Returns an empty spectrum if the range cannot be read or the decoder
    /// rejects it.
    OpenMS::MSSpectrum getSpectrum(OpenMS::Size i);

    /// Does this file give up MS level and precursors to the scrape? Reads
    /// the first @p n spectra WITHOUT decoding peaks, so the caller can
    /// decide against this reader for the price of the metadata alone.
    bool reportsSpectrumMetadata(OpenMS::Size n = 64);

  private:
    OpenMS::MSSpectrum read_(OpenMS::Size i, bool want_peaks);

    struct Impl;
    std::unique_ptr<Impl> impl_;
  };
}
