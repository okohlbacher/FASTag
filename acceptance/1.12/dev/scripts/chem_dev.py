#!/usr/bin/env python3
"""#3 DEV regeneration on the frozen RC (a117801): the 254 SDRF DEV runs (sdrf_truth_runs.tsv) with the options of
the paper's digest validation (fastag-digest-val/run_one.py, scripts/cluster/rerun190.py, nontryptic/nt_run190.sh);
only the binary, the passes and the output dirs change. FASTAG_FULL_PRECISION=1, FASTAG_DIGEST_DIR = the RC's
data/digest (the shipped tables at a117801).

Passes per run (termini passes on every run with an input; the 1.9.0 rerun ran them only where prose-auto had
C-terminal tags):
  B   termini, shipped v1 models: -tag_length 4 -subsample_fraction 0.25 -fragment_tolerance 20 ppm
      -digest_out B.digest.tsv -label_out B.label.tsv                         (CFG-03-base; #3a label_call rows)
  V0  as B plus -digest_models_version v2 -digest_detection shipped -digest_flank2 auto (the unfitted v2 prior
      table at a117801): v2 log-likelihoods for the port check, flank2 on the no-call runs
  C   the prose-auto mass-gap command (gap_cmd of runs.json; nt_runs.tsv for the 10 nontryptic_new runs: organism
      FASTA of the prose-auto panel) plus -massgap_out C.massgap.tsv -alkylation_out C.alkylation.tsv
  A   (later, --passes A) #3g on the whole run: the gap command without -subsample_fraction, -recon_out,
      -delta_out and -recon_min_length, its -recon_fasta passed as -alkylation_proteome, plus -alkylation_out
  NAME (later, --table NAME DIGEST_DIR ["extra options"]): as V0 with a candidate digest dir
Only DEV runs: the list is checked against every held-out manifest first (scripts/check_dev_inputs.py).
Usage: chem_dev.py <dev check tsv> <out dir> <workers> <threads> [--passes B,V0,C] [--table NAME DIR ["extra"]]"""
import csv, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RC = "/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag"
DIGEST = "/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/data/digest"
RUNS = "/ceph/ibmi/abi/oliver/fastag-digest-val/runs.json"
NT = "/ceph/ibmi/abi/oliver/jpr-bench/sdrf/nontryptic"
PANEL = "/ceph/ibmi/abi/oliver/prose-auto-20261029/panel"
WORK = Path("/dev/shm/kohlbach-chemdev")


def jobs(check):
    J = json.load(open(RUNS))
    nt = {}
    for l in open(f"{NT}/nt_runs.tsv"):
        f = l.rstrip("\n").split("\t")
        nt[(f[0], f[1][:-4])] = f[5]
    out = []
    for r in csv.DictReader(open(check), delimiter="\t"):
        if r["result"] != "PASS":
            continue
        s, acc, run = r["run_id"].split("__", 2)
        hit = [j for j in J if (j["set"], j["acc"], j["run"]) == (s, acc, run)]
        if hit:
            out.append({"name": r["run_id"], "input": hit[0]["input"], "gap_cmd": hit[0].get("gap_cmd")})
        else:
            org = nt[(acc, run)]
            inp = f"{NT}/mzML/{acc}/{run}.mzML"
            gap = ["FASTag", "-in", inp, "-out", "X", "-tag_length", "4", "-extension", "6", "-threads", "8",
                   "-recon_fasta", f"{PANEL}/{org}.fasta", "-recon_out", "X", "-delta_out", "X", "-recon_min_length",
                   "5", "-fixed_modifications", "-fragment_tolerance", "20.0", "-fragment_tolerance_unit", "ppm"]
            out.append({"name": r["run_id"], "input": inp, "gap_cmd": gap})
    return out


def run(cmd, log, env):
    t = time.time()
    with open(log, "w") as fh:
        rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    return rc, round(time.time() - t, 2)


