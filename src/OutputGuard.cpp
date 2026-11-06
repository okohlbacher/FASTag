// Output safety: the input/output path guard and the .part-then-rename helper.
// See OutputGuard.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "OutputGuard.h"

#include <array>
#include <atomic>
#include <cctype>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <system_error>

#ifndef _WIN32
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace FASTag
{
  bool samePath(const std::string& a, const std::string& b)
  {
    std::error_code ea, eb;
#ifdef _WIN32
    // NUL (Git Bash passes /dev/null as nul) has no file status on Windows.
    for (const std::string* x : {&a, &b})
    {
      std::string f = fs::path(*x).stem().string();
      for (char& c : f) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      if (f == "nul") return false;
    }
#endif
    // A device (/dev/null, /dev/stdout) or other non-regular file may be
    // named twice: writing it truncates nothing.
    for (const std::string* x : {&a, &b})
    {
      std::error_code e;
      const auto st = fs::status(*x, e);
      if (!e && fs::exists(st) && !fs::is_regular_file(st)) return false;
    }
    if (fs::exists(a, ea) && fs::exists(b, eb))
    {
      std::error_code e;
      if (fs::equivalent(a, b, e)) return true;
    }
    const fs::path ca = fs::weakly_canonical(a, ea), cb = fs::weakly_canonical(b, eb);
    return !ea && !eb && ca == cb;
  }

  namespace
  {
    // `path` with symlinks followed (up to 40 hops, like the kernel), kept
    // relative when the links are relative. A dangling link resolves to the
    // file it would create.
    std::string resolveTarget(const std::string& path)
    {
      fs::path p(path);
      for (int hop = 0; hop < 40; ++hop)
      {
        std::error_code e;
        const auto st = fs::symlink_status(p, e);
        if (e || !fs::is_symlink(st)) break;
        const fs::path t = fs::read_symlink(p, e);
        if (e) break;
        p = t.is_absolute() ? t : p.parent_path() / t;
      }
      return p.string();
    }

    // True when the target exists and is not a regular file (a device, FIFO,
    // directory), or is Windows' NUL: such a target is written directly.
    bool writesDirect(const std::string& target)
    {
#ifdef _WIN32
      std::string f = fs::path(target).stem().string();
      for (char& c : f) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      if (f == "nul") return true;
#endif
      std::error_code e;
      const auto st = fs::status(target, e);
      return !e && fs::exists(st) && !fs::is_regular_file(st);
    }

    // ---- the .part registry the SIGTERM handler reads ----------------------
    //
    // Fixed storage, so the handler touches no allocator: a slot is claimed
    // under the mutex (never taken in the handler) and published by its
    // atomic state. A file that finds no free slot, or whose path is too
    // long, is still written; it is just not removed on SIGTERM.
    constexpr int kSlots = 64;
    constexpr std::size_t kPathMax = 4096;
    struct Slot
    {
      std::atomic<int> live{0};
      char path[kPathMax];
    };
    std::array<Slot, kSlots> g_slots;
    std::mutex g_slots_mu;
    static_assert(std::atomic<int>::is_always_lock_free, "the SIGTERM handler needs a lock-free flag");

#ifndef _WIN32
    struct sigaction g_old_term;
    void onTerm(int sig, siginfo_t* info, void* ctx)
    {
      dropPartialOutputs();
      // Hand the signal on to what was there before: the default action
      // (terminate, re-raised once this handler returns and unblocks it) or a
      // handler of the embedding program.
      sigaction(SIGTERM, &g_old_term, nullptr);
      if (g_old_term.sa_flags & SA_SIGINFO)
      {
        if (g_old_term.sa_sigaction) g_old_term.sa_sigaction(sig, info, ctx);
      }
      else if (g_old_term.sa_handler == SIG_DFL)
        raise(sig);
      else if (g_old_term.sa_handler != SIG_IGN)
        g_old_term.sa_handler(sig);
    }
    void installTermHandler()
    {
      struct sigaction old;
      if (sigaction(SIGTERM, nullptr, &old) != 0) return;
      // Ignored by whoever started us: stay ignored.
      if (!(old.sa_flags & SA_SIGINFO) && old.sa_handler == SIG_IGN) return;
      g_old_term = old;
      struct sigaction sa;
      std::memset(&sa, 0, sizeof sa);
      sa.sa_sigaction = onTerm;
      sigemptyset(&sa.sa_mask);
      sa.sa_flags = SA_SIGINFO | SA_RESTART;
      sigaction(SIGTERM, &sa, nullptr);
    }
#else
    // Windows raises SIGTERM only through raise(); kept for symmetry.
    using Handler = void (*)(int);
    Handler g_old_term = SIG_DFL;
    void onTerm(int sig)
    {
      dropPartialOutputs();
      std::signal(SIGTERM, g_old_term == SIG_ERR ? SIG_DFL : g_old_term);
      if (g_old_term == SIG_DFL || g_old_term == SIG_ERR) std::raise(sig);
      else if (g_old_term != SIG_IGN) g_old_term(sig);
    }
    void installTermHandler()
    {
      const Handler old = std::signal(SIGTERM, onTerm);
      if (old == SIG_IGN) { std::signal(SIGTERM, SIG_IGN); return; }
      g_old_term = old;
    }
#endif

    std::once_flag g_install_once;

    int registerPart(const std::string& part)
    {
      if (part.size() >= kPathMax) return -1;
      std::lock_guard<std::mutex> lock(g_slots_mu);
      for (int i = 0; i < kSlots; ++i)
      {
        if (g_slots[i].live.load(std::memory_order_acquire) != 0) continue;
        std::memcpy(g_slots[i].path, part.c_str(), part.size() + 1);
        g_slots[i].live.store(1, std::memory_order_release);
        return i;
      }
      return -1;
    }
  }

  std::string partPathFor(const std::string& path)
  {
    return resolveTarget(path) + ".part";
  }

  void dropPartialOutputs() noexcept
  {
    for (Slot& s : g_slots)
      if (s.live.load(std::memory_order_acquire) == 1)
      {
#ifndef _WIN32
        unlink(s.path);
#else
        std::remove(s.path);
#endif
      }
  }

  // ---- PathGuard -----------------------------------------------------------

  void PathGuard::input(const char* opt, const std::string& path)
  {
    if (!path.empty()) ins_.push_back({opt, path, false});
  }

  void PathGuard::output(const char* opt, const std::string& path, bool via_part)
  {
    if (!path.empty()) outs_.push_back({opt, path, via_part});
  }

  std::string PathGuard::check() const
  {
    struct Cand
    {
      std::string path;
      bool part;
    };
    const auto cands = [](const Entry& e) {
      std::vector<Cand> c{{e.path, false}};
      if (e.via_part)
      {
        const std::string t = resolveTarget(e.path);
        if (!writesDirect(t)) c.push_back({t + ".part", true});
      }
      return c;
    };
    std::vector<std::vector<Cand>> oc;
    oc.reserve(outs_.size());
    for (const Entry& o : outs_) oc.push_back(cands(o));

    for (size_t i = 0; i < outs_.size(); ++i)
    {
      const Entry& o = outs_[i];
      for (const Entry& in : ins_)
        for (const Cand& c : oc[i])
        {
          if (!samePath(c.path, in.path)) continue;
          const std::string what = c.part
              ? "-" + o.opt + "'s temporary file (" + c.path + ")"
              : "-" + o.opt + " (" + c.path + ")";
          if (in.opt == "in")
            return what + " is the input file; writing it would destroy the input.";
          return what + " is the -" + in.opt + " file; writing it would destroy that input.";
        }
      for (size_t j = 0; j < i; ++j)
        for (const Cand& a : oc[i])
          for (const Cand& b : oc[j])
          {
            if (!samePath(a.path, b.path)) continue;
            if (!a.part && !b.part)
              return "-" + o.opt + " and -" + outs_[j].opt + " name the same file (" + o.path + ").";
            return "-" + o.opt + " and -" + outs_[j].opt + " collide through a temporary file ("
                   + a.path + ").";
          }
    }
    return std::string();
  }

  // ---- PartFile ------------------------------------------------------------

  PartFile::PartFile(std::string path) : path_(std::move(path)) {}

  PartFile::~PartFile()
  {
    if (!committed_) discard();
  }

  bool PartFile::begin()
  {
    if (begun_) return true;
    error_.clear();
    target_ = resolveTarget(path_);
    direct_ = writesDirect(target_);
    if (!direct_)
    {
      part_ = target_ + ".part";
      std::error_code e;
      const auto st = fs::symlink_status(part_, e);
      if (!e && fs::exists(st))
      {
        if (fs::is_directory(st))
        {
          error_ = "Cannot write " + path_ + ": " + part_ + " is a directory.";
          return false;
        }
        // Unlinks a planted symlink itself, never its target.
        fs::remove(part_, e);
        if (e)
        {
          error_ = "Cannot remove the stale temporary file " + part_ + ": " + e.message();
          return false;
        }
      }
      std::call_once(g_install_once, installTermHandler);
      slot_ = registerPart(part_);
    }
    begun_ = true;
    committed_ = false;
    return true;
  }

  bool PartFile::open(std::ofstream& os, std::ios::openmode mode)
  {
    if (!begin()) return false;
    if (!direct_)
    {
      // Created exclusively: the stale file is gone, so anything there now
      // was planted since; refuse it rather than write through it.
      std::FILE* f = std::fopen(part_.c_str(), "wx");
      if (!f)
      {
        error_ = "Cannot create " + part_ + ": " + std::strerror(errno);
        discard();
        return false;
      }
      std::fclose(f);
    }
    os.open(writePath(), mode | std::ios::out);
    if (!os)
    {
      error_ = "Cannot open output file " + writePath() + " for writing.";
      discard();
      return false;
    }
    return true;
  }

  bool PartFile::commit()
  {
    if (!begun_)
    {
      error_ = "Nothing to commit for " + path_ + ".";
      return false;
    }
    if (committed_) return true;
    if (!direct_)
    {
      std::error_code e;
      const auto st = fs::status(target_, e);
      if (!e && fs::is_regular_file(st))
      {
        std::error_code ep;  // best effort: a mode we cannot copy keeps the new file's
        fs::permissions(part_, st.permissions(), fs::perm_options::replace, ep);
      }
      fs::rename(part_, target_, e);
      if (e)
      {
        error_ = "Cannot rename " + part_ + " to " + target_ + ": " + e.message();
        discard();
        return false;
      }
      unregister_();
    }
    committed_ = true;
    return true;
  }

  void PartFile::discard() noexcept
  {
    if (begun_ && !committed_ && !direct_)
    {
      std::error_code e;
      fs::remove(part_, e);
    }
    unregister_();
    begun_ = false;
  }

  void PartFile::unregister_() noexcept
  {
    if (slot_ >= 0) g_slots[slot_].live.store(0, std::memory_order_release);
    slot_ = -1;
  }
}
