#!/usr/bin/env python3
"""Unit tests of tools/census_ident.py (1.16 item 4) on hand-made tables: the exact label join (categories,
no_psm vs unmappable, wrong-run filename and precursor m/z, duplicate rank-1), the C++-equivalent features and
mid-ranks, the cluster down-weighting, the weighted AUC and top-10% precision.

    census_ident_tool_test.py <tools/census_ident.py>
"""
import importlib.util
import math
import os
import sys
import tempfile
import unittest

TOOL = sys.argv.pop(1) if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "tools",
                                                               "census_ident.py")
sys.path.insert(0, os.path.dirname(os.path.abspath(TOOL)))
SPEC = importlib.util.spec_from_file_location("ci", TOOL)
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)

CEN_HEAD = ["index", "spectrum", "rt", "precursor_mz", "charge_used"] + [f for f in ci.FEATURES
                                                                          if f not in ("precursor_mz", "charge_used")]
SAGE_HEAD = ["psm_id", "filename", "scannr", "rank", "label", "expmass", "charge", "spectrum_q",
             "sage_discriminant_score"]


def write(d, name, header, rows):
    p = os.path.join(d, name)
    with open(p, "w") as f:
        f.write("\t".join(header) + "\n")
        for r in rows:
            f.write("\t".join(map(str, r)) + "\n")
    return p


def cen_row(i, mz, z=2, rt=None):
    vals = {"index": i, "spectrum": f"scan={i}", "rt": rt if rt is not None else 10.0 * i, "precursor_mz": mz,
            "charge_used": z}
    return [vals.get(h, "") for h in CEN_HEAD]


def mass(mz, z):
    return (mz - ci.PROTON) * z


