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
  `cases.tsv`, `results.tsv`. Every non-info digest line equals refs-1.10.0;
  only the info line with the -out_spectra mzML software version differs
  (1.10.0 -> 1.12.0).
- dia_refuse, pseudo_pass and profile_mzml of `tools/gate_new_cases.sh`
  (`GATE_NEW_REFS=<dir> GATE_CASES="dia_refuse pseudo_pass profile_mzml"
  gate_new_cases.sh --refs`): `<case>.digest`, `BINARY.<case>.txt`. Each
  equals its development reference in `../refs-dev`.

charge_infer (#6) is not in this set: the approval names the three cases
above, and the plan adds charge_infer only after its acceptance. It stays in
`../refs-dev`.

The full outputs of the reference run (258 MB, `out/`) are not committed;
they are in `data:/scratch/kohlbach/fastag112-rc/rc2/val/refs-1.12.0/out`.

Check a binary against this set on data:

    GATE_REFS=<repo>/tools/gate-1.12/refs-1.12.0 /ceph/ibmi/abi/oliver/fastag-gate/gate.sh <FASTag> <outdir>
    GATE_NEW_REFS=<repo>/tools/gate-1.12/refs-1.12.0 GATE_CASES="dia_refuse pseudo_pass profile_mzml" \
      bash <repo>/tools/gate_new_cases.sh <FASTag> <outdir>

The digests do not depend on the thread count, except the -out_spectra mzML,
which records `parameter: threads` in its data processing: gate.sh at
`GATE_THREADS` other than 32 reports out_spectra_mzml as FAIL by that one
value (and the index offsets it moves).
