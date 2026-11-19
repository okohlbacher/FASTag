# FREEZE1: PREREG-dha (2026-11-18)

- Signed off by the author 2026-11-18: held-out split = every PXD045734 run not from the 57-year-old development donor (171 runs; `../runs.tsv`, split `heldout*`), the thresholds in `../../PREREG-dha.md`, ~60 GB of held-out RAW.
- FASTag build: `feat/deep-exam` at `47181587` (this branch's base).
- Open search: MSFragger 4.4.1 (`/ceph/ibmi/abi/oliver/spextract/tools`), Java 21.0.12.1, parameters `open.params`, driver `opensearch.sh`.
- Scoring: `compare_open.py`, pooling `pool2.py`; FASTag driver `item1_dev2.sh` (development version; the held-out driver takes the same arguments).
- No held-out run has been downloaded, converted or searched at this freeze.
- `SHA256SUMS` covers the prereg, the run list and every file here.
