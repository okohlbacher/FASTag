"""sagecfg.py IN.json OUT.json [--fasta F] [--enzyme NAME] [--mzml P] : rewrite a FASTag Sage config."""
import json, sys
RULES = {  # cleave_at, restrict, c_terminal (FASTag's table; TrypChymo = ProteaseDB TrypChymo)
    "Trypsin": ("KR", "P", True), "Lys-C": ("K", "P", True), "Arg-C": ("R", "P", True),
    "Asp-N": ("D", None, False), "Glu-C": ("DE", None, True), "Chymotrypsin": ("FWYL", "P", True),
    "TrypChymo": ("FWYLKR", "P", True), "unspecific": ("", None, True)}
a = sys.argv[1:]
cfg = json.load(open(a[0]))
opts = dict(zip(a[2::2], a[3::2]))
if "--fasta" in opts: cfg["database"]["fasta"] = opts["--fasta"]
if "--mzml" in opts: cfg["mzml_paths"] = [opts["--mzml"]]
if "--enzyme" in opts:
    c, r, t = RULES[opts["--enzyme"]]
    e = cfg["database"]["enzyme"]
    e["cleave_at"], e["restrict"], e["c_terminal"] = c, r, t
    e.pop("semi_enzymatic", None)
json.dump(cfg, open(a[1], "w"), indent=2)
