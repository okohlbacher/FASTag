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
        # are outside U and must not enter).
        # FDR per cut: 0, 0, 0, 1/3, 1/4, 2/4; q (running min from the bottom): 0, 0, 0, 1/4, 1/4, 1/2.
        a, _ = self.one(fdr="subset")
        self.assertEqual((a["t_triage"], a["t_rest"]), (3, 0))  # s2 s3 s4; s3 is T here, not globally
        self.assertIsNone(a["rr"])
        a, _ = self.one(fdr="subset", q=0.25)  # s5 joins (q 1/4)
        self.assertEqual((a["t_triage"], a["t_rest"]), (3, 1))
        self.assertAlmostEqual(a["rr"], 3.0)
        # equal scores enter together: a decoy tied with the best target leaves nothing at 1%
        psms = {"x": (True, 0.0, 5.0), "y": (False, 0.0, 5.0), "z": (True, 0.0, 4.0)}
        self.assertEqual(cte.subset_truth(psms, {"x", "y", "z"}, 0.01), set())
        self.assertEqual(cte.subset_truth(psms, {"x", "y", "z"}, 0.5), {"x", "z"})
        self.assertEqual(cte.subset_truth(psms, {"x", "z"}, 0.01), {"x", "z"})  # y outside the subset
        with self.assertRaises(cte.EvalError):
            cte.subset_truth({"x": (True, 0.0, None)}, {"x"}, 0.01)

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
