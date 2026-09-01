# Backlog implementation plan — 2026-09

> **STATUS (2026-09-01, end of day): EXECUTED.** Every phase below landed the
> same day the plan was written, with the Review-revisions deltas applied and
> two additions the plan did not foresee: a latent nondeterminism (pointer-
> ordered ResidueDB iteration feeding the collapse-rule budget) found and
> fixed back to v0.19.1, and the F4 calibration audit's measured envelope
> (conservative ≤ 0.02, ~1.6x optimistic at 0.05–0.1) shipped into the docs
> and the tool's own log. See doc/BACKLOG.md for per-item outcomes and
> doc/F4-CALIBRATION-AUDIT.md for the audit.

Repo: `/Users/kohlbach/Claude/FasTag`. Synthesized from 12 design briefs (F2, F4, F5, F10, F11, F12, F14, GUI browser, GUI test harness, CI taxonomy embed, `-out_spectra` memory bound, data inventory).

## Standing rules (apply to every item)

- **Recall-first defaults.** Tagging is a sensitive prefilter; later stages (filter, recon, q-value) supply specificity. No gate is tuned tighter than the math, and any specificity-adding mechanism ships as ordering/annotation, not filtering.
- **No default flips on synthetic evidence.** Synthetic benchmarks may gate mechanisms; only real data can change a shipped default. All new behavior below is opt-in (`-diversity`, `-glyco`, `-res_conf`, `-recon_out`, `-entrapment_fasta`, `-stream`).
- **New scoring columns are opt-in until validated** (`q_db`, `res_conf`, `glyco`, recon columns) and byte-identity of existing output is a validation gate for every change.
- **Push discipline:** batch commits, push once per phase; rapid pushes cancel the ~1h15m Windows CI mid-build and poison its OpenMS cache.

## Order of execution

Dependencies honored: F2 is the substrate for F1-wiring, the F5 rider, and the F9 follow-up. F4 is independent of F2 and runs in parallel. The user's priority: **F2 and F4 gate the release milestone and come first.** `ci-embed-taxonomy` is decided and mechanical — it goes into Phase 0. Data groundwork (Phase 0) unblocks the F2/F4/F12 validation gates and costs hours.

| Phase | Item | Effort | Depends on |
|---|---|---|---|
| 0 | ci-embed-taxonomy (decided, mechanical) | half a day incl. dry-run tag | — |
| 0 | Data groundwork (from data-inventory): rename/alias `bench_astral_dda.mzML`, fetch archaeal proteomes, re-download PXD000001 `F063721.dat` | ~1 day | — |
| 0 | F5 decision edits (close the backlog item; code rides on F2) | hours | — |
| 1 | **F2** proteome suffix-array index + TagRecon rework + `-recon_out` wiring | 2–3 days | Phase 0 data |
| 1 | **F5 rider** (`-delta_out` histogram + docs) | +0.5 day on F2 | F2 |
| 1 | **F4** entrapment-calibrated `q_db` (parallel to F2) | 2–3 days | Phase 0 data |
| 2 | F12 tag diversity (opt-in) | 1 day | — |
| 2 | F10 `-stream` low-latency mode | 0.5 day | — |
| 2 | F11 glyco flag | 0.5 day | — |
| 2 | `-out_spectra` memory bound (two-pass write) | 1 day | — |
| 2 | F14 `-res_conf` + `tools/tags_to_denovo.py` | 1–2 days | — |
| 3 | GUI vitest harness | 1 day | — |
| 3 | GUI million-row results browser | 1.5 days | vitest harness (see Open conflict 5) |

F9 (error-tolerant tag matching) is not planned here but is explicitly enabled by F2: pigeonhole half-tag locate + ≤1-mismatch verify on the same suffix array (~a few hundred extra 0.5 µs probes per tag, vs. an automaton explosion under Aho–Corasick). Record it in `doc/BACKLOG.md` when F2 lands.

---

## Phase 0

### 0.1 ci-embed-taxonomy — embed the taxonomy index into every release tarball

**Chosen design.** Source the ~430 MB `FASTag-taxonomy-k7.tar.gz` from the existing v0.19.1 release asset via `gh release download`, pinned by **tag + SHA256** in each workflow's env block (`TAXDB_TAG: v0.19.1`, `TAXDB_SHA256: 520d93229df807e45b0e6fdf4d8d20c7aad95b73952749cb041c3e54de474a4b`) — never "latest", for the same reason the `MZPEAK_REF` comment gives: a moving ref silently changes what a release contains. One tag-gated "Embed taxonomy index" step per workflow, placed **after** macOS signing/notarization (data files are unsigned; embedding earlier balloons the notarytool upload by ~450 MB) and before "Attach binary to the GitHub Release". The step downloads, verifies sha256, untars **over** `dist/FASTag` (the asset's dumps — the ones the index was built against — overwrite the repo copies), asserts `share-FASTag-taxonomy/tax_k7.taxdb` exists, and runs a real `-species` smoke through the shipped wrapper on the bundled `share-OpenMS/examples/ID/Ecoli_MS2_small.mzML`. Failure mode: fail the release loudly (`set -euo pipefail`, no dumps-only fallback). Embed on tag builds only; main pushes keep fast dumps-only bundles. Keep the standalone asset and copy it forward onto each new release via an independent `taxonomy-asset` job (so a platform build failure cannot leave a release without it). No code change: `taxonomyDir_()` (`src/FASTag.cpp:101`) already prefers a dir holding the index over dumps-only, and the flat `./share-FASTag-taxonomy` candidate matches the layout.

