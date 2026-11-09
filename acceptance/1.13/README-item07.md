# acceptance/1.13: #7 E7-03 release test (backlog 1.13 item 5, thread e703)

Branch `acceptance/1.13`, made from origin/acceptance/1.12 (7157c38). The rules of `acceptance/1.12/README.md`
("Rules that bind the runs") apply unchanged: each manifest and config is committed and in the registry before its
run, each config is scored exactly once, never tuned on held-out data, and the registry is append-only.

| Path | What |
|---|---|
| `PREREG-item07.md` | amendment 1 of `acceptance/1.12/PREREG-item07.md`: the 28 vendor files converted on Windows, CFG-07 `frozen` |
| `manifests/item07-E7-03.tsv` | the 1.12 manifest with the new conversions (`scripts/e703_amend_manifest.py`) |
| `inputs/staged/e703_win_conv.tsv` | per-file msconvert result (route, exit code, output, bytes, sha256) |
| `scripts/conv.ps1`, `scripts/list.tsv` | the conversion script and list run on flash (Windows) |
| `frozen-configs.tsv` | CFG-07, status `frozen` |
| `validation-registry.tsv` | the 1.13 rows (`HO-07-E7-03-a1*`, results row). The 1.12 rows stay in `acceptance/1.12/` |
| `results/item07/` | job script (`jobs/run_item07.sh`); the single scoring: `result.json`, `units.tsv`, `RESULT.md` (verdict **FAIL**) |

The scorer is the committed 1.12 one, unchanged: `acceptance/1.12/scorers/score_item07.py`, called with
`--acc acceptance/1.13`, so that it reads `acceptance/1.13/manifests/item07-E7-03.tsv`.
