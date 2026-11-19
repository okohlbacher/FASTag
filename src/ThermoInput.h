// Thermo .raw input.
//
// WHY THIS EXISTS: FASTag reads mzML, mzPeak and MGF by itself. A Thermo run
// is read through OpenMS's OnDiscThermoRawExperiment (the openms-thermo-bridge
// around Thermo's RawFileReader, on a .NET 8 runtime), which exists only in an
// OpenMS built with WITH_THERMO_RAW=ON. This file keeps that dependency in one
// place, with what FASTag needs around it:
//
//   - open(): random access to the run without loading it, as the indexed
//     mzML path has: the scan headers are indexed once, then any spectrum is
//     decoded on request. Every tagging thread gets its own clone() (one file
//     handle each; the index is shared), as with OnDiscMSExperiment.
//   - Representation: tagging reads VENDOR-CENTROIDED spectra (Thermo's own
//     peak picking, as ThermoRawFileParser and FileHandler apply it). The
//     reader's default keeps profile scans as acquired, so open() always sets
//     the representation explicitly. PROFILE is kept for measurements that
//     need peak shapes (the run QC's resolution); FASTag does not tag it.
//   - massResolvingPower(): the resolving power the instrument states per scan
//     (trailer "Orbitrap Resolution:", else "FT Resolution:"), which OpenMS
//     keeps as the meta value "mass resolving power" (mzML MS:1000800). Read
//     from the metadata alone, no peaks decoded.
//
// Native IDs are Thermo's "controllerType=0 controllerNumber=1 scan=N", as in
// ThermoRawFileParser's and msconvert's mzML, so USIs (scan=N) and -census_ids
// joins are the same for a run read as .raw or as its mzML conversion.
//
// Licence: Thermo's RawFileReader is not MIT. Its distribution licence (shipped
// as share/OpenMS/LICENSES/ThermoRawFileReader-License.doc of the OpenMS
// install) asks, among other things, for copyrightNotice() in the software's
// About text; FASTag prints it with the version and in --help when the build
// reads .raw (BOM.md, "Thermo RawFileReader").
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/IMSExperimentRandomAccess.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <memory>
#include <optional>
#include <string>

namespace FASTag::Thermo
{
  /**
    @brief Whether this build reads Thermo .raw files (OpenMS with WITH_THERMO_RAW).

    The .NET 8 runtime and the bridge's managed files are looked for only when a
    file is opened; see open().
  */
  bool supported();

  /**
    @brief Whether @p path names a Thermo raw file: a name ending in ".raw" (any case).

    Names only; nothing is opened.
  */
  bool isThermoPath(const std::string& path);

  /**
    @brief The text RawFileReader's distribution licence (section 3.2) requires in
    the About text of software that includes it, verbatim.
  */
  const char* copyrightNotice();

  /// Which peaks open() returns.
  enum class Representation
  {
    CENTROID,  ///< Thermo's peak picking (as ThermoRawFileParser's default and FileHandler); for tagging
    PROFILE    ///< scans as acquired (profile where the instrument wrote profile); for peak-shape measurements
  };

  /**
    @brief Opens @p path for random access: the scan headers are indexed, no peaks
    are read. All MS levels are indexed (spectrum i of the run is scan header i
    in acquisition order); chromatograms, the instrument method text, the trailer
    copy and the file checksum are not read.

    The returned reader is not thread-safe: give each thread its own clone().

    @throws OpenMS::Exception::BaseException when the file cannot be opened
    (FileNotFound, ParseError: e.g. no .NET 8 runtime, or not a raw file), and
    OpenMS::Exception::NotImplemented when the build has no Thermo support.
  */
  std::unique_ptr<OpenMS::IMSExperimentRandomAccess> open(const std::string& path,
                                                          Representation rep = Representation::CENTROID);

  /**
    @brief The resolving power the instrument states for this scan ("mass resolving
    power", MS:1000800), or nothing when the scan has none (ion-trap scans, or
    input whose reader does not keep it).
  */
  std::optional<long long> massResolvingPower(const OpenMS::MSSpectrum& spectrum);

  /**
    @brief As above, for spectrum @p index of @p reader, from its metadata only
    (the scan header is read, no peaks are decoded).
  */
  std::optional<long long> massResolvingPower(OpenMS::IMSExperimentRandomAccess& reader, OpenMS::Size index);

  /**
    @brief Spectrum @p index of @p reader with the metadata the acquisition and
    activation probes read, without peaks; levels other than 2 come back with
    the MS level only (no scan header is read for them).
  */
  OpenMS::MSSpectrum ms2Metadata(OpenMS::IMSExperimentRandomAccess& reader, OpenMS::Size index);

  /**
    @brief A one-line hint for a failed open(): the .NET runtime and managed-file
    environment variables to check. Empty when the error does not look like one.
  */
  std::string runtimeHint(const std::string& error);

  /**
    @brief Points DOTNET_ROOT at the .NET runtime shipped beside the executable
    (<executable dir>/dotnet, as the release bundles carry it), unless
    DOTNET_ROOT is set already or there is no such directory. Call once, first
    thing in main(): OpenMS's Thermo bridge reads DOTNET_ROOT when it starts
    the runtime. On Linux it also sets DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
    (unless set) when it uses the bundled runtime, so the bundle needs no libicu.
    A no-op in a build without Thermo support.
  */
  void useBundledRuntime();
}
