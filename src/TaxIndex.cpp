// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "TaxIndex.h"
#include "Sha256.h"

#include <zstd.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <new>
#include <thread>

#ifdef _WIN32
#  include <windows.h>
#else
#  include <fcntl.h>
#  include <sys/mman.h>
#  include <sys/stat.h>
#  include <unistd.h>
#endif

namespace FASTag
{
  namespace
  {
    /// The folded alphabet, exactly 19 letters: the 20 standard residues with I
    /// folded onto L. Anything else (X/B/J/O/U/Z, digits, '*') is ambiguous and
    /// would match spuriously, so it has no code and kills the k-mer.
    constexpr char ALPHABET[] = "ACDEFGHKLMNPQRSTVWY";
    constexpr int RADIX = 19;

    const int8_t* codeTable()
    {
      // Function-local static: C++11 guarantees thread-safe one-time
      // initialization, which matters because a v2 load never touches this
      // table, so the FIRST lookups happen straight from the OpenMP loop.
      static const std::array<int8_t, 256> table = [] {
        std::array<int8_t, 256> t;
        t.fill(-1);
        for (int i = 0; i < RADIX; ++i) t[static_cast<uint8_t>(ALPHABET[i])] = static_cast<int8_t>(i);
        t[static_cast<uint8_t>('I')] = t[static_cast<uint8_t>('L')];  // I folds onto L
        return t;
      }();
      return table.data();
    }

    inline uint64_t rdKey(const uint8_t* p, int width)
    {
      uint64_t v = 0;
      for (int i = width - 1; i >= 0; --i) v = (v << 8) | p[i];
      return v;
    }
    inline void wrKey(uint8_t* p, int width, uint64_t v)
    {
      for (int i = 0; i < width; ++i) { p[i] = static_cast<uint8_t>(v & 0xFF); v >>= 8; }
    }
    inline size_t align8(size_t n) { return (n + 7u) & ~static_cast<size_t>(7); }

    template <class T> void wr(std::ostream& o, T v)
    { o.write(reinterpret_cast<const char*>(&v), sizeof v); }
    template <class T> bool rd(std::istream& i, T& v)
    { return static_cast<bool>(i.read(reinterpret_cast<char*>(&v), sizeof v)); }
  }

  int TaxIndex::keyBytes(int k)
  {
    // k is capped at MAX_K, where 19^k still fits in uint64 with room to spare.
    // Beyond that the code overflows (silent collisions) and the width formula
    // truncates -- both corrupt the index. buildtaxdb enforces the same cap.
    if (k < 1) return 1;
    if (k > MAX_K) k = MAX_K;
    uint64_t max = 1;
    for (int i = 0; i < k; ++i) max *= RADIX;   // 19^MAX_K << 2^64
    int b = 1;
    while (b < 8 && ((max - 1) >> (8 * b)) != 0) ++b;
    return b;
  }

  uint64_t TaxIndex::encode(const char* s, int k)
  {
    const int8_t* t = codeTable();
    uint64_t v = 0;
    for (int i = 0; i < k; ++i)
    {
      const int8_t c = t[static_cast<uint8_t>(s[i])];
      if (c < 0) return UINT64_MAX;
      v = v * RADIX + static_cast<uint64_t>(c);
    }
    return v;
  }

  std::string TaxIndex::fold(const std::string& s)
  {
    std::string out = s;
    for (char& c : out) if (c == 'I') c = 'L';
    return out;
  }

  TaxIndex::~TaxIndex() { reset_(); }

  uint32_t TaxIndex::postingAt_(uint32_t p) const
  {
    return static_cast<uint32_t>(
        rdKey(post_ + static_cast<size_t>(p) * static_cast<size_t>(tax_bytes_), tax_bytes_));
  }

  void TaxIndex::reset_()
  {
    if (map_base_ != nullptr)
    {
#ifdef _WIN32
      UnmapViewOfFile(map_base_);
      if (map_handle_ != nullptr) CloseHandle(static_cast<HANDLE>(map_handle_));
      if (file_handle_ != nullptr) CloseHandle(static_cast<HANDLE>(file_handle_));
      map_handle_ = nullptr; file_handle_ = nullptr;
#else
      munmap(map_base_, map_len_);
      if (map_fd_ >= 0) ::close(map_fd_);
      map_fd_ = -1;
#endif
      map_base_ = nullptr;
      map_len_ = 0;
    }
    image_ = nullptr; image_len_ = 0; heap_.reset(); packed_sha256_.clear();
    keys_ = nullptr; post_ = nullptr; offsets_ = nullptr; taxa_ = nullptr; taxpost_ = nullptr;
    n_kmers_ = 0; n_taxa_ = 0; key_bytes_ = 0; tax_bytes_ = 0; k_ = 0;
    index_.clear(); postings_.clear(); legacy_ = false;
  }

  void TaxIndex::build(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries,
                       const std::vector<uint32_t>& taxids, int k)
  {
    reset_();
    k_ = k;
    legacy_ = true;   // build fills the maps; save() packs them into the v2 image
    if (k < 1 || k > MAX_K) { k_ = 0; return; }

    for (size_t e = 0; e < entries.size(); ++e)
    {
      const uint32_t tax = e < taxids.size() ? taxids[e] : 0;
      if (tax == 0) continue;
      const std::string seq = fold(entries[e].sequence);
      for (size_t i = 0; i + static_cast<size_t>(k) <= seq.size(); ++i)
      {
        if (encode(seq.data() + i, k) == UINT64_MAX) continue;

        std::vector<uint32_t>& set = index_[seq.substr(i, static_cast<size_t>(k))];
        // Keep the set sorted and unique; postings count the FIRST time a taxon
        // is added to a k-mer, so they measure breadth, not abundance.
        auto it = std::lower_bound(set.begin(), set.end(), tax);
        if (it == set.end() || *it != tax)
        {
          set.insert(it, tax);
          ++postings_[tax];
        }
      }
    }
  }