def one(j, out, th, passes, table):
    o = out / j["name"]
    w = WORK / j["name"]
    o.mkdir(parents=True, exist_ok=True)
    w.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, FASTAG_FULL_PRECISION="1", FASTAG_DIGEST_DIR=DIGEST,
               OPENMS_TMPDIR="/dev/shm/kohlbach-tmp", TMPDIR="/dev/shm/kohlbach-tmp")
    env.pop("FASTAG_TAXONOMY_DIR", None)
    st = json.loads((o / "status.json").read_text()) if (o / "status.json").exists() else {"cmd": {}}
    term = [RC, "-in", j["input"], "-tag_length", "4", "-threads", str(th), "-subsample_fraction", "0.25",
            "-fragment_tolerance", "20.0", "-fragment_tolerance_unit", "ppm"]
    v2 = ["-digest_models_version", "v2", "-digest_detection", "shipped", "-digest_flank2", "auto"]
    todo = {}
    if "B" in passes:
        todo["B"] = term + ["-out", f"{w}/B.tags.tsv", "-digest_out", f"{o}/B.digest.tsv", "-label_out",
                            f"{o}/B.label.tsv"]
    if "V0" in passes:
        todo["V0"] = term + ["-out", f"{w}/V0.tags.tsv", "-digest_out", f"{o}/V0.digest.tsv"] + v2
    if "C" in passes and j.get("gap_cmd"):
        c = list(j["gap_cmd"])
        c[0] = RC
        for k, v in (("-out", f"{w}/C.tags.tsv"), ("-recon_out", f"{w}/C.recon.tsv"),
                     ("-delta_out", f"{w}/C.delta.tsv"), ("-threads", str(th))):
            c[c.index(k) + 1] = v
        todo["C"] = c + ["-massgap_out", f"{o}/C.massgap.tsv", "-alkylation_out", f"{o}/C.alkylation.tsv"]
    if "A" in passes and j.get("gap_cmd"):
        # #3g on the whole run: the gap command without its -subsample_fraction and without the recon/delta outputs,
        # its -recon_fasta given as -alkylation_proteome (the held-out rule: the SDRF organism's panel FASTA)
        c = list(j["gap_cmd"])
        c[0] = RC
        out_c, drop = [], {"-recon_out", "-delta_out", "-subsample_fraction"}
        i = 0
        while i < len(c):
            if c[i] in drop:
                i += 2
                continue
            if c[i] == "-recon_fasta":
                out_c += ["-alkylation_proteome", c[i + 1]]
                i += 2
                continue
            if c[i] == "-recon_min_length":
                i += 2
                continue
            out_c.append(c[i])
            i += 1
        out_c[out_c.index("-out") + 1] = f"{w}/A.tags.tsv"
        out_c[out_c.index("-threads") + 1] = str(th)
        todo["A"] = out_c + ["-alkylation_out", f"{o}/A.alkylation.tsv"]
    if table:
        # a candidate digest dir (v2 table, calibration) replaces the RC's through FASTAG_DIGEST_DIR
        name = table[0]
        todo[name] = term + ["-out", f"{w}/{name}.tags.tsv", "-digest_out", f"{o}/{name}.digest.tsv"] + v2 + table[2]
    for p, cmd in todo.items():
        if p in st and st[p][0] == 0 and (o / f"{p}.log").exists():
            continue
        e = dict(env)
        if table and p == table[0]:
            e["FASTAG_DIGEST_DIR"] = table[1]
        st[p] = list(run(cmd, o / f"{p}.log", e))
        st["cmd"][p] = cmd
    for f in os.listdir(w):
        os.remove(w / f)
    w.rmdir()
    (o / "status.json").write_text(json.dumps(st) + "\n")
    return j["name"], {k: v for k, v in st.items() if k != "cmd"}


def main():
    check, out, workers, th = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    passes = ["B", "V0", "C"]
    if "--passes" in sys.argv:
        passes = sys.argv[sys.argv.index("--passes") + 1].split(",")
    table = None
    if "--table" in sys.argv:
        # --table NAME DIGEST_DIR ["extra options"]: a digest dir holding the candidate digest_models_v2.tsv and
        # digest_calibration.tsv (other tables as the RC's), plus options such as -digest_min_confidence
        k = sys.argv.index("--table")
        extra = sys.argv[k + 3].split() if len(sys.argv) > k + 3 else []
        table = (sys.argv[k + 1], sys.argv[k + 2], extra)
        passes = []
    WORK.mkdir(parents=True, exist_ok=True)
    os.makedirs("/dev/shm/kohlbach-tmp", exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    J = jobs(check)
    with open(out / f"driver{'_' + table[0] if table else ''}.log", "a") as log:
        log.write(f"{time.strftime('%F %T')} start {len(J)} runs, passes {passes or table[0]}, {workers} x {th}\n")
        log.flush()
        with ThreadPoolExecutor(workers) as ex:
            for name, st in ex.map(lambda j: one(j, out, th, passes, table), J):
                log.write(f"{time.strftime('%T')} {name} {json.dumps(st)}\n")
                log.flush()
        log.write("DRIVER_DONE\n")


if __name__ == "__main__":
    main()
