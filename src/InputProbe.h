// The two machine interfaces the desktop GUI reads (1.12 G1, GUI-DESIGN.md
// P2b and P4; approved in gui-opt/DECISIONS.md "Three new CLI capabilities"):
//
//   -probe_input <file>     the input's metadata as JSON lines: instrument,
//                           MS2 analyser, activation, spectrum counts, the
//                           centroid/profile verdict, the mzML index state
//                           and the #7 acquisition call. Reads metadata only.
//   -dump_spectrum <id>     the peaks FASTag tags of one spectrum of -in (after
//                           the reader's centroiding, the precursor cut, the
//                           m/z collapse, deisotoping and the peak budget), as
//                           JSON lines.
//
// Both print to stdout only, write no file and exit without tagging. The
// GUI detects them through --helphelp and ignores records and fields it does
// not know; every record carries a "record" key, the first is the format
// record and the last {"record":"end"}, so a cut stream is detectable.
//
// The JSON writers here are pure; the readers are FASTag's own (mzML:
// IndexedMzMLReader, else OnDiscMSExperiment, else a full load; MGF:
// MgfReader; mzPeak: MzPeakFile), opened the way a run opens them.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "Acquisition.h"
#include "Centroid.h"
#include "FASTagger.h"

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstddef>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace FASTag::Probe
{
  /// The format of both streams; a reader refuses a higher one.
  inline constexpr int kFormat = 1;

  // ---- JSON ---------------------------------------------------------------

  /// @p s as a JSON string literal: quotes, backslash and control bytes
  /// escaped; other bytes as they are (FASTag's readers hand over text that
  /// is valid UTF-8 or sanitised).
  std::string jsonString(std::string_view s);
  /// Shortest round-trip form; null when not finite.
  void appendJsonNumber(std::string& buf, double v);
  void appendJsonNumber(std::string& buf, float v);

  /// One JSON object, fields in insertion order.
  class JsonObject
  {
  public:
    explicit JsonObject(const char* record);
    JsonObject& str(const char* key, std::string_view v);
    /// null when @p v is empty.
    JsonObject& strOrNull(const char* key, std::string_view v);
    JsonObject& num(const char* key, double v);
    JsonObject& count(const char* key, std::size_t v);
    JsonObject& integer(const char* key, long long v);
    JsonObject& boolean(const char* key, bool v);
    JsonObject& null(const char* key);
    JsonObject& raw(const char* key, std::string_view json);
    /// The object and a newline.
    std::string line() const;

  private:
    void key_(const char* key);
    std::string buf_;
  };

  // ---- mzML header --------------------------------------------------------

  /// What the mzML head (up to its spectrumList) says about the analysers.
  struct MzmlHeader
  {
    /// Per instrumentConfiguration id: the name of its LAST analyser (highest
    /// order) that carries a mass-analyser-type cvParam, which is the one an
    /// MS2 is read out in; "" when the configuration names none.
    std::map<std::string, std::string> analyzer_of;
    std::string default_config;  ///< the run's defaultInstrumentConfigurationRef
  };
  /// Parses the head of @p xml (the file's bytes up to <spectrumList>).
  MzmlHeader parseMzmlHeader(std::string_view xml);
  /// The head of mzML @p path, read up to its spectrumList (at most 8 MB).
  MzmlHeader readMzmlHeader(const std::string& path);
  /// The instrumentConfigurationRef of the first <scan> in a spectrum's XML;
  /// "" when it has none.
  std::string scanConfigRef(std::string_view spectrum_xml);
  /// True when the CV accession names a mass analyser type (MS:1000443 and
  /// its children that mzML files carry).
  bool isAnalyzerAccession(std::string_view accession);

  /// ok: a usable index; stale: an index that does not match the file;
  /// absent: no index; not_applicable: MGF and mzPeak.
  const char* indexStateName(bool has_index_list, bool rebuilt);
  /// True when the last 4 KB of @p path hold an <indexListOffset>.
  bool hasIndexListOffset(const std::string& path);

  // ---- -probe_input -------------------------------------------------------

  struct ProbeOptions
  {
    std::size_t probe_spectra = 4000;  ///< -acquisition_probe_spectra
    int mzpeak_threads = 1;
    Centroid::Mode pick_mode = Centroid::Mode::Legacy;  ///< -pick_profile
    bool pick_unknown_type = false;                     ///< -pick_unknown_type
    std::string acquisition_check = "refuse";           ///< -acquisition_check
    std::string fasta;                                  ///< -fasta, optional
    std::vector<std::string> decoy_affixes;             ///< -shortlist_decoy_affix
    std::string version;                                ///< FASTag's version
  };

  /// How the probe ended.
  enum class Status
  {
    Ok,           ///< the stream is complete; exit 0
    Unsupported,  ///< neither mzML, mzPeak nor MGF, or compressed; exit ILLEGAL_PARAMETERS
    NotReadable,  ///< exit INPUT_FILE_NOT_READABLE
    Empty,        ///< an MGF without BEGIN IONS; exit INPUT_FILE_EMPTY
    Corrupt,      ///< the reader failed; exit INPUT_FILE_CORRUPT
  };

  struct ProbeOutput
  {
    Status status = Status::Ok;
    std::string error;  ///< for stderr, when status is not Ok
    std::string jsonl;  ///< the stream; complete (ends with the end record) only when Ok
  };

  /// Probe @p in. Never throws.
  ProbeOutput probeInput(const std::string& in, const ProbeOptions& opt);

  // ---- -dump_spectrum ------------------------------------------------------

  struct DumpOptions
  {
    Centroid::Mode pick_mode = Centroid::Mode::Legacy;
    bool pick_unknown_type = false;
    int mzpeak_threads = 1;
    Param param;  ///< the run's tagging parameters (one seed length serves)
  };

  struct DumpOutput
  {
    Status status = Status::Ok;
    bool found = false;  ///< a spectrum with that native ID exists (status Ok)
    std::string error;
    std::string jsonl;
  };

  /// The tagged peaks of the spectrum of @p in whose native ID is @p id.
  /// Never throws. An unknown id gives status Ok with found = false and no
  /// stream; the caller reports it.
  DumpOutput dumpSpectrum(const std::string& in, const std::string& id, const DumpOptions& opt);

  /// The spectrum record of @p spec (read as the tagger reads it, @p picked
  /// telling whether the reader centroided it) at input position @p index:
  /// native_id, index, ms_level, precursor, charge (as tagged), charge_given,
  /// tolerance, tolerance_unit, picked, deisotoped, tagged, n_read, n, mz,
  /// int. Pure; the unit test checks it against preparedPeaks().
  std::string spectrumRecord(const OpenMS::MSSpectrum& spec, std::size_t index, bool picked, const Param& p);
}
