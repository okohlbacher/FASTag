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
| `PREREG-species-call.md`, `PREREG-chem.md` | #1/#10 and #3: binary, tables, DEV fits and (2026-11-08) the held-out scoring protocol |
| `PREREG-item02.md`, `-item06.md`, `-item07.md`, `-item09.md`, `-item15B.md` | scoring protocols of #2, #6, #7 (E7-03 as drawn), #9, #15B: truth search per run, cells and pooling, denominator, scorer sha256 |
| `scorers/` | the held-out scorers (`score_item*.py`, `acclib.py`), truth-search configs (`truth_config.py`, `truth/*.tsv`), `strip_charge.py` (#6), `SHA256SUMS`; `tests/` runs them on DEV outputs only (`run_dev_tests.sh`, `dev_results/`) |
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
    python3 -I scripts/registry_rows.py . validation-registry.tsv HO-...   # only for rows not yet committed
    python3 -I scripts/check_registry.py .                                # registry vs frozen-configs and manifests

Once a row is committed it is not rewritten: later changes are appended as new rows (`-r2`, `-PREREG`,
`-SUPERSEDED`, `-NOTRUN`; `scripts/append_status_rows.py` wrote the 2026-11-08 ones).

## Rules that bind the runs

Each manifest row is in the registry and committed before its run; each frozen config is scored exactly once;
never re-scored after seeing results; never tuned on held-out data. A config whose status in
`frozen-configs.tsv` is not `frozen` cannot be scored until its open part is closed and committed.

Scoring-protocol gate (amended 2026-11-08, after the audit): freezing the option string and the binary is not
enough. A config may be run on held-out data only when a committed PREREG file for its item
(`PREREG-item<NN>.md`; for #1/#10 `PREREG-species-call.md`, for #3 `PREREG-chem.md`) fixes all of:

- the truth search per run: engine and version, database (path and sha256), fixed and variable modifications,
  precursor and fragment tolerances, FDR level;
- the cells and how they are pooled (including any bootstrap or multiplicity correction);
- the denominator (which spectra, peptides, runs or genera count, and which are excluded);
- the scorer script, committed, with its sha256.

Until then the config's status is `pending_prereg`; it becomes `frozen` only in the commit that adds the PREREG
file. `python3 -I scripts/check_registry.py .` must pass before every held-out run: the last registry row that
names a config (rows are appended, never replaced) must carry its current param_hash and status.

Where a run may happen (amended 2026-11-08, when the user asked to farm the acceptance runs out to BinAC2): on node
data, or on BinAC2 under all of these conditions:

- FASTag is the byte-identical RC binary (`FASTag.bin`, sha256
  `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`), started through the documented wrapper
  (`bin/FASTag`, which runs it through data's loader and glibc; see `output/features-1.12/BINAC2-RUNTIME.md`).
- The BinAC2 public gate has reproduced `refs-1.12.0`: 17/17 digests identical (Slurm jobs 6464655 and 6464797,
  recorded in `output/features-1.12/BINAC2-RUNTIME.md`).
- The item's inputs have passed sha256 verification on BinAC2 against their manifest before the run.

Each config is still scored exactly once, on one of the two sites, and its registry row records where it ran (data or
BinAC2, with the Slurm job id for BinAC2).