  uint64_t TaxIndex::nKmers() const
  {
    return legacy_ ? static_cast<uint64_t>(index_.size()) : n_kmers_;
  }

  std::vector<uint32_t> TaxIndex::taxa() const
  {
    if (!legacy_ && taxa_ != nullptr) return std::vector<uint32_t>(taxa_, taxa_ + n_taxa_);
    std::vector<uint32_t> out;
    out.reserve(postings_.size());
    for (const auto& kv : postings_) out.push_back(kv.first);
    std::sort(out.begin(), out.end());
    return out;
  }

  std::vector<uint64_t> TaxIndex::pairwiseOverlap() const
  {
    const std::vector<uint32_t> tx = taxa();
    const size_t n = tx.size();
    std::vector<uint64_t> m(n * n, 0);
    if (n == 0) return m;

    // One shared accumulator over both storage paths: collect the taxon INDICES
    // of one k-mer, then bump every ordered pair. Indices, not taxids, so the
    // inner loop is an array write and never a map lookup.
    std::vector<uint32_t> ids;
    auto bump = [&]() {
      for (size_t a = 0; a < ids.size(); ++a)
        for (size_t b = 0; b < ids.size(); ++b)
          ++m[static_cast<size_t>(ids[a]) * n + ids[b]];
    };

    if (!legacy_ && keys_ != nullptr)
    {
      for (uint64_t i = 0; i < n_kmers_; ++i)
      {
        ids.clear();
        for (uint32_t p = offsets_[i]; p < offsets_[i + 1]; ++p)
        {
          const uint32_t idx = postingAt_(p);
          if (idx < n_taxa_) ids.push_back(idx);
        }
        bump();
      }
      return m;
    }

    // In-memory path: postings are taxids, so map each to its index once.
    for (const auto& kv : index_)
    {
      ids.clear();
      for (uint32_t t : kv.second)
      {
        auto it = std::lower_bound(tx.begin(), tx.end(), t);
        if (it != tx.end() && *it == t) ids.push_back(static_cast<uint32_t>(it - tx.begin()));
      }
      bump();
    }
    return m;
  }

  std::vector<uint64_t> TaxIndex::groupOverlap(const std::vector<int>& group_of, std::size_t n_groups) const
  {
    std::vector<uint64_t> m(n_groups * n_groups, 0);
    const std::vector<uint32_t> tx = taxa();
    const size_t n = tx.size();
    if (n == 0 || n_groups == 0 || group_of.size() < n) return m;

    // The distinct groups of one k-mer (taxon sets are small, so a linear
    // dedup beats a set), then every ordered pair of them once.
    std::vector<uint32_t> gs;
    auto add = [&](size_t idx) {
      const int g = group_of[idx];
      if (g < 0 || static_cast<std::size_t>(g) >= n_groups) return;
      const uint32_t u = static_cast<uint32_t>(g);
      if (std::find(gs.begin(), gs.end(), u) == gs.end()) gs.push_back(u);
    };
    auto bump = [&]() {
      for (size_t a = 0; a < gs.size(); ++a)
        for (size_t b = 0; b < gs.size(); ++b)
          ++m[static_cast<size_t>(gs[a]) * n_groups + gs[b]];
    };

    if (!legacy_ && keys_ != nullptr)
    {
      for (uint64_t i = 0; i < n_kmers_; ++i)
      {
        gs.clear();
        for (uint32_t p = offsets_[i]; p < offsets_[i + 1]; ++p)
        {
          const uint32_t idx = postingAt_(p);
          if (idx < n_taxa_) add(idx);
        }
        bump();
      }
      return m;
    }

    for (const auto& kv : index_)
    {
      gs.clear();
      for (uint32_t t : kv.second)
      {
        auto it = std::lower_bound(tx.begin(), tx.end(), t);
        if (it != tx.end() && *it == t) add(static_cast<size_t>(it - tx.begin()));
      }
      bump();
    }
    return m;
  }

  uint64_t TaxIndex::postings(uint32_t taxid) const
  {
    if (!legacy_ && taxa_ != nullptr)
    {
      const uint32_t* e = taxa_ + n_taxa_;
      const uint32_t* it = std::lower_bound(taxa_, e, taxid);
      if (it == e || *it != taxid) return 0;
      return taxpost_[it - taxa_];
    }
    auto it = postings_.find(taxid);
    return it == postings_.end() ? 0 : it->second;
  }

  void TaxIndex::lookup(const std::string& kmer, std::vector<uint32_t>& out) const
  {
    out.clear();
    if (k_ <= 0 || static_cast<int>(kmer.size()) != k_) return;

    if (legacy_)
    {
      // fold() here too: the mapped path folds I->L via encode(), so an
      // I-containing query must behave the same before a save/load round-trip.
      auto it = index_.find(fold(kmer));
      if (it != index_.end()) out = it->second;
      return;
    }
    if (keys_ == nullptr || n_kmers_ == 0) return;

    const uint64_t want = encode(kmer.data(), k_);
    if (want == UINT64_MAX) return;

    // Binary search the packed, sorted key array in place -- no deserialization.
    uint64_t lo = 0, hi = n_kmers_;
    while (lo < hi)
    {
      const uint64_t mid = lo + (hi - lo) / 2;
      const uint64_t got = rdKey(keys_ + mid * static_cast<size_t>(key_bytes_), key_bytes_);
      if (got < want) { lo = mid + 1; continue; }
      if (got > want) { hi = mid; continue; }

      const uint32_t b = offsets_[mid], e = offsets_[mid + 1];
      out.reserve(e - b);
      for (uint32_t p = b; p < e; ++p)
      {
        const uint32_t idx = postingAt_(p);
        if (idx < n_taxa_) out.push_back(taxa_[idx]);
      }
      return;
    }
  }

