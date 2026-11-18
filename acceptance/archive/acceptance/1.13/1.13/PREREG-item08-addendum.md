# PREREG-item08 addendum A1 (backlog #8)

Committed 2026-11-09 **after** the single held-out run of CFG-08-cand and CFG-08-base finished (node data,
started 20:47, `DONE RC=0` at 20:50:36+01:00) and **before** `scorers/score_item08.py` was run. No held-out
`label.tsv`, `digest.tsv` or `log.txt` has been read. PREREG-item08.md is frozen and unchanged; E1, E2 and the
decision rule stand as written. Nothing here relaxes or replaces a criterion.

## 1. E2 holds by construction (disclosure)

Both configs run the same binary and differ only in `-label_call_min_tags` (0 vs 175). On a run with at least
175 C-terminal tag ends they write identical `label_call` rows; on a run with fewer the base is
`no_call few_tags`, which the scorer counts as wrong. So `base_right_cand_wrong` is 0 by construction and E2
cannot fail. It is not a safety guard. **The decision rests on E1 alone.** The risk the new default adds (a
spurious isobaric or SILAC call on a few-tag-end run) is invisible to E2.

## 2. Post hoc descriptive analysis A1 (no pass/fail, no bound)

Because the run had already finished when this was written, A1 is marked **post hoc and descriptive**; it does
not enter the decision rule. `scorers/addendum_item08.py` (sha256
52ba91296cb856f88a77bcd3244166edb774b5628ad0cef5f1424490d3e6b653) reads only the `runs.tsv` that
`score_item08.py` writes:

- D1: on the few-tag subset (CFG-08-base basis `few_tags`): truth composition; CFG-08-cand correct, spurious
  label (a non-label-free call of the wrong class; on label-free truth a false label), missed label, no call;
  the false-label count among label-free truth runs, with the run list.
- D2: on the complement, the number of runs where the cand call differs from the base call (0 expected by
  construction).

DEV check (in-sample, `scorers/tests/dev_results/item08/runs.tsv`): D1 n 30 (label-free 28, TMT 1, SILAC 1),
cand correct 28, missed label 2, false label 0; D2 0 of 163.

A future *binding* safety guard (for example a bound on the false-label rate on few-tag-end runs) needs a new
PREREG and a fresh held-out draw; it cannot be added to this run.

## 3. `-digest_out` was written on item03-heldout (disclosure)

The CFG-08 command lines include `-digest_out digest.tsv`, which `score_item08.py` does not read and
`label_call` does not need. The run therefore wrote the 1.12 protease/alkylation report (#3's baseline
endpoint) for all 172 item03-heldout runs, which DEC-1112-r3-04 reserves for #3/#5. Handling:

- All 344 `digest.tsv` and 344 `log.txt` files under `data:/scratch/kohlbach/b113/labelcall/heldout/runs`
  (the log also prints the digest status line) were set to mode 000 before scoring and have not been read or
  copied. Only `label.tsv`, `rc.txt` and `inputs_verified.tsv` are read.
- Registry row HO-03-heldout-113-ITEM08 records this. Whether item03-heldout is still clean for #3 or #3
  needs a fresh draw is for the user to decide before #3 preregisters.
- Any rerun of item08 drops `-digest_out`, which needs its own PREREG addendum before running.
