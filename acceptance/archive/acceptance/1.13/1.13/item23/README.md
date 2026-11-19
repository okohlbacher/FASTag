# item23: backlog 23 (digqual), -digest_quality vs Sage (descriptive)

| File | What |
|---|---|
| `../PREREG-item23.md` | binary, options, data, truth, endpoints, scorer (committed before the eval run) |
| `../manifests/item23-digqual.tsv` | 48 runs: split dev (1), eval (35), excluded_itms (11); mzML, Sage results and sage.json sha256 |
| `scripts/build_manifest.py` | selection rule (header) and manifest build |
| `scripts/run_eval.sh` | the FASTag runs of one split with the frozen binary |
| `scorer/score_digqual.py` | the scorer (standard library) |
| `dev/` | the DEV run (PXD003531_QE_NO_03), scored with the same scorer |
| `results/` | the single eval scoring (added after the run) |

Work dir: `data:/scratch/kohlbach/b113/digqual/eval` (frozen binary and digest data in `frozen/`).