  // --- Serialization -------------------------------------------------------
  //
  // v2 ("FTX2"), little-endian, every section 8-byte aligned so the mapped
  // image is usable in place:
  //
  //   0  magic "FTX2" | 4 u32 version=2 | 8 u32 k | 12 u32 n_taxa
  //   16 u64 n_kmers  | 24 u64 n_postings | 32 u8 key_bytes | 33 u8 tax_bytes
  //   34 u8 reserved[6]
  //   40 u32 taxa[n_taxa]             ascending
  //      u64 taxon_postings[n_taxa]   STORED, not recomputed: scanning the whole
  //                                   postings array on every load is exactly the
  //                                   cost mapping the file exists to avoid
  //      keys[n_kmers * key_bytes]    base-19 codes, ascending
  //      u32 offsets[n_kmers + 1]     into postings
  //      postings[n_post * tax_bytes] INDICES into taxa[], ascending per k-mer
  bool TaxIndex::save(const std::string& path, std::string* err) const
  {
    if (k_ < 1 || k_ > MAX_K)
    { if (err) *err = "refusing to save an index with no valid k"; return false; }
    const std::vector<uint32_t> tx = taxa();
    if (tx.empty())
    { if (err) *err = "refusing to save an empty index"; return false; }
    const uint32_t n_taxa = static_cast<uint32_t>(tx.size());
    const int kb = keyBytes(k_);
    // Width follows the largest INDEX stored (n_taxa-1), not the count:
    // 256 taxa still index 0..255, one byte.
    const uint32_t max_idx = n_taxa - 1;
    const int tb = max_idx <= 0xFFu ? 1 : (max_idx <= 0xFFFFu ? 2 : 4);

    std::vector<std::pair<uint64_t, std::vector<uint32_t>>> rows;
    if (legacy_)
    {
      rows.reserve(index_.size());
      for (const auto& kv : index_)
      {
        const uint64_t code = encode(kv.first.data(), k_);
        if (code == UINT64_MAX) continue;
        std::vector<uint32_t> idx;
        idx.reserve(kv.second.size());
        for (uint32_t t : kv.second)
        {
          auto it = std::lower_bound(tx.begin(), tx.end(), t);
          if (it != tx.end() && *it == t) idx.push_back(static_cast<uint32_t>(it - tx.begin()));
        }
        rows.emplace_back(code, std::move(idx));
      }
      std::sort(rows.begin(), rows.end(),
                [](const std::pair<uint64_t, std::vector<uint32_t>>& a,
                   const std::pair<uint64_t, std::vector<uint32_t>>& b) { return a.first < b.first; });
    }
    else
    {
      // Re-saving an already-mapped index: its keys are already sorted.
      rows.reserve(static_cast<size_t>(n_kmers_));
      for (uint64_t i = 0; i < n_kmers_; ++i)
      {
        std::vector<uint32_t> idx;
        for (uint32_t p = offsets_[i]; p < offsets_[i + 1]; ++p) idx.push_back(postingAt_(p));
        rows.emplace_back(rdKey(keys_ + i * static_cast<size_t>(key_bytes_), key_bytes_), std::move(idx));
      }
    }

    uint64_t n_post = 0;
    for (const auto& r : rows) n_post += r.second.size();
    if (n_post > 0xFFFFFFFFull)
    { if (err) *err = "index has too many postings for the 32-bit offset format"; return false; }
    std::vector<uint64_t> tpost(n_taxa, 0);
    for (const auto& r : rows) for (uint32_t i : r.second) if (i < n_taxa) ++tpost[i];

    std::ofstream o(path, std::ios::binary);
    if (!o) { if (err) *err = "cannot open " + path + " for writing"; return false; }

    o.write("FTX2", 4);
    wr<uint32_t>(o, 2);
    wr<uint32_t>(o, static_cast<uint32_t>(k_));
    wr<uint32_t>(o, n_taxa);
    wr<uint64_t>(o, static_cast<uint64_t>(rows.size()));
    wr<uint64_t>(o, n_post);
    wr<uint8_t>(o, static_cast<uint8_t>(kb));
    wr<uint8_t>(o, static_cast<uint8_t>(tb));
    for (int i = 0; i < 6; ++i) wr<uint8_t>(o, 0);

    // Track the position ourselves: a failed stream returns tellp()==-1, which
    // as size_t is SIZE_MAX and would spin the pad loop forever.
    size_t pos = 40;
    auto put = [&](const void* d, size_t n) { o.write(static_cast<const char*>(d), static_cast<std::streamsize>(n)); pos += n; };
    auto pad = [&]() { while ((pos % 8u) != 0 && o) { char z = 0; o.write(&z, 1); ++pos; } };

    for (uint32_t t : tx) put(&t, 4);
    pad();
    for (uint64_t v : tpost) put(&v, 8);
    pad();

    std::vector<uint8_t> kbuf(static_cast<size_t>(kb));
    for (const auto& r : rows) { wrKey(kbuf.data(), kb, r.first); put(kbuf.data(), static_cast<size_t>(kb)); }
    pad();

    uint32_t run = 0;
    for (const auto& r : rows) { put(&run, 4); run += static_cast<uint32_t>(r.second.size()); }
    put(&run, 4);
    pad();

    std::vector<uint8_t> pbuf(static_cast<size_t>(tb));
    for (const auto& r : rows)
      for (uint32_t i : r.second) { wrKey(pbuf.data(), tb, i); put(pbuf.data(), static_cast<size_t>(tb)); }

    o.flush();
    return static_cast<bool>(o);
  }

