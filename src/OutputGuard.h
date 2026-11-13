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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <fstream>
#include <ios>
#include <string>
#include <utility>
#include <vector>

namespace FASTag
{
  /**
    @brief Tests whether two paths name the same regular file.

    The same path after weakly_canonical, or the same file by fs::equivalent
    (hard link, symlink). A device or other non-regular file is never "the
    same": writing it twice truncates nothing. On Windows, NUL never matches.

    @param[in] a First path.
    @param[in] b Second path.
    @return True when @p a and @p b name the same regular file.
  */
  bool samePath(const std::string& a, const std::string& b);

  /**
    @brief The temporary path a PartFile for @p path writes.
    @param[in] path The output path.
    @return `<target>.part`, where the target is @p path with a symlink
      resolved (see PartFile).
  */
  std::string partPathFor(const std::string& path);

  /**
    @brief The input/output collision guard.

    No output may be an input the run consumes, or another output, by any
    name (see the file comment).
  */
  class PathGuard
  {
  public:
    /**
      @brief Registers a consumed input.
      @param[in] opt The option name without the dash.
      @param[in] path The input path; an empty path is ignored.
    */
    void input(const char* opt, const std::string& path);
    /**
      @brief Registers an output.
      @param[in] opt The option name without the dash.
      @param[in] path The output path; an empty path is ignored.
      @param[in] via_part The output is written through a PartFile: its
        temporary path is checked too.
      @param[in] part_of_part Also check the temporary of a PartFile on that
        temporary path (partPathFor(partPathFor(path)), the -census_ids join).
    */
    void output(const char* opt, const std::string& path, bool via_part = false, bool part_of_part = false);
    /**
      @brief Checks the registered paths for collisions.

      Outputs are checked in registration order: against every input (in
      registration order), then against every earlier output.

      @return The first collision as an error message, or "" when there is none.
    */
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

  /**
    @brief Removes every .part file a live PartFile holds.

    Async-signal-safe; the SIGTERM handler calls it. Exposed for tests and for
    fatal-error paths.
  */
  void dropPartialOutputs() noexcept;

  /**
    @brief One output written to `<target>.part` and renamed on success.

    See the file comment for how an existing target (regular file, symlink,
    device) is handled.
  */
  class PartFile
  {
  public:
    /**
      @brief Creates the writer for an output path; nothing is touched on disk yet.
      @param[in] path The output path the caller named.
    */
    explicit PartFile(std::string path);
    /// @brief Removes the .part file unless commit() succeeded.
    ~PartFile();
    PartFile(const PartFile&) = delete;
    PartFile& operator=(const PartFile&) = delete;

    /**
      @brief Prepares the write.

      Resolves the target, removes a stale .part file and registers the .part
      file for removal on SIGTERM. For a writer that opens the file itself:
      write to writePath() after this. Calling it again does nothing.

      @return False (with error() set) when the stale .part file cannot be
        removed; true otherwise.
    */
    bool begin();
    /**
      @brief Calls begin(), then creates the .part file exclusively and opens a stream on it.
      @param[out] os The stream to open on writePath().
      @param[in] mode The open mode.
      @return False (with error() set) on failure; true otherwise.
    */
    bool open(std::ofstream& os, std::ios::openmode mode = std::ios::out);
    /**
      @brief Renames the finished .part file onto the target.

      Nothing to do for a direct write. Close the stream first.

      @return False (with error() set, the .part file removed) on failure;
        true otherwise.
    */
    bool commit();
    /// @brief Removes the .part file. Also what the destructor does without commit().
    void discard() noexcept;

    /// @brief The path the caller named.
    /// @return The output path as given to the constructor.
    const std::string& path() const { return path_; }
    /// @brief The file the rename replaces (path() with a symlink resolved).
    /// @return The resolved target path (set by begin()).
    const std::string& target() const { return target_; }
    /// @brief Where the data go: the .part file, or the target for a direct write.
    /// @return The path to write to.
    const std::string& writePath() const { return direct_ ? target_ : part_; }
    /// @brief Whether the target is not a regular file and is written directly.
    /// @return True for a direct write.
    bool direct() const { return direct_; }
    /// @brief The last error message.
    /// @return The message, or "" when no step failed.
    const std::string& error() const { return error_; }

  private:
    void unregister_() noexcept;

    std::string path_, target_, part_, error_;
    bool direct_ = false, begun_ = false, committed_ = false;
    int slot_ = -1;
  };
}
