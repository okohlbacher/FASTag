// OutputGuard: the input/output path guard (exact path, relative spelling,
// symlink, hard link, devices, .part paths) and the PartFile helper (commit,
// discard, failure, mode kept, symlink kept, device written directly, stale
// and planted .part files, SIGTERM removing the .part file and still
// terminating the process).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "OutputGuard.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#ifndef _WIN32
#include <csignal>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
using FASTag::PartFile;
using FASTag::PathGuard;
using FASTag::samePath;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok)
    {
      ++failures;
      std::cerr << "FAIL: " << what << "\n";
    }
  }
  std::string slurp(const fs::path& p)
  {
    std::ifstream f(p, std::ios::binary);
    std::ostringstream s;
    s << f.rdbuf();
    return s.str();
  }
  void put(const fs::path& p, const std::string& text)
  {
    std::ofstream f(p, std::ios::binary);
    f << text;
  }
  bool contains(const std::string& s, const std::string& what) { return s.find(what) != std::string::npos; }
}

#ifndef _WIN32
// The ignored-SIGTERM case runs in a fresh image of this binary (fork+exec),
// so the PartFile once-flag is still unused when its first PartFile opens:
// a forked child would inherit the parent's used flag and never reach the
// SIG_IGN check in installTermHandler().
static int ignoredSigtermMode(const std::string& target)
{
  PartFile pf(target);
  std::ofstream os;
  if (!pf.open(os)) return 3;
  struct sigaction now;
  if (sigaction(SIGTERM, nullptr, &now) != 0) return 6;
  if ((now.sa_flags & SA_SIGINFO) || now.sa_handler != SIG_IGN) return 7;
  raise(SIGTERM);
  os << "still here\n";
  os.close();
  return pf.commit() ? 0 : 5;
}
#endif

