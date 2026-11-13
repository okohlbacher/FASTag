// Random access over a Mascot Generic Format (MGF) peak list.
//
// WHY THIS EXISTS: OpenMS's MascotGenericFile reads MGF, but only whole:
// load() parses every block serially into one MSExperiment, so memory grows
// with the file and tagging cannot start until the parse ends. Its per-block
// parser is protected and bound to std::ifstream. It also fails the whole load
// on the CHARGE forms msconvert writes (`2+ and 3+`) and on the negative form
// its own writer emits (`-3-`).
//
// This reader is shaped like IndexedMzMLReader instead. One parallel pass over
// the bytes records where every BEGIN IONS ... END IONS block begins and ends
// (16 bytes per spectrum; the pass itself holds about twice that while it
// runs) and checks the file's block structure before any output is opened.
// That check covers the markers only: a block's content is parsed, and can
// fail, when a worker reads it. Each worker then owns a copy with its own
// stream, reads exactly one block's bytes into a reused buffer and parses
// that. Memory is O(threads) plus the offsets.
//
// THE PARSER is FASTag's own, about 150 lines. Numbers go through the same
// OpenMS functions MascotGenericFile uses (StringUtilsHelper::extractDouble /
// extractInt share parseFloat / from_chars with StringUtils::toDouble), so
// peaks and precursors are bit-identical to OpenMS's; mgf_reader_test holds the
// two to that on every block of the fixture. It differs from OpenMS on purpose
// in these cases:
//   - CHARGE: several values (`2+ and 3+`, `2+,3+`) give charge 0 with the
//     values kept as possible charge states, and a negative form (`3-`, `-3`,
//     `-3-`) gives its magnitude with negative polarity. OpenMS throws on both.
//   - RTINSECONDS: a range `a-b` gives its midpoint. OpenMS throws.
//   - MSLEVEL: a strict integer >= 1, else a ParseError. OpenMS reads `2abc` as
//     2 and falls back to 2 on garbage.
//   - TITLE: kept raw (after the first '=', trimmed, control bytes and invalid
//     UTF-8 replaced by '?'), never parsed for a retention time, no `_index=`
//     suffix.
//   - Comment lines (#, ;, !, /) are ignored anywhere in a block. OpenMS
//     ignores them before the first peak line and fails on them after it.
//   - A second BEGIN IONS inside a block is an error (OpenMS skips it).
//   - A leading UTF-8 byte-order mark is skipped (OpenMS loses block 0).
//   - A line that looks like a peak but does not start with a digit (`-100 5`,
//     `.5 5`, `nan 5`) is an error anywhere in a block. OpenMS skips it
//     before the first peak line and fails on it after.
//   - SCANS is sanitised like TITLE; a non-finite RTINSECONDS leaves the RT
//     unset (counted).
//   - Text outside the blocks is ignored, as in OpenMS, but an END IONS
//     there and text that looks like a spectrum are counted, so a lost
//     BEGIN IONS line does not drop a spectrum silently.
// Switch to OpenMS's parser if it becomes public and handles these.
//
// SCOPE: peaks, precursor m/z, intensity and charge, retention time, MS level,
// TITLE and SCANS. MGF carries no instrument, scan window, native-ID format
// or ion mobility, and this reader invents none. Compressed MGF is not read
// (a compressed stream cannot be seeked); the caller refuses it.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/ExperimentalSettings.h>

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace FASTag
{
  /**
    @brief Random access over a Mascot Generic Format (MGF) peak list.

    One parallel pass records where every BEGIN IONS ... END IONS block
    begins and ends; each per-thread copy then reads and parses one block at
    a time (see the file comment for how the parser differs from OpenMS's).
  */
  class MgfReader
  {
  public:
    /// @brief No block may be larger than this: a block's bytes are read whole.
    static constexpr std::uint64_t kMaxBlockBytes = std::uint64_t{256} << 20;
    /// @brief At most this much of the text before the first block is looked at.
    static constexpr std::size_t kHeaderScan = std::size_t{64} << 10;
    /// @brief TITLEs in error messages are cut to this many bytes.
    static constexpr std::size_t kTitleInMessages = 120;

    /**
      @brief Where the blocks are.

      Block k is the bytes [begin[k], end[k]), from the start of its BEGIN
      IONS line to just past its END IONS line.
    */
    struct Blocks
    {
      std::vector<std::uint64_t> begin, end;  ///< byte ranges of the blocks
      std::uint64_t data_start = 0; ///< 3 after a UTF-8 byte-order mark, else 0
      /// END IONS lines outside any block (each means a lost BEGIN IONS line),
      /// and the byte just past the first one's line.
      std::size_t stray_ends = 0;
      std::uint64_t first_stray_end = 0;  ///< the byte just past the first stray END IONS line
      /// Stretches of text outside the blocks (the header, a gap between two
      /// blocks, the trailer) holding a line that looks like spectrum content:
      /// a peak line (starting with a digit) or PEPMASS=, TITLE=, RTINSECONDS=
      /// or SCANS=. Only the first kHeaderScan bytes of each are looked at.
      std::size_t loose_regions = 0;
      std::uint64_t first_loose = 0; ///< where the first such line starts
    };

    /**
      @brief Finds every block of the MGF file @p path.

      Pieces of @p chunk_bytes are searched in parallel (up to 16 threads,
      within omp_get_max_threads()); @p chunk_bytes changes only how the work
      is split, never the result. A marker is a line whose content, trimmed
      of spaces, tabs and CRs, is exactly `BEGIN IONS` or `END IONS`; a stray
      END IONS between blocks is ignored, as in OpenMS, and counted, as is
      text between blocks that looks like a spectrum.

      @param[in] path the MGF file
      @param[in] chunk_bytes size of the pieces searched in parallel
      @param[in] max_block the largest block allowed (bytes)
      @return the block offsets and the counts of text outside the blocks
      @throw OpenMS::Exception::ParseError naming the LOWEST bad block, for a
        block with no END IONS before the next BEGIN IONS or the end of the
        file, or one larger than @p max_block bytes
      @throw OpenMS::Exception::FileEmpty when the file has no block at all
      @throw OpenMS::Exception::FileNotReadable when it cannot be read
    */
    static Blocks scanBlocks(const std::string& path, std::size_t chunk_bytes = std::size_t{4} << 20,
                             std::uint64_t max_block = kMaxBlockBytes);

    /**
      @brief What parsing came across, per reader copy (summed by the caller).
    */
    struct Counts
    {
      std::size_t no_pepmass = 0;       ///< blocks without a usable (finite, > 0) PEPMASS
      std::size_t titles_sanitised = 0; ///< TITLEs with control bytes or invalid UTF-8 replaced
      std::size_t scans_sanitised = 0;  ///< SCANS values with them replaced
      std::size_t rt_not_finite = 0;    ///< blocks whose RTINSECONDS is nan or inf (RT left unset)
      std::size_t no_charge_key = 0;    ///< blocks without a CHARGE line of their own
    };

    /**
      @brief Parses one block into @p spec, which is reset first.

      The spectrum gets OpenMS's MGF defaults: MS level 2, exactly one
      precursor (at m/z 0 when PEPMASS is missing or not finite, so it is
      counted as MS2 and yields no tags), centroid, native ID `index=<index>`.
      Peaks stay in file order, as OpenMS keeps them.

      @param[in] block the block's bytes, from its BEGIN IONS line to past its END IONS line
      @param[in] index the block's index (native ID and messages)
      @param[in] offset the byte where the block starts in @p source (messages only)
      @param[in] source the file name (messages only)
      @param[out] spec the parsed spectrum
      @param[in,out] counts incremented by what parsing came across
      @throw OpenMS::Exception::ParseError for a non-numeric peak, PEPMASS,
        CHARGE, RTINSECONDS or MSLEVEL, a peak line with one value or not
        starting with a digit, a key after the peaks, or a second BEGIN IONS
    */
    static void parseBlock(std::string_view block, OpenMS::Size index, std::uint64_t offset,
                           const std::string& source, OpenMS::MSSpectrum& spec, Counts& counts);

    /**
      @brief Scans @p path (scanBlocks) and reads the text before the first block.
      @param[in] path the MGF file
      @param[in] chunk_bytes size of the pieces searched in parallel
      @param[in] max_block the largest block allowed (bytes)
      @throw OpenMS::Exception::ParseError as scanBlocks
      @throw OpenMS::Exception::FileEmpty as scanBlocks
      @throw OpenMS::Exception::FileNotReadable as scanBlocks, or when the file cannot be opened
    */
    explicit MgfReader(const std::string& path, std::size_t chunk_bytes = std::size_t{4} << 20,
                       std::uint64_t max_block = kMaxBlockBytes);
    /**
      @brief A per-thread reader over the same file.

      Shares the offsets, opens its own handle and starts its own counts. The
      copies must not be used from more than one thread.

      @param[in] other the reader to copy
      @throw OpenMS::Exception::FileNotReadable when the file cannot be opened again
    */
    MgfReader(const MgfReader& other);
    MgfReader& operator=(const MgfReader&) = delete;
    /// @brief Closes the file handle.
    ~MgfReader();

    /// @brief The number of blocks (spectra).
    /// @return the number of spectra
    OpenMS::Size getNrSpectra() const;
    /**
      @brief Block @p i as a spectrum (parseBlock).
      @param[in] i the block index
      @return the spectrum; an empty one when @p i is out of range
      @throw OpenMS::Exception::ParseError as parseBlock, or when the bytes
        cannot be read
    */
    OpenMS::MSSpectrum getSpectrum(OpenMS::Size i);

    /**
      @brief The run-level settings an MGF supports.

      One SourceFile naming the input, OpenMS's MGF file type (written to
      mzML as "Mascot MGF format"), native-ID type MS:1000774. Nothing else.

      @return the settings
    */
    const OpenMS::ExperimentalSettings& settings() const;
    /// @brief What this reader copy's parsing came across so far.
    /// @return the counts
    const Counts& counts() const;
    /// @brief Where the blocks are.
    /// @return the block offsets
    const Blocks& blocks() const;

    /// @brief Whether the file starts with a UTF-8 byte-order mark (skipped).
    /// @return true when it does
    bool hasBom() const;
    /**
      @brief Whether the text before the first block has a file-level CHARGE= line.

      Mascot applies it to blocks without one and this reader (like OpenMS)
      does not. Only the first kHeaderScan bytes are looked at.

      @return true when there is one
    */
    bool headerCharge() const;
    /// @brief Bytes between the start of the file (after a BOM) and the first block.
    /// @return the number of bytes
    std::uint64_t headerBytes() const;
    /// @brief The read buffer's current capacity (for the test that it is released
    /// after a large block).
    /// @return the capacity in bytes
    std::size_t bufferCapacity() const;

  private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
  };
}