class Labels(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.cen = write(self.d, "c.tsv", CEN_HEAD, [cen_row(i, 500.0 + i) for i in range(1, 7)])

    def sage(self, rows, name="s.tsv"):
        return write(self.d, name, SAGE_HEAD, rows)

    def test_categories(self):
        s = self.sage([
            (1, "run.mzML", "scan=1", 1, 1, mass(501.0, 2), 2, 0.001, 9),   # accepted
            (2, "run.mzML", "scan=2", 1, 1, mass(502.0, 2), 2, 0.02, 5),    # target above q
            (3, "run.mzML", "scan=3", 1, -1, mass(503.0, 2), 2, 0.0, 8),    # decoy
            (4, "run.mzML", "scan=4", 2, 1, mass(504.0, 2), 2, 0.0, 7),     # rank 2 only: no_psm
            (5, "run.mzML", "scan=5", 1, 1, mass(505.0, 2), 2, 0.01, 6),    # boundary: accepted
        ])
        out, st = ci.labels(self.cen, s, "run.mzML", 0.01)
        self.assertEqual([r[1] for r in out], [1, 0, 0, 0, 1, 0])
        self.assertEqual([r[2] for r in out], ["accepted", "target_above_q", "decoy", "no_psm", "accepted", "no_psm"])
        self.assertEqual(st, {"rank1": 4, "mz_mismatch": 0})

    def test_unmappable_refused(self):
        s = self.sage([(1, "run.mzML", "scan=99", 1, 1, mass(501.0, 2), 2, 0.001, 9)])
        with self.assertRaisesRegex(ci.IdentError, "unmappable"):
            ci.labels(self.cen, s, "run.mzML", 0.01)

    def test_wrong_filename_refused(self):
        s = self.sage([(1, "other.mzML", "scan=1", 1, 1, mass(501.0, 2), 2, 0.001, 9)])
        with self.assertRaisesRegex(ci.IdentError, "wrong run"):
            ci.labels(self.cen, s, "run.mzML", 0.01)

    def test_wrong_run_by_precursor(self):
        # same native ids and file name, another run's precursors (renamed file)
        s = self.sage([(i, "run.mzML", f"scan={i}", 1, 1, mass(700.0 + i, 2), 2, 0.001, 9) for i in range(1, 7)])
        with self.assertRaisesRegex(ci.IdentError, "wrong run"):
            ci.labels(self.cen, s, "run.mzML", 0.01)

    def test_duplicate_rank1_refused(self):
        s = self.sage([(1, "run.mzML", "scan=1", 1, 1, mass(501.0, 2), 2, 0.001, 9),
                       (2, "run.mzML", "scan=1", 1, -1, mass(501.0, 2), 2, 0.001, 9)])
        with self.assertRaisesRegex(ci.IdentError, "two rank-1"):
            ci.labels(self.cen, s, "run.mzML", 0.01)

    def test_charge_from_psm(self):
        # a 3+ PSM of a spectrum the census calls 2+ (no header charge) is matched by its own m/z
        s = self.sage([(1, "run.mzML", "scan=1", 1, 1, mass(501.0, 3), 3, 0.001, 9)])
        out, st = ci.labels(self.cen, s, "run.mzML", 0.01)
        self.assertEqual(out[0][1], 1)
        self.assertEqual(st["mz_mismatch"], 0)


class Features(unittest.TestCase):
    def test_raw(self):
        self.assertEqual(ci.raw_feature(0, ""), -math.inf)
        self.assertEqual(ci.raw_feature(0, "0.001"), 3.0)
        self.assertEqual(ci.raw_feature(0, "0"), 400.0)
        self.assertEqual(ci.raw_feature(0, "-1"), -math.inf)
        self.assertEqual(ci.raw_feature(5, "17"), 17.0)
        self.assertEqual(ci.raw_feature(5, "x"), -math.inf)

    def test_mid_ranks(self):
        # as census_score_test 2.
        self.assertEqual(ci.mid_ranks([3, -math.inf, 1, 3, -math.inf]), [0.8, 0.2, 0.5, 0.8, 0.2])
        self.assertEqual(ci.mid_ranks([7]), [0.5])

    def test_logistic(self):
        m = {"intercept": -1.0, "coef": [2.0, 0.5] + [0.0] * 10}
        x = [1.0, 0.0] + [0.0] * 10
        self.assertAlmostEqual(ci.logistic(m, x), 1 / (1 + math.exp(-1.0)))


class Clusters(unittest.TestCase):
    def test_cluster(self):
        d = tempfile.mkdtemp()
        rows = [cen_row(1, 500.0, 2, 100.0), cen_row(2, 500.004, 2, 130.0),  # 8 ppm, 30 s: one cluster
                cen_row(3, 500.004, 2, 200.0),                                 # 100 s from the leader: own
                cen_row(4, 500.0, 3, 100.0),                                   # other charge: own
                cen_row(5, 500.01, 2, 100.0)]                                  # 20 ppm: own
        rows.append([("" if h in ("precursor_mz", "charge_used") else v) for h, v in zip(CEN_HEAD, cen_row(6, 1))])
        p = write(d, "c.tsv", CEN_HEAD, rows)
        h, r = ci.read_table(p)
        cid = ci.clusters(h, r, p)
        self.assertEqual(cid[0], cid[1])
        self.assertEqual(len({cid[i] for i in (0, 2, 3, 4, 5)}), 5)
        self.assertEqual(ci.cluster_weights(cid), [0.5, 0.5, 1.0, 1.0, 1.0, 1.0])


class Metrics(unittest.TestCase):
    def test_wauc(self):
        # scores 1..4, labels 0 1 0 1: pairs (pos>neg) = (2>1), (4>1), (4>3) of 4 -> 0.75
        self.assertEqual(ci.wauc([1, 2, 3, 4], [0, 1, 0, 1], [1, 1, 1, 1]), 0.75)
        # tie between a positive and a negative counts one half
        self.assertEqual(ci.wauc([1, 1], [0, 1], [1, 1]), 0.5)
        # weights: the negative at 3 weighs 3 -> (1*1 + 1*(1+3)) / (2 * 4) = 5/8... positives at 2 and 4:
        # pos 2 beats neg 1 (w1); pos 4 beats neg 1 and neg 3 (w 1 + 3); total (1 + 4) / (2 * 4)
        self.assertEqual(ci.wauc([1, 2, 3, 4], [0, 1, 0, 1], [1, 1, 3, 1]), 5 / 8)
        self.assertIsNone(ci.wauc([1, 2], [1, 1], [1, 1]))

    def test_top_precision(self):
        s = list(range(20))
        y = [0] * 18 + [1, 0]
        # top 10% of 20 = 2 rows: scores 19 (0) and 18 (1)
        self.assertEqual(ci.top_precision(s, y, [1] * 20), 0.5)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=1)
