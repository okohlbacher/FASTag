# acqcheck4 held-out result: raw-DIA acquisition check of FASTag 1.14.0 (Astral DDA, closed-window DIA)

**Verdict: INCONCLUSIVE** (scored once, 2026-11-15). No criterion failed. K1, K2 and K3 passed. K4 has n = 1
against a minimum of 5, so the overall verdict cannot be PASS. This shortfall was recorded at freeze 2, before
the run.

Protocol: `acceptance/1.15/PREREG-acqcheck4.md`. Freeze 1 c6abe7e0, **freeze 2 73920eb9** (audited.tsv sha256
65e6d24637cdd48e7058d2bc83d6000185c8b21336a0039368513a9d11c574cd). Candidate: FASTag 1.14.0 (v1.14.0 = da92dee6),
binary sha256 f7e2ec8d...2bd, checked in `run.sha256`, with all options at their defaults
(`-acquisition_check refuse`).
Run: `run.sh` on node data, 2026-11-15 23:13:46 to 23:21:09 CET. 157 units, 4 at once, 2 threads each. All 157
units exited on their own: 70 exited with rc 11 and printed `FASTAG_REFUSED reason=raw_dia`, 87 exited with rc 0.
No unit was stopped or timed out. The `-probe_input` metadata probe agreed with the run on all 157 units.

| Row | Criterion | n (min) | Result | Verdict |
|---|---|---|---|---|
| K1 | NONDIA refused = 0 | 86 (50) | 0 of 86 (upper 95 % bound 3.4 %) | PASS |
| K2 | DIA refused >= 90 % | 71 (40) | 70 of 71 (98.6 %) | PASS |
| K3 | Astral DDA refused = 0 | 12 (8) | 0 of 12 (upper 95 % bound 22.1 %) | PASS |
| K4 | closed-window DIA refused >= 90 % | 1 (5) | 1 of 1 | INCONCLUSIVE |

Reported only: Astral DIA 28 of 28 refused; recurring or targeted NONDIA 0 of 58 refused (upper 95 % bound 5.0 %).
By stratum: DIA files 23 of 23 refused in DDA_astral, 30 of 31 in DIA_closed and 17 of 17 in DIA_orbitrap.
NONDIA files 0 refused in every stratum: DDA_astral 32, DDA_orbitrap 35, DIA_closed 9, DIA_orbitrap 3, PRM 7.
Excluded: 5 selected rows with truth UNCLEAR (DDA_astral.02, .27, .51, PRM.08, DDA_orbitrap.24).

**The one DIA miss** was AQ4.DIA_closed.15 (PXD072035, Orbitrap Eclipse, 42 windows of 13 Th, single cycle). It
carries real, mixed precursor charges (0 % uncharged, no placeholder charge), so FASTag called it DIA-like. It
logged a warning, tagged the file and exited 0. This is the documented DIA-like behaviour; it was not a
closed-window case.

**K3 note.** The 12 Astral DDA units come from 5 projects (PXD065279, PXD062322, PXD053086, PXD061981,
PXD070627), with up to 3 runs per project as the draw allows. The upper bound treats the runs as independent.

## Deviations and notes (from FREEZE2.md)

1. **Persistent Ceph copies were skipped because the abi quota is full.** The first staging run stopped after
   15 rows (OSError 122). Staging restarted with the PRIDE archive on node-local scratch (`stage_local.sh`),
   using the frozen `stage.sh` unchanged. 177 of 177 attempted rows were staged.
2. **AQ4.DDA_orbitrap.29 was never staged.** Its file ends in `.RAW` and `stage.sh` matches `.raw` case-sensitively.
   AQ4.DDA_orbitrap.37 replaced it under the standard backup rule.
3. **Truth parallelism.** Truth ran with 2 workers under nice -n 19 instead of 6, because the node was shared
   with another timed test. The output is unaffected.
4. **Cross-branch drop list was empty.** 40 origin refs were checked, including acc115/msfcalib.
   `branch_pxd.py` gained an option to skip refs; the change was committed with freeze 2.
5. **K4 shortfall.** Only one closed-window DIA file was found: an MSX run, PXD003935. The tier-A candidates
   (retention-time window segments, dynamic windows, BoxCarmax) all had a single cycle (per = 1.0) or were not
   DIA. No criterion was lowered.
6. **Truth label kept for K1.** AQ4.DIA_closed.05 (BoxCarmax run 3 of 4, PXD021922) is NONDIA targeted under the
   frozen truth rule. FASTag called it PRM/targeted and did not refuse it.
7. Nothing was re-scored.

## Files

`acceptance/1.15/acqcheck4/results/`: `summary.txt` (verdict), `units.tsv` (per unit), `decide.tsv`,
`probe.tsv`, `run.sha256`, `run.list`, `score.out`. Freeze 2: `acqcheck4/freeze2/` (`audited.tsv`, `FREEZE2.md`).

## Reading

FASTag 1.14.0 refused no non-DIA file among the 86: 12 confirmed Astral DDA runs, Orbitrap DDA and PRM. That
closes acqcheck3's Astral DDA gap (K3 PASS). It refused 70 of 71 DIA files, including all 28 Astral DIA runs and
the one MSX run. The closed-window case (K4) is still untested beyond that single file, because public Thermo DIA
with no single cycle is rare in PRIDE.
