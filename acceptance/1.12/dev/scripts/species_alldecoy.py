#!/usr/bin/env python3
"""#1 DEV all-decoy run (PLAN-organism-chemistry #1, "Pre-freeze go/no-go on DEV": "an all-decoy run (decoys
treated as targets) must give empirical p roughly uniform (KS test, p > 0.01) before any held-out run"). This is
option 2 of the "Deviation: all-decoy check" section of PREREG-species-call.md. DEV data only; the frozen RC
binary (a117801, FASTag.bin c4c2ad67...) unchanged; nothing under src/ is touched.

Operationalisation (fixed in this file before any all-decoy run; the RC binary has no switch that treats its own
decoy tags as targets, so the targets are made decoys on the index side):
  - decoy index: the 50 reference proteomes that tax_k7.taxdb was built from (<taxid>.fasta, verified against
    /ceph/ibmi/abi/oliver/jpr-bench/species/proteomes.sha256), every protein's residues shuffled in place
    (Fisher-Yates, random.Random("fastag-1.12:#1:alldecoy:<taxid>:<ordinal>"), ordinal = 0-based protein position
    in its file; headers kept, composition and length kept), built with the RC buildtaxdb, k = 7. Every target hit
    is then a hit on a decoy sequence, so every genus in every run is a false genus by construction, while the
    call's own null (D = 5 decoy tags per evaluated tag, spill, BH) runs unchanged. The same nodes.dmp, names.dmp
    and species_call.tsv as the DEV regeneration (data:/scratch/kohlbach/fastag112-dev/tax).
  - provenance check: the same buildtaxdb on the unshuffled 50 proteomes must reproduce tax_k7.taxdb
    (34427bba...); recorded either way.
  - runs: the 47 DEV runs (lists/species_dev_check.tsv PASS rows, as species_dev.py), the same command lines as
    species_dev.py (fastag_bench.species.fastag_cmd, arm default, label fixed mods, 0.3 Da on ion-trap MS2,
    16 threads), FASTAG_TAXONOMY_DIR = the decoy tax dir. Arms:
      ad_g_0.01_0_10_off  -species_call decoy -species_call_params grid/g_0.01_0_10.tsv  (the go/no-go point of
                          PREREG-species-call.md; PRIMARY)
      ad_cand             -species_call decoy -species_call_params dev/species/fitted/species_call.tsv
                          -species_deconvolve  (the CFG-01-cand options; secondary, false presents only)
  The statistic is computed by fit_alldecoy.py (its header fixes it).

Usage:
  species_alldecoy.py proteomes <proteomes.sha256> <src dir> <out dir>
  species_alldecoy.py run <dev check tsv> <repo> <tax dir> <grid table> <fitted table> <out dir> <workers> <threads>
"""
import hashlib, json, os, random, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RC = "/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag"
FITTED_SHA = "c556d587297fddc20fe0128cb181d742c776936c0fa015b867a527d526bc305f"
SEED = "fastag-1.12:#1:alldecoy"


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def shuffle_fasta(src, dst, taxid):
    n, out, hdr, seq = 0, open(dst, "w"), None, []

    def flush():
        nonlocal n
        if hdr is None:
            return
        s = list("".join(seq))
        random.Random(f"{SEED}:{taxid}:{n}").shuffle(s)
        out.write(hdr + "\n")
        t = "".join(s)
        for i in range(0, len(t), 60):
            out.write(t[i:i + 60] + "\n")
        n += 1

    for line in open(src):
        line = line.rstrip("\n")
        if line.startswith(">"):
            flush()
            hdr, seq = line, []
        elif line:
            seq.append(line.strip())
    flush()
    out.close()
    return n


