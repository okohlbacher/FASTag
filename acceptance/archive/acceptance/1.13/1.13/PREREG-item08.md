# PREREG-item08: label call refit (backlog #8, `-label_call_min_tags`)

Committed 2026-11-09 **before any held-out run**. One primary endpoint (E1) and one paired endpoint (E2);
everything else is descriptive. Each config is run once and scored exactly once; nothing is tuned on held-out
data; no criterion is relaxed after this commit.

## What is tested

FASTag 1.12's `label_call` rows (prose-auto 0.1.10's rule) make `no_call few_tags` below 175 C-terminal tag
ends. Branch `feat/b113-labelcall` adds `-label_call_min_tags` with **default 0** (every ppm run is called; the
fastag-bench harness's prose-auto 0.1.3 rule); `-label_call_min_tags 175` is the 1.12 rule byte for byte.
Question: on held-out public runs, is the default (a) at least 5 points above "always the majority class" and
(b) no worse than the 1.12 rule?

## Frozen software

| What | Value |
|---|---|
| Source | `feat/b113-labelcall` 344d92f (C++; fa052a0 adds tests, GUI and docs only) |
| FASTag binary | `data:/scratch/kohlbach/b113/labelcall/frozen/FASTag`, sha256 **d29381e2acd378932d063a542e18e304e260a240748dcd6babac02c2cf1ec6a6** (build env of data/HANDOFF.md: fastag-omsdev, OpenMS 70cebcd144) |
| `FASTAG_DIGEST_DIR` | `data:/scratch/kohlbach/b113/labelcall/frozen/digest` (= the branch's `data/digest`): digest_models.tsv b486bbb2fc97c72192956c0cf1f64ddd5868570a61edb05953a98edc7bff7c36, massgap_mods.tsv c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106 |
| Runner | `scripts/run_item08.py` sha256 344ec7823b3a826df39d73e5723c5a27e981b0d12645e4aefab033d216b5ffb5 (checks the binary sha256 and every input sha256 before running) |
| Scorer | `scorers/score_item08.py` sha256 **f3876140a670204c69a69ef51571855647c1d4634d096fe34a91811d95446aa5** |

## Configurations (`frozen-configs.tsv`)

Both: the termini command of acceptance/1.12 PREREG-chem (the paper's digest validation options), node data,
`FASTAG_FULL_PRECISION=1`, 4 threads (thread count does not change -label_out; digest_cli_test checks 1/2/3):

    FASTag -in <run> -out <tmp> -tag_length 4 -threads 4 -subsample_fraction 0.25 -fragment_tolerance 20.0
           -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv

| Config | Extra options | Parameter hash | Status |
|---|---|---|---|
| CFG-08-cand | none (default `-label_call_min_tags 0`) | fb570abd50c839fe1caeeb02936949d6b9730246717f9e3ae4693021e6b7460c | frozen |
| CFG-08-base | `-label_call_min_tags 175` (FASTag 1.12 rule) | 4073ea76f17e8a7891eb71b780a3d04277777dbeffe1993e07e0dddfbae500ed | frozen |

Hash = sha256 of `binary=<sha>;options=<options>;tables=<name:sha,...>` (as acceptance/1.12).

## Held-out set (registry HO-08-heldout; `manifests/item08-heldout.tsv`, sha256 db878ac4a15abae98f807fa404b42456dcbf280e7a4bd6c3b33c6e2574968a85)

- Source: `acceptance/1.12/manifests/item03-heldout.tsv` (sha256 6768c5fa...ed95), registry HO-03-heldout-r2/-r3:
  drawn from bigbio/sdrf-annotated-datasets 452596762d38 outside the 234 DEV PXDs, the prose-auto
  validation sets and corpora; staged and hashed on 2026-11-08; **never scored** (DEC-1112-r3-04: "refit on DEV
  first and preregister a new config later"). No FASTag output on these runs has been read for this item.
- Built by `scripts/build_item08.py` (rules in its header, from manifest columns only): 179 rows; **172
  included** (`include = yes`): label-free 150, SILAC 15, TMT 4, TMTpro/iTRAQ8 3. Not included, listed: 4
  SECOND_DOWNLOAD_DIFFERS, 2 DOWNLOAD_FAILED (no input), 1 `isotope (unspecified)` (not a label class).
- Strata are those of item03 (protease/alkylation strata, not label strata); SILAC runs in non-K/R strata
  (Arg-C, LysargiNase, chymotrypsin) cannot pass the `KR_TRYPTIC` gate under either config. This was known at
  the draw and is kept: the endpoint is on the whole set as drawn.
- Disjointness (`disjointness/item08-heldout.tsv`, sha256 403b6b47...6506): 169 PXDs, none among the 234 PXDs of
  the 254 DEV truth rows (`inputs/item08_dev_label_call.tsv`, which contains the 193 evaluable DEV runs).
- Inputs: `data:/scratch/kohlbach/fastag-heldout-1.12/<fastag_input>`; the runner verifies each sha256 against
  the manifest. Truth: the manifest's `label_class` (SDRF `label_truth`, fixed at the draw; TMTpro and iTRAQ8
  one class). No search.

## Endpoints

Denominator: the 172 included rows. A run counts as correct when `label_call status = call` and its label
(TMTpro -> TMTpro/iTRAQ8) equals the truth class; a no call, a failed or missing run, and an input whose sha256
check fails all count as wrong.

- **E1 (primary):** accuracy(CFG-08-cand) >= majority share + 0.05, where the majority share is that of the most
  frequent truth class over the denominator (as drawn: label-free 150/172 = 0.872, so the threshold is 0.922,
  i.e. at least 159 of 172 correct). This is acceptance/1.12 PREREG-chem's 3a criterion, unchanged.
- **E2:** correct(CFG-08-cand) >= correct(CFG-08-base) on the same runs (paired; no worse than the 1.12 rule).
- Descriptive: Wilson 95% CIs, called accuracy, per-class recall, balanced accuracy, confusion, discordant pairs
  and the exact two-sided sign test.

**Decision rule.** The default `-label_call_min_tags 0` stays only if E1 and E2 both PASS. Otherwise the
branch's default goes back to 175 (no default output change), the option stays experimental, and the result
is documented as FAIL for the user to decide.

## DEV test of the scorer (in-sample, DEV outputs only)

`scorers/tests/dev_item08.py` lays out the DEV regeneration with the frozen binary (209 item05 runs,
`scorers/tests/dev_run_item08.py`; 193 evaluable) as a runs root; the scorer gives CFG-08-cand 178/193
(0.922, CI 0.876-0.952) and CFG-08-base 150/193 (0.777, CI 0.713-0.830), majority 159/193: the item05
numbers of `output/jpr-paper/carryover-1.12/label_call.md`, reproduced (`scorers/tests/dev_results/item08/`).
On DEV the regenerated cand calls equal the harness termini calls on 193/193 and the base calls equal
1.12's label_call on 193/193; all 209 base label reports equal the 1.12.0 RC's byte for byte (run version
row aside). These are in-sample and are not evidence for the held-out endpoints.

## Commands

    # node data, build env activated (data/HANDOFF.md)
    python3 -I acceptance/1.13/scripts/run_item08.py acceptance/1.13/manifests/item08-heldout.tsv \
      /scratch/kohlbach/b113/labelcall/frozen/FASTag d29381e2acd378932d063a542e18e304e260a240748dcd6babac02c2cf1ec6a6 \
      /scratch/kohlbach/b113/labelcall/frozen/digest /scratch/kohlbach/fastag-heldout-1.12 \
      /scratch/kohlbach/b113/labelcall/heldout/runs 6
    python3 -I acceptance/1.13/scorers/score_item08.py acceptance/1.13/manifests/item08-heldout.tsv \
      /scratch/kohlbach/b113/labelcall/heldout/runs acceptance/1.13/results/item08
