"""Sage ground truth with the harness configuration (fastag_bench.sage.sage_config), for the de novo task."""
import sys, json
from pathlib import Path
from fastag_bench.config import load_bench_config, load_datasets, select
from fastag_bench.sage import sage_config, write_sage_config
ds_id, mzml, fasta, out = sys.argv[1:5]
cfg = load_bench_config(None)
ds = select(load_datasets("/ceph/ibmi/abi/oliver/jpr-bench/denovo/fastag-bench/datasets.yaml"), [ds_id], None)[0]
c = sage_config(ds, Path(fasta).resolve(), [Path(mzml).resolve()], cfg["sage"])
write_sage_config(Path(out) / "sage.json", c)
print(json.dumps(c["database"]["static_mods"]), json.dumps(c["database"]["variable_mods"]), c["database"]["enzyme"])