def cmd_proteomes(shalist, srcdir, outdir):
    srcdir, outdir = Path(srcdir), Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    rows = [l.split() for l in open(shalist) if l.strip()]
    sums = []
    for want, name in rows:
        src = srcdir / name
        got = sha256(src)
        if got != want:
            sys.exit(f"sha256 mismatch {src}: {got} != {want}")
        taxid = name[:-len(".fasta")]
        n = shuffle_fasta(src, outdir / name, taxid)
        sums.append(f"{sha256(outdir / name)}  {name}")
        print(f"{name}: {n} proteins shuffled", flush=True)
    (outdir / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    print(f"PROTEOMES_DONE {len(rows)}")


def cmd_run(check, repo, taxdir, grid, fitted, out, workers, threads):
    sys.path.insert(0, str(Path(repo) / "bench/fastag-bench/src"))
    from fastag_bench import species as SP  # noqa: E402
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if sha256(fitted) != FITTED_SHA:
        sys.exit(f"fitted table {fitted} is not {FITTED_SHA}")
    arms = {"ad_g_0.01_0_10_off": ["-species_call", "decoy", "-species_call_params", str(grid)],
            "ad_cand": ["-species_call", "decoy", "-species_call_params", str(fitted), "-species_deconvolve"]}
    ok = {l.split("\t")[0] for l in open(check).read().splitlines()[1:] if l.split("\t")[3] == "PASS"}
    man = [r for r in SP.load_manifest(Path(repo) / "bench/fastag-bench/config/species_runs.tsv").to_dict("records")
           if r["run_id"] in ok]
    prov = {"rc": RC, "rc_bin_sha256": sha256(RC + ".bin"), "taxdir": str(taxdir),
            "taxdir_sha256": {f: sha256(Path(taxdir) / f) for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp",
                                                                    "species_call.tsv")},
            "grid_table": str(grid), "grid_sha256": sha256(grid), "fitted_table": str(fitted),
            "fitted_sha256": FITTED_SHA, "runs": len(man), "arms": arms, "threads": threads}
    (out / "provenance.json").write_text(json.dumps(prov, indent=1) + "\n")
    env = dict(os.environ, FASTAG_TAXONOMY_DIR=str(taxdir), OPENMS_TMPDIR="/dev/shm/kohlbach-tmp",
               TMPDIR="/dev/shm/kohlbach-tmp")
    env.pop("FASTAG_DIGEST_DIR", None)
    os.makedirs("/dev/shm/kohlbach-tmp", exist_ok=True)
    log = open(out / "driver.log", "a")

    def one(r):
        rid, mz = r["run_id"], Path(r["mzml"])
        rd = out / rid
        rd.mkdir(parents=True, exist_ok=True)
        an = SP.ms2_analyzer(mz)
        (rd / "meta.json").write_text(json.dumps({"analyzer": an, "mzml": str(mz), "size": mz.stat().st_size}) + "\n")
        for arm, extra in arms.items():
            d = rd / arm
            if (d / "species.tsv").exists():
                continue
            d.mkdir(parents=True, exist_ok=True)
            c = SP.fastag_cmd(RC, mz, d, "default", r["label"], an, threads) + extra
            (d / "command.txt").write_text(" ".join(c) + "\n")
            t0 = time.time()
            with open(d / "run.log", "w") as fh:
                rc = subprocess.run(c, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
            (d / "time.json").write_text(json.dumps({"wall_s": round(time.time() - t0, 3), "returncode": rc}) + "\n")
            (d / "tags.tsv").unlink(missing_ok=True)
            if rc != 0:
                (d / "species.tsv").unlink(missing_ok=True)
            log.write(f"{time.strftime('%T')} {rid} {arm} rc {rc} {round(time.time() - t0, 1)} s\n")
            log.flush()
        return rid

    log.write(f"{time.strftime('%F %T')} start {len(man)} runs x {len(arms)} arms\n")
    log.flush()
    with ThreadPoolExecutor(workers) as ex:
        for rid in ex.map(one, man):
            log.write(f"{time.strftime('%T')} DONE {rid}\n")
            log.flush()
    log.write("DRIVER_DONE\n")
    log.close()


if __name__ == "__main__":
    if sys.argv[1] == "proteomes":
        cmd_proteomes(*sys.argv[2:5])
    elif sys.argv[1] == "run":
        a = sys.argv[2:]
        cmd_run(a[0], a[1], a[2], a[3], a[4], a[5], int(a[6]), int(a[7]))
    else:
        sys.exit(__doc__)
