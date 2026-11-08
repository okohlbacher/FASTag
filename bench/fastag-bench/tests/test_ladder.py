import pandas as pd

from fastag_bench.ladder import identity, mark_gate, summarize


def _raw():
    rows = []
    for fmt in ("mzML", "point"):
        for thr, walls in ((1, (20.0, 22.0)), (4, (5.5, 5.0))):
            for rep, w in enumerate(walls, 1):
                rows.append(dict(tool="fastag", profile="default", dataset="PXD1", format=fmt, threads=thr, rep=rep,
                                 exit=0, wall_s=w, user_s=w * thr * 0.9, sys_s=0.1, maxrss_kb=1024 * (100 + thr),
                                 load1_before=2.0, load1_after=3.0, foreign_r_before=1, foreign_r_after=2,
                                 spectra=1000, tags=5000, sha256="abc", t_parallel=w / 2))
    # one run on a loaded node and one failed run: kept in raw, excluded from the summary
    rows.append({**rows[0], "rep": 3, "wall_s": 1.0, "load1_before": 300.0})
    rows.append({**rows[0], "rep": 4, "exit": 1, "sha256": None})
    rows.append(dict(rows[0], tool="directag", profile="matched", format="mzML", sha256="zzz", spectra=0, tags=0))
    return pd.DataFrame(rows)


def test_gate_and_summary():
    df = mark_gate(_raw(), ncpu=384, gate=0.25)
    assert (df["gated"] == "no").sum() == 2
    s = summarize(df)
    c = s[(s.tool == "fastag") & (s.format == "mzML") & (s.threads == 1)].iloc[0]
    assert c["n"] == 2 and c["wall_min_s"] == 20.0 and c["wall_max_s"] == 22.0
    assert c["spread_pct"] == 10.0
    c4 = s[(s.tool == "fastag") & (s.format == "mzML") & (s.threads == 4)].iloc[0]
    assert c4["speedup"] == 4.0 and c4["efficiency"] == 1.0
    assert c4["spectra_per_s"] == 200.0
    assert c4["t_parallel_median"] == 2.625


def test_identity():
    df = mark_gate(_raw(), ncpu=384)
    ident = identity(df).set_index("tool")
    assert ident.loc["fastag", "identical"] == "yes"
    assert ident.loc["fastag", "formats"] == "mzML,point"
    assert ident.loc["fastag", "threads"] == "1,4"
    assert "directag" not in ident.index


def test_directag_status():
    from fastag_bench.ladder import directag_status
    df = _raw()
    trunc = dict(df.iloc[-1], dataset="PXD1", spectra=10, tags=50, exit=0)
    ok = dict(df.iloc[-1], dataset="PXD1_cvpatch", spectra=990, tags=5000, exit=0)
    fail = dict(df.iloc[-1], dataset="PXD2", spectra=None, tags=None, exit=1)
    st = directag_status(pd.DataFrame([*df.to_dict("records")[:-1], trunc, ok, fail])).set_index("dataset")["status"]
    assert st["PXD1"].startswith("truncated output (10 of 1000")
    assert st["PXD1_cvpatch"] == "ok"
    assert st["PXD2"] == "fails"


def test_corrections(tmp_path):
    from fastag_bench.ladder import apply_corrections, directag_status
    df = _raw()
    df.loc[df.index[-1], ["dataset", "spectra", "tags"]] = ["PXD1", 10, 50]
    c = tmp_path / "c.tsv"
    c.write_text("# x\ntool\tprofile\tdataset\tformat\tthreads\trep\texit\tnote\n"
                 "directag\tmatched\tPXD1\tmzML\t1\t1\t139\tsignal 11\n")
    out = apply_corrections(df, c)
    assert out.iloc[-1]["exit"] == 139 and "signal 11" in out.iloc[-1]["note"]
    assert directag_status(out).set_index("dataset").loc["PXD1", "status"] == "crashes (signal 11)"


def test_reuse_rows(tmp_path):
    from fastag_bench.ladder import load_raw
    df = _raw()
    new, old = tmp_path / "new.tsv", tmp_path / "old.tsv"
    df[df.tool == "fastag"].to_csv(new, sep="\t", index=False)
    df.assign(wall_s=99.0).to_csv(old, sep="\t", index=False)
    out = load_raw([new], [("directag", old)])
    assert len(out) == len(df)
    assert (out[out.tool == "directag"]["wall_s"] == 99.0).all()
    assert (out[out.tool == "fastag"]["wall_s"] != 99.0).all()
    assert out[out.tool == "directag"]["origin"].iloc[0] == "old.tsv (reused directag rows)"
    assert set(out[out.tool == "fastag"]["origin"]) == {"new.tsv"}
