# refs-1.12.0

The FASTag 1.12.0 gate reference set, approved by the user on 2026-11-07
(gui-opt/DECISIONS.md, "1.12 wave 1": refs-1.12.0 from the dev refs of
dia_refuse, pseudo_pass and profile_mzml). refs-1.10.0 stays the identity
reference and is unchanged.

Made on node data with the 1.12.0 release-candidate binary (FASTag.bin
sha256 bc36282b..., integration/1.12 at fe4e12c, OpenMS 70cebcd144),
32 threads:

- the 9 cases of `/ceph/ibmi/abi/oliver/fastag-gate/gate.sh`, re-referenced
  (`GATE_REFS=<dir> gate.sh --refs`): `<case>.digest`, `BINARY.txt`,
  `cases.tsv`, `results.tsv`. gate.sh was the shared script with sha256
  `1230067c11686521147aaabc23e67fdba25b71b91a1aee7ff7c0c7119bb7f095`
  (unchanged since 2026-11-04); its mzPeak digests use /usr/bin/python3 with
  pyarrow 25.0.1 (the `digest python` line of `BINARY.txt`).
  Every non-info digest line equals refs-1.10.0;
  only the info line with the -out_spectra mzML software version differs
  (1.10.0 -> 1.12.0).
- dia_refuse, pseudo_pass and profile_mzml of `tools/gate_new_cases.sh`
  (`GATE_NEW_REFS=<dir> GATE_CASES="dia_refuse pseudo_pass profile_mzml"
  gate_new_cases.sh --refs`): `<case>.digest`, `BINARY.<case>.txt`. Each
  equals its development reference in `../refs-dev`. These digests use
  sha256sum and sed only, no Python; the `digest python none` line of the
  three `BINARY.<case>.txt` files was added after the run to say so, and
  gate_new_cases.sh now writes it.

**Added at the RC rebuild (2026-11-08), PROVISIONAL until the user
approves them:** the five wave-2 cases of PLAN-INTEGRATION 4.2 from the
`feat/gate-cases-112` track, etd_auto (#15, opt-in `-ion_series auto`),
species_call (#1, opt-in `-species_call decoy`), chem_reports (#3),
census_dda and census_recon (#11). The 2026-11-07 approval names only
dia_refuse, pseudo_pass and profile_mzml; these five follow the plan's
table (census_* through refs-dev first, as they were) and can be dropped
by removing their `<case>.digest` and `BINARY.<case>.txt` files. Made with
`GATE_NEW_REFS=<dir> GATE_CASES="etd_auto species_call chem_reports
census_dda census_recon" gate_new_cases.sh --refs` at 32 threads with the
RC rebuild binary (FASTag.bin sha256 cf3d73da..., integration/1.12 at
69bfe94, inputs staged with `--stage` in data:/scratch/kohlbach/fastag112-rcb/in).
Every non-info line equals its `../refs-dev` reference (chem_reports after
the input-directory mask of c68cf5e). The 12 earlier digests were not
re-made: the RC rebuild binary passes them unchanged (gate.sh `GATE PASS
(9 cases)`, `NEW CASES PASS (3 cases)`), so their outputs did not change.

charge_infer (#6) is not in this set: the approval names the three cases
above, and the plan adds charge_infer only after its acceptance. It stays in
`../refs-dev`.

The full outputs of the reference run (258 MB, `out/`) are not committed;
they are in `data:/scratch/kohlbach/fastag112-rc/rc2/val/refs-1.12.0/out`.

Check a binary against this set on data:

    GATE_REFS=<repo>/tools/gate-1.12/refs-1.12.0 /ceph/ibmi/abi/oliver/fastag-gate/gate.sh <FASTag> <outdir>
    GATE_NEW_REFS=<repo>/tools/gate-1.12/refs-1.12.0 \
      GATE_CASES="dia_refuse pseudo_pass profile_mzml etd_auto species_call chem_reports census_dda census_recon" \
      bash <repo>/tools/gate_new_cases.sh <FASTag> <outdir>

The digests do not depend on the thread count, except the -out_spectra mzML,
which records `parameter: threads` in its data processing: gate.sh at
`GATE_THREADS` other than 32 reports out_spectra_mzml as FAIL by that one
value (and the index offsets it moves).