  bool TaxIndex::load(const std::string& path, std::string* err)
  {
    reset_();

    char magic[4] = {0, 0, 0, 0};
    {
      std::ifstream probe(path, std::ios::binary);
      if (!probe) { if (err) *err = "cannot open " + path; return false; }
      probe.read(magic, 4);
    }

    // ---- v1: parse into the in-memory maps ----------------------------------
    if (std::memcmp(magic, "FTXI", 4) == 0)
    {
      std::ifstream i(path, std::ios::binary);
      i.seekg(4);
      uint32_t ver = 0, k = 0; uint64_t n = 0;
      if (!rd(i, ver) || ver != 1) { if (err) *err = "unsupported index version"; return false; }
      if (!rd(i, k) || !rd(i, n)) { if (err) *err = "truncated index header"; return false; }
      k_ = static_cast<int>(k);
      legacy_ = true;
      index_.reserve(n);
      for (uint64_t e = 0; e < n; ++e)
      {
        uint8_t klen = 0;
        if (!rd(i, klen)) { if (err) *err = "truncated index"; return false; }
        std::string key(klen, '\0');
        if (!i.read(&key[0], klen)) { if (err) *err = "truncated index key"; return false; }
        uint32_t setlen = 0;
        if (!rd(i, setlen)) { if (err) *err = "truncated index set length"; return false; }
        std::vector<uint32_t> set(setlen);
        for (uint32_t s = 0; s < setlen; ++s)
          if (!rd(i, set[s])) { if (err) *err = "truncated index set"; return false; }
        for (uint32_t t : set) ++postings_[t];
        index_.emplace(std::move(key), std::move(set));
      }
      return true;
    }

    if (std::memcmp(magic, "FTZ1", 4) == 0) return loadPacked_(path, err);
    if (std::memcmp(magic, "FTX2", 4) != 0)
    { if (err) *err = "not a FASTag taxonomy index"; return false; }
    // ---- v2: map it and point into the image -------------------------------
#ifdef _WIN32
    HANDLE fh = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (fh == INVALID_HANDLE_VALUE) { if (err) *err = "cannot open " + path; return false; }
    LARGE_INTEGER sz;
    if (GetFileSizeEx(fh, &sz) == 0)
    { CloseHandle(fh); if (err) *err = "cannot size " + path; return false; }
    HANDLE mh = CreateFileMappingA(fh, nullptr, PAGE_READONLY, 0, 0, nullptr);
    if (mh == nullptr)
    { CloseHandle(fh); if (err) *err = "cannot map " + path; return false; }
    void* base = MapViewOfFile(mh, FILE_MAP_READ, 0, 0, 0);
    if (base == nullptr)
    { CloseHandle(mh); CloseHandle(fh); if (err) *err = "cannot map " + path; return false; }
    file_handle_ = fh;
    map_handle_ = mh;
    map_len_ = static_cast<size_t>(sz.QuadPart);
#else
    const int fd = ::open(path.c_str(), O_RDONLY);
    if (fd < 0) { if (err) *err = "cannot open " + path; return false; }
    struct stat st;
    if (fstat(fd, &st) != 0) { ::close(fd); if (err) *err = "cannot size " + path; return false; }
    void* base = mmap(nullptr, static_cast<size_t>(st.st_size), PROT_READ, MAP_PRIVATE, fd, 0);
    if (base == MAP_FAILED) { ::close(fd); if (err) *err = "cannot map " + path; return false; }
    map_fd_ = fd;
    map_len_ = static_cast<size_t>(st.st_size);
#endif
    map_base_ = base;

    image_ = static_cast<const uint8_t*>(base);
    image_len_ = map_len_;
    return bindImage_(err);
  }

