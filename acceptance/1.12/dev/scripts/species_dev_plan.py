#!/usr/bin/env python3
"""Plan the #1/#10 DEV regeneration for a batch host (BinAC2) with exactly species_dev.py's commands.

For every DEV run (PASS rows of the dev check list) and every arm whose species.tsv is not yet in <runs dir>,
writes <plan dir>/<run_id>/meta.json (as species_dev.run_one) and <plan dir>/<run_id>/arms.tsv
(arm <TAB> shell-quoted argv). The argv is species_dev's: the RC wrapper path, the input under species/in, -out relative to
the run directory's parent as on data. Nothing is run here. The batch job (binac2_species_job.sh) executes the argv
inside an Ubuntu 24.04 container with the RC bundle, OpenMS and the env libraries bound at their data paths, with
cwd = /scratch/kohlbach/fastag112-dev, so the binary (c4c2ad67...) and every path are the same as on data.
Also writes <plan dir>/inputs.tsv: run_id, source path, size, basename (to copy into species/in).
Usage: species_dev_plan.py <dev check tsv> <runs dir as given to species_dev.py> <plan dir> <threads> [--both <arm>]"""
import json, shlex, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import species_dev as SD  # noqa: E402

devlist, out, plan, threads = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4])
arms = {"base": [], **SD.grid_tables()}
if "--both" in sys.argv:
    pt = sys.argv[sys.argv.index("--both") + 1]
    arms = {f"both_{pt}": arms[pt] + ["-species_orientation", "both"]}
ok = {l.split("\t")[0] for l in open(devlist).read().splitlines()[1:] if l.split("\t")[3] == "PASS"}
man = [r for r in SD.SP.load_manifest(SD.MANIFEST).to_dict("records") if r["run_id"] in ok]
names = [Path(r["mzml"]).name for r in man]
assert len(names) == len(set(names)), "input basenames collide in species/in"
plan.mkdir(parents=True, exist_ok=True)
n_arms = 0
with open(plan / "inputs.tsv", "w") as inp:
    inp.write("run_id\tsource\tsize\tname\n")
    for r in man:
        rid, src = r["run_id"], Path(r["mzml"])
        rd = out / rid
        todo = [a for a in arms if not (rd / a / "species.tsv").exists()]
        if not todo:
            continue
        an = SD.SP.ms2_analyzer(src)
        pd = plan / rid
        pd.mkdir(parents=True, exist_ok=True)
        (pd / "meta.json").write_text(json.dumps({"analyzer": an, "mzml": str(src), "size": src.stat().st_size}) + "\n")
        mz = SD.SCR / src.name
        with open(pd / "arms.tsv", "w") as fh:
            for a in todo:
                cmd = SD.SP.fastag_cmd(SD.RC, mz, rd / a, "default", r["label"], an, threads) + arms[a]
                fh.write(a + "\t" + shlex.join(cmd) + "\n")
                n_arms += 1
        inp.write(f"{rid}\t{src}\t{src.stat().st_size}\t{src.name}\n")
print(f"planned {n_arms} arms over {sum(1 for _ in open(plan / 'inputs.tsv')) - 1} runs")
