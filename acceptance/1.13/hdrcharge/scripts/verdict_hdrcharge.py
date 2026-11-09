#!/usr/bin/env python3
"""hdrcharge (backlog #14) held-out verdict from the two score tables (PREREG-item14.md). Prints JSON.

as-given table (real headers): E1 pooled false_alarm <= 0.005 and its Wilson 95 % upper bound <= 0.005;
E2 pooled net_lo95 >= -1.0 (charges fixed minus broken per 1000 truth spectra, bootstrap 2.5 % bound).
perturbed table (every 5th scan's charge changed, perturb_charge.py): E3 pooled precision >= 0.90 and
sensitivity >= 0.10. E4 validity: every run in both tables has n >= 500 and FASTAG_RC/SAGE_RC 0 (checked by the
run script, passed as --rc-ok yes|no). PASS when E1, E2, E3 pass and E4 holds; FAIL when E4 holds and any of
E1-E3 fails; INCONCLUSIVE when E4 does not hold.
Usage: verdict_hdrcharge.py <asgiven result.tsv> <perturbed result.tsv> --rc-ok yes|no"""
import csv
import json
import sys


def table(p):
    with open(p) as f:
        return {r["run"]: r for r in csv.DictReader(f, delimiter="\t")}


def main():
    a, b = table(sys.argv[1]), table(sys.argv[2])
    rc_ok = sys.argv[sys.argv.index("--rc-ok") + 1] == "yes"
    runs = [k for k in a if k != "pooled" and not k.startswith("stratum:")]
    small = [k for k in runs if int(a[k]["n"]) < 500] + [k for k in b if k != "pooled" and not k.startswith("stratum:") and int(b[k]["n"]) < 500]
    pa, pb = a["pooled"], b["pooled"]
    f = lambda r, c: float(r[c])
    e1 = f(pa, "false_alarm") <= 0.005 and f(pa, "false_alarm_hi95") <= 0.005
    e2 = f(pa, "net_lo95") >= -1.0
    prec = f(pb, "precision")
    e3 = prec == prec and prec >= 0.90 and f(pb, "sensitivity") >= 0.10
    e4 = rc_ok and not small
    verdict = "INCONCLUSIVE" if not e4 else ("PASS" if e1 and e2 and e3 else "FAIL")
    print(json.dumps({"E1_false_alarm": pa["false_alarm"], "E1_hi95": pa["false_alarm_hi95"], "E1": "PASS" if e1 else "FAIL",
                      "E2_net_per_1000": pa["net_per_1000"], "E2_lo95": pa["net_lo95"], "E2": "PASS" if e2 else "FAIL",
                      "E3_precision": pb["precision"], "E3_sensitivity": pb["sensitivity"], "E3": "PASS" if e3 else "FAIL",
                      "E4_rc_ok": rc_ok, "E4_runs_below_500": small, "E4": "met" if e4 else "NOT MET",
                      "verdict": verdict}, indent=1))


if __name__ == "__main__":
    main()
