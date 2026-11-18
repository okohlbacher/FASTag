# RESULT: held-out test "aspn" (Asp-N call and semi-specific export of `-shortlist_protease auto`, FASTag 1.13.4)

2026-11-13/14. Protocol: acceptance/1.14/PREREG-aspn.md on okohlbacher/FASTag branch acc114/aspn.
Freeze 1: 499de19 + f3be8d5. Freeze 2 (staged manifest, DB sha256, truth audit, mzML header check): 724b6255.
One run (run_all.sh, data, 12 threads, 2026-11-13 21:57Z-23:47Z), scored once (score_once.sh, rc 0). Results commit: see
branch (acceptance/1.14/aspn/results/).

## Verdict: **FAIL** (frozen rule: any criterion FAIL gives FAIL). The only failing criterion is G1.

| id | verdict | numbers |
|---|---|---|
| E0 | PASS | evaluable Asp-N runs 11 of 12 from 4 projects (need >= 6 / 3); control runs 9 of 9 from 8 projects (need >= 6 / 3) |
| C1 | PASS | auto placement Asp-N in 11 of 12 Asp-N runs (0.917; threshold 0.50) |
| C2 | PASS | Asp-N placed in 0 of 9 control runs |
| R1 | PASS | recall(auto, semi) - recall(trypsin shortlist): mean +0.3686, 95 % CI [+0.3175, +0.4454] (4 projects, 10 runs) |
| R2 | PASS | recall(auto, semi) - recall(Asp-N full export): mean +0.0465, 95 % CI [+0.0230, +0.0831] (4 projects, 10 runs) |
| T1 | PASS | median Sage time auto export / full search 0.983 over 10 runs (<= 1.25); range 0.448-1.598 |
| G1 | **FAIL** | 1 of 21 runs counted as aborted: A3.3 |
| S1 | PASS | every auto Asp-N call semi-specific, every autofull call full |

## What failed in G1
A3.3 (PXD050612, *M. marinum* culture filtrate, Asp-N, `AspN_CF_1_3ul`): the **trypsin comparator arm** (`-shortlist_force`,
default trypsin shortlist) exited 0 but kept 0 proteins ("0 of 2 proteins with evidence kept", both below min_spectra 2)
and wrote an empty red.fasta (0 bytes). The frozen scorer (`exports()`, score.py) requires sl.tsv, red.fasta and sage.json
to be non-empty, so the arm counts as an abort under G1. The candidate behaviour itself (auto arm, autofull arm, every Sage
search) had rc 0 and complete exports in all 21 runs. Not a crash: an empty trypsin shortlist on an Asp-N digest, which
FASTag writes as an empty FASTA without warning or non-zero exit. Per the PREREG this stays FAIL; the set is now a
development set. Product note for 1.14 (not a re-score): an empty shortlist should be reported explicitly (message and/or
non-zero exit or documented empty-output contract), and the G1 rule for comparator arms should be stated precisely in
future PREREGs.

## Other observations (no criterion)
- A3.2 (PXD050612, `AspN_CF_3`) called `unspecific` (margin 0.919 log-likelihood per tag end), not Asp-N; counted in C1
  denominator; excluded from R1/R2/T1 (not called Asp-N).
- A4.1 (PXD059041): reference search (Sage, full T. brucei DB, Asp-N) rc 0 but 0 PSMs at q <= 0.01 -> not evaluable
  (rule "< 50 reference proteins"); A4.2/A4.3 of the same project gave 849/1002 reference proteins. Not investigated further.
- A1.3: Sage on the auto (semi) export rc 0 but 0 PSMs at q <= 0.01 (Sage recall 0.0 vs 0.345 for the full-specificity
  export); A1.1/A1.2 normal. Sage recall is reported without threshold; shortlist recall (the criterion metric) 0.369.
- Per-run shortlist recall auto / autofull / tryp (Asp-N runs called Asp-N, evaluable): A1 0.35/0.34/0.01, 0.29/0.27/0.01,
  0.37/0.35/0.01; A2 0.32/0.28/0.01, 0.31/0.27/0.01, 0.32/0.28/0.01; A3.1 0.45/0.40/0.01, A3.3 0.44/0.41/0.00;
  A4.2 0.40/0.30/0.02, A4.3 0.56/0.45/0.04.
- Controls: trypsin controls called Trypsin (full) 7/7, Glu-C called Glu-C, chymotrypsin called Chymotrypsin.
- Node data was shared (load ~40); A2.2 tryp Sage 142 s is an outlier of the shared node (not in T1).

## Deviations
- None in the run or scoring. Erratum: freeze-2 TRUTH_AUDIT.md and STATE.md say "9 control slots from 6 projects"; the
  correct count is 8 distinct projects (PXD027242, PXD050612, PXD059041 + K5-K9). E0 holds either way.
- Operational: the cluster gateway flapped (banner-exchange timeouts); ssh calls were retried; the score_once call that
  timed out never connected (no results dir existed before the successful call, which ran with a verdict-exists guard).

## Files
Branch acc114/aspn: acceptance/1.14/aspn/results/{scores.tsv, verdict.tsv, score_once.log, run_all.log, A3.3_tryp_run.log,
A3.3_tryp_sl.tsv, RESULT.md}. Node data: /scratch/kohlbach/acc114/aspn/heldout/{out,results}.
