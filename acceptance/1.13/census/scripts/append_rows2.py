#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage), second held-out test: append the frozen config and the registry rows (append-only).

    append_rows2.py <acceptance/1.13 dir> prereg|staged|result [note]
"""
import hashlib, sys

ACC, KIND = sys.argv[1], sys.argv[2]
BIN = "95a571728f3ce826ef81e0eedd37d6c8c5525b6c0bfefd2e98259299a683ea91"
BUNDLE = "-"  # a branch build, not a release bundle: the binary sha256 alone names it
OPTS = ("-census -census_ids <closed.idXML> -census_ids_fdr 0.01 -census_triage_evalue 0.01 -threads 8 (all else default);"
        " closed: SageAdapter 70cebcd144 + Sage 0.14.7, 10/20 ppm, Trypsin, fixed CAM, var Met-ox, IDScoreSwitcher "
        "spectrum_q -> q-value; semi/open second searches as census/scorers/census2/run_census_triage.sh")
TABLES = ("UP000005640_9606.fasta:1f028a9ab2bca643c0e121c01ba3e05c92136beaa693a6197a32a025670df4bc,"
          "UP000005640_9606_td.fasta:281e4e25b05ddc125f2983c2941b38155dbd33d3d53f5f372e3ed88a9a1c5378,"
          "sage:d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625")
PH = hashlib.sha256(f"binary={BIN};bundle={BUNDLE};options={OPTS};tables={TABLES}".encode()).hexdigest()
CFG = "CFG-census-triage2-113"
name = "census-triage-2.tsv" if KIND == "prereg" else "census-triage-2.staged.tsv"
man = f"{ACC}/manifests/{name}"
MSHA = hashlib.sha256(open(man, "rb").read()).hexdigest()
REC = "2026-11-10"
REF = f"feat/b113-census 16b50f4 (FASTag 1.12.2), binary {BIN}"
PXDS = ",".join(sorted({l.split("\t")[3] for l in open(man) if l.startswith("#11\t")}))


def reg(row_id, kind, notes):
    f = [row_id, kind, "#11", "census-triage-2", REF, PXDS, f"acceptance/1.13/manifests/{name}", MSHA,
         f"{CFG} [frozen] param_hash {PH}"] + [""] * 12 + [notes, REC, "acceptance/1.13/PREREG-census-2.md"]
    assert len(f) == 24
    with open(f"{ACC}/validation-registry.tsv", "a") as o:
        o.write("\t".join(f) + "\n")


if KIND == "prereg":
    with open(f"{ACC}/frozen-configs.tsv", "a") as o:
        o.write("\t".join([CFG, "#11", "triage2", BIN, BUNDLE, OPTS, TABLES, PH, "frozen",
                           "PREREG-census-2.md (backlog 1.13 item 7, second test); scored once on census-triage-2"]) + "\n")
    reg("HO-census-triage2-113", "heldout_manifest",
        "8 drawn runs, 8 PRIDE projects (Q Exactive HCD DDA, human), drawn by census/inputs2/select_census_heldout2.py; "
        "chosen and backup file per project; nothing downloaded at freeze; disjointness/census-triage-2.tsv")
    reg("HO-census-triage2-113-PREREG", "heldout_status",
        "PREREG-census-2.md, drawn manifest, frozen config and scorers (census/scorers/census2, SHA256SUMS; "
        "census_triage_eval.py sha256 8b1a2d10d9357d011ff5180e9bd6b698a7bfc20b19e7824e939bcf2600d2bbb4) committed before "
        "any held-out file is downloaded. E0 >= 6 of 8 runs evaluable, E1 pooled rr >= 2.0 (CI lo >= 1.5), "
        "E2 rr > 1 in every evaluable run, E3 d vs n_peaks > 0 (CI lo > 0).")
elif KIND in ("staged", "result"):
    reg(f"HO-census-triage2-113-{KIND.upper()}", "heldout_status", sys.argv[3])
else:
    sys.exit("prereg|staged|result")
print(PH)
