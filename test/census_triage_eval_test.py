#!/usr/bin/env python3
"""Unit tests of tools/census_triage_eval.py on hand-made census and Sage tables (expected values counted by hand).

    census_triage_eval_test.py <tools/census_triage_eval.py>
"""
import importlib.util
import math
import os
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("cte", sys.argv.pop(1) if len(sys.argv) > 1 else
                                              os.path.join(os.path.dirname(__file__), "..", "tools",
                                                           "census_triage_eval.py"))
cte = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cte)

CEN_HEAD = ["index", "spectrum", "n_peaks", "n_edges", "status", "best_evalue", "identified", "triage"]
SAGE_HEAD = ["psm_id", "filename", "scannr", "rank", "label", "spectrum_q", "sage_discriminant_score"]


def write(d, name, header, rows):
    p = os.path.join(d, name)
    with open(p, "w") as f:
        f.write("\t".join(header) + "\n")
        for r in rows:
            f.write("\t".join(map(str, r)) + "\n")
    return p


# Run A: 10 census rows.
#   s0 identified 1 (outside U)          s5 identified 0, triage 0, E 0.5
#   s1 unknown (empty identified)        s6 identified 0, triage 0, no tag (empty E)
#   s2 identified 0, triage 1, E 1e-5    s7 identified 0, triage 0, E 0.02
#   s3 identified 0, triage 1, E 1e-3    s8 identified 0, triage 1, E 0.01 (boundary, triage 1 as written)
#   s4 identified 0, triage 1, E 1e-4    s9 identified 0, triage 0, E 0.9
# Second search truth (rank 1, target, q <= 0.01): s1, s2, s4, s5 (s0, outside U, a decoy with the top score).
#   s3 target at q 0.0101 (not T), s7 decoy at q 0 (not T), s9 rank 2 only (not T), s8 not reported.
A_CEN = [
    (0, "s0", 50, 9, "tagged", "1e-09", "1", "0"),
    (1, "s1", 40, 8, "tagged", "1e-06", "", ""),
    (2, "s2", 75, 7, "tagged", "1e-05", "0", "1"),
    (3, "s3", 80, 6, "tagged", "0.001", "0", "1"),
    (4, "s4", 70, 5, "tagged", "0.0001", "0", "1"),
    (5, "s5", 90, 4, "tagged", "0.5", "0", "0"),
    (6, "s6", 5, 0, "no_tags", "", "0", "0"),
    (7, "s7", 70, 3, "tagged", "0.02", "0", "0"),
    (8, "s8", 20, 2, "tagged", "0.01", "0", "1"),
    (9, "s9", 20, 1, "tagged", "0.9", "0", "0"),
]
A_SAGE = [
    (1, "a.mzML", "s0", 1, -1, 0.0, 20),
    (2, "a.mzML", "s1", 1, 1, 0.001, 19),
    (3, "a.mzML", "s2", 1, 1, 0.01, 10),
    (4, "a.mzML", "s3", 1, 1, 0.0101, 9),
    (5, "a.mzML", "s4", 1, 1, 0.005, 8),
    (6, "a.mzML", "s5", 1, 1, 0.002, 6),
    (7, "a.mzML", "s7", 1, -1, 0.0, 7),
    (8, "a.mzML", "s9", 2, 1, 0.0, 30),
    (9, "a.mzML", "s9", 1, -1, 0.5, 5),
]


