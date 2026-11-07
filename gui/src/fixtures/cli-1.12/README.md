# FASTag 1.12 output on the public gate inputs

Real output of the integration/1.12 build (commit in `commit.txt`,
0e4b0c56; the binary still reports Version 1.11.0) on node `data`, run on the
public gate inputs only:

| prefix | input | arguments besides `-in`/`-out`/`-digest_out`/`-label_out` |
|---|---|---|
| `iontrap_20ppm` | PXD010783 `KristenJeff_p53_mod_AspN_03_02_07.mzML` (LTQ Orbitrap XL, MS2 in the ion trap, CID and ETD) | `-subsample_spectra 3000 -threads 8` (20 ppm, the default) |
| `iontrap_03da` | the same file | the same, `-fragment_tolerance 0.3 -fragment_tolerance_unit Da` |
| `orbitrap_hcd` | PXD003531 `20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML` (Q Exactive, HCD) | `-subsample_spectra 3000 -threads 8` |
| `dia_raw` | PXD006096 `100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML` (raw DIA) | the same; refused with exit 11 |
| `dia_pseudo` | its DIAspeXtract output `..._DIA1_new.pseudo.mzML` | the same |

Each run has its `.stdout`, `.stderr` and exit code (`.rc`); the tagged runs
their digest and label reports. `helphelp.txt` is the build's `--helphelp`
(with `RC=` appended): it lists `-acquisition_check` and no `-probe_input`.
The paths in the outputs are the node's (`/scratch/kohlbach/gate-in*`).

## The probe fixtures (`../probe/`)

No FASTag prints the metadata probe yet, so these are written to its
contract (`src/inspector/probe.ts`, gui/README.md "Inspector"), from the same
gate inputs: the `acquisition` reasons are the "Acquisition check:" lines of
the runs above; the MS1/MS2 counts, the analyser of the instrument
configuration the MS2 reference and the activation methods were counted
from the mzML headers on `data`; the index state is the one FASTag reported
for these files: each of the three gate inputs (PXD010783, PXD003531,
PXD006096) has an `indexedmzML` wrapper whose offsets FASTag 1.12 rejects
("has no index, or one that no longer matches the file", line 1 of each
`.stderr` above), so their probes say `stale`. Only the DIAspeXtract output
(`dia_pseudo`, whose log has no such line) is really indexed (`ok`). `iontrap`, `orbitrap`, `dia_raw` and `dia_pseudo` come from
these inputs; `no_ms2`, `profile`, `fasta_nodecoys` (the gate FASTA,
20,416 proteins, no decoy entries), `newer_format` and `truncated` are edge
cases of the contract. Probe activation counts are over the 4,000 MS2
probed (the whole PXD010783 file is half CID, half ETD).
