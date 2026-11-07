"""#4: per-spectrum scoring against candidate sets, the summary by axis cell, and the CLI wiring."""
import pandas as pd
import pytest

from fastag_bench import score as S
from fastag_bench import unidentified as U


def _tag(peptide, pos, L, key, rank, evalue=0.001):
    res, pref, total = S.peptide_masses(peptide)
    return {"key": key, "rank": rank, "tag": res[pos:pos + L], "nterm_mass": pref[pos],
            "cterm_mass": total - pref[pos + L], "evalue": evalue, "length": L}


def _wrong(key, rank, evalue=0.5):
    return {"key": key, "rank": rank, "tag": "WWW", "nterm_mass": 1.0, "cterm_mass": 1.0, "evalue": evalue, "length": 3}


TAGS = pd.DataFrame([
    _tag("SAMPLER", 1, 3, "scan=1", 1), _wrong("scan=1", 2),
    _wrong("scan=2", 1), _tag("PEPTIDEK", 2, 3, "scan=2", 2, 0.02),
    _wrong("scan=3", 1),
    _tag("LATEMK", 0, 3, "scan=5", 1),   # candidate set of size 2, correct for one member
])
TRUTH = pd.DataFrame({
    "key": ["scan=1", "scan=2", "scan=3", "scan=4", "scan=5", "scan=6"],
    "candidates": [["SAMPLER"], ["PEPTIDEK"], ["AAAK"], ["CCCK"], ["KLATEM", "LATEMK"], []],
    "identification": ["S3-PT", "S3-PT", "S3-PT", "S3-PT", "S3-PT", "S3-PT"],
    "chimericity": ["none"] * 6,
})


def test_score_spectra():
    out = U.score_spectra(TAGS, TRUTH, ks=(1, 5)).set_index("key")
    assert list(out.loc["scan=1", ["tagged", "top1", "top5"]]) == [1, 1, 1]
    assert list(out.loc["scan=2", ["tagged", "top1", "top5"]]) == [1, 0, 1]
    assert list(out.loc["scan=3", ["tagged", "top1", "top5"]]) == [1, 0, 0]
    assert list(out.loc["scan=4", ["tagged", "top1", "top5"]]) == [0, 0, 0]
    assert out.loc["scan=5", "size_label"] == "pool_consistent" and out.loc["scan=5", "top1"] == 1
    assert out.loc["scan=6", "size_label"] == "no_pool_candidate"
    assert out.loc["scan=1", "size_label"] == "size1"
    assert out.loc["scan=1", "n_tags"] == 2 and out.loc["scan=1", "n_correct"] == 1
    # per-tag counts at E <= 0.01
    assert out.loc["scan=2", "n_tags_e001"] == 0 and out.loc["scan=1", "n_tags_e001"] == 1
    assert out.loc["scan=1", "n_correct_e001"] == 1


def test_summarize_separates_size_classes_and_skips_no_candidate():
    sc = U.score_spectra(TAGS, TRUTH, ks=(1, 5))
    summ = U.summarize(sc, by=["identification", "chimericity", "size_label"], ks=(1, 5))
    s = summ.set_index("size_label")
    assert set(s.index) == {"size1", "pool_consistent", "no_pool_candidate"}
    assert s.loc["size1", "spectra"] == 4 and s.loc["size1", "tagged"] == 3
    assert s.loc["size1", "rank1_accuracy"] == pytest.approx(1 / 3)   # over tagged spectra
    assert s.loc["size1", "top5_any"] == pytest.approx(2 / 3)
    assert s.loc["size1", "tag_precision"] == pytest.approx(2 / 5)
    assert s.loc["no_pool_candidate", "scored"] == 0  # reported, not scored


def test_chance_uses_swapped_candidates():
    swapped = TRUTH.assign(candidates=[["PEPTIDEK"], ["SAMPLER"], ["AAAK"], ["CCCK"], ["SAMPLER"], []])
    ch = U.score_spectra(TAGS, swapped, ks=(1,)).set_index("key")
    assert ch.loc["scan=1", "top1"] == 0 and ch.loc["scan=2", "top1"] == 0


