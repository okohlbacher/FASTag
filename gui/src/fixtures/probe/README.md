Probe fixtures (`FASTag -probe_input`, format 1; see `../../inspector/probe.ts`).

The two `*.1.16.4.probe.jsonl` files are the unedited stdout of the FASTag 1.16.4
development build (fix/1.16.4, macOS arm64, 2026-11-27), the first with the
`instrument` fields `ms2_filter_itms` and `ms2_filter_ftms`:

- `ecoli_ms2_small.1.16.4.probe.jsonl`: `FASTag -probe_input test/fixtures/Ecoli_MS2_small.mzML`
  (run from the repository root). LTQ Orbitrap XL, 139 MS2 with `ITMS` filter strings; the one
  instrument configuration names the orbitrap.
- `ecoli_ms2_small_ftms.1.16.4.probe.jsonl`: the same file with every `"ITMS + ` filter string
  changed to `"FTMS + ` (`sed 's/"ITMS + /"FTMS + /g'`, same length, so the index still holds),
  probed as `FASTag -probe_input Ecoli_MS2_small_FTMS.mzML`. `test/input_probe_test.cpp` makes the
  same twin.

`ecoli_ms2_small.probe.jsonl` is the FASTag 1.15.0 probe of the same file (no filter-string
fields): the GUI reads it as before.
