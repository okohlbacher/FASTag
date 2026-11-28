// Taxonomic k-mer index for tag-driven species detection.
//
// Maps each amino-acid k-mer (I/L folded) occurring in a curated reference
// protein set to the SET of taxa whose proteins contain it. Taxon sets are
// kept, not collapsed to a per-k-mer LCA: collapsing at index time is
// irreversible and one misannotated protein would drag a k-mer to the root,
// where keeping the set lets outliers be down-weighted at report time.
//
// ON-DISK FORMAT AND MEMORY
//
// The index (v2) is a flat, packed, memory-MAPPED image:
//   * k-mers are packed base-19 (the folded alphabet has exactly 19 letters),
//     so k=7 needs 30 bits -> 4 bytes, against 7 bytes of characters.
//   * postings store an INDEX into the taxon table, not a taxid: 50 taxa need
//     one byte instead of four.
//   * nothing is parsed at load. The file is mapped and the arrays are used in
//     place, so resident memory is file-backed and EVICTABLE under pressure
//     rather than anonymous heap the OS cannot reclaim. (A hash map of strings
//     costs ~90 bytes per k-mer in RAM: ~10 GB resident for 50 taxa.)
//
// v1 files (a serialized hash map) still load via the in-memory path, which
// build() also fills; save() always writes v2.
//
// PACKED FORM ("FTZ1", tax_k7.ftz; savePacked())
//
// The v2 image compresses badly as it is (zstd -19: 1138 -> 366 MB; the
// release tarball's gzip: 450 MB): its sorted keys and its offsets are
// arithmetic progressions, which LZ matching does not see. The packed form
// stores the key DELTAS and the set SIZES instead, escape-coded to one byte
// each (a delta or size >= 255 is 0xFF and the full value), and the postings
// as they are, each section one zstd frame with a content checksum: 219 MB
// at level 12 (207 MB at 19). load() decodes it back into the EXACT v2 image
// (whose sha256 is in the header), so every lookup, count and report is the
// same as from the .taxdb. The first load writes that image ONCE into a
// per-user cache folder (packedCacheDir()) and maps it; later loads map the
// cached file, as cheap as a .taxdb. Without a writable cache folder it is
// decoded into anonymous memory on every load (see loadPacked_ in the .cpp).
//
// ACCEPTED LIMITATIONS (deliberate):
//   * Little-endian, 64-bit hosts only. macOS/Windows/Linux on x86-64/arm64 are
//     all LE; a big-endian reader would see byte-swapped numeric fields, and a
//     32-bit host cannot map a >4 GB index. Both are non-targets.
//   * load() bounds-checks every section against the file length and validates
//     the offset array, so a truncated or partial download is rejected, not
//     crashed on. It does NOT fully validate SEMANTICS (keys sorted, taxon
//     indices in range) -- a corrupt-but-in-bounds file yields wrong results,
//     not a fault. The index is a trusted, checksummed release asset.
//   * Reading uint32/uint64 arrays straight from the mapping is technically
//     object-lifetime UB in C++17, but the sections are 8-byte aligned and the
//     map base is page-aligned, so it is well-defined on every target compiler.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/FORMAT/FASTAFile.h>

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace FASTag
{
  /**
    @brief k-mer -> taxon set index over a curated reference protein database.

    Thread-safe for concurrent const reads after build()/load().
  */
  class TaxIndex
  {
  public:
    /// @brief Creates an empty index.
    TaxIndex() = default;
    /// @brief Releases the mapping, if any.
    ~TaxIndex();
    TaxIndex(const TaxIndex&) = delete;             ///< owns a mapping
    TaxIndex& operator=(const TaxIndex&) = delete;

    /**
      @brief Build from protein entries whose taxid is supplied in parallel.

      Only k-mers of the single canonical length @p k are indexed, I is folded
      to L. A taxon is recorded once per distinct k-mer regardless of how many
      of its proteins or positions carry it, so posting counts reflect taxon
      breadth, not abundance. Replaces any previous content.

      @param[in] entries the protein entries
      @param[in] taxids taxids[i] is the taxon of entries[i]; 0 (or a missing entry) skips it
      @param[in] k the k-mer length, in [1, MAX_K]; outside it the index stays empty (k() = 0)
    */
    void build(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries,
               const std::vector<uint32_t>& taxids, int k);

    /// @brief The indexed k-mer length.
    /// @return k; 0 when empty
    int k() const { return k_; }

    /**
      @brief Taxa whose proteins contain @p kmer (I/L folded, length k), ascending.

      Fills @p out rather than returning a reference: the mapped image stores
      taxon indices, so there is no vector<uint32_t> in the file to point at.
      Callers reuse one buffer instead of allocating per lookup.

      @param[in] kmer the k-mer; another length gives no taxa
      @param[out] out cleared, then filled with the taxids
    */
    void lookup(const std::string& kmer, std::vector<uint32_t>& out) const;

    /**
      @brief The number of indexed k-mers whose taxon set contains @p taxid (its posting count).

      Background for the null "taxon T absent": p_T = postings(T)/nKmers().

      @param[in] taxid the taxon
      @return the posting count
    */
    uint64_t postings(uint32_t taxid) const;
    /// @brief The number of distinct indexed k-mers.
    /// @return the k-mer count
    uint64_t nKmers() const;

    /// @brief Every taxon that appears anywhere in the index, ascending.
    /// @return the taxids
    std::vector<uint32_t> taxa() const;

    /**
      @brief Row-major n x n matrix of |kmers(i) AND kmers(j)| over taxa() order, n = taxa().size().

      The diagonal equals postings().

      This is the raw material for correcting near-neighbour inflation: two
      genera that share most of their k-mers cannot be told apart by counting
      tags, but the overlap says by how much, so the shared part can be
      subtracted (see TaxDeconv). Computed in one pass over the postings, at a
      cost of sum(|S|^2) over k-mer taxon sets S -- cheap because the reference
      is deliberately small and most k-mers sit in one or two taxa.

      @return the overlap matrix
    */
    std::vector<uint64_t> pairwiseOverlap() const;

    /**
      @brief The same overlap at the level of GROUPS of index taxa.

      Entry (a, b) of the row-major n_groups x n_groups result is the number
      of DISTINCT indexed k-mers whose taxon set contains a member of group a
      and a member of group b, so the diagonal is the number of k-mers in
      group a. Unlike summing pairwiseOverlap() over the members, a k-mer
      shared by several members of one group counts once, so
      conditionalMatrix() of the result is P(k-mer in a | k-mer in b) also
      when a group holds several index taxa. One pass over the postings.

      @param[in] group_of maps each index taxon (taxa() order) to its group, or -1 for a taxon outside every group
      @param[in] n_groups the number of groups
      @return the group overlap matrix
    */
    std::vector<uint64_t> groupOverlap(const std::vector<int>& group_of, std::size_t n_groups) const;

    /**
      @brief Writes the index in the compact binary format v2.
      @param[in] path the output file
      @param[out] err if not null, receives the error on failure
      @return false on failure (also for an empty index or one without a valid k)
    */
    bool save(const std::string& path, std::string* err = nullptr) const;
    /**
      @brief Loads an index file in the compact binary format (v1 into memory, v2 memory-mapped).

      Every section is bounds-checked against the file length; semantics are
      not fully validated (see the file comment).

      @param[in] path the index file
      @param[out] err if not null, receives the error on failure
      @return false on any magic or version other than v1 and v2, or an unreadable or truncated file
    */
    bool load(const std::string& path, std::string* err = nullptr);

    /**
      @brief Writes the loaded v2 image in the packed form "FTZ1" (see the file comment).

      Deterministic: the same image and level give the same bytes (each
      section is compressed single-threaded, on its own thread).

      @param[in] path the output file (by convention tax_k7.ftz)
      @param[in] level the zstd level (1..22)
      @param[out] err if not null, receives the error on failure
      @return false for an index that is not a loaded v2 image (build() output: save() and load() it first)
    */
    bool savePacked(const std::string& path, int level = 12, std::string* err = nullptr) const;

    /**
      @brief Writes the v2 image verbatim, as load() mapped or decoded it.

      For a packed index this restores the .taxdb it was packed from, byte for byte.

      @param[in] path the output file
      @param[out] err if not null, receives the error on failure
      @return false for an index without a v2 image, or on a write error
    */
    bool saveImage(const std::string& path, std::string* err = nullptr) const;

    /// @brief The v2 image (mapped or decoded), or nullptr for an in-memory index.
    /// @return the first byte of the image
    const uint8_t* image() const { return image_; }
    /// @brief The length of image().
    /// @return the byte count; 0 without an image
    size_t imageBytes() const { return image_len_; }
    /// @brief Whether the index came from a packed (FTZ1) file.
    /// @return true after loading an FTZ1 file
    bool packed() const { return !packed_sha256_.empty(); }
    /// @brief The sha256 of the v2 image a packed file records (lowercase hex).
    /// @return the digest; empty unless packed()
    const std::string& packedSha256() const { return packed_sha256_; }

    /// @brief Whether load() unpacks a packed index into the cache folder (default) or decodes it in memory.
    /// @param[in] on false: always decode in memory (buildtaxdb --verify/--unpack, tests)
    void usePackedCache(bool on) { use_cache_ = on; }
    /// @brief What the last load() of a packed index did (cache hit, unpack, in-memory fallback and why).
    /// @return one line for the log; empty for a .taxdb
    const std::string& loadNote() const { return load_note_; }
    /// @brief The cache file a packed index is mapped from.
    /// @return the path; empty unless a packed index was loaded through the cache
    const std::string& cachePath() const { return cache_path_; }

    /**
      @brief The folder packed indexes are unpacked into.

      $FASTAG_TAXDB_CACHE if set ("off", "0" or "none": no cache), else
      ~/Library/Caches/de.openms.fastag/taxdb (macOS),
      $XDG_CACHE_HOME or ~/.cache, then de.openms.fastag/taxdb (Linux),
      %LOCALAPPDATA%\de.openms.fastag\taxdb (Windows).

      @param[out] why if not null and the result is empty, the reason
      @return the folder (not created here); empty for none
    */
    static std::filesystem::path packedCacheDir(std::string* why = nullptr);

    /// @brief File name of the bundled index.
    static constexpr const char* BUNDLED_NAME = "tax_k7.taxdb";
    /// @brief File name of the bundled index in the packed form.
    static constexpr const char* BUNDLED_PACKED_NAME = "tax_k7.ftz";

    /**
      @brief The bundled index in @p dir: tax_k7.taxdb, else tax_k7.ftz.

      The .taxdb wins when both are there: it is mapped, not decoded.

      @param[in] dir a taxonomy directory
      @return the path of the first that is a regular file; "" for neither
    */
    static std::string findInDir(const std::string& dir);

    /**
      @brief Folds I to L; other characters pass through unchanged.
      @param[in] s the sequence
      @return the folded sequence
    */
    static std::string fold(const std::string& s);

    /**
      @brief Pack a folded k-mer into its base-19 code.
      @param[in] s the k-mer's first residue (k characters are read)
      @param[in] k the k-mer length
      @return the code, or UINT64_MAX if it contains a residue outside the
        19-letter alphabet (X/B/J/O/U/Z and anything else)
    */
    static uint64_t encode(const char* s, int k);
    /**
      @brief Bytes needed to store a base-19 code of length @p k.
      @param[in] k the k-mer length (capped at MAX_K; < 1 gives 1)
      @return the byte count
    */
    static int keyBytes(int k);

    /// @brief The largest supported k-mer length.
    ///
    /// k must be in [1, MAX_K]: 19^MAX_K fits in a uint64 code with margin.
    /// Higher k overflows the packing and silently corrupts the index.
    static constexpr int MAX_K = 12;

  private:
    void reset_();
    bool bindImage_(std::string* err);   ///< points the v2 fields into image_
    bool loadPacked_(const std::string& path, std::string* err);
    bool mapV2_(const std::filesystem::path& path, std::string* err);
    /// Maps the cache file @p file if it is the image of @p sha (stamped, or
    /// hashed now); sets @p stale when a file is there but is not.
    bool useCached_(const std::filesystem::path& file, const std::string& sha, const uint8_t* ftz_header,
                    uint64_t bytes, bool* stale);
    uint32_t postingAt_(uint32_t p) const;  ///< taxon index of mapped posting p

    int k_ = 0;

    // ---- v2: the mapped image (all pointers are into map_base_) -------------
    void* map_base_ = nullptr;
    size_t map_len_ = 0;
    // The v2 image the pointers below point into: the mapping, or the heap
    // buffer a packed file was decoded into (8-byte aligned, as mapped).
    const uint8_t* image_ = nullptr;
    size_t image_len_ = 0;
    std::unique_ptr<uint64_t[]> heap_;
    std::string packed_sha256_;
    std::string cache_path_;
    std::string load_note_;
    bool use_cache_ = true;
#ifdef _WIN32
    void* map_handle_ = nullptr;
    void* file_handle_ = nullptr;
#else
    int map_fd_ = -1;
#endif
    const uint8_t* keys_ = nullptr;       ///< n_kmers_ * key_bytes_, sorted
    const uint32_t* offsets_ = nullptr;   ///< n_kmers_ + 1
    const uint8_t* post_ = nullptr;       ///< n_postings * tax_bytes_
    const uint32_t* taxa_ = nullptr;      ///< n_taxa_, ascending
    const uint64_t* taxpost_ = nullptr;   ///< n_taxa_ posting counts
    uint64_t n_kmers_ = 0;
    uint32_t n_taxa_ = 0;
    int key_bytes_ = 0;
    int tax_bytes_ = 0;

    // ---- in-memory form: build() output and v1 files -----------------------
    std::unordered_map<std::string, std::vector<uint32_t>> index_;
    std::unordered_map<uint32_t, uint64_t> postings_;
    bool legacy_ = false;
  };
}
