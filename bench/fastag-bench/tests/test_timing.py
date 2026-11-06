import sys

from fastag_bench.timing import run_timed


def test_run_timed_reports_child_not_parent(tmp_path):
    ballast = bytearray(300 * 1024 * 1024)  # make the harness process large
    ballast[::4096] = b"x" * len(ballast[::4096])
    r = run_timed([sys.executable, "-c", "print('hi')"], log=tmp_path / "log.txt")
    assert r["returncode"] == 0 and (tmp_path / "log.txt").read_text().strip() == "hi"
    assert r["maxrss_kb"] < 150 * 1024, r  # not the 300 MB of the caller
    assert r["wall_s"] >= 0 and r["cpu_s"] >= 0
    del ballast


def test_run_timed_returncode(tmp_path):
    r = run_timed([sys.executable, "-c", "import sys; sys.exit(3)"])
    assert r["returncode"] == 3