  bool TaxIndex::bindImage_(std::string* err)
  {
    if (image_len_ < 40) { reset_(); if (err) *err = "index is truncated"; return false; }
    const uint8_t* p = image_;
    auto u32at = [p](size_t o) { uint32_t v; std::memcpy(&v, p + o, 4); return v; };
    auto u64at = [p](size_t o) { uint64_t v; std::memcpy(&v, p + o, 8); return v; };

    // Re-check the magic in the MAPPED bytes, not just the earlier probe read:
    // the file could have been replaced between the two opens.
    if (std::memcmp(p, "FTX2", 4) != 0) { reset_(); if (err) *err = "not a FASTag taxonomy index"; return false; }
    if (u32at(4) != 2) { reset_(); if (err) *err = "unsupported index version"; return false; }
    k_ = static_cast<int>(u32at(8));
    n_taxa_ = u32at(12);
    n_kmers_ = u64at(16);
    const uint64_t n_post = u64at(24);
    key_bytes_ = p[32];
    tax_bytes_ = p[33];

    if (key_bytes_ <= 0 || key_bytes_ > 8 || tax_bytes_ <= 0 || tax_bytes_ > 4
        || k_ <= 0 || k_ > MAX_K
        || key_bytes_ != keyBytes(k_)
        || n_kmers_ == 0 || n_taxa_ == 0)
    { reset_(); if (err) *err = "index header is malformed"; return false; }

    // Every section is bounds-checked BEFORE its pointer is formed, with
    // subtraction rather than addition so attacker-controlled counts cannot wrap
    // a 64-bit offset past the end and back inside the mapping. This matters in
    // practice, not just against a hostile file: the ~1 GB index is a downloaded
    // asset, so a truncated or partial download is a realistic corruption.
    // `avail` is what remains after `off`; a section of `count` elements of
    // `size` bytes fits iff count <= avail/size.
    size_t off = 40;
    auto fits = [&](uint64_t count, size_t size) -> bool {
      if (off > image_len_) return false;
      const size_t avail = image_len_ - off;
      return size == 0 || count <= avail / size;
    };
    auto bump = [&](uint64_t count, size_t size) { off = align8(off + static_cast<size_t>(count) * size); };

    if (!fits(n_taxa_, 4)) { reset_(); if (err) *err = "index is truncated (taxa)"; return false; }
    taxa_ = reinterpret_cast<const uint32_t*>(p + off);
    bump(n_taxa_, 4);
    if (!fits(n_taxa_, 8)) { reset_(); if (err) *err = "index is truncated (taxpost)"; return false; }
    taxpost_ = reinterpret_cast<const uint64_t*>(p + off);
    bump(n_taxa_, 8);
    if (!fits(n_kmers_, static_cast<size_t>(key_bytes_))) { reset_(); if (err) *err = "index is truncated (keys)"; return false; }
    keys_ = p + off;
    bump(n_kmers_, static_cast<size_t>(key_bytes_));
    if (!fits(n_kmers_ + 1, 4)) { reset_(); if (err) *err = "index is truncated (offsets)"; return false; }
    offsets_ = reinterpret_cast<const uint32_t*>(p + off);
    bump(n_kmers_ + 1, 4);
    if (!fits(n_post, static_cast<size_t>(tax_bytes_))) { reset_(); if (err) *err = "index is truncated (postings)"; return false; }
    post_ = p + off;

    // The offsets array must be a valid CSR structure, or lookup() would read
    // arbitrary bytes of the postings section (or far past it). Checked once here
    // so the hot path can trust it.
    if (offsets_[0] != 0 || offsets_[n_kmers_] != n_post)
    { reset_(); if (err) *err = "index offsets are malformed"; return false; }
    for (uint64_t i = 1; i <= n_kmers_; ++i)
      if (offsets_[i] < offsets_[i - 1])
      { reset_(); if (err) *err = "index offsets are not monotonic"; return false; }

    legacy_ = false;
    return true;
  }

  // --- Packed form ("FTZ1") ---------------------------------------------------
  //
  // Little-endian. Bytes 0..39 mirror the v2 header field for field (only the
  // magic and the version differ), so a header peek reads k at offset 8 from
  // either:
  //
  //   0  magic "FTZ1" | 4 u32 version=1 | 8 u32 k | 12 u32 n_taxa
  //   16 u64 n_kmers  | 24 u64 n_postings | 32 u8 key_bytes | 33 u8 tax_bytes
  //   34 u8 reserved[6]
  //   40 u64 image_bytes                 the length of the v2 image it decodes to
  //   48 u64 head_bytes                  the image's header + taxa + taxon_postings, padded
  //   56 u8  image_sha256[32]            of the decoded image (buildtaxdb --verify)
  //   88 u32 n_sections=4 | 92 u32 zstd level (informational)
  //   96 {u64 compressed, u64 raw}[4]
  //   160 the sections, each one zstd frame with a content checksum:
  //       0 head      the image's first head_bytes bytes, verbatim
  //       1 keys      key deltas (the first from 0), escape-coded at key_bytes
  //       2 sizes     postings per k-mer (offset deltas), escape-coded at 4 bytes
  //       3 postings  verbatim
  //
  // Escape code: a value below 255 is one byte; any other is 0xFF followed by
  // the value in the stated width. 99.9% of the k=7 deltas and every set size
  // take one byte, and zstd's entropy stage does the rest.
  namespace
  {
    constexpr size_t FTZ_HEADER = 160;
    constexpr int FTZ_SECTIONS = 4;
    constexpr size_t ESC_CHUNK = size_t(1) << 20;

    /// The v2 image's section offsets for the given header counts, or false
    /// when they cannot describe an image (sizes that overflow, or a postings
    /// count the 32-bit offsets cannot address).
    struct Layout { size_t head = 0, keys = 0, offs = 0, post = 0, end = 0; };
    bool layoutOf(uint32_t n_taxa, uint64_t n_kmers, uint64_t n_post, int kb, int tb, Layout& L)
    {
      if (n_kmers == 0 || n_kmers > 0xFFFFFFFFull || n_post > 0xFFFFFFFFull) return false;
      if (kb < 1 || kb > 8 || tb < 1 || tb > 4) return false;
      L.head = align8(align8(40 + size_t(4) * n_taxa) + size_t(8) * n_taxa);
      L.keys = L.head;
      L.offs = align8(L.keys + size_t(n_kmers) * size_t(kb));
      L.post = align8(L.offs + size_t(4) * (size_t(n_kmers) + 1));
      L.end = L.post + size_t(n_post) * size_t(tb);
      return true;
    }

    inline void putEsc(std::string& out, uint64_t v, int width)
    {
      if (v < 255) { out.push_back(static_cast<char>(v)); return; }
      out.push_back(static_cast<char>(0xFF));
      for (int i = 0; i < width; ++i) { out.push_back(static_cast<char>(v & 0xFF)); v >>= 8; }
    }

