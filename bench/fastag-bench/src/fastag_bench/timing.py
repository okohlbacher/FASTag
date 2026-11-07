"""Wall time, CPU time and peak RSS of a child process.

Uses os.wait4(), so it needs no /usr/bin/time. ru_maxrss is in KiB on Linux and in bytes on
macOS; both are reported here as KiB. The 1-minute load average before and after each run is
recorded because the IBMI nodes are shared: a run on a loaded node is a smoke figure, not a
benchmark.

Peak RSS: Linux carries a process's RSS high-water mark across fork() and exec(), so a tool forked
directly from a large Python process (one that has just scored millions of tags) would report the
parent's RSS as its own peak. The command is therefore started by a small helper interpreter
(`python -I -S`, about 10 MB), which forks the tool and reads its rusage with os.wait4; the tool's
peak RSS can include at most that helper's size, never the harness's.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

TIME_FIELDS = ["wall_s", "user_s", "sys_s", "cpu_s", "maxrss_kb", "load1_before", "load1_after", "returncode"]


def _load1() -> float:
    try:
        return round(os.getloadavg()[0], 2)
    except OSError:
        return float("nan")


_HELPER = r"""
import json, os, subprocess, sys, time
spec = json.loads(sys.argv[1])
out = open(spec["log"], "w") if spec["log"] else subprocess.DEVNULL
t0 = time.perf_counter()
proc = subprocess.Popen(spec["cmd"], stdout=out, stderr=subprocess.STDOUT, cwd=spec["cwd"])
_, status, ru = os.wait4(proc.pid, 0)
wall = time.perf_counter() - t0
print(json.dumps({"wall": wall, "utime": ru.ru_utime, "stime": ru.ru_stime, "maxrss": ru.ru_maxrss,
                  "rc": os.waitstatus_to_exitcode(status)}))
"""


def run_timed(cmd: list[str], log: str | Path | None = None, env: dict | None = None,
              cwd: str | Path | None = None) -> dict:
    """Run cmd (via the small helper, see module docstring), write stdout+stderr to log, return
    the TIME_FIELDS. Wall time is measured inside the helper around the tool only."""
    import json
    full_env = dict(os.environ)
    if env:
        full_env.update({k: str(v) for k, v in env.items()})
    spec = {"cmd": [str(c) for c in cmd], "log": str(log) if log else None, "cwd": str(cwd) if cwd else None}
    l0 = _load1()
    p = subprocess.run([sys.executable, "-I", "-S", "-c", _HELPER, json.dumps(spec)], env=full_env,
                       capture_output=True, text=True)
    l1 = _load1()
    if p.returncode != 0 or not p.stdout.strip():
        raise RuntimeError(f"timing helper failed for {cmd[0]}: {p.stderr.strip()[-500:]}")
    r = json.loads(p.stdout.strip().splitlines()[-1])
    rss = r["maxrss"] / 1024 if sys.platform == "darwin" else r["maxrss"]
    return {
        "wall_s": round(r["wall"], 3),
        "user_s": round(r["utime"], 3),
        "sys_s": round(r["stime"], 3),
        "cpu_s": round(r["utime"] + r["stime"], 3),
        "maxrss_kb": int(rss),
        "load1_before": l0,
        "load1_after": l1,
        "returncode": r["rc"],
    }
