# FASTag 1.12 held-out manifests and preregistrations

Branch `acceptance/1.12`, made from origin/integration/1.12 at a117801 (the frozen RC; FASTag.bin
c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3). No file under src/ is changed here, and
**nothing has been scored**: every held-out file was drawn, staged and hashed before any FASTag run on it.

## Layout

| Path | What |
|---|---|
| `validation-registry.tsv` | the features-1.12 registry with one `HO-<item>-<split>` row per item and split (earlier rows unchanged) |
| `manifests/item*.tsv` | one manifest per item and split: PXD, file, PRIDE SHA-1, staged raw path and sha256, staged FASTag input and sha256, conversion, stratum, selection note |
| `frozen-configs.tsv` | one row per item and arm: RC binary sha256, RC bundle SHA256SUMS sha256, options, tables, parameter hash, status |
| `disjointness/` | per-file DEV overlap check per manifest, and `summary.tsv` (H2 vs H1 too) |
| `PREREG-species-call.md`, `PREREG-chem.md` | skeletons for #1/#10 and #3: binary, tables and pre-fit hashes; the fitted tables follow after DEV |
| `scripts/` | selection rules (in each script's header), staging and conversion, manifest build, disjointness, registry rows |
| `inputs/` | selection inputs and raw draw outputs; `inputs/staged/` the staging logs from node data |

Staged files: `data:/scratch/kohlbach/fastag-heldout-1.12/<item>/<split>/...` (E7-03 under `e7-03/<id>/`, raw files
hard-linked from the E7-03 download). They are on node data's /scratch, not on /ceph: the /ceph/ibmi/abi group
quota (80 TiB) was full on 2026-11-08 (copies there failed with "Disk quota exceeded" and were removed again).
The RC bundle (opt/ and data/ of a117801) is at `data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801`
(SHA256SUMS sha256 93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051).

## Rebuild

    python3 -I scripts/select_corpus.py inputs manifests
    python3 -I scripts/build_manifests.py .
    python3 -I scripts/check_disjoint.py .
    python3 -I scripts/registry_rows.py . validation-registry.tsv HO-...

## Rules that bind the runs

Each manifest row is in the registry and committed before its run; each frozen config is scored exactly once;
never re-scored after seeing results; never tuned on held-out data; runs on node data only. A config whose status in
`frozen-configs.tsv` is not `frozen` cannot be scored until its open part is closed and committed.