    /// A read-only mapping of a whole file, released on destruction. The
    /// compressed sections are read through it rather than copied to the heap:
    /// clean file-backed pages, not another 200 MB of anonymous memory.
    struct ReadMap
    {
      const uint8_t* p = nullptr;
      size_t n = 0;
#ifdef _WIN32
      HANDLE fh = INVALID_HANDLE_VALUE, mh = nullptr;
#else
      int fd = -1;
#endif
      ReadMap() = default;
      ReadMap(const ReadMap&) = delete;
      ReadMap& operator=(const ReadMap&) = delete;
      ~ReadMap()
      {
#ifdef _WIN32
        if (p != nullptr) UnmapViewOfFile(p);
        if (mh != nullptr) CloseHandle(mh);
        if (fh != INVALID_HANDLE_VALUE) CloseHandle(fh);
#else
        if (p != nullptr) munmap(const_cast<uint8_t*>(p), n);
        if (fd >= 0) ::close(fd);
#endif
      }
      bool open(const std::string& path)
      {
#ifdef _WIN32
        fh = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (fh == INVALID_HANDLE_VALUE) return false;
        LARGE_INTEGER sz;
        if (GetFileSizeEx(fh, &sz) == 0 || sz.QuadPart <= 0) return false;
        mh = CreateFileMappingA(fh, nullptr, PAGE_READONLY, 0, 0, nullptr);
        if (mh == nullptr) return false;
        void* b = MapViewOfFile(mh, FILE_MAP_READ, 0, 0, 0);
        if (b == nullptr) return false;
        p = static_cast<const uint8_t*>(b);
        n = static_cast<size_t>(sz.QuadPart);
#else
        fd = ::open(path.c_str(), O_RDONLY);
        if (fd < 0) return false;
        struct stat st;
        if (fstat(fd, &st) != 0 || st.st_size <= 0) return false;
        void* b = mmap(nullptr, static_cast<size_t>(st.st_size), PROT_READ, MAP_PRIVATE, fd, 0);
        if (b == MAP_FAILED) return false;
        p = static_cast<const uint8_t*>(b);
        n = static_cast<size_t>(st.st_size);
#endif
        return true;
      }
    };

    struct DCtxFree { void operator()(ZSTD_DCtx* d) const { ZSTD_freeDCtx(d); } };
    struct CCtxFree { void operator()(ZSTD_CCtx* c) const { ZSTD_freeCCtx(c); } };

    /// Decompresses the single zstd frame [src, src+n) of @p raw bytes and
    /// hands each of its @p count escape-coded values to @p f, in order,
    /// streaming through a 1 MB buffer. @p f returns false to stop (a value
    /// out of range). False with @p err on a corrupt, short or long stream.
    template <class F>
    bool decodeEsc(const uint8_t* src, size_t n, uint64_t raw, int width, uint64_t count, F&& f, std::string& err)
    {
      std::unique_ptr<ZSTD_DCtx, DCtxFree> d(ZSTD_createDCtx());
      if (!d) { err = "out of memory"; return false; }
      std::vector<uint8_t> buf(ESC_CHUNK + 16);
      size_t have = 0;
      uint64_t produced = 0, got = 0;
      ZSTD_inBuffer in{src, n, 0};
      for (;;)
      {
        ZSTD_outBuffer out{buf.data() + have, buf.size() - have, 0};
        const size_t ret = ZSTD_decompressStream(d.get(), &out, &in);
        if (ZSTD_isError(ret)) { err = ZSTD_getErrorName(ret); return false; }
        have += out.pos;
        produced += out.pos;
        size_t i = 0;
        while (i < have)
        {
          uint64_t v = buf[i];
          size_t step = 1;
          if (v == 0xFF)
          {
            if (have - i < size_t(1) + size_t(width)) break;   // the rest comes with the next chunk
            v = rdKey(buf.data() + i + 1, width);
            step += size_t(width);
          }
          if (got == count) { err = "more values than the header says"; return false; }
          if (!f(v)) { err = "value out of range"; return false; }
          ++got;
          i += step;
        }
        std::memmove(buf.data(), buf.data() + i, have - i);
        have -= i;
        if (ret == 0) break;                                   // frame decoded and flushed
        if (in.pos == in.size && out.pos == 0) { err = "truncated"; return false; }
      }
      if (have != 0 || in.pos != in.size) { err = "trailing bytes"; return false; }
      if (got != count || produced != raw) { err = "fewer values than the header says"; return false; }
      return true;
    }

    /// One-shot decompression of a frame of exactly @p raw bytes into @p dst.
    bool decodeRaw(const uint8_t* src, size_t n, uint8_t* dst, uint64_t raw, std::string& err)
    {
      const unsigned long long fcs = ZSTD_getFrameContentSize(src, n);
      if (fcs != raw) { err = "frame size does not match the header"; return false; }
      const size_t got = ZSTD_decompress(dst, static_cast<size_t>(raw), src, n);
      if (ZSTD_isError(got)) { err = ZSTD_getErrorName(got); return false; }
      if (got != raw) { err = "short frame"; return false; }
      return true;
    }

