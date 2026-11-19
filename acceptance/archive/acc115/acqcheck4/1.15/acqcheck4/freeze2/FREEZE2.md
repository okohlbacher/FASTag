# acqcheck4 freeze 2 (audited manifest; before any FASTag binary reads a held-out file)

Date: 2026-11-15/16 (CET). No FASTag run has started (`run.started` absent on data).
`audited.tsv` **sha256 65e6d24637cdd48e7058d2bc83d6000185c8b21336a0039368513a9d11c574cd** is the frozen input of
`run.sh`. It equals `audited.prep2.tsv` (select.py output, sha256 bfc1fbef...) except for audit notes in the
`note` column. `truth.tsv` sha256 6eb4202c0ec531ada0102918cbf76ac95a5fb757b756a26ca928957fb10db064.

## Staging notes (no criterion changed)

1. **Persistent Ceph copies skipped: abi quota full.** The first `stage.sh` run (16:15) staged 15 rows, then every
   pride_get call failed with OSError 122 (Disk quota exceeded) on the PRIDE archive under
   /ceph/ibmi/abi/dont-backup/pride (`stage.passes.run1`). Nothing on Ceph was deleted. Staging was restarted at 17:13
   with `stage_local.sh`, which only sets `PRIDE_ARCHIVE=/scratch/kohlbach/acc115/acqcheck4/pride-archive`
   (node-local) and runs the frozen `stage.sh` unchanged; the 15 staged rows were kept (`stage.passes`).
   Result: 177 of 177 `.raw` rows staged (PRIDE MD5 checked, ThermoRawFileParser rc 0).
2. **AQ4.DDA_orbitrap.29 was never attempted**: its file name ends in `.RAW`; `stage.sh` selects `\.raw$`
   case-sensitively, draw.py case-insensitively. It counts as not staged and was replaced by AQ4.DDA_orbitrap.37
   under the standard backup rule.
3. **Truth parallelism.** Truth ran as `truth_p2.sh`: the commands of `prep2.sh truth` with 2 workers under
   nice -n 19 instead of 6 (node data was running another timed held-out test). Output is unaffected.

## Cross-branch drop

After `git fetch` (2026-11-15 22:20), 40 origin refs except acc115/acqcheck4 (including acc115/msfcalib), with
collect_pxd's catalogue rule (`branches_f2.txt`, `branches_f2_catalogues.txt`): 0 drawn PXDs found;
`drop.txt` is empty. `tools/branch_pxd.py` gained optional refs to skip (used for this check only).

## Selection (`select.py`, `select.out`)

178 rows, 177 staged, 0 dropped, 162 selected. Unused staged rows (never run): DDA_astral.59, .60;
DIA_orbitrap.21-.25; PRM.09-.11; DDA_orbitrap.38-.42. DDA_astral used all 20 main rows and backups 1-38
(through AQ4.DDA_astral.58), when the 12th Astral DDA unit was reached. DIA_closed used all 40 rows; the target
of 8 closed-window units was not reached.

## Units entering the run (known before the run, from truth only)

157 units: 71 DIA, 86 NONDIA; 5 selected rows are UNCLEAR and excluded (DDA_astral.02, .27, .51: DDA+PRM mixed;
PRM.08; DDA_orbitrap.24).

- **K3 Astral DDA: 12 units** (DDA_astral.04, .07, .08, .09, .10, .29, .33, .34, .35, .53, .57, .58), all with
  model Orbitrap Astral, ASTMS MS2 and dependent filters; they come from 5 projects (PXD065279, PXD062322,
  PXD053086, PXD061981, PXD070627; up to 3 runs each, as the draw rule allows).
- **K4 closed-window DIA: 1 unit** (DIA_closed.18, PXD003935, MSX run `..._MSX3_...`, per 0, 1,247 windows).
  Every other DIA file, including the tier-A RT-segment, dynamic-window and BoxCarmax candidates, has a single
  cycle (per = 1.0). **K4 has n = 1 < 5, so by the frozen rules that row is INCONCLUSIVE unless a miss makes it
  fail, and the overall verdict can be FAIL or INCONCLUSIVE but not PASS.** Recorded before the run; no criterion
  changed.
- K1 NONDIA n = 86 (>= 50), K2 DIA n = 71 (>= 40).

## Truth audit

60 selected staged rows (35 projects) were audited: truth differs from the drawn class, or UNCLEAR, or a DDA_astral
row that is not an Astral DDA unit. Notes are in the `note` column of `audited.tsv`. Every label is consistent
with the PRIDE record or, where the record is silent or incomplete (PXD061597, PXD063289), with the file metadata.
Of the 46 audited DDA_astral rows: 23 are Astral DIA runs, 16 are DDA runs on Q Exactive, Exploris or Fusion instruments of
mixed projects, 4 are DDA on the Astral with MS2 in the Orbitrap (PXD059754, PXD056327; not Astral DDA units by
definition), 3 are UNCLEAR. One file is noted for K1: DIA_closed.05 (BoxCarmax run 3 of 4, PXD021922) is
NONDIA targeted by the frozen truth rule (window coverage <= 50 %). No label was changed.
