# FASTag 1.13 held-out manifests, preregistrations and results

Branch `acceptance/1.13`, made from origin/acceptance/1.12 (acceptance/1.12/ unchanged). Rules as
`acceptance/1.12/README.md`: every manifest, PREREG (endpoints, margins, truth, scorer sha256) and frozen config is
committed before any held-out run; held-out data are disjoint from DEV; each frozen config is scored exactly once;
never tuned on held-out data; no criterion is relaxed; a FAIL is a valid result.

| Path | What |
|---|---|
| `validation-registry.tsv` | append-only registry (columns of the 1.12 registry); rows are never rewritten, later changes are new rows |
| `frozen-configs.tsv` | one row per item and arm (binary, options, tables, param_hash, status) |
| `manifests/`, `disjointness/` | held-out manifests and their DEV-disjointness checks |
| `PREREG-item<NN>.md` | scoring protocol per item |
| `item<NN>/` | per-item scripts, tables, DEV checks and results |

Concurrent items append to the shared tables; on a rejected push: fetch, rebase, keep both sides' rows, push again
(never force).

## Rules added after item 12 (2026-11-09)

- Before a held-out manifest is frozen, check every run's truth from a non-endpoint search (for the real-chimera
  harness: `fastag-bench realchimera precheck`, a plain closed Sage search; refuses a run without truth, one that
  identifies under 5 % of its MS2, or ion-trap MS2 under a ppm fragment tolerance). Check the MS2 analyzer from
  the file, not from a candidate list.
- Check reuse against every earlier and concurrent record, not only the item's DEV runs: PXD, raw file name, raw
  SHA-1 and mzML sha256 against acceptance/1.12, acceptance/1.13 and the backlog DEV tables
  (`fastag-bench realchimera reuse`). Each raw-level reuse is declared with its reason before the run, or the run
  is dropped.