int main(int argc, char** argv)
{
#ifndef _WIN32
  if (argc == 3 && std::string(argv[1]) == "--ignored-sigterm") return ignoredSigtermMode(argv[2]);
#else
  (void)argc;
  (void)argv;
#endif
  const char* tmp_env = std::getenv("TMPDIR");
  fs::path root = fs::path(tmp_env && *tmp_env ? tmp_env : fs::temp_directory_path().string())
                  / ("fastag-output-guard-" + std::to_string(
#ifndef _WIN32
                                                 static_cast<long>(getpid())
#else
                                                 0L
#endif
                                                     ));
  fs::remove_all(root);
  fs::create_directories(root);
  const std::string dir = root.string();
  const std::string in = dir + "/run.mzML", db = dir + "/db.fasta";
  put(in, "spectra\n");
  put(db, ">P1\nPEPTIDE\n");

  // ---- samePath --------------------------------------------------------------
  check(samePath(in, in), "exact path");
  check(samePath(in, dir + "/./sub/../run.mzML"), "relative spelling");
  check(!samePath(in, db), "two different files");
  check(!samePath(dir + "/none1.tsv", dir + "/none2.tsv"), "two absent files");
  check(samePath(dir + "/none.tsv", dir + "/./none.tsv"), "one absent file, two spellings");
#ifndef _WIN32
  fs::create_symlink(in, dir + "/link.mzML");
  check(samePath(dir + "/link.mzML", in), "symlink");
  fs::create_hard_link(in, dir + "/hard.mzML");
  check(samePath(dir + "/hard.mzML", in), "hard link");
  check(!samePath("/dev/null", "/dev/null"), "/dev/null twice is not a collision");
#endif

  // ---- PathGuard -------------------------------------------------------------
  {
    PathGuard g;
    g.input("in", in);
    g.input("fasta", db);
    g.input("recon_fasta", "");
    g.output("out", dir + "/tags.tsv");
    g.output("recon_out", "");
    check(g.check().empty(), "no collision: " + g.check());
  }
  {
    PathGuard g;
    g.input("in", in);
    g.output("out", dir + "/tags.tsv");
    g.output("out_spectra", in);
    check(g.check() == "-out_spectra (" + in + ") is the input file; writing it would destroy the input.",
          "output = -in message: " + g.check());
  }
  {
    PathGuard g;
    g.input("in", in);
    g.output("out", dir + "/s.tsv");
    g.output("recon_out", dir + "/s.tsv");
    check(g.check() == "-recon_out and -out name the same file (" + dir + "/s.tsv).",
          "two outputs message: " + g.check());
  }
  for (const std::string& alias : {db
#ifndef _WIN32
                                   , dir + "/dblink.fasta", dir + "/dbhard.fasta"
#endif
       })
  {
#ifndef _WIN32
    if (!fs::exists(dir + "/dblink.fasta")) fs::create_symlink(db, dir + "/dblink.fasta");
    if (!fs::exists(dir + "/dbhard.fasta")) fs::create_hard_link(db, dir + "/dbhard.fasta");
#endif
    PathGuard g;
    g.input("in", in);
    g.input("fasta", db);
    g.output("out", dir + "/t.tsv");
    g.output("recon_out", alias);
    check(g.check() == "-recon_out (" + alias + ") is the -fasta file; writing it would destroy that input.",
          "output = -fasta via " + alias + ": " + g.check());
  }
  {
    // Inputs are checked before earlier outputs, -in first.
    PathGuard g;
    g.input("in", in);
    g.input("fasta", db);
    g.output("out", db);
    check(contains(g.check(), "is the -fasta file"), "first output against -fasta: " + g.check());
  }
  {
    // A .part path against an input and against another output.
    put(dir + "/x.tsv.part", "input\n");
    PathGuard g;
    g.input("in", in);
    g.input("census_model", dir + "/x.tsv.part");
    g.output("census_out", dir + "/x.tsv", /*via_part=*/true);
    check(g.check() == "-census_out's temporary file (" + dir + "/x.tsv.part) is the -census_model file; "
                       "writing it would destroy that input.",
          ".part = input: " + g.check());
    PathGuard h;
    h.input("in", in);
    h.output("out", dir + "/y.tsv.part");
    h.output("census_out", dir + "/y.tsv", true);
    check(contains(h.check(), "collide through a temporary file"), ".part = other output: " + h.check());
    PathGuard k;
    k.input("in", in);
    k.output("out", dir + "/y.tsv.part");
    k.output("census_out", dir + "/y.tsv", false);
    check(k.check().empty(), "no .part without via_part: " + k.check());
  }

  // ---- PartFile --------------------------------------------------------------
  {
    const std::string fin = dir + "/new.tsv";
    {
      PartFile pf(fin);
      std::ofstream os;
      check(pf.open(os), "open: " + pf.error());
      check(pf.writePath() == fin + ".part", "writes the .part file");
      os << "row\n";
      os.close();
      check(!fs::exists(fin), "the target does not exist before commit");
      check(fs::exists(fin + ".part"), "the .part file exists while writing");
      check(pf.commit(), "commit: " + pf.error());
    }
    check(slurp(fin) == "row\n", "committed content");
    check(!fs::exists(fin + ".part"), "no .part after commit");
  }
  {
    const std::string fin = dir + "/old.tsv";
    put(fin, "old\n");
    {
      PartFile pf(fin);
      std::ofstream os;
      check(pf.open(os), "open over an existing file");
      os << "half";
      os.close();
      // destroyed without commit
    }
    check(slurp(fin) == "old\n", "an uncommitted write leaves the old file");
    check(!fs::exists(fin + ".part"), "an uncommitted write leaves no .part");
  }
  {
    // A stale .part, and a planted symlink at the .part path.
    const std::string fin = dir + "/stale.tsv";
    put(fin + ".part", "stale\n");
    PartFile pf(fin);
    std::ofstream os;
    check(pf.open(os), "open over a stale .part");
    os << "fresh\n";
    os.close();
    check(pf.commit(), "commit over a stale .part");
    check(slurp(fin) == "fresh\n", "stale .part replaced");
#ifndef _WIN32
    const std::string victim = dir + "/victim.txt";
    put(victim, "keep\n");
    fs::create_symlink(victim, dir + "/planted.tsv.part");
    PartFile pp(dir + "/planted.tsv");
    std::ofstream o2;
    check(pp.open(o2), "open over a planted .part symlink");
    o2 << "data\n";
    o2.close();
    check(pp.commit(), "commit over a planted .part symlink");
    check(slurp(victim) == "keep\n", "a planted .part symlink was followed");
    check(slurp(dir + "/planted.tsv") == "data\n", "planted case content");
#endif
  }
  {
    // Path-based writer: begin(), write writePath(), commit().
    const std::string fin = dir + "/bypath.tsv";
    PartFile pf(fin);
    check(pf.begin(), "begin");
    put(pf.writePath(), "by path\n");
    check(pf.commit(), "commit by path");
    check(slurp(fin) == "by path\n", "path-based content");
  }
  {
    const std::string fin = dir + "/nodir/x.tsv";
    PartFile pf(fin);
    std::ofstream os;
    check(!pf.open(os), "open in a missing directory fails");
    check(!pf.error().empty(), "with an error message");
  }
#ifndef _WIN32
  {
    // Mode of an existing target kept; a symlink stays a link.
    const std::string fin = dir + "/mode.tsv";
    put(fin, "old\n");
    chmod(fin.c_str(), 0640);
    PartFile pf(fin);
    std::ofstream os;
    check(pf.open(os), "open mode");
    os << "new\n";
    os.close();
    check(pf.commit(), "commit mode");
    struct stat st;
    stat(fin.c_str(), &st);
    check((st.st_mode & 0777) == 0640, "mode 0640 kept");

    const std::string real = dir + "/real.tsv", link = dir + "/lnk.tsv";
    put(real, "old\n");
    fs::create_symlink(real, link);
    PartFile pl(link);
    std::ofstream ol;
    check(pl.open(ol), "open through a symlink");
    check(pl.writePath() == real + ".part", "the .part file sits next to the link's target");
    ol << "via link\n";
    ol.close();
    check(pl.commit(), "commit through a symlink");
    check(fs::is_symlink(link), "the symlink stays a link");
    check(slurp(real) == "via link\n", "the link's target got the data");
    check(FASTag::partPathFor(link) == real + ".part", "partPathFor resolves the link");

    PartFile pn("/dev/null");
    std::ofstream on;
    check(pn.open(on), "open /dev/null");
    check(pn.direct() && pn.writePath() == "/dev/null", "/dev/null is written directly");
    on << "x";
    on.close();
    check(pn.commit(), "commit /dev/null");
    check(fs::exists("/dev/null") && !fs::is_regular_file("/dev/null"), "/dev/null left alone");
  }
  {
    // SIGTERM while a .part file is open: removed, and the process still
    // dies of SIGTERM.
    const std::string fin = dir + "/term.tsv";
    int pipefd[2];
    check(pipe(pipefd) == 0, "pipe");
    const pid_t pid = fork();
    if (pid == 0)
    {
      close(pipefd[0]);
      PartFile pf(fin);
      std::ofstream os;
      if (!pf.open(os)) _exit(3);
      os << "partial" << std::flush;
      const char c = 'r';
      if (write(pipefd[1], &c, 1) != 1) _exit(4);
      for (;;) pause();
    }
    close(pipefd[1]);
    char c = 0;
    check(read(pipefd[0], &c, 1) == 1 && c == 'r', "child ready");
    close(pipefd[0]);
    check(fs::exists(fin + ".part"), "the child's .part file exists before SIGTERM");
    kill(pid, SIGTERM);
    int status = 0;
    waitpid(pid, &status, 0);
    check(WIFSIGNALED(status) && WTERMSIG(status) == SIGTERM, "the child died of SIGTERM");
    check(!fs::exists(fin + ".part"), "SIGTERM removed the .part file");
    check(!fs::exists(fin), "SIGTERM created no target");
  }
  {
    // SIGTERM ignored by the parent stays ignored. SIG_IGN survives exec; the
    // re-executed test binary opens its first PartFile under it.
    const std::string target = dir + "/ign.tsv";
    const pid_t pid = fork();
    if (pid == 0)
    {
      signal(SIGTERM, SIG_IGN);
      char mode[] = "--ignored-sigterm";
      char* args[] = {argv[0], mode, const_cast<char*>(target.c_str()), nullptr};
      execv(argv[0], args);
      _exit(127);
    }
    int status = 0;
    waitpid(pid, &status, 0);
    check(WIFEXITED(status) && WEXITSTATUS(status) == 0,
          "an ignored SIGTERM stays ignored (child status " + std::to_string(status) + ")");
    check(slurp(dir + "/ign.tsv") == "still here\n", "ignored-SIGTERM content");
  }
#endif

  fs::remove_all(root);
  if (failures)
  {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "output_guard_test: all checks passed\n";
  return 0;
}