def test_cli_subcommands_registered():
    from fastag_bench.cli import build_parser
    ap = build_parser()
    for sub in ("sage-modes", "pool-truth", "chimera-build", "run", "score", "collect", "splits", "v190-check"):
        a = ap.parse_args(["unidentified", sub, "--config", "x.yaml"])
        assert a.cmd == "unidentified" and a.step == sub
    a = ap.parse_args(["unidentified", "run", "--config", "x.yaml", "--split", "dev", "--ratios", "1,10",
                       "--modes", "closed,pool", "--seed", "3"])
    assert (a.split, a.ratios, a.modes, a.seed) == ("dev", "1,10", "closed,pool", 3)
    with pytest.raises(SystemExit):
        ap.parse_args(["unidentified", "run", "--config", "x.yaml", "--split", "nosuch"])


def test_mgf_tags_map_index_to_chimera_scan(tmp_path):
    p = tmp_path / "tags.tsv"
    p.write_text("spectrum\ttag\tnterm_mass\tcterm_mass\nindex=0\tAAA\t1\t2\nindex=0\tCCC\t1\t2\nindex=4\tDDD\t1\t2\n")
    t = U._mgf_tags(p)
    assert list(t["key"]) == ["scan=1", "scan=1", "scan=5"] and list(t["rank"]) == [1, 2, 1]
    p.write_text("spectrum\ttag\tnterm_mass\tcterm_mass\nscan=3\tAAA\t1\t2\n")
    with pytest.raises(ValueError):
        U._mgf_tags(p)


def test_pools_without_tryptic_search_are_not_scored():
    pools = pd.DataFrame({"pool": ["A", "B", "C"], "zips": ["a-tryptic.zip", "", None]})
    assert list(U.eligible(pools)) == [True, False, False]


def test_shared_identity_spectra_are_reported_not_scored():
    sc = U.score_spectra(TAGS, TRUTH, ks=(1, 5))
    sc.loc[sc["key"] == "scan=1", "size_label"] = "shared_identity"
    s = U.summarize(sc, by=["size_label"], ks=(1, 5)).set_index("size_label")
    assert s.loc["shared_identity", "spectra"] == 1 and s.loc["shared_identity", "scored"] == 0
    assert s.loc["size1", "spectra"] == 3 and s.loc["size1", "rank1_accuracy"] == 0.0


# --------------------------------------------------------------------------------- reserved splits, caching
def test_cli_accepts_reserved_splits_and_shared_identities_step():
    from fastag_bench.cli import build_parser
    ap = build_parser()
    for sp in ("reserved_2", "reserved_15", "reserved_16"):
        assert ap.parse_args(["unidentified", "pool-truth", "-c", "x.yaml", "--split", sp]).split == sp
    assert ap.parse_args(["unidentified", "shared-identities", "-c", "x.yaml"]).step == "shared-identities"


def test_cached_tags_needs_same_command_and_input(tmp_path):
    inp, out = tmp_path / "in.mgf", tmp_path / "run"
    out.mkdir()
    inp.write_text("BEGIN IONS\nEND IONS\n")
    tags = out / "tags.tsv"
    cmd = ["FASTag", "-in", str(inp), "-out", str(tags), "-tag_length", "3"]
    assert not U.cached_tags(tags, cmd, inp)  # nothing there
    tags.write_text("spectrum\ttag\n")
    (out / "command.txt").write_text(U._command_record(cmd, inp))
    assert U.cached_tags(tags, cmd, inp)
    assert not U.cached_tags(tags, cmd[:-1] + ["5"], inp)  # other profile args
    inp.write_text("BEGIN IONS\nPEPMASS=1\nEND IONS\n")  # rewritten input (e.g. another chimera seed)
    assert not U.cached_tags(tags, cmd, inp)
    # a record from before the check (no sha line): accepted only for an input older than the tags
    import os
    (out / "command.txt").write_text(" ".join(cmd) + "\n")
    os.utime(inp, (1, 1))
    assert U.cached_tags(tags, cmd, inp) and "# input sha256" in (out / "command.txt").read_text()
    (out / "command.txt").write_text(" ".join(cmd) + "\n")
    os.utime(inp, None)
    os.utime(tags, (1, 1))
    assert not U.cached_tags(tags, cmd, inp)