**Implementation steps.**
1. Add `TAXDB_TAG`/`TAXDB_SHA256` env pins to `.github/workflows/ci.yml` (after `MZPEAK_REF`, ~line 74) and `windows.yml` (~line 56), with the lockstep + bump-procedure comment (upload new asset first, then bump both values, then tag).
2. Insert the embed step into ci.yml's build job between "Delete signing keychain (macOS)" and "Attach binary" (covers all four matrix entries).
3. Windows variant in windows.yml after "Verify the bundle is portable": `sha256sum -c`, `$WS` paths, run `"$WS/dist/FASTag/FASTag.bat"` under the existing CLEAN_PATH recipe.
4. Add the tag-gated `taxonomy-asset` copy-forward job (`gh release download` from `TAXDB_TAG`, verify, `gh release upload --clobber`).
5. Update the stale "ships once per release" comments in all three bundle steps and CMakeLists.txt lines 149–156 (local `cmake --install` stays dumps-only — correct for source builds, say so).
6. Docs: README "Get the index", `data/taxonomy/README.md` matrix cell, `doc/V1.0-READINESS.md` decision 1 → decided/implemented.
7. Confirm `Ecoli_MS2_small.mzML` exists in the CI openms-install (the GUI's vendored install at `gui/src-tauri/resources/fastag/share/OpenMS/examples/ID/` came from this recipe); fallback is a tiny committed mzML under `tests/`.

**Files touched.** `.github/workflows/ci.yml`, `.github/workflows/windows.yml`, `README.md`, `data/taxonomy/README.md`, `CMakeLists.txt`, `doc/V1.0-READINESS.md`.

**Validation gate (real data).** Locally before any push: download the v0.19.1 asset, verify the pinned sha256, extract next to a locally built FASTag, run `./FASTag -in ~/Claude/local_test.mzML -out /tmp/t.tsv -species -species_out /tmp/t.species.tsv -tag_length 7` with no `FASTAG_TAXONOMY_DIR`; then `-species` on `~/Claude/bench_astral_dda.mzML` must rank Homo first (index+dumps coherence). Then one throwaway tag push (single push): `tar tzf` every platform tarball for `tax_k7.taxdb`, smoke steps green, standalone asset + `.sha256` on the release, per-platform assets ~550–610 MB; delete the throwaway release+tag.

**Effort.** Hours of edits + one CI dry-run cycle (~1.5 h wall) — half a day.

**Risks.** Smoke-fixture presence in CI's openms-install (asserted loudly, verified on dry run); chicken-and-egg on index rebuilds (new asset must be uploaded out-of-band before bumping pins — a forgotten bump ships the old index silently; sha256 at least blocks corruption); embed step exercised only at tag time (mitigated by the loud in-step `-species` run); tag builds ~2–4 min slower per platform; notarization ordering is load-bearing (comment in the step). Pre-existing gap, out of scope: v0.19.1 shipped with **no** `FASTag-linux-x64.tar.gz` and nobody noticed — release completeness is unchecked (flagged to the user under Open conflicts, item 8).

### 0.2 Data groundwork (from the data-inventory brief)

**Chosen design.** Three tiers. (a) Ready now: `~/Claude/bench_astral_lf.mzML` (Astral label-free human DDA, 102,236 spectra, PXD076528 — the only large local run free of fixed-mod complications) + `9606.fasta` is the F4 entrapment substrate; on-disk `218491.fasta` (P. atrosepticum, full 4,463-seq proteome) and `83333.fasta` (E. coli) serve as interim entrapment. (b) One ~65 MB download re-establishes the strongest ground truth: PXD000001's Mascot `F063721.dat` (the mzML is already on disk at `mzpeak-example-data/data/general-ms/thermo-ltq-orbitrap-velos/`), whose 2,254-PSM 1%-FDR recipe (score ≥ 16.85, TMT6plex N-term/K + Methylthio C fixed mods) is fully documented in `doc/BACKLOG.md` but whose parser/scorer scripts were never committed and must be rewritten. (c) Fetch archaeal reference proteomes (243232 M. jannaschii, 273057 S. solfataricus; optionally 186497, 64091, and/or Arabidopsis 3702 per the speXtract precedent) via `tools/fetch_reference_set.py` — minutes; archaea avoid both contaminant coincidence and the conserved-protein k-mer overlap the on-disk Enterobacterales sets carry. **Critical hygiene:** `bench_astral_dda.mzML` is misnamed — metadata says Orbitrap **Eclipse**, ion-trap Turbo CID MS2, TMTpro16plex human 4-cell, 41,407 spectra (MSV000096674; cornerstone #4 "iontrap" of `doc/TEST-DATA.md`). Rename or symlink-alias it (e.g. `bench_eclipse_iontrap_tmt.mzML`) so nobody runs ion-trap data at 20 ppm (documented 274× tag-count collapse). Also on disk and relevant: `OpenMS - DirecTag/real/S23.mgf` (194 MB diaTracer pseudo-MS2), `full/fastag_native.tsv` (657 MB tags), `real/fdr_full.txt` (shuffled-decoy tag FDR: 74% @ len 5 → 1% @ len 7 → 0% @ len 8 — direct F4 tag-length calibration evidence), and `mzpeak-example-data/diann/agxt-2026/` (6 diaPASEF runs + DIA-NN `report.parquet`, 38–44k precursors/run — real precursor-level DIA truth for F12).

**Steps.** Rename/alias the Eclipse file and fix all doc references; run `tools/fetch_reference_set.py` for the archaeal taxids (grow an ad-hoc taxid-list mode if needed); re-download `F063721.dat` from PRIDE; rewrite the Mascot parser/scorer from the BACKLOG recipe and **reproduce the documented 86.4% rank-1 / 88.5% best-E-value numbers as a regression gate** before trusting any new calibration numbers; update `doc/TEST-DATA.md` with the corrected inventory.

**Files touched.** `doc/TEST-DATA.md`, `doc/BACKLOG.md`, `tools/fetch_reference_set.py`, `~/Claude/FasTag-speciesdb/proteomes/` (new fastas), a new ground-truth script (location: `bench/` or `tools/`).

**Validation gate.** The rewritten PXD000001 scorer reproduces 86.4%/88.5% on the on-disk `TMT_Erwinia_*-20141210.mzML` against `218491.fasta` with the documented fixed mods. (The fixed-mod trap silently zeroed all matches on the first historical attempt — this reproduction is the gate.)

**Effort.** ~1 day (download + parser rewrite dominate).

**Risks.** PRIDE availability of the `.dat` (open question); fixed-mod trap; the ratio-correction subtleties move to F4.

### 0.3 F5 — close the PTM-Shepherd decision now

**Chosen design.** SKIP F5 as a standalone item and close its open design decision: (a) direct PTM-Shepherd interop is **permanently off the table** — its standalone mode consumes only Philosopher `psm.tsv` + mzML dir (per the Nesvilab README), requires FDR-filtered full-peptide PSMs, and builds its delta-mass histogram internally; a tag-level tool cannot feed it — a category mismatch, not a deferral. (b) Fabricating `psm.tsv` from reconciled tags is rejected on statistical-honesty grounds (no calibrated tag FDR exists yet; interop theater). (c) The genuinely useful deliverable — per-reconciliation delta columns plus one aggregated `-delta_out` histogram TSV plus an honest doc section — is a near-free rider on F1/F2 and ships with them (Phase 1). The tag-level "delta column" alternative is mathematically vacuous: at `FASTagger.cpp:705-706`, `nterm_mass` is defined as precursor minus (ladder end + tag), so nterm+tag+cterm equals the precursor residue mass **by construction** — a real delta exists only after reconciliation, and `TagReconciler` already computes exactly the right artifact (`delta_mass`, region `[region_lo,region_hi]`, `delta_interp` "mod:Name@X"/"sub:X->Y"/"?").

**Steps now (hours).** Edit `doc/BACKLOG.md` line ~230 (verdict row) and ~311 (sized-gaps row): F5 → "FOLDED INTO F1/F2; direct PTM-Shepherd feed impossible (psm.tsv+mzML contract, no histogram input)"; fix the dead link to `RESEARCH-tagger-uses-2021plus.md` (referenced ~line 211, absent from `doc/`); edit `doc/V1.0-READINESS.md` item 3 to "decided" so 1.x readiness no longer waits on F5 code.

**Files touched.** `doc/BACKLOG.md`, `doc/V1.0-READINESS.md`.

**Validation gate.** The decision rests on two checkable facts: the PTM-Shepherd input contract (github.com/Nesvilab/PTM-Shepherd) and the flank identity at `FASTagger.cpp:705-706`. The rider's validation is under Phase 1.2.

**Risks.** Users keep asking for FragPipe compatibility — the doc section must spell out the psm.tsv mismatch and missing tag-level FDR or the fabricate-psm.tsv temptation recurs. If PTM-Shepherd ever grows generic-TSV input, direct interop can be revisited; the histogram deliverable loses nothing.

---

## Phase 1 — release gate

### 1.1 F2 — tag-to-database lookup index at proteome scale (substrate for F1 and F9)

**Chosen design.** A per-run, in-memory, k-bounded **suffix array** over the concatenated I/L-folded proteome with `#` sentinels between proteins, built with plain `std::sort` using a comparator capped at 32 chars (> `MAX_FILTER_LEN=25`) — no library, no persistence — plus two side arrays that make it the F1 substrate: a **double** prefix-mass array over the concatenated text (91 MB human; double is mandatory — float's 24-bit mantissa gives ~0.25 Da resolution at titin's ~3.8 MDa cumulative prefix mass, destroying ppm flank checks) and per-protein tryptic cleavage-site lists (~5 MB). Measured on the real `9606.fasta` (11,438,535 residues): 32-bit SA is 45.8 MB, builds in 1.59 s single-threaded, locate ~0.5 µs; occurrence counts 3850/294/6.7/2.7/1.8/1.4 at k=3/4/6/8/10/15 (matches FastaFilter's EFF_ALPHABET=14.7 chance model). Total ~150 MB, ~2 s build. **Digestion moves out of the index:** a match at text position p expands at query time into the ≤(MC+1)² tryptic windows containing [p,p+k); db flanks are `prefix[p]-prefix[s_i]` and `prefix[s_j]-prefix[p+k]`; TagRecon's `tryPlace`/`interpretDelta_` math is kept unchanged on top. I/L folding is index-side; **isobaric collapse (tag N matches db GG) and b-ion reversal are query-side** — expand each tag into its bounded set of mass-equivalent spellings (same rule derivation as `FastaFilter::deriveCollapses`, budget-capped like `emitReadings`, cap ~64) × two orientations, one SA range query each. This replaces TagRecon's demo hash index (~34M placements, ~2M heap-heavy Peptide objects, fixed single k, minutes of build) and frees recon from the fixed-k restriction — one SA serves lengths 3..25 uniformly. New `src/ProteomeIndex.{h,cpp}` (~250 LOC) with `locate`/`locateTag`/`peptidesAt`/`flankMass`; `TagReconciler` keeps its public `reconcile(tag, nterm_mass, cterm_mass) -> vector<Reconciliation>` contract verbatim but `build()` takes a `const ProteomeIndex&` + missed_cleavages. CLI: opt-in `-recon_out <tsv>` (requires `-fasta`, reuses loaded entries), `-recon:missed_cleavages 1`, `-recon:min_length 0=derived` (autoMinLen-style; k=3 gives 3850 hits/tag on human — pure noise; the gate must be overridable and documented, not tuned tighter than the math, per the prefilter-stays-sensitive rule).

**Implementation steps.**
1. `ProteomeIndex::build`: concatenate with `#` sentinels, `norm()` folding (hoist the 7-line `norm()` and `deriveCollapses` rule loop from `FastaFilter.cpp` into a tiny shared header — rules must stay one implementation), uint32 SA + `std::sort` with the 32-char-capped memcmp comparator; double prefix-mass array with fixed mods folded in (same residue-mass sourcing as today's `TagRecon::build` via ResidueDB Natural19WithoutI); per-protein cleavage sites with OpenMS 'Trypsin' semantics (cuts after K/R, not before P — match `ProteaseDigestion` exactly).
2. `locate()`: `std::equal_range` with the capped comparator; `locateTag()`: collapse variants × both orientations, dedupe on (prot,pos,window_len,reversed).
3. `peptidesAt()`: enumerate starts among the MC+1 sites at/left of pos and ends among the MC+1 sites at/right of pos+len with internal-site count ≤ MC; `#` (and X/B/Z/U/O, which `norm()` turns into `#`) is a hard cleavage barrier — document that this is slightly more sensitive than TagRecon's skip-whole-peptide-on-unknown behavior.
4. Unit tests: locate vs brute-force scan on a small FASTA; `peptidesAt` cross-checked against `ProteaseDigestion::digest` on real proteins incl. missed cleavages; `flankMass` vs AASequence masses; tag `N` matching db `GG` in both orientations; no match across sentinels; build on `9606.fasta` asserting <3 GB RSS.
5. Rework `TagReconciler::build` onto ProteomeIndex; `reconcile` = locateTag → peptidesAt → existing `tryPlace`/`interpretDelta_` unchanged; cross-check old-vs-new `reconcile()` equivalence on a demo-scale FASTA.
6. Wire `-recon_out` into `FASTag.cpp` inside `tag_one` (index is const/thread-safe after build, like `filt`/`tables`; rows join the block-ordered output discipline).
7. Benchmark on real data and record numbers in `doc/BACKLOG.md` F1/F2 rows; note the F9 path (pigeonhole half-tag locate + ≤1-mismatch verify on the same SA).

**Files touched.** `src/ProteomeIndex.h/.cpp` (new), `src/TagRecon.h/.cpp`, `src/FASTag.cpp`, `src/FastaFilter.cpp` (only if norm/rules hoisted), `doc/BACKLOG.md`, new `ProteomeIndex_test` beside existing tests. Benchmark scratch exists at the session scratchpad (`f2bench/sa_bench.cpp`).

**Validation gate (real data).** Feasibility already measured on `9606.fasta` (numbers above). After implementation: (1) unit cross-checks incl. old-vs-new TagReconciler equivalence; (2) end-to-end `FASTag -in ~/Claude/bench_astral_dda.mzML -fasta …/9606.fasta -recon_out …` vs the same run without recon — wall-time delta, peak RSS (target: recon adds <200 MB and small % runtime), fraction of `fasta_hit=fwd/rev` tags reconciling with ≥1 exact-flank placement — **note**: this file is Eclipse ion-trap TMT (Open conflict 1); run it at its correct 0.3 Da tolerance and with TMT fixed mods, and add `bench_astral_lf.mzML` as the ppm-domain end-to-end; (3) spot-verify ~20 placements by hand (grep the tag variant in 9606.fasta, recompute flanks); (4) `83333.fasta` (E. coli, 1.39M residues) small sanity case; (5) scale probe on `bench_astral_lf.mzML` (102k spectra).

**Effort.** 2–3 days (index+tests ~1, TagRecon rework+CLI ~1, real-data benchmarks+doc ~0.5–1).

**Risks.** Cleavage-rule drift vs `ProteaseDigestion` (Trypsin vs Trypsin/P nuance) silently shifts flank masses — mitigated by the digest cross-check; trypsin stays hardcoded. Collapse-variant explosion on W/Q/R-rich tags (W has 6 pair spellings at 0.04 Da) — budget-cap like `emitReadings`. Double-counting palindromic tags and distinct variants on the same window — dedupe TagOcc before `tryPlace`. Short-tag placement floods (k=3 → 3850 hits × peptide enumeration) — derived min-length gate + per-tag locate cap, overridable and documented. Sentinel-as-barrier changes unknown-residue semantics slightly — stated in header comment, covered by a test. `std::sort` n log n: all 17 bundled proteomes together are only 19.75M residues (~79 MB SA, seconds); libsais noted as the upgrade if a >100M-residue DB ever appears.

### 1.2 F5 rider — recon TSV + `-delta_out` mass-shift histogram (ships with F2)

**Chosen design.** Two flags on the TOPP tool, both riding on the F2 wiring: (1) `-recon_out <tsv>` — one row per reconciliation with spectrum, tag, protein, peptide, pos, reversed, nterm_match, cterm_match, delta_mass (%.4f), region, delta_interp (verbatim from TagReconciler; empty when exact) — the exact column layout must reconcile the F2/F5 schema drift (Open conflict 3). (2) `-delta_out <tsv>` — aggregated histogram: delta_center, count, spectra, top_interps (semicolon-joined "interp:count", capped at 3). **Counting rule for honesty:** each spectrum contributes at most one count per delta bin (best-E-value tag's best placement), so one spectrum's 50 tags × many placements cannot flood a bin. Binning: 0.0005 Da bins in a `std::map<int64_t,…>`, adjacent-bin local-max grouping — stdlib only. The README "Mass shifts" section states explicitly: region-level (not residue-level) localization, no FDR control, compare peaks against Unimod/PTM-Shepherd mass-shift tables; `delta_interp` values are candidates, not identifications. This is PTM-Shepherd-**style** summarization done database-side — the only form of "interop" honest for a tagger.

**Steps.** Wire TagReconciler mod candidates from the existing `-variable_modifications` list via ModificationsDB (FASTag.cpp ~line 440); `-delta_out` aggregation (~50 LOC): per-spectrum best placement → binning → local-max grouping → TSV; unit test on synthetic reconciliations (known Ox/deamidation deltas in, expected bins and top_interps out) beside `test/tagrecon_test.cpp`; README section with the no-FDR caveat.

**Files touched.** `src/FASTag.cpp`, `README.md`, `test/tagrecon_test.cpp` or sibling, `doc/BACKLOG.md`.

**Validation gate (real data).** Reconcile `~/Claude/bench_astral_lf.mzML` (human, label-free — substituted for the misnamed dda file per Open conflict 1) against `9606.fasta` and assert: (a) the zero-delta bin dominates; (b) known chemistry at the right masses — +15.9949 on M-containing regions (interp names Oxidation), +0.9840 on N/Q (deamidation), +57.0215 present when Carbamidomethyl is NOT declared fixed and vanishing when it is; (c) negative control: the same human data against `83333.fasta` yields a flat/noise histogram. Scale check confirms the per-spectrum counting rule keeps `-delta_out` stable under `-max_tags 50`.

**Effort.** ~half a day on top of F2. **Risks.** Histogram over-read as a PTM profile (mitigated by doc language, counting rule, "candidates" naming); if F2 slips, F5 stays closed-as-decided but undelivered — acceptable, the decision was the 1.x blocker.

### 1.3 F4 — calibrated per-tag q-value via entrapment-augmented database filtering

**Chosen design.** Entrapment-augmented filtering with **k-mer-space attribution**, reusing the recovered TagFDR contract. Background: the earlier F4 attempt failed because single-spectrum decoys produce an empty null — FASTag's false tags are real ladder reads of chimeric co-isolated peptides (66,516 "incorrect" PXD000001 tags at median E-value 2.3). The unit-tested `src/TagFDR.h` + `test/tagfdr_test.cpp` were **deleted without ever being committed**; the full contract was recovered from `build-f4/` compiled artifacts (symbols, disassembly, assertion strings): `TagFDR(vector<double> targets, vector<double> decoys, double decoy_scale)` + `double qOf(double e)`; q(e) = scale·D(e)/T(e), monotonized non-decreasing, binary-searched. Design: `-entrapment_fasta <file>` builds a **second FastaFilter** over foreign-species sequences with identical settings (same orientation, same `deriveCollapses(tol, fixed_deltas)`, min_len forced to the target filter's `minLen()`) — no index-format change. Attribution is **target-first**: a tag hitting the target index is "target" even if it also hits entrapment; only entrapment-and-not-target counts. This implements entrapment-only counting AND handles homology exactly where it bites — in collapsed k-mer space (I/L folding and N=GG collapses applied identically to both DBs, which CD-HIT-style sequence filtering cannot see). Effective ratio r_eff = (K_E − K_shared)/K_T computed from the built indexes via a new ~25-line `FastaFilter::sharedKeys(other)`. Per-tag q: `TagFDR(target_evalues, entrap_evalues, scale = 1/r_eff).qOf(e)` — the target-list form of the combined estimator of Wen/Freestone et al. (Nat Methods 2025; FDRBench), with one deliberate deviation from the lost original: a **+1 pseudo-count** (q = min(1, scale·(D+1)/T)) for finite-sample conservatism (maintainer sign-off needed, Open conflict 7). **Statistical honesty, stated in code, README, column docs:** `q_db` estimates the tag-is-in-DB **false-match** rate — NOT the tag-is-a-correct-read-of-the-precursor rate; a correct ladder read of a co-isolated chimeric peptide legitimately matches the target DB and is not false under this null (which is precisely why this null is non-empty where spectrum decoys failed). Opt-in; target-matching rows byte-identical apart from the appended `q_db` column (%.3g, `-proforma` precedent); `fasta_hit` gains `efwd`/`erev` for entrapment-only matches; v1 refuses `-entrapment_fasta` + `-species` (entrapment rows are known-false and would pollute taxon evidence). Log entrapment keys, shared keys, r_eff, match counts; WARN when N_entrap < ~200 or r_eff < 0.1.

**Implementation steps.**
1. Recreate `src/TagFDR.h` (~60 lines) to the recovered contract with the documented +1 deviation; recreate `test/tagfdr_test.cpp` from the recovered assertion list (monotone in E; empty inputs → q 1; larger scale never lowers q; well-separated best target ≈ 0; indistinguishable ≈ 1; 'no decoys → q 0' updated to 'q = scale/T monotonized' for the +1 variant); re-add the test target to CMakeLists.txt. Where runnable, cross-check against the surviving `build-f4/tagfdr_test` binary.
2. Add `FastaFilter::sharedKeys(const FastaFilter&) const` + per-length `keyCount(k)`; unit-test (shared k-mers counted once, collapse-space equality, disjoint DBs → 0).
3. Wire `FASTag.cpp`: register `-entrapment_fasta`; build second filter with `entrap.setMinLen(filt.minLen())`, same deriveCollapses and build range; guard vs `-species`; in `tag_one()` try `filt.match` first, else `entrap.match` (emit efwd/erev; exclude entrapment-only tags from the `-out_spectra` kept criterion); accumulate per-thread target/entrap evalue vectors (per_thread_len pattern); compute r_eff, log stats.
4. Post-pass: after the summary block, build TagFDR once; stream-rewrite `<out>` to `<out>.tmp` appending `q_db` parsed off each row's evalue column (q is a pure function of evalue), atomic rename; end-to-end column test in `test/fastag_test.cpp` with two small FASTAs.
5. Smoke: `local_test.mzML` + `9606.fasta` + `83333.fasta` entrapment, `-tag_length 4 -extension 4`; byte-identity of target rows modulo the new column; sane r_eff/overlap logs.
6. Fetch the archaeal entrapment ensemble (Phase 0.2) to reach r_eff ~0.5–1 vs human's ~11M residues; also a shuffled-9606 FASTA (10-line script) as the composition-matched alternative null.
7. Run the validation protocol; update README column docs; rewrite BACKLOG F4 with measured calibration curves. Opt-in only, no default changes.

**Files touched.** `src/TagFDR.h` (recreate), `test/tagfdr_test.cpp` (recreate), `src/FastaFilter.h/.cpp`, `src/FASTag.cpp`, `CMakeLists.txt`, `test/fasta_filter_test.cpp`, `test/fastag_test.cpp`, `README.md`, `doc/BACKLOG.md`, optional GUI param regen via `gen-params.mjs`.

**Validation gate (real data).** (0) Recreated tests green; spot-agree with the surviving binary. (1) Byte-identity on `local_test.mzML`. (2) **Primary — entrapment-on-entrapment calibration audit** (FDRBench methodology, no PSM truth needed): sample = `~/Claude/bench_astral_lf.mzML` (**substituted** for the brief's bench_astral_dda per Open conflict 1 — the dda file is TMT-labeled Eclipse ion-trap, exactly the fixed-mod/tolerance confound the audit must avoid; confirm sample species with a `-species` run first); target DB = `9606.fasta` PLUS a held-out foreign proteome B as pseudo-target (archaeon set 2, or on-disk `83332` M. tuberculosis); calibration entrapment A = archaeon set 1. For q_db ≤ x ∈ {0.005, 0.01, 0.02, 0.05, 0.1}: B-only match count scaled by B's own key ratio, over target matches, must be ≤ x within binomial CI across the curve; swap A/B (calibration must agree between entrapment choices); repeat with shuffled-9606 to bound composition sensitivity. (3) Scale/perf on the same lf file at full 102k spectra — wall time, peak RSS, curve stability. (4) Ground-truth cross-check quantifying what q_db is NOT: the restored PXD000001 pipeline (Phase 0.2) with `218491.fasta` + archaeal entrapment; against 1%-FDR PSMs, publish per-tag correct-read rate as a function of q_db side by side with the q_db curve (88.5% best-per-spectrum baseline) — demonstrating q_db calibrates DB-match spuriousness while correct-read remains governed by the E-value. Ship opt-in only; no default flips until (2)–(4) hold on these files.

**Effort.** 2–3 days (~1.5 code+tests — TagFDR recreation is half a day since the contract is recovered — ~1 day validation runs/analysis).

**Risks.** Equal-chance violation (wrong-read tags are human-composition, archaea differ) → q_db underestimates — mitigated by k-mer-space r_eff, the shuffled-target null (r≈1), and the entrapment-on-entrapment audit measuring miscalibration directly. Misreading q_db as de novo correctness is the biggest user-facing hazard — guarded by naming, doc strings, and publishing the PXD000001-measured gap. Memory: two proteome-scale filters can reach ~8 GB (`FastaFilter::build` throws >4 GB per instance) — document, log projections, prefer archaeal ensembles over a second mammalian proteome. Small N_entrap makes the curve step-noisy with 1/r_eff amplification — +1 pseudo-count bounds the anti-conservative tail; WARN surfaces it. Reimplementation drift bounded by the recovered symbol-level API and runnable binary. Entrapment species coinciding with a real contaminant would inflate the null — archaea are not plausible lab contaminants (documented selection rule). TSV post-pass assumes `-out` is a regular file on one filesystem (atomic rename) — noted in code.

---

## Phase 2 — tagger features

### 2.1 F12 — top-N tag diversity per precursor for chimeric spectra

**Chosen design.** Opt-in greedy peak-set diversity that **orders slot occupancy but never filters** — the same principle the gap penalty established (`FASTagger.cpp:1012-1025`). Problem: on a chimeric spectrum the dominant peptide's ladder produces many distinct survivors (adjacent-offset re-reads sharing k−1 of k peaks; alternative gap spellings with identical peaks) that fill every `-max_tags` slot; the co-isolated peptide's tags fall below the cap. Flank masses cannot define this redundancy (they sum to the precursor residue mass for every tag by construction). The exact, deterministic signature is the **peak-index set** (indices into the shared `Prepared::spec`, already in hand at `emit()` time, just not carried into the Tag). Near-duplicate rule (precise, integer, parameter-free): A and B are near-duplicates iff |peaks(A) ∩ peaks(B)| ≥ min(|A|,|B|) − 1 — catches adjacent-offset re-reads, sub-reads, and gap respellings; deliberately does NOT merge b- vs y-series reads, charge variants, or distal windows (genuinely different evidence — the recall-safe direction). Selection: walk the already-sorted, cutoff-passed, deduped stream once; non-near-duplicates of kept tags go to `kept` (stop at N), others to `deferred` (bounded at N); backfill kept from deferred in rank order; **re-sort the selected N by the existing (evalue, seq, low_mz) comparator** so the header's "ordered by E-value, best first" contract (`FASTagger.h:153`) is untouched. Output size and rank 1 are provably unchanged; only which tags occupy the capped slots. No-op when `max_tag_count == 0` or flag off. O(M·N·k) two-pointer intersections on a list the existing loop already walks. Default off per both standing principles.

**Steps.** (1) `bool diversity = false;` in Param (`FASTagger.h` ~line 63) with the orders-not-filters doc. (2) File-local `struct ScoredTag { Tag tag; std::vector<uint32_t> peaks; }`; `scored` (line 874) becomes `vector<ScoredTag>`; `emit()` (line 805) pushes {tag, peaks}; adapt the stable_sort comparator (994) and penalty loop (984). (3) Replace the final loop (1009–1042) keeping cutoff/early-exit/dedup exactly as-is; flag-off path must reduce to today's behavior exactly. (4) `registerFlag_("diversity", …)` near `FASTag.cpp:334`; wire near 521. (5) Tests in `test/fastag_test.cpp`: two-peptide chimeric spectrum from ideal y-ladders (dominant intense, co-isolated weak, disjoint peaks) — with small cap + diversity on, some tag reads the co-isolated peptide while rank 1 still reads the dominant; off-equals-pre-change; determinism (run twice); output size = min(N, survivors) on/off. (6) Extend `bench/benchmark.cpp`: record the synthesized chimera peptides (currently dropped at ~line 339) and add chimera-recall counters at N ∈ {5,10,50} plus dominant-peptide rank1/top5/any; run astral and ddapasef profiles on/off. (7) Real-data runs; update BACKLOG F12 row (line 237) MAYBE → DONE-as-opt-in with measured numbers. (8) Optional follow-up: Tauri GUI checkbox.

**Files touched.** `src/FASTagger.h/.cpp`, `src/FASTag.cpp`, `test/fastag_test.cpp`, `bench/benchmark.cpp`, `doc/BACKLOG.md`.

**Validation gate (real data).** (1) Regression/determinism: pre-change vs patched without `-diversity` on `local_test.mzML` and `bench_astral_dda.mzML` — bit-identical TSVs; patched with `-diversity` twice — bit-identical. (2) Synthetic chimera benchmark (gates the mechanism only): chimera recall must rise while dominant-peptide rank1/top5/any move within noise; per-spectrum tag count identical on/off. (3) Real chimeric-rich data: `bench_astral_lf.mzML` (wide-window, 102k spectra) with `-max_tags 10` on/off — wall-clock delta < a few percent; via `-fasta` against `9606`, spectra whose top-10 tags hit ≥2 distinct proteins (expected up) and spectra with ≥1 hit (**any drop blocks the feature**). (4) Control: same ≥1-hit comparison on a narrow-isolation file — note per Open conflict 1 that `bench_astral_dda.mzML` is Eclipse TMT SPS **co-isolation-rich**, so it is NOT the narrow-isolation control the brief assumed; use `local_test.mzML` or a DDA run with narrow isolation, and treat the Eclipse file as a second chimera-rich case. Ship default-off regardless.

**Effort.** ~1 day. **Risks.** Gap-spelling siblings share identical peak sets — under a tight cap a correct alternative spelling can defer out (opt-in, documented; exempt equal-peak-set families later if real data shows it biting). Coincidental all-but-one sharing in very dense spectra (bounded by the integer rule + backfill = demotion, not deletion). Not provably recall-neutral under a cap — hence default off and the benchmark gate. Rank semantics within a capped spectrum change for row-order-deriving consumers (flag doc; evalue column permits re-sorting).

### 2.2 F10 — low-latency single-spectrum tagging (`-stream`)

**Chosen design.** A `-stream` mode on the existing binary (~100–150 lines in `main_`), plus documenting the already-existing in-process C++ API (`FASTagger.h` + `libfastag_core.a`: `Tables` once, `tagSpectrum` per spectrum, thread-safe by construction). Measured on this machine (real Astral data): per-spectrum `tagSpectrum` at CLI defaults is **67 µs mean / 214 µs worst** over 2000 stride-sampled MS2 spectra; the budget-breakers are fixed costs — ~50 ms warm process start (~1.7 s cold), Tables ~85 ms at defaults / ~1.06 s heavy (extension 2, gaps 1), and mzML parsing (a 1-spectrum run on the 309 MB file takes 1.44 s, 100% fixed cost). A resident process reading line-oriented spectrum blocks from stdin removes every fixed cost: header `spectrum <id> <precursor_mz> <charge>` (charge ≤ 0 → treated as 2 per the FASTagger.h contract), `<mz> <intensity>` lines, blank-line terminator; output is file-mode-identical TSV rows plus a `#end <id> <n_tags>` sentinel per block, flushed; malformed input → `#error <id> <msg>` + resync, never exit; diagnostics on stderr only. Rows come from the same `tag_one` lambda as file mode (tid 0) so the two paths cannot drift. Pipes beat sockets/FFI: reachable from any instrument-control host (Thermo iAPI is C#, Bruker SDK is C), zero lifecycle management, sub-ms steady state with ~100× headroom against a tens-of-ms budget.

**Steps.** (1) `registerFlag_("stream")`; `-in`/`-out` become optional with a manual check (file mode without both → ILLEGAL_PARAMETERS with TOPPBase's wording). (2) In stream mode skip species file probes, OnDiscMSExperiment/mzPeak setup, subsampling, tolerance probe; keep mods, FastaFilter, Tables. (3) Route TSV header+rows to stdout via a `std::ostream*` chosen once; verify OPENMS_LOG_* go to stderr, redirect if not. (4) Read-eval loop after the `tag_one` lambda (~line 837): strtod parse into an MSSpectrum with one Precursor, `sortByPosition()`, `tag_one(spec, 0)`, write buf + sentinel, flush; `#error` + resync on parse failure. (5) Protocol docs in flag help + README, plus a README section on the C++ API. (6) Test: 3 spectra piped through `-stream`, rows byte-identical to file mode, `#end` for a zero-tag spectrum, malformed-block resync.

**Files touched.** `src/FASTag.cpp`, `README.md`, `test/` (new stream test), `CMakeLists.txt` if a separate target.

**Validation gate (real data).** (1) No-drift: file mode on `~/Claude/bench_astral_dda.mzML -subsample_spectra 2001` (147 rows) vs the same spectra piped through `-stream` — byte-identical. (2) Latency: a Python driver holds the child open, feeds 2000 stride-sampled spectra, measures write-to-sentinel per spectrum at (a) defaults, (b) `-extension 2 -gaps 1`, (c) `-fragment_tolerance 0.3 Da`; **pass if p99 < 10 ms** (expected < 1 ms at defaults); include at least one >50k-peak spectrum from `bench_astral_lf.mzML` (the corpus reaches ~130k peaks per the ChunkingConsumer comment). (3) Robustness: malformed header, non-numeric peak, zero-peak block, unsorted peaks, EOF mid-block — never a nonzero mid-stream exit, exactly one sentinel per block. (4) `time FASTag -stream </dev/null` confirms resident-start cost paid once.

**Effort.** Half a day. **Risks.** Log-stream contamination of stdout (step 3 + test asserts no stray lines); relaxing `-in`/`-out` must not let bare `FASTag` hang on stdin; heavy-config per-spectrum cost not yet measured (validation covers it); charge<2 silently → 2 must be documented for instrument integrators; parameter changes require restart by design (Tables immutability).

### 2.3 F11 — per-spectrum glycopeptide flag via oxonium ions

**Chosen design.** A separate per-spectrum TSV following the `-species` pattern — NOT a column in the main tag TSV — because the main TSV has rows only for tag-bearing spectra and glyco spectra are precisely the tag-poor ones a column would systematically miss (statistical honesty, not taste). `-glyco` writes one row per MS2 spectrum to `<out>` with a `.glyco.tsv` suffix (override `-glyco_out`, same derivation as `-species_out` at `FASTag.cpp:1216`). Detection in a new header-only `src/Glyco.h` (Proforma.h pattern): a static ~14-entry table of canonical singly-protonated oxonium m/z (HexNAc 204.08665 and fragments 186.07608/168.06552/144.06552/138.05495/126.05495; Hex 163.06010; HexHexNAc 366.13948; NeuAc 292.10269/274.09213; NeuGc 308.09761/290.08705; HexNAc+Hex+dHex 512.19737; HexNAc+Hex+NeuAc 657.23488 — a superset of MSFragger-Glyco's defaults). Per target: binary-search the m/z-sorted **raw** spectrum (before max_peaks/window selection, so peak budgets can never eat the oxonium region), most intense peak within tol = `tol_ppm ? mz*frag_tol*1e-6 : frag_tol` — identical semantics to `-fragment_tolerance` elsewhere. Flag rule combines the two accepted literature heuristics: glyco=1 iff ≥2 distinct oxonium species matched (GPQuest/Toghi Eshghi) AND summed matched intensity / base peak ≥ 0.10 (MSFragger-Glyco `diagnostic_intensity_filter`; the one knob, `-glyco_min_fraction`). Charge-1 matching is correct, not a shortcut (oxonium ions are intrinsically 1+; every published detector matches 1+ m/z on raw peaks, no deisotoping). Columns: spectrum, n_oxonium, oxonium_frac (can exceed 1, MSFragger convention), glyco (0/1), ions (semicolon names, `-` if none). Honesty guard: track MS2 spectra whose scan window starts above m/z 205 and WARN when most do (absence is not evidence). Hook is `record()` — it receives (idx, spec) on both input paths and writes idx-distinct slots, so it stays race-free and byte-deterministic under `-threads`.

**Steps.** (1) `src/Glyco.h` (~80 lines): constexpr table with citations, `scanOxonium()` (lower_bound per target, windowed max, names string, base-peak division, empty-spectrum guard). (2) Register `-glyco`, `-glyco_out`, `-glyco_min_fraction` (default 0.10, min 0) beside the `-species` block (~line 374); open the ofstream before the loop, CANNOT_WRITE_OUTPUT_FILE on failure. (3) Block-local `glyco_rows` in `prep_block`; fill in `record()` **before** the empty-buf early return, for MS2 non-empty spectra. (4) Flush in `write_block()` independent of `keep[]`; serial counters for n_glyco and front-m/z>205. (5) Summary log line; WARN if >~90% of MS2 are scan-range-clipped (style of the ion-trap tolerance warning at line ~750). (6) `test/glyco_test.cpp` (+ CMakeLists.txt:179): 204.0867+366.1395 dominant → 1; b/y-only → 0; single 204 → 0 (count rule); two ions at 5% base → 0 (fraction rule); ±ppm edges at 20 vs 25 ppm; Da path; spectrum starting at m/z 300 → n_oxonium 0. (7) README option table + Output subsection (flag = oxonium-bearing spectrum — glycopeptide, free glycan, or O-GlcNAc — NOT an identification; row count deliberately exceeds "MS2 tagged"; frac range) ; regen `gui/src/params.generated.json` via `node gui/scripts/gen-params.mjs`. (8) Validate; -threads 1 vs 8 byte-identity on the .glyco.tsv.

**Files touched.** `src/Glyco.h` (new), `src/FASTag.cpp` (~70 lines), `test/glyco_test.cpp` (new), `CMakeLists.txt`, `README.md`, `gui/src/params.generated.json` (regenerated).

**Validation gate (real data).** Specificity on real local negatives: `-glyco` on `bench_astral_dda.mzML`, `bench_astral_lf.mzML` (subsample 20000), `bench_hela_ddapasef.mzML` (13 GB, subsample) — non-enriched tryptic runs should flag well under ~2–3% of MS2; materially higher is a false-positive bug (eyeball 5 flagged spectra for genuine 204.0867/366.1395). Determinism: `-threads 1` vs `8`, `cmp` byte-identical. Tolerance monotonicity: n_oxonium may only shrink from 20→10 ppm. Unit tests cover the matcher; **shipped thresholds are literature values (GPQuest ≥2 ions; MSFragger 0.10), never locally fitted** — per the synthetic-evidence rule. Sensitivity requires a public PRIDE glyco-enriched run — download needs user approval (deferred; until then the flag ships documented as literature-parameterized). Note per Open conflict 1: the dda file is TMTpro-labeled — TMT reporter 126.128 vs HexNAc fragment 126.055 collide at 0.3 Da but separate cleanly at ppm; run its specificity check at ppm and keep the Da-tolerance caveat in the README.

**Effort.** Half a day. **Risks.** No local true-positive data (sensitivity pending approval); Da-tolerance coincidences (documented, not tuned); 126/138/144 in the immonium region at loose tolerances; row-count mismatch with the main log (intended, one README sentence); frac >1.0 consumers; flag is a spectrum property, not an ID.

### 2.4 Bound `-out_spectra` memory (two-pass write)

**Chosen design.** Two-pass write for the mzML-in → mzML-out case, NOT per-block streaming. Today every kept spectrum accumulates in `PeakMap kept` and is stored once at the end — gigabytes held until exit on a 1.9 GB no-filter run (the help text admits "memory proportional to the FILE"). During tagging, record only global input indices of kept spectra (`std::vector<Size> kept_idx`, appended in `write_block` in input order — a few hundred KB). After the loop the kept count is exact, so `PlainMSDataWritingConsumer` can be fed correctly: `setExperimentalSettings` + `setExpectedSize(kept_idx.size(), 0)` + `addDataProcessing(getProcessingInfo_(DataProcessing::FILTERING))` **all before the first consume** (the consumer writes the header and `<spectrumList count>` lazily at the first `consumeSpectrum` from `spectra_expected_`), then serially re-read each kept spectrum via `ondisc->getSpectrum(i)` (or `exp[i]` on the no-index fallback) and consume it; the destructor writes footer+index. Memory becomes O(1 spectrum); cost is one serial re-read of only the kept spectra. Per-block streaming was rejected on **correctness**: the count is baked into the file at the first spectrum, before the total is knowable — you'd ship `count="0"` (schema-invalid, breaks pymzml `len()`), and patching afterwards shifts bytes and invalidates the index offsets. Output stays byte-identical to today in the normal case (verified mechanism-by-mechanism: identical writeHeader_/writeSpectrum_/writeFooter_, binary ofstream with `writtenDigits(double())` precision, indexedmzML default, exact count, same DP chain). Keep today's accumulate+store path whenever mzPeak is involved: no streaming mzPeak writer exists in this build (`MzPeakFile::store` is bulk-only), and mzpeak input materializes upstream anyway (documented 23.7 GB for a 2.11 GB file) with no reliable index to re-read by. `stream_out = !out_spectra.empty() && !mzpeak_in && !mzpeak_out`. Empty-result behavior preserved exactly (consumer constructed only once kept_idx is non-empty; no file, UNEXPECTED_RESULT).

**Steps.** (1) `stream_out` bool beside the mzpeak decisions (~line 625); `kept_idx` + `block_base` beside the block buffers (~line 820). (2) Gate `record()`'s `kept_spec[idx] = spec` (~904), `prep_block`'s resize (~915), `write_block`'s `kept.addSpectrum` (~957) on `!stream_out`; push `block_base + i` instead; set `block_base` before each `write_block` in the mzML loop (~1052/1118). (3) Replace the final write (~1427–1449) with the scoped consumer loop for stream_out; keep kept/store for mzPeak paths; include `MSDataWritingConsumer.h`. (4) Skip populating `kept` and its ExperimentalSettings copy when stream_out. (5) Update `-out_spectra` help (~line 284: the memory warning now applies only to .mzpeak output / mzpeak input — or the bound claim is dishonest), README, and a `doc/BACKLOG-mzpeak.md` line that bounding .mzpeak output needs a streaming Parquet writer (row-group appends + metadata at close). (6) Validate; commit once, push once.

**Files touched.** `src/FASTag.cpp`, `README.md`, `doc/BACKLOG-mzpeak.md`.

**Validation gate (real data).** (1) Byte-identity, filtered: old vs new on `bench_astral_dda.mzML` + `-fasta 9606` + `-out_spectra kept.mzML`; `cmp` both kept.mzML and TSVs. (2) Memory bound, worst case: `bench_astral_lf.mzML` (1.9 GB, 102k spectra), no `-fasta`, both binaries under `/usr/bin/time -l` — new max RSS near the no-out_spectra baseline; `cmp` outputs. (3) `FileInfo -v` + MzMLFile round-trip on the new output. (4) Regression on unchanged paths: `local_test.mzML` → .mzpeak before/after via load()-equivalence (ZIP bytes need not be deterministic). (5) Empty-kept path: absurd `-max_evalue` → no file created, exit code unchanged. Optional headline: repeat (2) on the 13 GB `bench_hela_ddapasef.mzML`.

**Effort.** ~1 day. **Risks.** Serial second decompress of kept spectra (measure; a read-ahead ring is a later optimization). Byte-identity edge cases: heterogeneous scan modes / per-spectrum sourceFile entries change the header vs today; `=`-less native IDs are no longer renewed (arguably a fix; changelog note — see Open decisions). Serial reuse of the master `ondisc` reader after the parallel loop (exercise on bench_astral_dda first). Crash mid-second-pass leaves a truncated file (same exposure class as any writer; `store()` isn't atomic either). mzPeak paths remain unbounded — deliberate and documented.

### 2.5 F14 — overlap-friendly long reads for antibody assembly (Stitch/ALPS)

**Chosen design.** A hybrid — one small opt-in C++ column plus one stdlib script — because the brief's premise ("nearly free given F4+F13") fails against what the consumers actually parse. Verified from Stitch's source: it reads a PEAKS CSV **positionally** (`Format: Old`, 15 fixed columns), extracts the sequence as `peptide.Where(Char.IsUpper && Char.IsLetter)` (so inline `X[ModName]` is silently wrong and ProForma `J` is not in blosum62.csv/default_alphabet.csv), requires local confidence as space-separated **integers** whose count equals the residue count, and a **constant Area=1 produces NaN intensity** (min==max in `(log10(Area)-min)/(max-min)`, Read.cs:234) — Area must be 0 for Stitch (and 1 for ALPS, matching denovopipeline). Both consumers need a per-residue confidence vector **that FASTag computes and throws away** (`src/FASTagger.cpp:640-671` computes `mz_fit * int_fit` per edge, keeps only min/mean) — so a pure script cannot be written honestly (flattening mean_conf across positions fabricates the one column the consumer reads). Part 1: opt-in `-res_conf` appends one TSV column — space-separated integers 0..100, one per residue, N→C, gap edge's value written twice ((k−2)+2 = k = n_res); `min_conf == min(res_conf)/100` and `mean_conf == mean/100` by construction (free test cross-check). **The one correctness trap:** `spell()` (`FASTagger.cpp:160-176`) walks the path backwards (traversal is C→N), so the confidence vector must be **reversed** before writing or every tag's confidences are mirrored — a bug no mass or length check catches. Gate the push_backs on `p.per_residue_conf` so the default path allocates nothing and stays bit-identical. Part 2: `tools/tags_to_denovo.py` (stdlib) emits Stitch-PEAKS-`Old` or ALPS CSV, with all vendor trivia, `--top-n 1` default (FASTag's ≤50 per-spectrum tags are correlated readings of one ladder, not independent observations — un-thinned export inflates consensus depth ~50×), `--min-length 8` (ALPS at k=6..8 gets zero k-mers from shorter reads), flanks parked in Stitch's free-text PTM column as `n=<nterm_mass>;c=<cterm_mass>` (metadata, weighted zero — neither assembler can use them), mods PEAKS-style `S(+79.9663)` for Stitch and stripped for ALPS, L never J, `--check` self-validator reimplementing Stitch's parser constraints, `--batchfile` snippet with a **measured** CutoffALC (Stitch's default 90 against naive 100·mean_conf would discard nearly everything — median min_conf is ~0.45 for correct vs ~0.17 for incorrect tags).

**Steps.** (1) `Param::per_residue_conf = false` + `Tag::res_conf` (`vector<uint8_t>`, contract in comment). (2) In the per-edge loop (`:653-671`): push `lround(100*c)` once per ordinary edge, twice per gap edge; **reverse before returning**; debug-assert size == n_res. (3) `FASTag.cpp`: `registerFlag_("res_conf")` beside `-proforma`; append `\tres_conf` to header at :771 after proforma; space-joined ints in the row builder (:877-891). (4) Unit tests: size/min/mean identities; **ORDER** — a spectrum whose weakest-supported residue sits at a known terminus must put the low value at the matching end (the test that catches the reversal); gapped duplication. (5) `tools/tags_to_denovo.py` with docstring explaining Area 0-vs-1, L-not-J, top-n 1; name the Stitch source files/revision the layout was read from. (6) Regression: `-res_conf` off → TSV byte-identical on bench_astral_dda; benchmark shows zero slowdown. (7) Run the calibration measurement **before** writing any recommended-settings runbook; only then README + BACKLOG F14 flip, quoting measured numbers.

**Files touched.** `src/FASTagger.h/.cpp`, `src/FASTag.cpp`, `test/fastag_test.cpp`, `tools/tags_to_denovo.py` (new), `README.md`, `doc/BACKLOG.md`.

**Validation gate (real data).** Step 2 is the gate: `FASTag -in <human DDA> -fasta 9606.fasta -tag_length 4 -extension 6 -res_conf -subsample_spectra 20000`, using `fasta_hit` as a per-tag correctness proxy restricted to length ≥ 8 (a 4-mer hits by chance; state the caveat). By residue position: (a) mean res_conf for hit vs non-hit rows — if hits are not higher at every position, the column is not a per-residue confidence and the feature does not ship; (b) hit rate as a function of extension-added residues — this decides the recommended `-extension` (extension's greedy best-|Δm/z| walk, `extendPath` :747, has never been measured per-position; if outer residues are near-random, cap the documented setting and say so). **Substrate note (Open conflict 1):** run the primary calibration on `bench_astral_lf.mzML` (label-free, ppm) with `bench_astral_dda.mzML` as the cross-check at its correct 0.3 Da/TMT settings, not the reverse. Step 3: `--check` conformance offline. Step 4 (needs Stitch, not installed here): known-answer proxy — abundant human protein (albumin/keratin/tubulin) as Stitch template, converted reads at `--top-n 1` vs `--top-n 50`, score consensus coverage/identity — turns the correlated-reads risk into a measurement. Step 5: byte-identity + benchmark regression.

**Effort.** 1–2 days (+0.5 day machine time for calibration, which gates the runbook). **Risks.** Read length is the real, unmeasured gate (default tag_length 3 is useless to both consumers); correlated reads inflate consensus support (mitigated by --top-n 1 + warning, not eliminated); positional-format silent misparse on a Stitch layout change (pinned `Format: Old` + `--check`); the Area NaN trap (must stay covered by `--check`); I/L unrecoverable (Natural19WithoutI — contigs show L where I is correct, incl. CDRs; documentation, not fixable); flanks contribute nothing to assembly (README must say so plainly); hot-path allocation (flag must gate the push_backs, not just the output); ALPS parser undocumented (5-column layout inferred from one pipeline's invocation — label the ALPS half lower-confidence).

---

## Phase 3 — GUI

### 3.1 GUI test harness (vitest + @testing-library/react + jsdom)

**Chosen design.** Vitest 4 + RTL 16 + jsdom driving the real `<App />` through a hand-rolled `window.fastag` mock with a control surface (emitLog/emitProgress/emitDone, holdRun/releaseRun, recorded runCalls/previewCalls/speciesCalls, programmable pick* returns) — because `App.tsx` never imports `api.ts`; `main.tsx` installs `window.fastag` as a global, so the global IS the seam the shipped code uses (no `vi.mock` of @tauri-apps). Toolchain fits: vitest 4.1.11 declares vite `^6||^7||^8` and dedupes onto the project's vite 8.2.2. Config in a separate `gui/vitest.config.ts` (jsdom, globals:true — needed only so RTL's auto-cleanup/act-environment hooks engage; tests still import from 'vitest' explicitly, so `npm run build`'s tsc pass typechecks tests for free). One tiny source change: move `declare global { interface Window { fastag: FastagApi } }` from `api.ts` to `types.ts` so tests can assign the mock without executing api.ts's Tauri imports. Fourteen tests covering the orchestration that nearly broke in review: duplicate-done-dropped (pending Map keyed by runId), unknown/undefined-runId ignored, early-done-buffered (the done-before-invoke-reply race that `earlyDone` exists for, reproduced via holdRun), failed-start and rejected-invoke settle, batch-cancel stops the queue, batch overrides (`species_out:''`, `out_spectra` → `<stem>.spectra<ext>` per job), last-job species path, out-collision numbering, input dedup, dotted-dir `stripExt` on both slash flavors, single-run species path, run gating. Seeding parameter state goes through `loadSettings().lastUsed` (merged over defaults at App.tsx:109). Every emit wrapped in `act()`, queue advancement asserted via `waitFor` (the batch loop resumes on microtasks). CI: a new **independent** `gui` job (ubuntu-24.04, node 24, `npm ci; npm run typecheck; npm test` in `gui/`) — no `needs:`, it must not wait ~70 min for OpenMS.

**Steps.** (1) `npm i -D vitest jsdom @testing-library/react @testing-library/dom` (RTL 16 made @testing-library/dom an explicit peer); verify one vite via `npm ls vite`. (2) Move the Window declaration to `types.ts`. (3) `gui/vitest.config.ts` + add it to `tsconfig.node.json` include. (4) `gui/src/testing/mockBridge.ts` (~120 lines, plain object + listener arrays). (5) `gui/src/App.test.tsx`, tests 1–14 (evidence-regex parsing and unmount-unsubscribes as follow-ups). (6) package.json scripts `test`/`test:watch`. (7) Mutation check: break stripExt's slash guard, key onDone to first-pending-entry, drop the second batchCancel check — tests 12, 1, 6 must each fail; revert. (8) Add the `gui` CI job; commit as ONE push per the CI-cache rule.

**Files touched.** `gui/vitest.config.ts` (new), `gui/src/testing/mockBridge.ts` (new), `gui/src/App.test.tsx` (new), `gui/package.json` + lock, `gui/src/types.ts`, `gui/src/api.ts`, `gui/tsconfig.node.json`, `.github/workflows/ci.yml`.

**Validation gate (real data).** (a) `npm run typecheck && npm test` green, zero act warnings, zero unhandled rejections (node v26.5.0/npm 12.0.2 verified present). (b) **Ground the path-derivation tests against the CLI:** run the built FASTag with `-species` on `bench_astral_dda.mzML` writing tags into a dotted directory (`…/runs.2026/astral.tags.tsv`) with no `-species_out` and confirm the CLI writes `runs.2026/astral.species.tsv` exactly where `defaultSpeciesOut`/`stripExt` predict — this cross-check is what makes the tests honest rather than self-referential. (c) Mutation checks. (d) Push once; `gui` job passes in ~1–2 min.

**Effort.** ~1 day. **Risks.** React 19 act-warning noise (await the probe badge first); microtask-timing flakes without waitFor; bare `tsc` couples build to test type-hygiene (treated as a feature); the known product wart — `showResults` rejecting inside onClick-driven `run()`/`runBatch` becomes an unhandled rejection (don't write that test until App gains a `.catch`; see Open decisions); a future vitest/vite major range split (pin `^4.1`; `npm ci` catches double-vite); duplicate dones parked forever in `earlyDone` (harmless, documented by test 1).

### 3.2 Million-row results browser

**Chosen design.** Candidate B — a plain Rust indexed reader, **zero new dependencies**. The tags TSV is a fixed 12-column schema (written at `src/FASTag.cpp:771`, no quoting, split-on-tab exact; ~68 B/row measured, so 1M rows ≈ 70–100 MB, hela-scale ~10M rows / ~1 GB). On open: one sequential scan builds a `Vec<u64>` of line-start offsets (8 MB per 1M rows, ~1–3 s for 1 GB from page cache, inside `spawn_blocking`). Sort/filter builds a cached view: one full scan evaluating the filter predicate and collecting the sort key per matching row, then sorting a permutation `Vec<u32>` (5M f64 keys ≈ 60 MB transient, ~1 s; string columns a few hundred MB transient at 10M rows — acceptable on a machine that just ran FASTag, which needs ~2 GB). Windows serve ≤1000 rows by seeking to view offsets (~100 KB JSON IPC). One Tauri command `results_query(path, view, offset, limit)` with a single-slot cache keyed by (path, len, mtime) for the index and ViewSpec equality for the view; numeric sort parses f64 with `-`/unparsable last, byte-wise string fallback; Err(String) on IO error (a browser must say the file vanished, unlike preview's silent empty). Filters: spectrum substring (case-insensitive), min length, max evalue, fasta_hit tri-state any/only(≠`-`)/none. Frontend: hand-rolled fixed-row-height (28px) virtualization — NOT react-window, because above ~600k rows the spacer div exceeds WebKit's ~16.7M px max element height and react-window breaks the same way, so proportional scrollTop→row mapping (spacer capped at 15M px) must be hand-written regardless; at that point the dep buys nothing. Page-aligned 500-row chunks in a Map with in-flight dedupe, LRU beyond 40 pages, cleared on ViewSpec change; header-click sort asc→desc→off; status line "matched X of Y rows". The browser **replaces** the preview pane (one results path): after a run App.tsx sets `resultsPath`; `preview.rs`, its registration, the Preview type, and `api.preview` are deleted once the swap compiles. Rejected: DuckDB (libduckdb-sys compiles the C++ amalgamation — 15–40 min extra per CI platform, worst on the already-fragile ~1h15m Windows MSVC build, +40–70 MB binary, for 4 fixed filters and a sort over a schema we control) and rusqlite (cheap dep but full import per open plus a disk-sized temp DB lifecycle; the designated fallback if requirements grow to ad-hoc SQL/joins).

**Steps.** (1) `gui/src-tauri/src/browser.rs`: offset-index builder (BufReader/read_until, CRLF trim), view builder, window server, `results_query` in spawn_blocking, (len, mtime) invalidation; unit tests (fixture correctness, numeric vs string sort, each filter, `-` handling, CRLF, missing file → Err, cache reuse/staleness). (2) Wire `lib.rs`: `mod browser`, `.manage(BrowserCache::default())`, register in `generate_handler!`. (3) `ResultsView`/`ResultsPage` in types.ts, `resultsQuery` in api.ts + FastagApi. (4) `ResultsTable.tsx` with the capped-spacer mapping, page cache, sortable headers, filter bar, status line; styles in index.css. (5) Swap App.tsx (`resultsPath` instead of preview state; species path untouched; delete the truncation notice; optional "Open results TSV…" picker, ~10 lines). (6) Delete preview.rs and its API surface **and update the vitest fixture/tests that reference `preview`** (Open conflict 5). (7) Validate; adjust page size/spacer cap only if measurements demand.

**Files touched.** `gui/src-tauri/src/browser.rs` (new), `gui/src-tauri/src/lib.rs`, `gui/src-tauri/src/preview.rs` (deleted at the end), `gui/src/types.ts`, `gui/src/api.ts`, `gui/src/ResultsTable.tsx` (new), `gui/src/App.tsx`, `gui/src/index.css`, plus `gui/src/App.test.tsx` / `mockBridge.ts` updates.

**Validation gate (real data).** `cargo test` in src-tauri; generate a genuinely large file with the actual tool — FASTag on `bench_astral_lf.mzML` (a prior 42k-spectra run produced 1,130,228 tags, so expect ~2–4M rows / ~200–400 MB); `local_test.tags.tsv` (12,584 rows) for correctness. Cross-check against coreutils on the same file: matched count for maxEvalue=1e-3 equals `awk -F'\t' 'NR>1 && $9<=1e-3' | wc -l`; first page of evalue-asc equals `sort -t$'\t' -k9,9g | head`; last unsorted window row equals `tail -1`. Perf targets: cold open <3 s on the ~300 MB file, warm window <100 ms, sort <2 s. GUI smoke via `npm run tauri dev`: scroll to the very end (exercises the capped-spacer mapping), sort every column both ways, apply each filter and compare status-line counts to the awk numbers.

**Effort.** ~1.5 days. **Risks.** The proportional mapping is required, not polish (above the cap a wheel tick moves multiple rows — acceptable; sort/filter are the real navigation); string-sort transient memory at 10M rows (document the bound; revisit with (offset,len) slice keys only after a real file hurts); a re-run overwriting the open file can serve one garbage window before (len, mtime) catches it (App resets the view on run completion — seconds of exposure); IPC limit clamped at 1000 rows; a scroll during a cold 1 GB index build waits ~2–3 s on the cache mutex (spawn_blocking keeps the UI live; in-flight dedupe prevents pile-up).

---

## Open conflicts

Flagged rather than silently resolved; each names an owner decision or a concrete fix already folded into the plan above.

1. **`bench_astral_dda.mzML` is not what five briefs think it is.** The data-inventory brief verified its metadata: Orbitrap **Eclipse**, ion-trap Turbo CID MS2, **TMTpro16plex** human 4-cell, 41,407 spectra (MSV000096674) — not Astral DDA. This collides with: **F4** (uses it as the primary entrapment-audit sample described as "human DDA" — TMT fixed mods and ion-trap tolerance are exactly the confounds the audit must avoid → substituted with `bench_astral_lf.mzML`, as the inventory brief itself recommends); **F12** (uses it as the *narrow-isolation control* expecting chimerism to be rare, while the inventory identifies it as TMT SPS co-isolation-**rich** → control substrate replaced); **F14** (step-2 calibration at implied ppm defaults on ion-trap data → primary moved to lf); **F11** (calls it non-enriched HeLa; it's a TMT 4-cell mix — fine as a specificity negative at ppm, but the TMT-reporter/126.055 collision caveat applies); **F10** (latency measured on it as "Astral DDA" — the timings are real and stand, but the instrument label in any published numbers must be corrected). Phase 0 renames/aliases the file; each affected validation gate above has been adjusted. This is `doc/TEST-DATA.md`'s own documented mislabeling trap biting the planning layer.
2. **build-rel binary health: F14 vs F10 vs today.** F14 reported `build-rel/FASTag` aborting on every input with `OMP: Error #15` (two libomp copies: `/opt/homebrew/opt/libomp` and the omsbuild env via libOpenMS's second LC_RPATH) and made it a hard blocker; F10 took extensive measurements with the same tree in its session. Checked during synthesis: `build-rel/FASTag --help` currently exits 0 on this machine. The blocker is therefore environment-dependent/intermittent, not a standing fact. Action: before any Phase 1/2 benchmark session, run the one-line health check; if it aborts, apply F14's fix (symlink libomp into the first rpath dir, `OpenMS-mzpeak-build/build/lib`, or use `gui/scripts/bundle-macos.sh`) — never `KMP_DUPLICATE_LIB_OK` for quotable numbers.
3. **`-recon_out` schema drift between F2 and F5.** F2 specifies columns `…, delta_mass, region_lo, region_hi, interp`; F5 specifies `…, delta_mass (%.4f), region ("lo-hi", empty when exact), delta_interp`. Same substance, incompatible headers. Decision needed at F2 implementation time; recommendation: F5's single `region` column and the `delta_interp` name (self-describing, matches TagReconciler's field naming), `%.4f` formatting.
4. **F4's null-space accounting vs the data-inventory's speXtract port.** F4 computes the correction as a collapsed **k-mer key ratio** from the built indexes (`sharedKeys`, target-first attribution); the inventory brief proposes porting speXtract's **tryptic peptide-hypothesis ratio** + bootstrap CI (`speXtract/bench/entrapment.py` — where a protein-ratio shortcut caused an 18% bias). These are different sample-space definitions and will give different r values. Related open design point (inventory brief): should an entrapment "hit" be bare-sequence (FastaFilter membership, F4's design) or flank-reconciled (TagRecon) — this changes the null space and therefore the correct ratio. Recommendation: F4's k-mer-space ratio matches the discovery set users actually consume (tags passing `-fasta` membership) and is the v1 design; port speXtract's bootstrap CI machinery on top of it; revisit reconcile-level entrapment as a later layer once F2's recon is wired (F4's own alternatives list already defers it). The two implementations must not silently diverge in published numbers — state which ratio a curve uses.
5. **GUI sequencing: vitest fixture vs preview deletion.** The harness's mock and tests 3/13 exercise `window.fastag.preview`; the browser change deletes `preview.rs` and `api.preview`. Resolution (adopted above): land the harness first against the shipped app, then the browser change updates `mockBridge.ts` and the affected tests (`previewCalls` → `resultsQueryCalls`) as part of its swap — the harness then protects the swap itself.
6. **BACKLOG F6 row vs `FASTagger.cpp` (found by F14).** The F6 row claims a seed "emits the short seed (recall, extended=0) AND its extensions (specificity, extended=1) in one run"; the code (`:905-918`) copies the seed path, extends greedily, scores once at realized length, and emits **once** — `extended=0` rows appear only when no edge continues. This determines the read-length distribution F14's exporter sees. Resolve before writing the F14 runbook; if the code is intended behavior, fix the F6 row.
7. **TagFDR +1 pseudo-count vs the recovered contract.** The lost original's disassembly says q = scale·D/T with "no decoys → q 0"; the F4 brief deliberately deviates to scale·(D+1)/T for finite-sample conservatism and updates the recreated test accordingly. Maintainer call required **before** the test file is recreated (conservative deviation recommended; it is the anti-overconfidence direction and consistent with the honesty rules).
8. **Release completeness is unchecked (pre-existing, surfaced by ci-embed-taxonomy).** v0.19.1 is live with no `FASTag-linux-x64.tar.gz` and nothing noticed — a platform job failure already produces silently-partial releases. Out of scope for the embed change (the independent `taxonomy-asset` job at least keeps the shared asset off that failure path), but the user should decide whether a completeness check lands before 1.0.
9. **Minor: F2 vs F4 open question overlap on filter-vs-recon coupling.** F2 asks whether recon should run on all tags or only `-fasta`-passing ones; F4's q_db is defined over the `-fasta`-passing discovery set. If recon later restricts to filter-passing tags, the two features' semantics couple (filter = membership incl. collapse; recon adds flank constraints). Decide at F1-wiring time; default recommendation: recon runs on all emitted tags when `-fasta` is absent from filtering concerns, and the docs state the set each output is defined over.

## Open decisions carried from briefs (non-conflicting, need an owner call)

- F2: report reconciled peptides I/L-folded (current behavior, despite the header comment claiming otherwise) or in original DB spelling via `ProteomeIndex::protein()` (nearly free, more honest — recommended). Query-side collapse symmetry (tag GG ↔ db N reverse direction) — out of scope either way for shipped `-fasta` semantics.
- F4: bundle a default entrapment proteome with releases, or strictly user-supplied (v1: user-supplied)? Standardize archaeal taxids (proposal: 186497, 243232, 64091 + enough for r_eff ~0.5). Later: should `-species` silently exclude entrapment-matched tags instead of refusing the combination (TaxStats' own q-value comment at `FASTag.cpp:1182` admits the same chimeric-null caveat)?
- F5 rider: emit exact-delta counts split by nterm/cterm match as a histogram denominator (cheap, probably yes); best-per-spectrum vs best-per-(spectrum,peptide) counting (decide with lf data in hand); mod-candidate list for histogram labels (`-variable_mods` only vs curated Unimod subset).
- F10: MGF block framing; per-block charge-ambiguity override; GUI live-preview reuse — all deferred until a real integration asks.
- F11: include phospho-glycan diagnostics 243.0264/405.0792 (suggested yes); glyco summary line always printed when flag set (assumed yes).
- F12: equal-peak-set gap-spelling family exemption (decide after benchmark numbers); `-diversity_shared` integer knob only if evidence appears; GUI checkbox timing; tagfeatures peak-family aggregate as F7 synergy.
- F14: `res_conf` opt-in vs always-on (opt-in recommended; flip only if measured free at 100k spectra); the defensible ALC/CutoffALC value (must be the measured step-2 number, never Stitch's default 90); real antibody dataset reachability for a true CDR-level end-to-end.
- outspectra-stream: preserving original native IDs on `=`-less inputs (recommended: accept as documented improvement); skipping `loadMetaData_` on `-out_spectra` runs (separate follow-up — interacts with the stock-OpenMS probe guard at line 661).
- gui-vitest: fix the unhandled-rejection wart (`showResults` without `.catch`, App.tsx:256-257/294 — 2-line fix, touches shipped behavior) alongside the harness so the "rejecting preview still releases batch controls" test becomes writable.
- data: PXD000001 `.dat` retrievability from PRIDE; `fetch_reference_set.py` ad-hoc taxid-list mode.

## Not doing / deferred

**Permanently rejected (with reasons):**
- **F5 direct PTM-Shepherd interop** — category mismatch: its only input is FDR-filtered Philosopher `psm.tsv` + spectra; it builds histograms internally and accepts neither delta lists nor histograms. Not a deferral.
- **Fabricating `psm.tsv` from reconciled tags** — PTM-Shepherd assumes FDR-filtered full-peptide PSMs; FASTag has no calibrated tag FDR at the PSM level; psm.tsv is an informal FragPipe-owned moving target. Interop theater with dishonest statistics.
- **Database-free per-tag delta column** — mathematically vacuous: flanks sum to the precursor by construction (`FASTagger.cpp:705-706`).
- **F4 via single-spectrum decoys** (random-m/z, gap-shuffle) — already attempted, documented empty null (false tags are chimeric reads, not coincidences). Winnow-style learned calibration — needs a neural rescorer + Python stack, opaque. Chimeric spectrum-splice decoys — its own research project. CD-HIT-style homology pre-filtering — blind to I/L folding and isobaric collapse, exactly the space where tags match.
- **F2 alternatives** — sdsl-lite FM-index (GPLv3 vs MIT, CI cost, to compress 46 MB); libsais (std::sort measures 1.6 s); extending Kmer128 with positions (its own `build()` throws >4 GB on this input; per-length, fixed-k); Aho–Corasick over emitted tags (fights the deliberately block-streamed bounded-memory output, collapse×orientation×F9-variant pattern explosion); GappedFiltration's bitset index (~27 GB on human, answers a mass question FASTag doesn't ask — every FASTag tag is a spelled string); persistent on-disk index (2 s per-run build makes it pure liability).
- **F12** — flank-mass near-duplicate test (misses the target class by construction); fractional Jaccard knob (calibrated on nothing); hard deletion of near-duplicates (the 20-point gap-penalty recall lesson); full DIA deconvolution (BACKLOG SKIP verdict stands); default-on diversity (not provably recall-neutral; only synthetic evidence exists); peak indices in the public Tag struct (meaningless without Prepared, bloats the API).
- **F10** — mzML-snippet stdin (DOM parse; instruments hand over centroid arrays); C API/FFI wrapper (speculative, no requesting user; the C++ API exists — document it); socket/HTTP mode (lifecycle for zero benefit at sub-ms); making spawn-per-spectrum fast (measured ~135 ms warm floor); serializing Tables (pointless when resident; cache-invalidation surface over every Param field).
- **F11** — main-TSV glyco column (misses exactly the tag-poor spectra the flag exists for); column+file both (join on spectrum ID is trivial); GlyCounter-style quantitative report (scope creep; the `ions` column captures composition); separate `-glyco_tolerance` (single-tolerance design); deisotoping before matching (oxonium ions are intrinsically 1+).
- **F14** — C++ `-stitch_out` writer (owning conformance to a third party's positional CSV with six version layouts; silent-misparse failure mode; F13 precedent that PSM-centric downstream formats are out of scope); script-alone (cannot be written honestly — the per-residue vector doesn't exist in the TSV; flattening mean_conf fabricates the one column the consumer reads); ProForma as exchange format (J not in Stitch alphabets, `]-` mangling in FromSloppyProForma); flanks as terminal mass tags (neither assembler uses them; fragile encoding); Area=1 for Stitch (verified NaN trap); exporting all 50 tags/spectrum (accidental 50× specificity claim); full SKIP (the C++ half is ~40 lines over already-computed arithmetic and finishes what the README already advertises).
- **ci-embed-taxonomy** — building the taxdb in CI (~50 flaky UniProt downloads on the release-critical path, unreproducible without proteome-release pins); actions/cache (7-day eviction, competes with four ~230 MB OpenMS caches in the 10 GB budget; the miss-fallback IS the gh-download design); "latest"-tracking (the MZPEAK_REF lesson); Git LFS (~1 GiB/month free bandwidth ≈ two tag builds); dumps-only fallback on fetch failure (reintroduces the state the decision eliminates); dropping the standalone asset (breaks README download, GUI bundling, cheap binary-only upgrades, and the embed step's own supply chain); embedding on main pushes (+~1.1 GB gzip per platform per push for artifacts nobody installs).
- **outspectra-stream** — per-block streaming through the consumer (bakes `count="0"` into the file — schema-invalid, and post-patching invalidates index offsets); index-off write + whole-file rewrite (O(filesize) extra I/O); CachedmzML spill (more code/disk/format for the same bound); streaming mzPeak writer bolted onto FASTag (a real MzPeakFile work item — backlogged in `doc/BACKLOG-mzpeak.md`).
- **gui-browser** — DuckDB, rusqlite (designated fallback if ad-hoc SQL/joins ever become requirements), react-window/@tanstack-virtual, frontend TSV loading, keeping preview.rs alongside, paged Prev/Next UI (requirement is windowed scroll).
- **gui-vitest** — module-mocking @tauri-apps (tests a wiring path production doesn't exercise), useRunQueue extraction refactor, tauri-driver E2E (can't reproduce the races), happy-dom, jest, user-event/jest-dom (add only if failure messages hurt).

**Deferred with a trigger:**
- **F9 error-tolerant matching** — after F2; pigeonhole half-tag locate + ≤1-mismatch verify on the same SA.
- **SA-backed `-fasta` membership above FastaFilter's 4 GB wall** (proteome-scale filtering) — separable follow-up after F2 lands; FastaFilter stays untouched now.
- **F4 per-length stratified q-curves** — statistically cleaner but fragments a small entrapment sample; r_eff documented as a length-aggregate approximation until N_entrap supports strata.
- **F4 reconcile-level target-decoy layer** (TagRecon + digested decoys) — a sensible later layer once F2's recon is wired; calibrates a different object than raw tags.
- **F11 sensitivity validation** — pending user approval to download one public PRIDE glyco-enriched run (fetuin/serum sialoglycopeptide HCD); until then the flag ships literature-parameterized, and per the synthetic-evidence rule its thresholds cannot be locally re-tuned anyway.
- **F14 real-mAb end-to-end** — no antibody dataset locally and Stitch not installed; the abundant-human-protein proxy stands in; CDR-level validation waits for real data.
- **Windows runner for the gui CI job** — stripExt's backslash branch is pure string logic covered on Linux; add only if platform-branching frontend code appears.
- **`@vitest/coverage-v8`** — a 14-test suite's gaps are visible by eye.
- **Read-ahead ring for the out_spectra second pass** — only if the measured re-read cost matters.
- **PXD059878 `.msf` re-fetch** — BACKLOG already classifies it a dead end (53 PSMs).
- **Sage S23 ground-truth regeneration** — needs Sage 0.14.7 + the documented precursor-injection fix; PXD000001 Mascot truth is cheaper and already anchored to shipped defaults; revisit only if the diaTracer path becomes load-bearing for F12.
- **Dedicated data-only release tags for future taxonomy index rebuilds** (`taxonomy-k7-YYYYMMDD`) — not needed while the v0.19.1 pin works; removes the out-of-band-upload awkwardness when the reference set next changes.
- **GUI bundle-macos.sh fetching the pinned taxonomy asset itself** — later packaging change.
---

## Review revisions (2026-09-01) — adjudicated findings from the kimi + codex adversarial pass

Both reviewers read the plan against the actual code (and the OpenMS sources the
plan relies on). Findings below were verified before adoption; where a reviewer
was wrong or the two disagreed, the adjudication says so. These deltas OVERRIDE
the sections above.

### F2 (1.1) — locate algorithm replaced
- **Collapse-variant explosion (codex, critical; kimi concurs on the >32-char
  gap):** enumerate-then-equal_range is dead. `locateTag` becomes character-by-
  character SA **interval refinement** (narrow [lo,hi) by one pattern char at a
  time via two binary searches on that char position), **branching** at each
  collapse point (literal char, plus each pair spelling where the tag char is a
  rule's `one`). Dead branches die at the first absent character, so cost is
  bounded by what exists in the proteome, not by 7^W combinatorics; no variant
  cap, no capped-comparator ambiguity (comparisons are per-position), patterns
  up to 50 chars handled exactly. A safety budget (~10k interval steps/tag,
  logged when hit) guards pathological rule sets only.
- The build-side sort comparator stays capped, but at **64 chars** (> max
  expanded pattern 50), and locate does not use it. (kimi: pattern-length
  comparator would also be order-compatible; interval refinement makes the
  question moot.)
- **`-recon_fasta` decoupling (codex, high):** `-recon_out` no longer requires
  `-fasta`. New optional `-recon_fasta <file>` (defaults to `-fasta`'s value
  when that is set) builds ONLY the ProteomeIndex — proteome-scale
  reconciliation must not force the per-length k-mer filter's 4 GB build.
- Doc numbers: 11,418,104 residues + 20,431 sentinels = 11,438,535 text chars
  (both reviewers); the k≥6 "chance model" cross-check claim is dropped (kimi:
  arithmetically false at k≥6 — those are mean multiplicities over present
  k-mers, a different statistic).

### F4 (1.3) — statistics corrected
- **Orientation closure (codex, critical):** key-space accounting is computed
  over the orientation-CLOSED key sets when `both_` matching is on: a key
  counts as shared if the key **or its reverse-complement spelling** occurs in
  the other index; entrapment-exclusive size uses the same closure. (Target
  `ACD` / entrapment `DCA` now correctly share their acceptance set.)
- **Per-length correction (codex, critical):** r_eff is computed **per tag
  length** ℓ (the key spaces are per-length by construction); each entrapment
  event enters the pooled curve with weight 1/r_ℓ. One monotone q-curve, no
  sample fragmentation. TagFDR gains a weighted-decoy variant alongside the
  recovered scalar contract.
- **Pseudo-count dropped (codex, high; overrides the brief and kimi's mild
  preference):** the recovered fixture (`build-f4/tagfdr_test`) proves
  `(D+1)/T` floors the low tail at 1/49 and fails the recovered assertions.
  We keep the recovered `q = scale·D/T` contract EXACTLY. Small-sample honesty
  is handled by: WARN below ~200 entrapment events, and logging the resolution
  floor (`scale/T_total`) so q=0 reads as "below resolution", not "zero risk".
- **Entrapment rows (codex, high):** `efwd`/`erev` rows get `q_db` empty — they
  are known-false calibration material, not discoveries.
- **No %g reparse (codex, medium):** the post-pass consumes an in-memory vector
  of raw evalues recorded in row-write order; the TSV is rewritten by row index,
  never by reparsing serialized evalues.
- **Audit fixed (kimi, medium):** the shuffled-9606 composition-matched null is
  **promoted to co-primary** in validation gate (2); the archaeon-B pseudo-
  target arm measures entrapment-choice sensitivity only and is labeled as
  such. `fasta_hit=-` rows also get `q_db` empty (kimi, low).

### F5 rider (1.2)
- "Best placement" defined deterministically: min |delta_mass|, tie-break on
  (protein index, position) — placement order is currently unscored (codex).
- Flank-closure wording: holds only for non-clamped flanks (`max(0,·)` at
  FASTagger.cpp:705-706 breaks the identity when a flank clamps) — histogram
  rows from clamped placements are excluded and counted separately (codex,
  medium).

### F12 (2.1)
- Near-duplicate predicate now requires **same charge** AND `min(|A|,|B|) ≥ 4
  peaks` (codex high: charge variants merged, G@z1 vs N@z2; both reviewers:
  degeneracy at tag_length 1–2). Below the floor, tags are never merged.
- Validation metric moves onto **F2's `-recon_out` protein ids** (codex: the
  `-fasta` filter cannot name proteins) — F12's real-data gate now depends on
  F2 landing first; sequencing updated.
- Substrate roles **swapped** (codex verified ±0.6 Th): `bench_astral_lf` is the
  narrow-isolation control; the Eclipse TMT SPS file (`bench_eclipse_
  iontrap_tmt`, at 0.3 Da) is the chimera-rich case. The diaPASEF/DIA-NN assets
  remain the optional precursor-level truth.

### F10 (2.2)
- `-stream` **refuses** `-entrapment_fasta`, `-out_spectra`, and `-species`
  (whole-run machinery vs immediate flush; codex, high). Documented in the flag
  help.
- The health-check note is corrected: `--help` proves nothing (codex verified a
  real-run abort). The dev-tree OMP #15 is now deterministically fixed (conda
  env libomp symlinked to homebrew's — see memory `dev-tree-libomp-fix`); all
  quotable runs happen under that fix.

### F11 (2.3)
- Cardinality claim corrected (codex, medium): `.glyco.tsv` covers spectra the
  tagger PROCESSED (post-subsample, non-empty, precursor-bearing) on both input
  paths; README says exactly that instead of "one row per MS2".
- Scan-window guard reads instrument `scanWindows` metadata when present;
  the front-peak heuristic is the fallback and its wording softened (codex).

### out_spectra (2.4)
- Byte-identity claim **downgraded** (both reviewers): identical for
  homogeneous single-instrument runs; heterogeneous per-spectrum sourceFile/
  dataProcessing references can differ — pass 2 **normalizes** kept spectra
  (clear per-spectrum sourceFile ptrs not declared in the header; unify DP
  chains) so the consumer never emits dangling references (codex, high).
- After the consumer destructs, the writer **verifies** the file: non-empty and
  ends with `</indexedmzML>`; failure → CANNOT_WRITE_OUTPUT_FILE (codex, high:
  the consumer never checks stream state).
- The mzPeak exclusion stands, but for the right reason (kimi): `transform()`
  materialization, not "no index" — MzPeakFile documents indexed random access.

### GUI (3.1/3.2)
- Duplicate-done/unknown-id semantics: implement the small guard (consume-and-
  delete `earlyDone` entries; ignore terminal events for already-settled runs)
  and THEN test it — tests must not assert unimplemented behavior (codex).
  The `showResults` missing-`.catch` wart is fixed alongside (2 lines).
- Browser: **header-driven dynamic columns** (codex: 12-column premise already
  false with `-proforma`, and F4/F14 add more); filters bind by column name
  when present. `cargo test` joins the `gui` CI job (webkit2gtk deps on the
  runner); ci.yml added to Phase 3 files-touched.

### CI (0.1)
- The taxonomy pin moves to a **dedicated data-only release**
  (`taxonomy-k7-20260901`) created once from the existing verified tarball —
  mutating v0.19.1's asset on future rebuilds would invalidate published
  provenance (codex, high); the deferred data-tag scheme is adopted now.
- `taxonomy-asset` copy-forward job gets `permissions: contents: write` and
  create-release-if-absent semantics (codex, high).
- Windows `gh release download` gets `--repo "$GITHUB_REPOSITORY"` (codex —
  the workspace root has no .git).
- **Release-completeness check lands now** (kimi pushed; codex flagged): a
  tag-gated job (`needs` all legs, `if: always()`) asserts the expected asset
  list on the release and fails red when any platform tarball is missing —
  non-destructive, but no more silently partial releases. (This closes Open
  conflict 8 in the affirmative; flagged to the user in the campaign report.)
- The signing-order placement remains theoretical until the MACOS_* secrets
  exist (codex) — noted in the step comment.

### Cosmetic anchor fixes (kimi)
`registerFlag_` additions go beside :358-362 (not :334); the block loop
variable is `base`; `norm()` also folds J; "17 bundled proteomes / 19.75M
residues" corrected to "17 present locally / 21.0M residues (50 listed)".

> **Post-review implementation note (F4 closure arithmetic):** the shipped
> code applies orientation closure on the shared-count probe (a key is shared
> if the accepting filter holds it or its reverse) while set SIZES use stored
> keys — not the fully-closed-set formula written above. Second-order
> numerically; the calibration audit validated the shipped form. Code is the
> contract; this note records the delta.
