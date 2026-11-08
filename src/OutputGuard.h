// Output safety: the input/output path guard and the .part-then-rename helper.
//
// PathGuard. No output may be an input the run consumes, or another output,
// by any name: the exact path, a symlink, a hard link or a relative spelling.
// Opening an output truncates it, so -out_spectra equal to -in destroyed the
// raw file before it was re-read, and -species_out equal to -out replaced the
// finished tag table. The tool registers every consumed input and every output
// it will write, then calls check() once, before the first output is opened.
// An output written through a PartFile also registers its temporary path,
// which is checked against the inputs and the other outputs as well.
//
// PartFile. Writes an output to `<target>.part` in the target's directory and
// renames it onto the target only when the writer finished, so an interrupted
// or failed run never leaves a truncated file under the final name. A SIGTERM
// handler, installed the first time a PartFile is used, removes every .part
// file still open and then lets the signal terminate the process as before.
// The existing outputs do not use it: -out and the other legacy outputs are
// still written in place (a rename changes the file's mode and owner, breaks
// hard links and cannot replace a file in a read-only directory). New outputs
// opt in. What a PartFile does with an existing target:
//   - a regular file is replaced by the rename; its permission bits are
//     copied onto the .part file first, its owner and hard links are not kept;
//   - a symlink stays a link: the .part file sits next to the file it points
//     to, and the rename replaces that file;
//   - a device, FIFO or other non-regular file (/dev/null, /dev/stdout) is
//     written directly, without a .part file.
// A stale .part file from an earlier run is removed before writing (a planted
// symlink there is unlinked, never followed).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <fstream>
#include <ios>
#include <string>
#include <utility>
#include <vector>

namespace FASTag
{
  /// True when `a` and `b` name the same regular file: the same path after
  /// weakly_canonical, or the same file by fs::equivalent (hard link, symlink).
  /// A device or other non-regular file is never "the same": writing it twice
  /// truncates nothing. On Windows, NUL never matches.
  bool samePath(const std::string& a, const std::string& b);

  /// The temporary path a PartFile for `path` writes: `<target>.part`, where
  /// the target is `path` with a symlink resolved (see PartFile).
  std::string partPathFor(const std::string& path);

  /// The input/output collision guard (see the file comment).
  class PathGuard
  {
  public:
    /// A consumed input, named by its option without the dash. Empty paths
    /// are ignored.
    void input(const char* opt, const std::string& path);
    /// An output, named by its option without the dash. Empty paths are
    /// ignored. With `via_part`, the PartFile temporary path is checked too;
    /// with `part_of_part` also the temporary of a PartFile on that temporary
    /// path (partPathFor(partPathFor(path)), the -census_ids join).
    void output(const char* opt, const std::string& path, bool via_part = false, bool part_of_part = false);
    /// The first collision as an error message, or "" when there is none.
    /// Outputs are checked in registration order: against every input (in
    /// registration order), then against every earlier output.
    std::string check() const;

  private:
    struct Entry
    {
      std::string opt, path;
      bool via_part = false;
      bool part_of_part = false;
    };
    std::vector<Entry> ins_, outs_;
  };

  /// Removes every .part file a live PartFile holds. Async-signal-safe; the
  /// SIGTERM handler calls it. Exposed for tests and for fatal-error paths.
  void dropPartialOutputs() noexcept;

  /// One output written to `<target>.part` and renamed on success.
  class PartFile
  {
  public:
    explicit PartFile(std::string path);
    ~PartFile();
    PartFile(const PartFile&) = delete;
    PartFile& operator=(const PartFile&) = delete;

    /// Prepares the write: resolves the target, removes a stale .part file and
    /// registers the .part file for removal on SIGTERM. For a writer that
    /// opens the file itself: write to writePath() after this. False (with
    /// error() set) when the stale .part file cannot be removed.
    bool begin();
    /// begin(), then creates the .part file exclusively and opens `os` on it
    /// with `mode`. False (with error() set) on failure.
    bool open(std::ofstream& os, std::ios::openmode mode = std::ios::out);
    /// Renames the finished .part file onto the target (nothing to do for a
    /// direct write). Close the stream first. False (with error() set, the
    /// .part file removed) on failure.
    bool commit();
    /// Removes the .part file. Also what the destructor does without commit().
    void discard() noexcept;

    /// The path the caller named.
    const std::string& path() const { return path_; }
    /// The file the rename replaces (path() with a symlink resolved).
    const std::string& target() const { return target_; }
    /// Where the data go: the .part file, or the target for a direct write.
    const std::string& writePath() const { return direct_ ? target_ : part_; }
    /// True when the target is not a regular file and is written directly.
    bool direct() const { return direct_; }
    const std::string& error() const { return error_; }

  private:
    void unregister_() noexcept;

    std::string path_, target_, part_, error_;
    bool direct_ = false, begun_ = false, committed_ = false;
    int slot_ = -1;
  };
}