# --------------------------------------------------------------------------------- score_pool on a toy pool
from fastag_bench import pooltruth as T  # noqa: E402
from fastag_bench.tsv import write_tsv  # noqa: E402

TARGETS = ["AGHSVLK", "PEPTIDEK", "WYQENFK"]
SWAP = ["GAGSGTGVK", "TSTYSRSK"]
CARRY = ["NNQQGGHHK"]


def _mz(p, z=2):
    return (T.peptide_mass(p) + z * T.PROTON) / z


def _toy(tmp_path, with_carry_list=True):
    wd = tmp_path / "wd"
    for pool, peps in (("P", TARGETS), ("S", SWAP)) + ((("N", CARRY),) if with_carry_list else ()):
        d = wd / "pools" / pool
        d.mkdir(parents=True)
        write_tsv(pd.DataFrame({"peptide": peps}), d / "peptides.tsv", ["toy"])
        write_tsv(pd.DataFrame({"peptide": T.decoy_pool(peps, seed=1)}), d / "decoys.tsv", ["toy"])
    run = wd / "runs" / "P"
    meta = pd.DataFrame({"key": ["scan=1", "scan=2", "scan=3", "scan=4"],
                         "precursor_mz": [_mz("AGHSVLK"), _mz("PEPTIDEK"), 1234.5678, _mz(CARRY[0])],
                         "charge": [2, 2, 2, 2], "nce": [28.0] * 4})
    write_tsv(meta, run / "ms2_meta.tsv", ["toy"])
    for mode, rows in (("closed", [("scan=1", "AGHSVLK", "sp|X")]),
                       ("pool", [("scan=1", "AGHSVLK", "P|T00001"), ("scan=2", "PEPTIDEK", "P|T00002")])):
        f = run / "sage" / mode / "results.sage.tsv"
        f.parent.mkdir(parents=True)
        pd.DataFrame({"filename": "run.mzML", "scannr": [f"controllerType=0 controllerNumber=1 {k}" for k, _, _ in rows],
                      "peptide": [p for _, p, _ in rows], "proteins": [x for _, _, x in rows], "spectrum_q": 0.001,
                      "label": 1, "rank": 1}).to_csv(f, sep="\t", index=False)
    res, pref, total = S.peptide_masses("PEPTIDEK")
    t = run / "fastag" / "matched" / "tags.tsv"
    t.parent.mkdir(parents=True)
    pd.DataFrame({"spectrum": ["scan=2", "scan=2", "scan=1"], "tag": [res[2:5], "WWW", "WWW"],
                  "nterm_mass": [pref[2], 1.0, 1.0], "cterm_mass": [total - pref[5], 1.0, 1.0],
                  "evalue": [0.001, 0.5, 0.5]}).to_csv(t, sep="\t", index=False)
    cfg = {"work_dir": str(wd), "sage": {"fdr": 0.01},
           "unidentified": {"static": {"C": 57.021464}, "variable": {"M": [15.994915]}, "max_var": 1, "tol_ppm": 10.0,
                            "charges": [2, 3, 4], "iso": [0, 1], "swap_seed": 1, "profiles": {"matched": []}}}
    import collections
    return cfg, collections.namedtuple("R", "pool batch")("P", "b1")


