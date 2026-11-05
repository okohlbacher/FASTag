// Random access over an indexed mzML that also fills spectrum METADATA.
//
// WHY THIS EXISTS: OpenMS's OnDiscMSExperiment gives random access, but its
// per-spectrum decoder (MzMLSpectrumDecoder::domParseSpectrum) fills the
// binary arrays and native id only -- MS level, retention time and precursors
// are dropped. FASTag needs all three, so OnDiscMSExperiment::openFile has to
// be told to load metadata, and that is a SERIAL Xerces parse of the entire
// file before any tagging starts: 4.0 s of a 9.1 s run on a 1.8 GB file,
// single-threaded and immune to -threads.
//
// This reader removes it: the mzML index gives each spectrum's byte range,
// the bytes are handed to the same public domParseSpectrum for peaks, and the
// three missing fields are read from the same XML the decoder just parsed.
// Nothing is parsed twice and nothing is parsed up front.
//
// SCOPE: peaks, native id, MS level, retention time and precursors -- what
// tagging and -out_spectra consume -- plus the scan windows and a scan-level
// ion mobility (1/K0, drift time or FAIMS CV), which -digest_out reads. Run-level metadata (instrument, source
// files, software) is NOT read, so a run that needs it (-out_spectra) still
// goes through OnDiscMSExperiment.
//
// NO INDEX, OR A STALE ONE: the spectrum offsets are rebuilt by scanning the
// file for <spectrum> start tags, in parallel, and the file is then read the
// same way. A stale index is the common case, not an exotic one: any tool
// that patches an mzML in place (adding precursor values, say) without
// rewriting its index leaves every offset after the first edit pointing
// into the wrong bytes. Refusing such a file would cost a serial full load
// instead, which is much slower on a large run than the parallel rescan.
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
    /// Reads the index, or rebuilds the offsets by scanning the file when it
    /// has no index or one that does not point at its spectra (see
    /// indexRebuilt()). Never throws: check ok(), and fall back to
    /// OnDiscMSExperiment when it is false (an unreadable file, or one with
    /// no spectrumList).
    explicit IndexedMzMLReader(const std::string& path);
    /// A per-thread reader over the same file: shares the parsed index,
    /// opens its own handle and owns its own decoder. Safe to call
    /// concurrently; the copies must not be used from more than one thread.
    IndexedMzMLReader(const IndexedMzMLReader& other);
    IndexedMzMLReader& operator=(const IndexedMzMLReader&) = delete;
    ~IndexedMzMLReader();

    bool ok() const;
    OpenMS::Size getNrSpectra() const;
    /// True when the file's own index was missing or stale and the offsets
    /// came from scanning the file instead.
    bool indexRebuilt() const;

    /// The byte offset of every <spectrum> element inside the spectrumList,
    /// ascending, followed by the offset of </spectrumList> as the end of the
    /// last one; empty when the file has no complete spectrumList. Found by
    /// scanning the bytes, not by trusting an index: pieces of @p chunk_bytes
    /// are searched in parallel (up to 16 threads, within
    /// omp_get_max_threads()), each reading a few bytes past its end so a tag
    /// split across two pieces is found by the piece it starts in.
    /// @p chunk_bytes changes only how the work is split, never the result;
    /// it is a parameter so the test can prove that.
    ///
    /// Known limit: a <spectrum tag inside an XML comment within the
    /// spectrumList would be taken for a spectrum. No mzML writer emits one;
    /// skip comments here if one ever does.
    static std::vector<std::uint64_t> scanSpectrumOffsets(const std::string& path,
                                                          std::size_t chunk_bytes = std::size_t{4} << 20);

    /// Spectrum @p i with native id, MS level, retention time (in SECONDS, as
    /// OpenMS wants) and precursors.
    ///
    /// PEAKS ARE DECODED FOR MS2 ONLY. Decoding is the expensive half of a
    /// read (a DOM parse plus zlib per spectrum) and FASTag tags MS2, so an
    /// MS1 comes back with its metadata and no peaks -- the same bargain the
    /// mzPeak reader strikes. That makes this reader unsuitable for anything
    /// that needs MS1 signal, which is why -out_spectra does not use it.
    ///
    /// @throws OpenMS::Exception::ParseError if the range cannot be read or
    ///   the decoder rejects an MS2 spectrum (OpenMS's reader fails the same
    ///   file; a silent empty spectrum would drop its tags).
    OpenMS::MSSpectrum getSpectrum(OpenMS::Size i);

    /// MS2 peaks are decoded by MzMLDirectDecoder, and by OpenMS's
    /// domParseSpectrum for every spectrum it declines. On by default;
    /// FASTAG_OPENMS_DECODER=1 turns it off for every reader, this for one.
    void setDirectDecoding(bool on);
    /// MS2 spectra this reader decoded directly, and through OpenMS.
    std::size_t directDecoded() const;
    std::size_t openmsDecoded() const;
    /// Declined this many times in a row from the start, a reader stops
    /// trying the direct decoder.
    static constexpr std::size_t kDirectProbe = 64;

    /// Does this file give up MS level and precursors to the scrape? Reads
    /// metadata WITHOUT decoding peaks, up to the first MS2 (at most
    /// kMetadataProbe spectra): true if that MS2 has a precursor, or if no
    /// MS2 comes within the cap but MS levels were read.
    bool reportsSpectrumMetadata();
    static constexpr OpenMS::Size kMetadataProbe = 5000;

  private:
    OpenMS::MSSpectrum read_(OpenMS::Size i, bool want_peaks);

    struct Impl;
    std::unique_ptr<Impl> impl_;
  };
}