class Tests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = self.t.name
        write(self.d, "a.census.tsv", CEN_HEAD, A_CEN)
        write(self.d, "a.sage.tsv", SAGE_HEAD, A_SAGE)

    def tearDown(self):
        self.t.cleanup()

    def runs(self, rows, head=("run", "census", "second", "mzml")):
        return write(self.d, "runs.tsv", head, rows)

    def one(self, **kw):
        res = dict(cte.evaluate(self.runs([("A", "a.census.tsv", "a.sage.tsv", "a.mzML")]), boot=0, **kw))
        return res["A"], res["pooled"]

    def test_counts_by_hand(self):
        a, p = self.one()
        # U = s2..s9 (8 rows), triage s2 s3 s4 s8 (4), rest s5 s6 s7 s9 (4); T in U = s2 s4 s5.
        self.assertEqual((a["n_unknown"], a["n_u"], a["n_triage"], a["n_rest"]), (1, 8, 4, 4))
        self.assertEqual((a["t_triage"], a["t_rest"]), (2, 1))
        self.assertAlmostEqual(a["p_triage"], 0.5)
        self.assertAlmostEqual(a["p_rest"], 0.25)
        self.assertAlmostEqual(a["rr"], 2.0)
        self.assertAlmostEqual(a["recall"], 2 / 3)
        self.assertEqual(a["second_rank1"], 8)   # s0 s1 s2 s3 s4 s5 s7 s9
        self.assertEqual(a["second_true_global"], 4)    # s1 s2 s4 s5 (s0 is a decoy)
        self.assertEqual(a["t_u"], 3)
        self.assertEqual(p["n_runs"], 1)
        self.assertEqual(p["n_u"], 8)

    def test_baseline_top_k_with_ties(self):
        a, _ = self.one(baselines=("n_peaks", "n_edges"))
        # n_peaks in U: s5 90, s3 80, s2 75, s4 70 (index 4), s7 70 (index 7), ... The tie at the cut goes to the
        # lower index: top 4 = s5 s3 s2 s4, T = s5 s2 s4.
        self.assertEqual(a["t_top_n_peaks"], 3)
        self.assertAlmostEqual(a["p_top_n_peaks"], 0.75)
        self.assertAlmostEqual(a["d_n_peaks"], 0.5 - 0.75)
        # n_edges in U: s2 7, s3 6, s4 5, s5 4 -> T = s2 s4 s5.
        self.assertEqual(a["t_top_n_edges"], 3)
        self.assertAlmostEqual(a["d_n_edges"], 0.5 - 0.75)

    def test_q_threshold_is_inclusive(self):
        a, _ = self.one(q=0.0101)  # s3 becomes T
        self.assertEqual(a["t_triage"], 3)
        a, _ = self.one(q=0.009)   # s2 (q 0.01) drops out
        self.assertEqual(a["t_triage"], 1)

    def test_subset_fdr(self):
        # rank-1 PSMs of U by score: s2 10 T, s3 9 T, s4 8 T, s7 7 D, s5 6 T, s9 5 D (s0, a decoy at 20, and s1
        # are outside U and must not enter). FDR = (D + 1) / T per cut: 1, 1/2, 1/3, 2/3, 2/4, 3/4;
        # q (running min from the bottom): 1/3, 1/3, 1/3, 1/2, 1/2, 3/4.
        a, _ = self.one(fdr="subset")
        self.assertEqual((a["t_triage"], a["t_rest"]), (0, 0))  # nothing at 1% in so small a set
        self.assertIsNone(a["rr"])                              # no hit in either group: undefined
        a, _ = self.one(fdr="subset", q=0.34)
        self.assertEqual((a["t_triage"], a["t_rest"]), (3, 0))  # s2 s3 s4; s3 is a hit here, not globally
        self.assertEqual(a["rr"], math.inf)                     # no rest hit: inf, not undefined
        a, _ = self.one(fdr="subset", q=0.5)                    # s5 joins (q 1/2)
        self.assertEqual((a["t_triage"], a["t_rest"]), (3, 1))
        self.assertAlmostEqual(a["rr"], 3.0)
        self.assertEqual((a["u_in_second"], a["triage_in_second"], a["rest_in_second"]), (6, 3, 3))
        # equal scores enter together: x T and y D tied at the top, z T below. (D+1)/T: 2, 1 -> q 1, 1.
        psms = {"x": (True, 0.0, 5.0), "y": (False, 0.0, 5.0), "z": (True, 0.0, 4.0)}
        self.assertEqual(cte.subset_truth(psms, {"x", "y", "z"}, 0.9), set())
        self.assertEqual(cte.subset_truth(psms, {"x", "y", "z"}, 1.0), {"x", "z"})
        self.assertEqual(cte.subset_truth(psms, {"x", "z"}, 0.5), {"x", "z"})  # y outside the subset: 1, 1/2
        # A tie whose outcome depends on grouping: targets a, b and decoy c tied at 5, target z at 4. Grouped:
        # (D+1)/T = 2/2 at the tie, 2/3 with z -> q 2/3 for all. Taken one by one in the order a b c z, the cut
        # a b alone would give 1/2 and admit a, b at q 0.6; in the order c a b z it would not. The result must be
        # the grouped one in every input order (sub is built from the iteration order of the ids).
        import itertools
        tp = {"a": (True, 0.0, 5.0), "b": (True, 0.0, 5.0), "c": (False, 0.0, 5.0), "z": (True, 0.0, 4.0)}
        for order in itertools.permutations(["a", "b", "c", "z"]):
            self.assertEqual(cte.subset_truth(tp, list(order), 0.6), set(), order)
            self.assertEqual(cte.subset_truth(tp, list(order), 2 / 3), {"a", "b", "z"}, order)
        # one target and no decoy is not a 1% discovery under (D+1)/T
        self.assertEqual(cte.subset_truth({"x": (True, 0.0, 5.0)}, {"x"}, 0.01), set())
        with self.assertRaises(cte.EvalError):
            cte.subset_truth({"x": (True, 0.0, None)}, {"x"}, 0.01)

    def test_pooled_rr_is_ratio_of_sums(self):
        # A (n_tri 10, t 10; n_rest 10, t 1), B (1000, 100; 1000, 100): pooled rr 110/1010 / (101/1010) = 110/101,
        # not the mean of the run rr's (10 and 1).
        rows_a = [(i, f"a{i}", 1, 1, "tagged", "1e-5", "0", "1") for i in range(10)] + \
                 [(10 + i, f"a{10 + i}", 1, 1, "tagged", "0.5", "0", "0") for i in range(10)]
        sage_a = [(i, "a.mzML", f"a{i}", 1, 1, 0.0, 1) for i in range(11)] + \
                 [(11 + i, "a.mzML", f"a{11 + i}", 1, -1, 0.9, 1) for i in range(9)]
        rows_b = [(i, f"b{i}", 1, 1, "tagged", "1e-5", "0", "1") for i in range(1000)] + \
                 [(1000 + i, f"b{1000 + i}", 1, 1, "tagged", "0.5", "0", "0") for i in range(1000)]
        sage_b = [(i, "b.mzML", f"b{i}", 1, 1 if i % 1000 < 100 else -1, 0.0 if i % 1000 < 100 else 0.9, 1)
                  for i in range(2000)]
        write(self.d, "pa.census.tsv", CEN_HEAD, rows_a)
        write(self.d, "pa.sage.tsv", SAGE_HEAD, sage_a)
        write(self.d, "pb.census.tsv", CEN_HEAD, rows_b)
        write(self.d, "pb.sage.tsv", SAGE_HEAD, sage_b)
        rs = self.runs([("A", "pa.census.tsv", "pa.sage.tsv", ""), ("B", "pb.census.tsv", "pb.sage.tsv", "")])
        res = dict(cte.evaluate(rs, boot=300, seed=3))
        self.assertAlmostEqual(res["A"]["rr"], 10.0)
        self.assertAlmostEqual(res["B"]["rr"], 1.0)
        self.assertAlmostEqual(res["pooled"]["rr"], 110 / 101)
        # resamples: AA 10, BB 1, AB 110/101 -> the interval lies in [1, 10]; d_n_peaks of each resample is in
        # [p_tri - p_top]: every row has n_peaks 1, so the top-k is the first k by index = the triage rows: d = 0.
        p = res["pooled"]
        self.assertGreaterEqual(p["rr_ci_lo"], 1.0 - 1e-12)
        self.assertLessEqual(p["rr_ci_hi"], 10.0 + 1e-12)
        self.assertEqual((p["d_n_peaks_ci_lo"], p["d_n_peaks_ci_hi"]), (0.0, 0.0))
        self.assertEqual(p["rr_boot_n"] + p["rr_boot_undefined"], 300)
        other = dict(cte.evaluate(rs, boot=300, seed=4))["pooled"]
        same = dict(cte.evaluate(rs, boot=300, seed=3))["pooled"]
        self.assertEqual((same["rr_ci_lo"], same["rr_ci_hi"]), (p["rr_ci_lo"], p["rr_ci_hi"]))
        self.assertTrue(cte.percentile([1.0, 2.0, math.inf], 0.975) == math.inf)
        self.assertIsNotNone(other["rr_ci_hi"])

    def test_bootstrap_keeps_inf_and_baseline_interval(self):
        # Six runs, each: 10 triage rows (5 hits, n_peaks 1), 10 rest rows (n_peaks 2, no hit) except run 6 (one rest
        # hit). Run rr = inf (runs 1-5) or 5 (run 6); a resample without run 6 has rr inf and must be kept.
        # Baseline n_peaks picks the 10 rest rows: d = 0.5 - 0 (runs 1-5) or 0.5 - 0.1 (run 6), so the d interval
        # lies in [0.4, 0.5] and is not [0, 0].
        runs = []
        for r in range(6):
            cen = [(i, f"r{r}t{i}", 1, 1, "tagged", "1e-5", "0", "1") for i in range(10)] + \
                  [(10 + i, f"r{r}r{i}", 2, 1, "tagged", "0.5", "0", "0") for i in range(10)]
            hits = [f"r{r}t{i}" for i in range(5)] + ([f"r{r}r0"] if r == 5 else [])
            sage = [(k, "x.mzML", sid, 1, 1, 0.0, 1) for k, sid in enumerate(hits)] + \
                   [(100 + i, "x.mzML", f"r{r}t{i}", 1, -1, 0.9, 1) for i in range(5, 10)]
            write(self.d, f"bs{r}.census.tsv", CEN_HEAD, cen)
            write(self.d, f"bs{r}.sage.tsv", SAGE_HEAD, sage)
            runs.append((f"R{r}", f"bs{r}.census.tsv", f"bs{r}.sage.tsv", ""))
        p = dict(cte.evaluate(self.runs(runs), boot=2000, seed=11))["pooled"]
        self.assertAlmostEqual(p["rr"], 30.0)
        self.assertEqual(p["rr_ci_hi"], math.inf)       # resamples without run 6
        self.assertEqual(p["rr_boot_undefined"], 0)
        self.assertEqual(p["rr_boot_n"], 2000)
        # a resample holding run 6 k times has rr 30 / k: the lower bound is one of 30, 15, 10, 7.5, 6, 5
        self.assertTrue(any(abs(p["rr_ci_lo"] - 30 / k) < 1e-9 for k in range(1, 7)), p["rr_ci_lo"])
        self.assertGreater(p["d_n_peaks_ci_lo"], 0.39)                  # 0.5 - k / 60
        self.assertLess(p["d_n_peaks_ci_lo"], p["d_n_peaks_ci_hi"])
        self.assertLessEqual(p["d_n_peaks_ci_hi"], 0.5 + 1e-12)
        self.assertAlmostEqual(p["d_n_peaks"], 0.5 - 1 / 60)

    def test_percentile_levels(self):
        # linear interpolation at (n - 1) p: positions 0.1 and 3.9 of [0, 10, 20, 30, 40]
        self.assertAlmostEqual(cte.percentile([40.0, 0.0, 20.0, 10.0, 30.0], 0.025), 1.0)
        self.assertAlmostEqual(cte.percentile([40.0, 0.0, 20.0, 10.0, 30.0], 0.975), 39.0)
        self.assertEqual(cte.percentile([7.0], 0.025), 7.0)
        self.assertIsNone(cte.percentile([], 0.5))

    def test_bootstrap_exact_interval(self):
        # Six runs r = 0..5, each 10 triage rows (n_peaks 1, r + 1 hits) and 10 rest rows (n_peaks 2, one hit).
        # A resample of runs k_1..k_6 has rr = sum(k + 1) / 6 and d_n_peaks = (sum(k + 1) - 6) / 60 (the n_peaks
        # top-10 is the rest). The resamples are recomputed here from random.Random(seed) drawing run indices as
        # the scorer does, and the interval must be the exact 2.5% / 97.5% interpolated percentiles of them.
        import random
        import statistics
        runs = []
        for r in range(6):
            cen = [(i, f"e{r}t{i}", 1, 1, "tagged", "1e-5", "0", "1") for i in range(10)] + \
                  [(10 + i, f"e{r}r{i}", 2, 1, "tagged", "0.5", "0", "0") for i in range(10)]
            hits = [f"e{r}t{i}" for i in range(r + 1)] + [f"e{r}r0"]
            sage = [(k, "x.mzML", sid, 1, 1, 0.0, 1) for k, sid in enumerate(hits)] + \
                   [(100 + i, "x.mzML", f"e{r}t{i}", 1, -1, 0.9, 1) for i in range(r + 1, 10)]
            write(self.d, f"ex{r}.census.tsv", CEN_HEAD, cen)
            write(self.d, f"ex{r}.sage.tsv", SAGE_HEAD, sage)
            runs.append((f"E{r}", f"ex{r}.census.tsv", f"ex{r}.sage.tsv", ""))
        rs = self.runs(runs)
        for seed, n in ((5, 40), (6, 40), (17, 333)):
            rng = random.Random(seed)
            rr, d = [], []
            for _ in range(n):
                ks = [rng.randrange(6) for _ in range(6)]
                hit = sum(k + 1 for k in ks)
                rr.append(hit / 6)
                d.append((hit - 6) / 60)
            p = dict(cte.evaluate(rs, boot=n, seed=seed))["pooled"]
            for key, vals in (("rr", rr), ("d_n_peaks", d)):
                qs = statistics.quantiles(vals, n=40, method="inclusive")
                self.assertAlmostEqual(p[f"{key}_ci_lo"], qs[0], places=12, msg=(seed, key))
                self.assertAlmostEqual(p[f"{key}_ci_hi"], qs[-1], places=12, msg=(seed, key))
                self.assertEqual(p[f"{key}_boot_n"], n)

    def test_baseline_tie_independent_of_row_order(self):
        write(self.d, "rev.census.tsv", CEN_HEAD, list(reversed(A_CEN)))
        res = dict(cte.evaluate(self.runs([("A", "rev.census.tsv", "a.sage.tsv", "a.mzML")]), boot=0))
        self.assertEqual(res["A"]["t_top_n_peaks"], 3)  # s4 (index 4) wins the tie with s7 (index 7)

    def test_quoted_sage_fields(self):
        q = [list(r) for r in A_SAGE]
        for r in q:
            r[2] = '"' + r[2] + '"'
        write(self.d, "q.sage.tsv", SAGE_HEAD, q)
        res = dict(cte.evaluate(self.runs([("A", "a.census.tsv", "q.sage.tsv", "a.mzML")]), boot=0))
        self.assertEqual((res["A"]["t_triage"], res["A"]["t_rest"]), (2, 1))

    def test_auroc(self):
        a, _ = self.one()
        # scores in U: s2 5, s3 3, s4 4, s5 0.301, s6 -inf, s7 1.699, s8 2, s9 0.0458; T = s2 s4 s5.
        # Positives' ranks (ascending): s6 1, s9 2, s5 3, s7 4, s8 5, s3 6, s4 7, s2 8 -> 3 + 7 + 8 = 18.
        self.assertAlmostEqual(a["auroc_neglog10_evalue"], (18 - 6) / 15)
        self.assertAlmostEqual(cte.auroc([1, 1, 2], [0, 1, 1]), 0.75)
        self.assertIsNone(cte.auroc([1, 2], [1, 1]))
        self.assertEqual(cte.score_key(""), -math.inf)
        self.assertEqual(cte.score_key("0"), math.inf)

    def test_pooling_and_bootstrap(self):
        write(self.d, "b.census.tsv", CEN_HEAD, [
            (0, "x0", 9, 1, "tagged", "1e-5", "0", "1"),
            (1, "x1", 8, 1, "tagged", "1e-5", "0", "1"),
            (2, "x2", 7, 1, "tagged", "0.5", "0", "0"),
            (3, "x3", 6, 1, "tagged", "0.5", "0", "0"),
        ])
        write(self.d, "b.sage.tsv", SAGE_HEAD, [(1, "b.mzML", "x0", 1, 1, 0.0, 3), (2, "b.mzML", "x2", 1, 1, 0.0, 2)])
        rs = self.runs([("A", "a.census.tsv", "a.sage.tsv", "a.mzML"), ("B", "b.census.tsv", "b.sage.tsv", "b.mzML")])
        res = dict(cte.evaluate(rs, boot=500, seed=7))
        p = res["pooled"]
        # pooled: triage 4 + 2 = 6 with T 2 + 1 = 3; rest 4 + 2 = 6 with T 1 + 1 = 2 -> rr 1.5.
        self.assertEqual((p["n_triage"], p["t_triage"], p["n_rest"], p["t_rest"]), (6, 3, 6, 2))
        self.assertAlmostEqual(p["rr"], 1.5)
        self.assertEqual(p["n_runs"], 2)
        # rr of run A alone 2.0, of B alone 1.0: every resample lies in [1, 2].
        self.assertGreaterEqual(p["rr_ci_lo"], 1.0 - 1e-12)
        self.assertLessEqual(p["rr_ci_hi"], 2.0 + 1e-12)
        self.assertLess(p["rr_ci_lo"], p["rr_ci_hi"])
        res2 = dict(cte.evaluate(rs, boot=500, seed=7))
        self.assertEqual(res2["pooled"]["rr_ci_lo"], p["rr_ci_lo"])  # deterministic for a seed

    def test_refusals(self):
        with self.assertRaises(cte.EvalError):  # second search of another file
            cte.evaluate(self.runs([("A", "a.census.tsv", "a.sage.tsv", "other.mzML")]), boot=0)
        with self.assertRaises(cte.EvalError):  # duplicate run label
            cte.evaluate(self.runs([("A", "a.census.tsv", "a.sage.tsv", ""), ("A", "a.census.tsv", "a.sage.tsv", "")]),
                         boot=0)
        write(self.d, "dup.sage.tsv", SAGE_HEAD, [(1, "a.mzML", "s2", 1, 1, 0.0, 1), (2, "a.mzML", "s2", 1, 1, 0.0, 1)])
        with self.assertRaises(cte.EvalError):  # two rank-1 rows for one spectrum
            cte.evaluate(self.runs([("A", "a.census.tsv", "dup.sage.tsv", "")]), boot=0)
        write(self.d, "noids.census.tsv", CEN_HEAD[:-2], [r[:-2] for r in A_CEN])
        with self.assertRaises(cte.EvalError):  # census written without -census_ids
            cte.evaluate(self.runs([("A", "noids.census.tsv", "a.sage.tsv", "")]), boot=0)
        bad = [list(r) for r in A_CEN]
        bad[2][7] = ""
        write(self.d, "bad.census.tsv", CEN_HEAD, bad)
        with self.assertRaises(cte.EvalError):  # identified 0 must carry triage 0 or 1
            cte.evaluate(self.runs([("A", "bad.census.tsv", "a.sage.tsv", "")]), boot=0)
        write(self.d, "nojoin.sage.tsv", SAGE_HEAD, [(1, "a.mzML", "zz", 1, 1, 0.0, 1)])
        with self.assertRaises(cte.EvalError):  # no U spectrum joins the second search
            cte.evaluate(self.runs([("A", "a.census.tsv", "nojoin.sage.tsv", "")]), boot=0)
        nan = [list(r) for r in A_SAGE]
        nan[3][6] = "nan"
        write(self.d, "nan.sage.tsv", SAGE_HEAD, nan)
        with self.assertRaises(cte.EvalError):  # non-finite discriminant
            cte.evaluate(self.runs([("A", "a.census.tsv", "nan.sage.tsv", "")]), boot=0)
        nob = [list(r) for r in A_CEN]
        nob[3][2] = ""
        write(self.d, "nob.census.tsv", CEN_HEAD, nob)
        with self.assertRaises(cte.EvalError):  # empty baseline value in U
            cte.evaluate(self.runs([("A", "nob.census.tsv", "a.sage.tsv", "")]), boot=0)

    def test_cli_output(self):
        rs = self.runs([("A", "a.census.tsv", "a.sage.tsv", "a.mzML")])
        out = os.path.join(self.d, "out.tsv")
        self.assertEqual(cte.main([rs, "--boot", "0", "--out", out]), 0)
        with open(out) as f:
            lines = f.read().splitlines()
        self.assertEqual(lines[0], "scope\tkey\tvalue")
        kv = {tuple(l.split("\t")[:2]): l.split("\t")[2] for l in lines[1:]}
        self.assertEqual(kv[("A", "rr")], "2.0")
        self.assertEqual(kv[("pooled", "t_triage")], "2")
        self.assertEqual(cte.main([self.runs([("A", "a.census.tsv", "a.sage.tsv", "x.mzML")]), "--boot", "0",
                                   "--out", out]), 2)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], "-v"])
