// The two machine interfaces the desktop GUI reads (1.12 G1, GUI-DESIGN.md
// P2b and P4; approved in gui-opt/DECISIONS.md "Three new CLI capabilities"):
//
//   -probe_input <file>     the input's metadata as JSON lines: instrument,
//                           MS2 analyser, activation, spectrum counts, the
//                           centroid/profile verdict, the mzML index state
//                           and the #7 acquisition call. Reads metadata only.
//                           A FASTA alone gives its protein and decoy counts.
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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /// @brief The format of both streams; a reader refuses a higher one.
  inline constexpr int kFormat = 1;

  // ---- JSON ---------------------------------------------------------------

  /**
    @brief Encodes @p s as a JSON string literal.

    Quotes, backslash and control bytes are escaped; other bytes are copied as
    they are (FASTag's readers hand over text that is valid UTF-8 or sanitised).

    @param[in] s the text to encode
    @return the quoted, escaped JSON string
  */
  std::string jsonString(std::string_view s);
  /**
    @brief Appends @p v to @p buf as a JSON number in shortest round-trip form.

    Appends null when @p v is not finite, and 0 for both +0 and -0.

    @param[in,out] buf the buffer appended to
    @param[in] v the value
  */
  void appendJsonNumber(std::string& buf, double v);
  /**
    @brief Appends @p v to @p buf as a JSON number in shortest round-trip form (float precision).

    Appends null when @p v is not finite, and 0 for both +0 and -0.

    @param[in,out] buf the buffer appended to
    @param[in] v the value
  */
  void appendJsonNumber(std::string& buf, float v);

  /**
    @brief One JSON object, fields in insertion order.

    The first field is always "record". Every adder appends one field and returns
    the object for chaining.
  */
  class JsonObject
  {
  public:
    /**
      @brief Starts an object whose "record" field is @p record.
      @param[in] record the record name
    */
    explicit JsonObject(const char* record);
    /**
      @brief Adds a string field.
      @param[in] key the field name
      @param[in] v the value, JSON-escaped
      @return this object
    */
    JsonObject& str(const char* key, std::string_view v);
    /**
      @brief Adds a string field, or null when @p v is empty.
      @param[in] key the field name
      @param[in] v the value, JSON-escaped
      @return this object
    */
    JsonObject& strOrNull(const char* key, std::string_view v);
    /**
      @brief Adds a number field (null when not finite).
      @param[in] key the field name
      @param[in] v the value
      @return this object
    */
    JsonObject& num(const char* key, double v);
    /**
      @brief Adds an unsigned integer field.
      @param[in] key the field name
      @param[in] v the value
      @return this object
    */
    JsonObject& count(const char* key, std::size_t v);
    /**
      @brief Adds a signed integer field.
      @param[in] key the field name
      @param[in] v the value
      @return this object
    */
    JsonObject& integer(const char* key, long long v);
    /**
      @brief Adds a boolean field.
      @param[in] key the field name
      @param[in] v the value
      @return this object
    */
    JsonObject& boolean(const char* key, bool v);
    /**
      @brief Adds a null field.
      @param[in] key the field name
      @return this object
    */
    JsonObject& null(const char* key);
    /**
      @brief Adds a field whose value is @p json, inserted verbatim (not escaped).
      @param[in] key the field name
      @param[in] json an already serialised JSON value
      @return this object
    */
    JsonObject& raw(const char* key, std::string_view json);
    /**
      @brief The closed object and a newline.
      @return one JSON line
    */
    std::string line() const;

  private:
    void key_(const char* key);
    std::string buf_;
  };

  // ---- mzML header --------------------------------------------------------

  /**
    @brief What the mzML head (up to its spectrumList) says about the analysers.
  */
  struct MzmlHeader
  {
    /// Per instrumentConfiguration id: the name of its LAST analyser (highest
    /// order) that carries a mass-analyser-type cvParam, which is the one an
    /// MS2 is read out in; "" when the configuration names none.
    std::map<std::string, std::string> analyzer_of;
    std::string default_config;  ///< the run's defaultInstrumentConfigurationRef
  };
  /**
    @brief Parses the head of an mzML file.
    @param[in] xml the file's bytes up to <spectrumList>
    @return the analysers per instrument configuration and the default configuration
  */
  MzmlHeader parseMzmlHeader(std::string_view xml);
  /**
    @brief Reads and parses the head of the mzML file @p path, up to its spectrumList (at most 8 MB).
    @param[in] path the mzML file
    @return the parsed head; empty when the file cannot be opened
  */
  MzmlHeader readMzmlHeader(const std::string& path);
  /**
    @brief The instrumentConfigurationRef of the first <scan> in a spectrum's XML.
    @param[in] spectrum_xml the XML of one spectrum element
    @return the reference; "" when it has none
  */
  std::string scanConfigRef(std::string_view spectrum_xml);
  /**
    @brief Tells whether a CV accession names a mass analyser type.

    Covers MS:1000443 and those of its children that mzML files carry.

    @param[in] accession the CV accession, e.g. "MS:1000484"
    @return true for a mass analyser type
  */
  bool isAnalyzerAccession(std::string_view accession);

  /**
    @brief The name of an mzML index state.

    ok: a usable index; stale: an index that does not match the file;
    absent: no index; not_applicable: MGF and mzPeak (not returned here).

    @param[in] has_index_list whether the file has an index list
    @param[in] rebuilt whether the index had to be rebuilt
    @return "absent", "stale" or "ok"
  */
  const char* indexStateName(bool has_index_list, bool rebuilt);
  /**
    @brief Tells whether the last 4 KB of @p path hold an <indexListOffset>.
    @param[in] path the mzML file
    @return true when found; false also when the file cannot be opened
  */
  bool hasIndexListOffset(const std::string& path);

  // ---- -probe_input -------------------------------------------------------

  /**
    @brief The options of -probe_input.
  */
  struct ProbeOptions
  {
    std::size_t probe_spectra = 4000;  ///< -acquisition_probe_spectra
    int mzpeak_threads = 1;  ///< threads for the mzPeak reader
    Centroid::Mode pick_mode = Centroid::Mode::Legacy;  ///< -pick_profile
    std::string acquisition_check = "refuse";           ///< -acquisition_check
    std::string fasta;                                  ///< -fasta, optional
    std::vector<std::string> decoy_affixes;             ///< -shortlist_decoy_affix
    std::string version;                                ///< FASTag's version
  };

  /**
    @brief How the probe ended.
  */
  enum class Status
  {
    Ok,           ///< the stream is complete; exit 0
    Unsupported,  ///< neither mzML, mzPeak nor MGF, or compressed; exit ILLEGAL_PARAMETERS
    NotReadable,  ///< exit INPUT_FILE_NOT_READABLE
    Empty,        ///< an MGF without BEGIN IONS; exit INPUT_FILE_EMPTY
    Corrupt,      ///< the reader failed; exit INPUT_FILE_CORRUPT
  };

  /**
    @brief The result of probeInput().
  */
  struct ProbeOutput
  {
    Status status = Status::Ok;  ///< how the probe ended
    std::string error;  ///< for stderr, when status is not Ok
    std::string jsonl;  ///< the stream; complete (ends with the end record) only when Ok
  };

  /**
    @brief Tells whether @p path is a FASTA name -probe_input takes as a database alone.
    @param[in] path the file name (.fasta, .fa, .faa, .fas; any case)
    @return true for a FASTA name
  */
  bool isFastaPath(const std::string& path);
  /**
    @brief The fasta record of @p path.

    Holds proteins, decoys (by @p decoy_affixes, as -shortlist_decoy_affix
    counts them) and the commonest decoy affix; null counts and an error field
    when the file cannot be read as FASTA.

    @param[in] path the FASTA file
    @param[in] decoy_affixes the decoy prefixes/suffixes
    @return one JSON line
  */
  std::string fastaRecord(const std::string& path, const std::vector<std::string>& decoy_affixes);

  /**
    @brief Probes the input file @p in and returns its metadata stream.

    A FASTA (isFastaPath) gives the probe record (file_format "FASTA"), its
    fasta record and the end record, and reads no spectra. Never throws.

    @param[in] in the input file
    @param[in] opt the probe options
    @return the status, an error text and the JSON-lines stream
  */
  ProbeOutput probeInput(const std::string& in, const ProbeOptions& opt);

  // ---- -dump_spectrum ------------------------------------------------------

  /**
    @brief The options of -dump_spectrum.
  */
  struct DumpOptions
  {
    Centroid::Mode pick_mode = Centroid::Mode::Legacy;  ///< -pick_profile
    int mzpeak_threads = 1;  ///< threads for the mzPeak reader
    Param param;  ///< the run's tagging parameters (one seed length serves)
    /// -ion_series (1.12 #15): the dumped spectrum is prepared with the ion
    /// pair the tagging loop reads it as (IonSeries::seriesInRun), so under
    /// cz, or auto on an electron-activated mzML spectrum, with the c/z-dot
    /// pair and its ETD precursor-window filter.
    IonSeries::Mode ion_mode = IonSeries::Mode::By;
  };

  /**
    @brief The result of dumpSpectrum().
  */
  struct DumpOutput
  {
    Status status = Status::Ok;  ///< how the dump ended
    bool found = false;  ///< a spectrum with that native ID exists (status Ok)
    std::string error;  ///< for stderr, when status is not Ok
    std::string jsonl;  ///< the stream
  };

  /**
    @brief The tagged peaks of the spectrum of @p in whose native ID is @p id.

    Never throws. An unknown id gives status Ok with found = false and no
    stream; the caller reports it.

    @param[in] in the input file
    @param[in] id the native ID of the spectrum
    @param[in] opt the dump options
    @return the status, whether the spectrum was found, an error text and the JSON-lines stream
  */
  DumpOutput dumpSpectrum(const std::string& in, const std::string& id, const DumpOptions& opt);

  /**
    @brief The spectrum record of @p spec, read as the tagger reads it.

    Fields: native_id, index, ms_level, precursor, charge (as tagged),
    charge_given, tolerance, tolerance_unit, picked, deisotoped, tagged,
    n_read, n, mz, int. The precursor is the 1.11 rule (the header m/z, its
    charge or else 2), the only one a run tags while -unknown_charge and
    -isotope_error (1.12 #6) are at their defaults; the tool refuses
    -dump_spectrum otherwise. Pure; the unit test checks it against
    preparedPeaks().

    @param[in] spec the spectrum
    @param[in] index its input position
    @param[in] picked whether the reader centroided it
    @param[in] p the tagging parameters; carry the ion pair the spectrum is read as (dumpSpectrum() sets it)
    @return one JSON line
  */
  std::string spectrumRecord(const OpenMS::MSSpectrum& spec, std::size_t index, bool picked, const Param& p);
}
