#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage): append the frozen config and the registry rows (append-only; never rewrites).

    append_rows.py <acceptance/1.13 dir> prereg|result [result note]
"""
import hashlib, os, sys

ACC, KIND = sys.argv[1], sys.argv[2]
BIN = "07d4adb796ae595cd8907e16a428e8d8273a2f3f5a6640a2197d710ac12b2fa0"
BUNDLE = "-"  # a branch build, not a release bundle: the binary sha256 alone names it
OPTS = ("-census -census_ids <closed.idXML> -census_ids_fdr 0.01 -census_triage_evalue 0.01 -threads 8 (all else default);"
        " closed: SageAdapter 70cebcd144 + Sage 0.14.7, 10/20 ppm, Trypsin, fixed CAM, var Met-ox, IDScoreSwitcher "
        "spectrum_q -> q-value; semi/open second searches as census/scorers/run_census_triage.sh")
TABLES = ("UP000005640_9606.fasta:1f028a9ab2bca643c0e121c01ba3e05c92136beaa693a6197a32a025670df4bc,"
          "UP000005640_9606_td.fasta:281e4e25b05ddc125f2983c2941b38155dbd33d3d53f5f372e3ed88a9a1c5378,"
          "sage:d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625")
PH = hashlib.sha256(f"binary={BIN};bundle={BUNDLE};options={OPTS};tables={TABLES}".encode()).hexdigest()
man = f"{ACC}/manifests/census-triage.tsv"
MSHA = hashlib.sha256(open(man, "rb").read()).hexdigest()
REC = "2026-11-09"
REF = f"feat/b113-census (no src change vs origin/main 702b45c), FASTag.bin {BIN}"
PXDS = ",".join(sorted({l.split("\t")[3] for l in open(man) if l.startswith("#11\t")}))


def reg(row_id, kind, flags, notes):
    f = [row_id, kind, "#11", "census-triage", REF, PXDS, "acceptance/1.13/manifests/census-triage.tsv", MSHA, flags] + \
        [""] * 12 + [notes, REC, "acceptance/1.13/PREREG-census.md"]
    assert len(f) == 24
    with open(f"{ACC}/validation-registry.tsv", "a") as o:
        o.write("\t".join(f) + "\n")


if KIND == "prereg":
    with open(f"{ACC}/frozen-configs.tsv", "a") as o:
        o.write("\t".join(["CFG-census-triage-113", "#11", "triage", BIN, BUNDLE, OPTS, TABLES, PH, "frozen",
                           "PREREG-census.md (backlog 1.13 item 7); scored once on census-triage"]) + "\n")
    reg("HO-census-triage-113", "heldout_manifest", f"CFG-census-triage-113 [frozen] param_hash {PH}",
        "6 runs, 6 PRIDE projects (Q Exactive HCD DDA, human), drawn by census/scripts/select_census_heldout.py; "
        "disjoint from DEV (PXD003531, PXD014764); staged on node data (/scratch/kohlbach/b113/census/heldout)")
    reg("HO-census-triage-113-PREREG", "heldout_status", f"CFG-census-triage-113 [frozen] param_hash {PH}",
        "PREREG-census.md, manifest, frozen config and scorer (census/scorers/census_triage_eval.py sha256 "
        "f167f1b798741a97118fb8f2ca22c5c492a30993cd86730a9a1461a0b0e02400, SHA256SUMS) committed before any "
        "held-out run. E1 pooled rr >= 2.0 (CI lo >= 1.5), E2 every run rr > 1, E3 d vs n_peaks > 0 (CI lo > 0).")
elif KIND in ("runstart", "result"):
    reg(f"HO-census-triage-113-{KIND.upper()}", "heldout_status", f"CFG-census-triage-113 [frozen] param_hash {PH}", sys.argv[3])
else:
    sys.exit("prereg|runstart|result")
print(PH)
