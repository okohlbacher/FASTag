# Held-out RAW staged and converted (2026-11-18)

All 171 held-out runs of `runs.tsv` (split `heldout*`) are archived and converted. No mzML content was read during staging.

| step | result |
|---|---|
| Download | Globus task `ea0fc854-e37a-11f1-b1d7-0affc602d875`, EBI `/pride/data/archive/2023/10/PXD045734/` to `/ceph/ibmi/abi/dont-backup/pride/PXD045734/.globus-in/`, `--sync-level checksum`. SUCCEEDED, 18:07–19:58 UTC: 171 of 171 files, 60,257,031,555 bytes, 9.0 MB/s, 7 transient faults retried by Globus. |
| Adoption | `pride_get.py get PXD045734 --file-list` (171 names) moved the files into `raw/`. Each manifest entry has `status ok` and `md5` = PRIDE's `md5_pride`. The archive now holds 177 RAW: 6 dev + 171 held-out. |
| Conversion | ThermoRawFileParser 2.0.0.0 (`/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/ThermoRawFileParser -f=2 -L=1-`, the dev converter and arguments), 8 in parallel on data from scratch copies. 171 OK, **0 failures**; 46,882,197,910 bytes of mzML; 6,418 s summed per-file time, done 21:15 CET. |
| Archive | mzML copied to `PXD045734/mzML/`, each copy sha256-checked against the scratch file. The list is `/ceph/ibmi/abi/oliver/fastag-deepexam/heldout-dha/mzML.SHA256SUMS` (sha256 `d3982a37…83acaf`). |
| Registration | `pride_get.py register PXD045734 --file <abs path> --source <raw> --converter ThermoRawFileParser --converter-version 2.0.0.0 --args="-f=2 -L=1-"`. The manifest's `derived` has 177 entries with these arguments. The first attempt used a relative path and was refused, then repeated with absolute paths. |

Storage on Ceph (`dont-backup`): 59 GB RAW + 46 GB mzML for PXD045734 in total, of which about 60 GB RAW and 44 GB mzML are new. On scratch, `/scratch/kohlbach/heldout-dha/mzML` holds the working copies (20 GB on disk).