    std::string toHex(const uint8_t* d, size_t n)
    {
      static const char* hx = "0123456789abcdef";
      std::string s(2 * n, '0');
      for (size_t i = 0; i < n; ++i) { s[2 * i] = hx[d[i] >> 4]; s[2 * i + 1] = hx[d[i] & 15]; }
      return s;
    }
    bool fromHex(const std::string& s, uint8_t* d, size_t n)
    {
      if (s.size() != 2 * n) return false;
      auto nib = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        return -1;
      };
      for (size_t i = 0; i < n; ++i)
      {
        const int a = nib(s[2 * i]), b = nib(s[2 * i + 1]);
        if (a < 0 || b < 0) return false;
        d[i] = static_cast<uint8_t>(a * 16 + b);
      }
      return true;
    }
  }

  std::string TaxIndex::findInDir(const std::string& dir)
  {
    for (const char* name : {BUNDLED_NAME, BUNDLED_PACKED_NAME})
    {
      const std::filesystem::path p = std::filesystem::path(dir) / name;
      std::error_code ec;
      if (std::filesystem::is_regular_file(p, ec) && std::filesystem::file_size(p, ec) > 0 && !ec)
        return dir + "/" + name;
    }
    return std::string();
  }

  bool TaxIndex::saveImage(const std::string& path, std::string* err) const
  {
    if (image_ == nullptr || image_len_ == 0)
    { if (err) *err = "no v2 image to write (save() an in-memory index instead)"; return false; }
    std::ofstream o(path, std::ios::binary);
    if (!o) { if (err) *err = "cannot open " + path + " for writing"; return false; }
    o.write(reinterpret_cast<const char*>(image_), static_cast<std::streamsize>(image_len_));
    o.flush();
    if (!o) { if (err) *err = "write failed: " + path; return false; }
    return true;
  }

  bool TaxIndex::savePacked(const std::string& path, int level, std::string* err) const
  {
    if (legacy_ || image_ == nullptr || keys_ == nullptr)
    { if (err) *err = "only a loaded v2 index can be packed (save() it, then load() it)"; return false; }
    if (level < 1 || level > ZSTD_maxCLevel())
    { if (err) *err = "zstd level out of range"; return false; }
    const uint64_t n_post = offsets_[n_kmers_];
    Layout L;
    if (!layoutOf(n_taxa_, n_kmers_, n_post, key_bytes_, tax_bytes_, L) || L.end != image_len_)
    { if (err) *err = "the image is not in the canonical v2 layout (save() it again)"; return false; }
    // The decoder writes zeros into the alignment gaps, so they must be zeros
    // here, or the round trip would not be byte for byte.
    auto zeros = [this](size_t a, size_t b) {
      for (size_t i = a; i < b; ++i) if (image_[i] != 0) return false;
      return true;
    };
    if (!zeros(L.keys + size_t(n_kmers_) * size_t(key_bytes_), L.offs)
        || !zeros(L.offs + size_t(4) * (size_t(n_kmers_) + 1), L.post))
    { if (err) *err = "the image has non-zero padding (save() it again)"; return false; }

    // The four section inputs.
    std::string keys_esc, sizes_esc;
    keys_esc.reserve(static_cast<size_t>(n_kmers_) + 1024);
    sizes_esc.reserve(static_cast<size_t>(n_kmers_) + 1024);
    uint64_t prev = 0;
    for (uint64_t i = 0; i < n_kmers_; ++i)
    {
      const uint64_t key = rdKey(keys_ + i * static_cast<size_t>(key_bytes_), key_bytes_);
      putEsc(keys_esc, key - prev, key_bytes_);   // keys ascend: never negative
      prev = key;
      putEsc(sizes_esc, uint64_t(offsets_[i + 1]) - offsets_[i], 4);
    }
    struct Sec { const void* src; size_t n; std::string out; std::string err; };
    Sec sec[FTZ_SECTIONS] = {
      {image_, L.head, {}, {}},
      {keys_esc.data(), keys_esc.size(), {}, {}},
      {sizes_esc.data(), sizes_esc.size(), {}, {}},
      {image_ + L.post, image_len_ - L.post, {}, {}},
    };
    // One thread per section, each compressing single-threaded: the output is
    // a function of the input and the level only (no worker-count dependence).
    auto compress = [level](Sec& s) {
      std::unique_ptr<ZSTD_CCtx, CCtxFree> c(ZSTD_createCCtx());
      if (!c) { s.err = "out of memory"; return; }
      ZSTD_CCtx_setParameter(c.get(), ZSTD_c_compressionLevel, level);
      ZSTD_CCtx_setParameter(c.get(), ZSTD_c_checksumFlag, 1);
      ZSTD_CCtx_setParameter(c.get(), ZSTD_c_contentSizeFlag, 1);
      s.out.resize(ZSTD_compressBound(s.n));
      const size_t r = ZSTD_compress2(c.get(), &s.out[0], s.out.size(), s.src, s.n);
      if (ZSTD_isError(r)) { s.err = ZSTD_getErrorName(r); return; }
      s.out.resize(r);
    };
    {
      std::vector<std::thread> th;
      for (int i = 1; i < FTZ_SECTIONS; ++i) th.emplace_back(compress, std::ref(sec[i]));
      compress(sec[0]);
      for (auto& t : th) t.join();
    }
    for (const Sec& s : sec)
      if (!s.err.empty()) { if (err) *err = "zstd: " + s.err; return false; }

    Sha256 h;
    h.update(image_, image_len_);
    uint8_t digest[32];
    if (!fromHex(h.hexDigest(), digest, 32)) { if (err) *err = "sha256 failed"; return false; }

    std::string hdr(FTZ_HEADER, '\0');
    std::memcpy(&hdr[0], image_, 40);           // the v2 header fields, as they are
    std::memcpy(&hdr[0], "FTZ1", 4);
    const uint32_t ver = 1;
    std::memcpy(&hdr[4], &ver, 4);
    const uint64_t ib = image_len_, hb = L.head;
    std::memcpy(&hdr[40], &ib, 8);
    std::memcpy(&hdr[48], &hb, 8);
    std::memcpy(&hdr[56], digest, 32);
    const uint32_t ns = FTZ_SECTIONS, lv = static_cast<uint32_t>(level);
    std::memcpy(&hdr[88], &ns, 4);
    std::memcpy(&hdr[92], &lv, 4);
    for (int i = 0; i < FTZ_SECTIONS; ++i)
    {
      const uint64_t c = sec[i].out.size(), r = sec[i].n;
      std::memcpy(&hdr[96 + 16 * i], &c, 8);
      std::memcpy(&hdr[96 + 16 * i + 8], &r, 8);
    }
    std::ofstream o(path, std::ios::binary);
    if (!o) { if (err) *err = "cannot open " + path + " for writing"; return false; }
    o.write(hdr.data(), static_cast<std::streamsize>(hdr.size()));
    for (const Sec& s : sec) o.write(s.out.data(), static_cast<std::streamsize>(s.out.size()));
    o.flush();
    if (!o) { if (err) *err = "write failed: " + path; return false; }
    return true;
  }

  bool TaxIndex::loadPacked_(const std::string& path, std::string* err)
  {
    auto fail = [&](const std::string& why) { reset_(); if (err) *err = why; return false; };
    ReadMap m;
    if (!m.open(path)) return fail("cannot open " + path);
    const uint64_t flen = m.n;
    if (flen < FTZ_HEADER) return fail("packed index is truncated (header)");
    const uint8_t* h = m.p;
    auto u32at = [h](size_t o) { uint32_t v; std::memcpy(&v, h + o, 4); return v; };
    auto u64at = [h](size_t o) { uint64_t v; std::memcpy(&v, h + o, 8); return v; };
    if (std::memcmp(h, "FTZ1", 4) != 0) return fail("not a FASTag taxonomy index");
    if (u32at(4) != 1) return fail("unsupported packed index version");
    if (u32at(88) != FTZ_SECTIONS) return fail("packed index header is malformed (sections)");

    const uint32_t n_taxa = u32at(12);
    const uint64_t n_kmers = u64at(16), n_post = u64at(24);
    const int kb = h[32], tb = h[33];
    const int k = static_cast<int>(u32at(8));
    Layout L;
    if (k < 1 || k > MAX_K || kb != keyBytes(k) || n_taxa == 0
        || !layoutOf(n_taxa, n_kmers, n_post, kb, tb, L)
        || u64at(40) != L.end || u64at(48) != L.head)
      return fail("packed index header is malformed");

    uint64_t comp[FTZ_SECTIONS], raw[FTZ_SECTIONS];
    uint64_t total = FTZ_HEADER;
    for (int i = 0; i < FTZ_SECTIONS; ++i)
    {
      comp[i] = u64at(96 + 16 * i);
      raw[i] = u64at(96 + 16 * i + 8);
      if (comp[i] > flen) return fail("packed index header is malformed (section size)");
      total += comp[i];
    }
    if (total != flen) return fail("packed index is truncated or has trailing bytes");
    if (raw[0] != L.head || raw[3] != L.end - L.post) return fail("packed index header is malformed (section size)");

    const uint8_t* src[FTZ_SECTIONS];
    {
      size_t o = FTZ_HEADER;
      for (int i = 0; i < FTZ_SECTIONS; ++i) { src[i] = m.p + o; o += static_cast<size_t>(comp[i]); }
    }

    // The image, 8-byte aligned like a mapping. Only the alignment gaps need
    // zeroing; every other byte is written by a section below.
    heap_.reset(new (std::nothrow) uint64_t[(L.end + 7) / 8]);
    if (!heap_) return fail("out of memory for the index image");
    uint8_t* img = reinterpret_cast<uint8_t*>(heap_.get());
    std::memset(img + L.keys + size_t(n_kmers) * size_t(kb), 0, L.offs - (L.keys + size_t(n_kmers) * size_t(kb)));
    std::memset(img + L.offs + size_t(4) * (size_t(n_kmers) + 1), 0, L.post - (L.offs + size_t(4) * (size_t(n_kmers) + 1)));
    std::memset(img + L.end, 0, (L.end + 7) / 8 * 8 - L.end);

    std::string e[FTZ_SECTIONS];
    const uint64_t max_key = kb >= 8 ? UINT64_MAX : (uint64_t(1) << (8 * kb)) - 1;
    auto keys = [&]() {
      uint8_t* dst = img + L.keys;
      uint64_t prev = 0, i = 0;
      decodeEsc(src[1], static_cast<size_t>(comp[1]), raw[1], kb, n_kmers,
                [&](uint64_t v) {
                  if (v > max_key - prev) return false;
                  prev += v;
                  wrKey(dst + (i++) * static_cast<size_t>(kb), kb, prev);
                  return true;
                }, e[1]);
    };
    auto sizes = [&]() {
      uint32_t* off = reinterpret_cast<uint32_t*>(img + L.offs);
      uint64_t run = 0, i = 0;
      off[0] = 0;
      decodeEsc(src[2], static_cast<size_t>(comp[2]), raw[2], 4, n_kmers,
                [&](uint64_t v) {
                  if (v > n_post - run) return false;
                  run += v;
                  off[++i] = static_cast<uint32_t>(run);
                  return true;
                }, e[2]);
      if (e[2].empty() && run != n_post) e[2] = "postings do not add up";
    };
    auto post = [&]() { decodeRaw(src[3], static_cast<size_t>(comp[3]), img + L.post, raw[3], e[3]); };
    {
      std::thread t1(keys), t2(sizes);
      post();
      decodeRaw(src[0], static_cast<size_t>(comp[0]), img, raw[0], e[0]);
      t1.join();
      t2.join();
    }
    static const char* names[FTZ_SECTIONS] = {"head", "keys", "sizes", "postings"};
    for (int i = 0; i < FTZ_SECTIONS; ++i)
      if (!e[i].empty()) return fail(std::string("packed index section ") + names[i] + ": " + e[i]);
    // The decoded v2 header must say what the packed header says.
    if (std::memcmp(img + 8, h + 8, 32) != 0) return fail("packed index header does not match its image");

    const std::string digest = toHex(h + 56, 32);
    image_ = img;
    image_len_ = L.end;
    if (!bindImage_(err)) return false;   // the same checks as a mapped .taxdb
    packed_sha256_ = digest;
    return true;
  }
}
