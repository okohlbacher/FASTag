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
// STEP 0 (1.12) adds, as OpenMS's MzMLHandler (70cebcd144) fills them:
//  - referenceableParamGroups, read once at open from the run header and
//    applied, where they are referenced, to the step-0 fields below only;
//    an element's own cvParam wins;
//  - the spectrum type, MS:1000127 centroid / MS:1000128 profile (UNKNOWN
//    when neither is given);
//  - the possible charge states of a selected ion, MS:1000633;
//  - each precursor's activation: dissociation methods (MS:1002678/1002679
//    supplemental terms as EThcD/ETciD) and activation energy MS:1000509;
//  - the first scan's filter string, MS:1000512, as the meta value
//    "filter string";
//  - the isolation window target, as the precursor meta value "isolation
//    window target m/z" whenever the selected ion moved the precursor m/z
//    away from it (0 when the window has no target, as in OpenMS).
// Not read: collision energy and the other activation meta values, product
// lists. OpenMS keeps the FIRST selected ion of a precursor only; this reader
// keeps one Precursor per selected ion, as before.
//
// The fields 1.11 already read -- MS level, selected-ion m/z, charge and
// intensity, the isolation window target and offsets -- are still read from
// the element's OWN cvParams only, as in 1.11, NOT from param groups, which
// OpenMS does resolve for them. Tags are therefore unchanged on every input.
// Resolving those fields from groups would change tags on mzMLs that keep
// them in a group (1.11: an MS level only in a group makes the spectrum no
// MS2; a charge only in a group leaves it tagged as 2+); that is a separate,
// declared output-changing item. Of the step-0 fields only the possible
// charge states reach any output: the count in the "carry no precursor
// charge" log warning (as on the OnDiscMSExperiment path already). The
// spectrum type, activation, filter string and target meta value are read
// by no 1.11 consumer. indexed_mzml_test compares the step-0 fields against
// OpenMS and pins the 1.11 reading of the others.
//
// FIELD MASKS (1.12.2): parsing every step-0 field cost about 6 us per
// spectrum, +12% read time, in a tagging loop that reads only some of them.
// A read now fills the step-0 fields its caller names (Field) and no others;
// what it fills is the same as before. The tagging loop takes
// kTaggingFields, the acquisition probe kProbeFields, -ion_series auto's
// scan kActivationFields; every other caller (-probe_input, -dump_spectrum,
// the serial probes, the tests) all of them. The element searches are also
// bounded to the element they belong to, so a field that is absent no
// longer costs a scan of the rest of the head.
//
// SELECTED-ION M/Z 0, THE ONE DELIBERATE DIFFERENCE FROM MzMLFile: a
// selected-ion m/z (MS:1000744) of 0, below 0 or not finite is read as no
// selected-ion m/z, so the precursor takes the isolation window target as a
// missing MS:1000744 gives it (no target meta value then). OpenMS's
// MzMLHandler keeps the 0, with the target as the meta value. mzpeak-convert
// 0.18 (mzdata) writes 0 for every Bruker precursor without a monoisotopic
// m/z; read as 0, such a spectrum yields no tags. getSpectrum() counts these
// spectra (invalidSelectedMz()); useSelectedIonTarget() does the same for a
// spectrum OpenMS read, so every input path tags them alike.
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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
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

    /// The step-0 fields (see the file comment) a read fills, as a bit mask
    /// (1.12.2). Everything else -- peaks, native id, MS level, RT, scan
    /// windows, ion mobility, the 1.11 precursor fields -- is read always.
    /// A field left out is simply not set; every field that IS set is
    /// exactly what kAllFields gives. Callers pass only what they consume,
    /// so the per-spectrum parse costs what 1.11's did where nothing more
    /// is needed (the tagging loop, the acquisition probe).
    enum Field : unsigned
    {
      kStep0Type = 1u << 0,              ///< centroid / profile (MS:1000127/128)
      kStep0FilterString = 1u << 1,      ///< the "filter string" meta value
      kStep0Activation = 1u << 2,        ///< each precursor's dissociation methods
      kStep0ActivationEnergy = 1u << 3,  ///< each precursor's activation energy
      kStep0PossibleCharges = 1u << 4,   ///< possible charge states (MS:1000633)
      kStep0TargetMeta = 1u << 5,        ///< the "isolation window target m/z" meta value
      kAllFields = (1u << 6) - 1,
      /// What the tagging loop reads: the type (-pick_profile), activation
      /// and filter string (IonSeries::activationClass, -digest_out) and the
      /// possible charges (precursor hypotheses, the no-charge warning).
      kTaggingFields = kStep0Type | kStep0FilterString | kStep0Activation | kStep0PossibleCharges,
      /// What the acquisition probe reads (Acquisition::fromSpectrum).
      kProbeFields = kStep0TargetMeta,
      /// What -ion_series auto's activation scan reads.
      kActivationFields = kStep0FilterString | kStep0Activation,
    };

    /// Spectrum @p i with native id, MS level, retention time (in SECONDS, as
    /// OpenMS wants) and precursors; the step-0 fields in @p fields.
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
    OpenMS::MSSpectrum getSpectrum(OpenMS::Size i, unsigned fields = kAllFields);
    /// As getSpectrum() with every field, but with the peaks of a spectrum of
    /// any MS level (1.13 -check_header_charge reads the MS1 scan before an MS2).
    OpenMS::MSSpectrum getSpectrumAnyLevel(OpenMS::Size i);

    /// Spectrum @p i WITHOUT peaks: every metadata field getSpectrum() fills
    /// (native id, MS level, retention time, type, scan windows, ion
    /// mobility, filter string, precursors with their activation), read from
    /// the head of the element. Lenient: an unreadable spectrum comes back
    /// empty instead of throwing. For a probe over many spectra (the 1.12
    /// acquisition check) that must not pay for decoding.
    OpenMS::MSSpectrum getSpectrumMetadata(OpenMS::Size i, unsigned fields = kAllFields);
    /// Byte range [first, second) of spectrum @p i in the file, as the
    /// offsets in use give it; {0, 0} when there is no such spectrum. Read
    /// only, for callers that scrape what the reader does not keep (1.12
    /// -probe_input: a scan's instrumentConfigurationRef).
    std::pair<std::uint64_t, std::uint64_t> spectrumByteRange(OpenMS::Size i) const;

    /// MS2 peaks are decoded by MzMLDirectDecoder, and by OpenMS's
    /// domParseSpectrum for every spectrum it declines. On by default;
    /// FASTAG_OPENMS_DECODER=1 turns it off for every reader, this for one.
    void setDirectDecoding(bool on);
    /// MS2 spectra this reader decoded directly, and through OpenMS.
    std::size_t directDecoded() const;
    std::size_t openmsDecoded() const;
    /// Spectra read by getSpectrum() with a selected-ion m/z of 0, below 0
    /// or not finite (see the file comment), and those of them whose
    /// precursor took the isolation window target instead (the rest have
    /// none and yield no tags). Metadata and any-level reads are not counted.
    std::size_t invalidSelectedMz() const;
    std::size_t invalidSelectedMzFromTarget() const;
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
    OpenMS::MSSpectrum read_(OpenMS::Size i, bool want_peaks, unsigned fields, bool any_level = false);

    struct Impl;
    std::unique_ptr<Impl> impl_;
  };

  /// For a spectrum read by OpenMS (OnDiscMSExperiment, MzMLFile, MzPeakFile):
  /// does a precursor have an m/z of 0, below 0 or not finite while its
  /// "isolation window target m/z" meta value is positive? That is how
  /// OpenMS reads a selected-ion m/z of 0 next to an isolation target.
  bool needsSelectedIonTarget(const OpenMS::MSSpectrum& spec);
  /// Gives each such precursor the target as its m/z and drops the meta
  /// value, as IndexedMzMLReader reads the same precursor. True if any changed.
  bool useSelectedIonTarget(OpenMS::MSSpectrum& spec);
}
