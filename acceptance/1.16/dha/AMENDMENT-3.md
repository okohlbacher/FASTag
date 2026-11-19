# AMENDMENT-3 to PREREG-dha: held-out execution details (2026-11-18)

Operational, written by the executing agent **before any FASTag or MSFragger run on a held-out mzML and before any held-out output exists**. It fixes what AMENDMENT-1/-2 leave open; it changes no threshold, argument or criterion. Frozen with `heldout/SHA256SUMS`.

## Build

- `feat/deep-exam` `425f16b2` (`git describe`: `v1.15.0-35-g425f16b2`), fresh `git clone` of a bundle of that commit into `data:/scratch/kohlbach/dha-src`, detached at `425f16b24d70535c793e0bd7761a0ac75f2d27a3`, clean tree.
- Built with the dev configuration (OpenMS develop `70cebcd144`, conda env `fastag-omsdev`, Release, Ninja) into `data:/scratch/kohlbach/dha-build`. Binary sha256 `054c3819def00bda477db0e04c28733757cc96f23add4161bef25b339ea8ec84`.
- **Dev reproduction:** `freeze2/item1_dev3.sh` (sha256 `a6211587…`) with this binary, arms `main` and `blind`, on the six dev runs: 48 of 48 output files (`tags`, `recon`, `delta`, `spectra`, `counts`) byte-identical to `item1-dev3/`.

## Drivers (`heldout/`)

- `heldout_fastag.sh`: `item1_dev3.sh`'s arms `blind` (gating), `main` (= informed, reported) and `entrap` (reported), with the same arguments; only the run list and paths differ. Inputs: the scratch copies of the held-out mzML, sha256-identical to the archived ones (`heldout-dha/mzML.SHA256SUMS`).
- `heldout_msf.sh`: `opensearch.sh`'s logic. It regenerates the target + `rev_` database and requires it to be byte-identical to the dev database, and requires `open.params` to have the freeze1 sha256. One MSFragger invocation runs over all held-out mzML.

## Scoring (`heldout/harden_heldout.py`)

The script executes the frozen `freeze2/harden_analysis.py` up to its first analysis section, then uses the following unchanged:
- `WATCH`, `TOL` and `SHIFT`;
- the Clopper–Pearson code;
- the MSFragger top-1 / q ≤ 0.01 filter;
- the readers.

The dev run list is replaced by the held-out list.

**Check on dev.** Pointed at `item1-dev3/` and the dev MSFragger search, the script reproduces the following:
- the AMENDMENT-2 dev values: G1 LBs 0.938 / 0.935 / 0.971 / 0.917 / 0.861 / 0.844 / 0.946 / 0.869;
- G2 LBs 0.694–0.935;
- G3 845/978 = 0.864 [0.841, 0.885], with null 2 of 1,871;
- G6 3 calls, p = 0.110;
- G7 18 of 20 on the informed arm, with +156.102 and +269.187 failing (b).

Choices the amendments leave open:
1. **Runs:** a run is excluded from gating when the blind arm's `-delta_counts_out` has a `check_*` row that is not `ok`, or the file is missing. The informed and entrapment arms are checked and reported the same way.
2. **G1/G2:** a shift with fewer than 30 joined MSFragger positives is INCONCLUSIVE for both G1 and G2. A criterion FAILs when any shift with enough data fails on its LB. Otherwise it is INCONCLUSIVE when any shift is, and PASS when none is.
3. **G3:** INCONCLUSIVE with fewer than 30 checkable calls. The null share is `null_class = fragment` over `loc_class = fragment`, both charge-given.
4. **G4 population:**
   - charge-given, `loc_class = fragment` samples within 0.01 Da of one of the eight G1 shifts, on any residue (AMENDMENT-2 sets no residue for the common shifts).
   - **Allocation:** 100 proportional to the stratum's calls, floored, at least 8 (all when a stratum has fewer). Largest remainder fills up to 100, and the largest excess over the proportional share is removed while above 8. Strata keep the G1 order.
   - **Sampling:** one `random.Random(20261118)` draws `rng.sample` per stratum, in G1 order, over the calls sorted by (run, scan).
   - With 100 or fewer calls, all are taken; with fewer than 30, G4 is INCONCLUSIVE.
5. **G5:** charge-given, fragment-localized samples. The expected residue is read from the `site` column; `localized` gives the terminal-ambiguous forms of the same residue.
6. **G6:** charge-given calls gate (AMENDMENT-2 §2). The dev convention (all charge sources) is reported beside it.
7. **G7:**
   - Pooled rows use the charge-given spectra of the blind arm (`-delta_group` rule at 4 mDa, as `harden_analysis.py`).
   - The majority class is taken over the row's nonzero samples. The class detail is the most common `obs_detail` of that class.
   - The name is the Unimod cell of the largest per-run row within 4 mDa, as in `harden_analysis.py`.
   - (b) uses the row's joined spectra.
8. **Outcome:** B is FAIL when G1, G2, G3, G6 or G7 fails. Otherwise it is PENDING until the G4/G5 hand-check.

## Hand-check packets (`heldout/handcheck_packet.py`)

- **Call lists** with sites and MSFragger results (`G4_population`, `G4_sample`, `G5_population`) and the **item key** stay on ceph, in `heldout-dha/sealed/`. Their sha256 go into RESULT-dha.md before any packet is shown.
- **Items** get random ids in random order (`random.Random(20261118)`) and randomly ordered candidate labels.
- **Each item shows:**
  - the peaks and the precursor;
  - FASTag's peptide (fixed CAM-Cys);
  - the shift on each region residue;
  - b/y 1+/2+ from TheoreticalSpectrumGenerator, shifted on the ions that contain the candidate, matched at 20 ppm;
  - a flag for ions whose shift state differs between candidates.
- **Not in the packet:** run name (donor), scan, FASTag's site, MSFragger.
- **`handcheck.tsv`:** the checker records (a) and (b), the ions cited and the checker's name. The verdict (correct / ambiguous / wrong) is derived from (a), (b) and the sealed key at unblinding. Run and scan are joined from the key then.