def test_score_pool_arms_controls_and_pool_column(tmp_path):
    cfg, r = _toy(tmp_path)
    sc, ctl = U.score_pool(cfg, r, "S", ["N"], ["M"], shared=set(), log=lambda s: None)
    assert set(sc["arm"]) == set(U.ARMS) and set(sc["pool"]) == {"P"}
    tr = sc[sc.arm == "truth"].set_index("key")
    assert tr.loc["scan=1", "identification"] == "S0" and tr.loc["scan=2", "size_label"] == "size1"
    assert tr.loc["scan=3", "size_label"] == "no_pool_candidate" and tr.loc["scan=4", "n_carryover"] == 1
    assert tr.loc["scan=2", "top1"] == 1 and tr.loc["scan=2", "pool_hit"] == S.normalize_peptide("PEPTIDEK")
    dec = sc[sc.arm == "decoy"].set_index("key")
    assert dec.loc["scan=2", "n_candidates"] >= 1 and dec.loc["scan=2", "top1"] == 0  # its own shuffled decoy
    assert sc[sc.arm == "chance"].set_index("key").loc["scan=2", "n_candidates"] == 0  # no swap peptide fits
    assert ctl["s3_size1"] == 1 and ctl["s3_size1_with_own_decoy"] == 1 and ctl["s3_size1_with_swap_candidate"] == 0
    assert ctl["s3_with_carryover"] == 1 and ctl["carryover_unavailable"] == "M" and ctl["carryover_peptides"] == 1
    assert ctl["pool_agreement"] == 1.0 and not ctl["pool_excluded"]


def test_score_pool_refuses_missing_carryover_list(tmp_path):
    cfg, r = _toy(tmp_path, with_carry_list=False)
    with pytest.raises(ValueError, match="carryover"):
        U.score_pool(cfg, r, "S", ["N"], [], shared=set(), log=lambda s: None)


def test_shared_identities_read_from_frozen_config_with_list_check(tmp_path):
    cfg, r = _toy(tmp_path)
    sh, lists = tmp_path / "shared.tsv", tmp_path / "lists.tsv"
    cfg["unidentified"].update({"shared_tsv": str(sh), "pool_lists_tsv": str(lists)})
    with pytest.raises(FileNotFoundError):
        U._shared(cfg, ["P"])
    write_tsv(pd.DataFrame({"identity": [S.normalize_peptide("PEPTIDEK")], "splits": ["dev;test"]}), sh, ["toy"])
    write_tsv(pd.DataFrame({"pool": ["P"], "split": ["dev"], "peptides": [3], "sha256": [T.list_digest(TARGETS)]}),
              lists, ["toy"])
    assert U._shared(cfg, ["P"]) == {S.normalize_peptide("PEPTIDEK")}
    write_tsv(pd.DataFrame({"peptide": TARGETS + ["EXTRAK"]}), tmp_path / "wd" / "pools" / "P" / "peptides.tsv", ["toy"])
    with pytest.raises(ValueError, match="differs from the frozen"):
        U._shared(cfg, ["P"])
    # the shared identity is reported, not scored
    write_tsv(pd.DataFrame({"peptide": TARGETS}), tmp_path / "wd" / "pools" / "P" / "peptides.tsv", ["toy"])
    sc, _ = U.score_pool(cfg, r, "S", ["N"], [], log=lambda s: None)
    assert sc[(sc.arm == "truth") & (sc.key == "scan=2")]["size_label"].iloc[0] == "shared_identity"


def test_decoy_map_and_list_digest():
    d = T.decoy_pool(TARGETS, seed=1)
    m = T.decoy_map(TARGETS, d)
    assert set(m) == {S.normalize_peptide(p) for p in TARGETS}
    assert all(sorted(S.normalize_peptide(x)) == sorted(S.normalize_peptide(t)) for t in TARGETS for x in m[S.normalize_peptide(t)])
    assert T.list_digest(TARGETS) == T.list_digest(list(reversed(TARGETS)) + [TARGETS[0].lower()])
    with pytest.raises(ValueError):
        T.decoy_map(TARGETS, d[:-1])
