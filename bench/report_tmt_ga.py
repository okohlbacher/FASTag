#!/usr/bin/env python3
"""Render G/A-only benchmark results and the independent failure audit."""
import argparse
import csv
import html
import json
from pathlib import Path

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('results', type=Path)
args = ap.parse_args()
root = args.results
with (root / 'summary.tsv').open() as fh:
    rows = list(csv.DictReader(fh, delimiter='\t'))
idx = {(r['dataset'], r['chemistry'], r['arm'], r['rule']): r for r in rows}
cells = list(dict.fromkeys((r['dataset'], r['chemistry']) for r in rows))
reuse_path = root / 'score-reuse.json'
reuse = json.loads(reuse_path.read_text()) if reuse_path.exists() else {}
final_verified = (reuse.get('verified_runs') == len(cells) * 4 * 3
                  and reuse.get('verified_cells') == len(cells) * 4)
verification_status = (
    '<p class="note">The final safeguard was retimed. All 108 tag outputs match the '
    'previously scored G/A-only outputs byte for byte; accuracy scoring was reused only '
    'after that check. The runtime table uses the final executions. '
    '<a href="score-reuse.json">Verification record</a>.</p>'
    if final_verified else
    '<p class="note">These tables describe the completed G/A-only benchmark. Runtime '
    'and output equivalence for the revised mixed-label safeguard are still pending. '
    'Do not attribute these measurements to the final safeguard until its verification '
    'record is available.</p>'
)
challenge_path = root / 'detector-challenge' / 'final-binary-validation' / 'summary.json'
challenge = json.loads(challenge_path.read_text()) if challenge_path.exists() else {}
challenge_verified = challenge.get('passed') is True and challenge.get('count') == 43
challenge_status = (
    '<p>The final compiled binary reproduced all 43 frozen challenge and mixture decisions, '
    'with identical probe counts. '
    '<a href="detector-challenge/final-binary-validation/summary.json">Compiled-binary verification</a>.</p>'
    if challenge_verified else
    '<p>These candidate-gate results come from the frozen count-based replay. Verification '
    'against the final compiled binary is still pending; the replay alone does not establish '
    'production behavior.</p>'
)


def table(headers, body):
    return '<div class="table"><table><thead><tr>' + ''.join(
        '<th>' + html.escape(x) + '</th>' for x in headers
    ) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(
        '<td>' + html.escape(str(x)) + '</td>' for x in line
    ) + '</tr>' for line in body) + '</tbody></table></div>'


def accuracy(chem, rule='paper_flank'):
    body = []
    for d, c in cells:
        if c != chem:
            continue
        b, a = [idx[d, c, arm, rule] for arm in ['baseline', 'auto']]
        body.append([d, b['psms'],
                     f"{100*float(b['recall50']):.3f} → {100*float(a['recall50']):.3f}",
                     f"{int(a['recall50_correct'])-int(b['recall50_correct']):+d}",
                     f"{100*float(b['rank1_accuracy']):.3f} → {100*float(a['rank1_accuracy']):.3f}",
                     f"{int(a['rank1_correct'])-int(b['rank1_correct']):+d}"])
    return table(['File', 'PSMs', 'Recall@50 (%)', 'Δ correct', 'Rank-1 (%)', 'Δ correct'], body)


def pooled(roles):
    body = []
    for c in ['label_blind', 'label_aware']:
        b = [r for r in rows if r['chemistry'] == c and r['arm'] == 'baseline'
             and r['rule'] == 'paper_flank' and r['role'] in roles]
        a = [idx[r['dataset'], c, 'auto', 'paper_flank'] for r in b]
        n = sum(int(r['psms']) for r in b)
        values = []
        for key in ['recall50_correct', 'rank1_correct']:
            before, after = [sum(int(r[key]) for r in group) for group in [b, a]]
            values.append(f'{100*before/n:.3f}% → {100*after/n:.3f}% ({after-before:+d})')
        body.append(['TMT omitted' if c == 'label_blind' else 'TMT configured', n, *values])
    return table(['Configuration', 'PSMs', 'Recall@50', 'Rank-1 accuracy'], body)


runtime = []
for d, c in cells:
    b, on, a = [idx[d, c, arm, 'paper_flank'] for arm in ['baseline', 'on', 'auto']]
    bv, av = float(b['wall_median_s']), float(a['wall_median_s'])
    runtime.append([d, c, b['wall_median_s'], on['wall_median_s'], a['wall_median_s'],
                    f'{av-bv:+.3f}', f'{100*(av/bv-1):+.1f}%'])

report = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FASTag G/A-only filtering: benchmark and adversarial reference audit</title>
<style>
body{font:16px/1.55 system-ui,sans-serif;color:#182635;max-width:1180px;margin:36px auto;padding:0 24px}
h1{font-size:32px;line-height:1.2}h2{margin-top:2em;font-size:23px}h3{font-size:18px}
a{color:#076d9a}code,pre{font:13px/1.5 ui-monospace,monospace}pre{background:#f0f4f6;padding:18px;overflow:auto}
.lead{font-size:19px}.note{border-left:4px solid #167fa3;padding:10px 18px;background:#eff7fa}
img{width:100%;height:auto}figure{margin:24px 0}figcaption{font-size:14px;color:#526271}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:16px 0}
th,td{text-align:left;border-bottom:1px solid #dbe1e6;padding:9px 11px;vertical-align:top}
th{background:#edf3f6}.small{font-size:14px;color:#526271}li{margin-bottom:14px}
</style>
<h1>Preserving terminal K removes the recall penalty; G/A filtering improves ranking</h1>
<p class="small">11 November 2026 · <code>feat/tmt-pseudo-tag-filter</code> · G/A-only implementation
<code>81bf267</code> · revised mixed-label safeguard <code>27e70f2</code></p>
<p class="lead">In the completed benchmark, automatic G/A-only filtering improves rank-1 accuracy in every TMT file,
both with and without configured TMT masses. No previously correct recall@50 or rank-1 case is
lost under either scoring rule. Recall itself changes very little. The benefit survives a
supplementary analysis restricted to independently corroborated reference peptides.</p>
<p class="note">The reference set is broadly supported, but not infallible. The audit found
a questionable reference assignment, unresolved modification localization, and spectra
supporting two different peptides. None was relabeled or removed from the primary benchmark.</p>
''' + verification_status + '''
<h2>Primary results on the original frozen references</h2>
<p>The two independent validation projects are PXD037999 and PXD000001. Their results are:</p>
''' + pooled({'validation'}) + '''
<p>Across all four TMT files, including development fr02 and within-project validation fr09:</p>
''' + pooled({'validation', 'development', 'within_project_validation'}) + '''
<h3>TMT omitted in both baseline and filtered runs</h3>
''' + accuracy('label_blind') + '''
<h3>TMT configured in both baseline and filtered runs</h3>
''' + accuracy('label_aware') + '''
<p>Each comparison holds the residue alphabet fixed. The primary paper rule accepts a matching
sequence or reverse (I/L equivalent) with at least one correct flank at the same placement,
within 0.05 Da. All reference PSMs are in the denominator; a spectrum with no reported tag counts as a miss.
The supplementary rule additionally requires each residue mass, including modifications,
to match within 0.02 Da. It still requires only one matching flank, so it is residue-mass
consistency, not a complete test of precursor closure or peptide identity.</p>
<figure><img src="figures/paper_flank.svg" alt="G/A-only versus former G/A-plus-K filtering">
<figcaption>Dots: G/A-only; crosses: the previous filter that also deleted bare terminal K.
Removing that K rule restores the tags whose sequence matched the reference. Exact paired gains and losses are in
<a href="paired_changes.tsv">paired_changes.tsv</a>.</figcaption></figure>
<figure><img src="figures/strict_mass.svg" alt="Supplementary residue-mass consistency results">
<figcaption>Supplementary metric. Retained K tags can have useful sequences while allocating
TMT mass to a flank, so their letter-level correctness and residue-mass consistency differ.</figcaption></figure>

<h2>What changed, and what was rejected</h2>
<p><strong>Iteration 1:</strong> removed only the bare-K rejection rule. The G/A mass windows and
positive TMT detector stayed unchanged. <strong>Iteration 2:</strong> retained that tag filter and made
the conflicting-label veto more sensitive after reproducing a failure in a file containing two labels.
The positive TMT criterion is unchanged. These are separate commits and separate benchmark runs.</p>
<pre>L = 229.162932; W = 18.010565
TMT_N = spectra with n ≈ L or c ≈ L − W
TMT_K = spectra with c ≈ K + L or n ≈ K + L + W
conflict_N, conflict_K = analogous counts at L = 304.207146

positive_min = max(20, ceil(eligible / 100))
conflict_min = max(5, ceil(eligible / 100))
activate only if eligible ≥ 100 and TMT_N, TMT_K ≥ positive_min
abstain if both conflict counts ≥ conflict_min, or tolerance is in Da

for each scored b/y tag, before deduplication and the top-N cap:
    reject bare first G/A with n ≈ L − mass(G/A)
    reject bare last G/A with c ≈ L − W − mass(G/A)
    terminal K alone never triggers rejection
retain surviving scores; refill vacated output slots</pre>
<p>Windows remain ±0.020 Da for N and ±0.006 Da for C. G/A residues with inline or fixed modifications are protected.
The separate reporter-endpoint filter is off throughout this experiment.
Automatic mode changes filtering, not the configured modification alphabet.</p>
<p>A K-ending tag can still be removed for an independent G/A pseudo-residue
at its other end. K with label mass in its terminal gap is otherwise retained.</p>
<p><strong>Rejected expansions:</strong> widening N to ±0.050 Da or C to ±0.020 Da, or adding
N-window offsets of ±1/±2 isotope masses, gave zero additional rank-1 gains in a capped-output
replay of all nine configurations. That replay does not estimate recall or cap-refill gains.
Raw precursor checks showed no isotope misassignment in the three top-ranked isotope-window
cases. Wider windows also overlap genuine TA, R and GL prefix masses in label-free spectra.
These findings do not support adding the proposed rules.</p>

<h2>Automatic label detection: broader challenge and a real improvement</h2>
<p>The original detector was challenged on 22 additional projects: seven TMT, six TMTpro, four label-free,
two iTRAQ, two dimethyl and one SILAC. Four of four high-resolution TMT runs activated.
All 15 non-TMT6/10 controls stayed off. Three TMT ion-trap/MS3 runs abstained, including when
stress-tested at 20 ppm. Correct abstention on unsupported data is not successful label identification.</p>
<p>In artificial files assembled from independently acquired spectra, the original gate missed
10% TMTpro in a TMT-rich file: its conflict counts were 29 and 16, so one site fell below the old minimum of 20.
In the frozen replay, the new conflict threshold caught that mixture and a second source pair fixed before replay
(31 and 11 supporting spectra, minimum 8), while retaining pure TMT detection. At 95:5 in that second pair,
the counts of 10 and 7 failed the requirement that both sites reach 8. No further threshold tuning was performed.</p>
<p>These proportions describe numbers of spectra in synthetic files, not molar labeling ratios,
mixed peptides in a spectrum, or an experimentally established detection limit. TMT mixed with
label-free spectra activated even at 10% TMT: the gate detects TMT presence, not complete labeling
or file purity. A 304-Da veto is compatible with TMTpro <em>and</em> iTRAQ8 and must not be read as
a specific label identification. The revised diagnostic says
<code>conflicting_304Da_label_evidence</code>.</p>
<p>Input hashes, expectations, source protocols, probe counts and compiled-gate verification are
retained in <a href="detector-challenge/summary.json">the challenge records</a> and
<a href="detector-challenge/candidate-evaluation.json">candidate evaluation</a>.</p>
''' + challenge_status + '''

<h2>Adversarial review: are the failures really wrong tags?</h2>
<ol>
<li><strong>The former K rule confused mass allocation with sequence error.</strong> In the prior
label-blind experiment, 124 spectra lost all paper-correct tags from their top 50 when
sequence-matching K-ending tags were removed. Their TMT mass was assigned to the C gap.
K is now retained; those individual recall losses disappear. The prior net recall change also included gains.</li>
<li><strong>A G/A match is not chemical proof of a pseudo-residue.</strong> Across the four TMT files,
six distinct spectra each lose a lower-ranked paper-correct tag in both chemistry configurations.
Those tags falsely assign methionine oxidation in reverse R-terminal reads:
R + W − Ox = 158.116761 Da, only 0.009057 Da from L − A.
All six fail residue-mass consistency and none is rank 1; other correct tags preserve recall.
This prevents a claim of perfect per-tag specificity.</li>
<li><strong>Ordered gap spellings overstate what the peaks resolve.</strong> In PXD037999,
210 label-blind and 225 label-aware wrong gapped rank-1 tags have a paper-correct alternative
with a tied reported score, the same charge and nearly identical flanks. Of these, 135 and 147,
respectively, are adjacent swaps. Reported ties do not prove identical hidden peak paths,
and no tie-aware metric replaced rank-1 accuracy.
These cases motivate reporting gap ambiguity rather than guessing its residue order.</li>
<li><strong>The reference can penalize a plausible correct tag.</strong> In Erwinia scan 1273,
the frozen Sage peptide YPQADVTR has q = 0.0080. The rank-1 tag QSED matches the accepted Comet peptide
DESQNK[TMT], including residue masses and a flank, but is counted as a recall and rank-1 failure against Sage.
At 20 ppm, the Sage and Comet peptides explain 2 versus 10 unique peaks (1.61% versus 6.18% of raw TIC).
At the original 0.2-Da Sage tolerance they explain 10 versus 11 peaks (4.55% versus 6.25%).
The extra broad-tolerance matches for Sage have mixed-sign residuals up to about ±0.057 Da, so a common
calibration offset does not explain the difference. This is a candidate reference error,
not a justified automatic relabel. Mascot's matching top hit fails its 1% cutoff.</li>
<li><strong>A spectrum can support two peptides.</strong> Erwinia scan 5076 has a Sage peptide
with an isotope-corrected precursor error of −15.4 ppm, within its 25-ppm search setting. An alternative
accepted by both Comet and Mascot has an error of +3.79 ppm. Both theoretical precursors fit the isolation window,
and both have substantial exclusive fragment evidence. The rank-1 tag EELT matches the independent
alternative but is called wrong by the single Sage reference. This supports possible coisolation;
neither peptide was removed from consideration in the audit. The outputs in this and the preceding
example are unchanged by G/A filtering: they explain residual errors, not its measured improvement.</li>
<li><strong>Modification localization is not always identifiable.</strong> PXD037999 scan 55112
has adjacent methionines. Sage and Comet choose different oxidation sites, but explain exactly
the same 14 peaks and 24.73% of raw TIC, with no candidate-exclusive peak. Sage's delta_next is zero.
The spectrum supports the peptide more strongly than either precise localization.</li>
<li><strong>Engine disagreement does not make the independent engine right.</strong>
PXD037999 scan 49759 supports Sage (19 peaks, 24.59% of TIC), while also supporting a different
Comet peptide (15 peaks, 9.55%) on a separate set of fragments; coisolation is plausible here too.
Erwinia scan 6162 supports the TMT(Y) peptide identified by Sage and Mascot (28 peaks, 30.65% of TIC).
The closed Comet search omitted TMT(Y) and chose another peptide (22 peaks, 14.84%), despite q = 0.
Search-space differences matter.</li>
<li><strong>Weak evidence is enriched among residual misses.</strong> In the TMT-configured
cohort, the 6.45% of references with q &gt; 0.005 account for 38.9% of recall misses.
Recall failure is 50.6% with ≤6 matched fragments versus 1.91% otherwise. These overlapping
strata cannot be added. Weak spectra can defeat both search and tagging; this association does
not prove their references false.</li>
<li><strong>The configured tag alphabet is deliberately incomplete.</strong> Erwinia has 28
reference PSMs containing TMT(Y), a modification omitted from both tagger alphabets.
In the TMT-configured arm, four remain recall misses and ten are rank-1 misses.
The control reference also allows deamidation and N-terminal acetylation beyond the tagger's
variable modifications. These are benchmark-scope limitations, not parsed-reference corruption.</li>
<li><strong>Reference identity and source fields needed validation.</strong> Every TMT peptide
annotation reproduces Sage's calculated mass within 0.0015 Da; no reference scan is duplicated.
All 33,854 TMT references carry the N-terminal label and all 23,775 lysine sites carry TMT,
as expected from their fixed-modification searches. That selection cannot establish sample-wide labeling completeness.
Raw scan/charge/precursor joins were verified in the three audited files. The old Erwinia conversion
is the same acquisition but not byte-identical: all 6,103 scan IDs, charges and retention times match
within numerical precision, and all 26 selected benchmark spectra are exact peak-pair subsets of
the old conversion. Its evidence is corroborative, not an identical-input search.</li>
<li><strong>Native search metrics are not literal physical measurements.</strong> Sage v0.14.7
stores log10(PEP) in posterior_error and can count an observed peak's intensity for multiple
theoretical ions. Negative values and a reported intensity fraction above 100% were therefore not
treated as corruption. Our spectrum audit counts each raw peak once per peptide.
See the primary <a href="https://raw.githubusercontent.com/lazear/sage/v0.14.7/crates/sage/src/ml/linear_discriminant.rs">PEP implementation</a>
and <a href="https://raw.githubusercontent.com/lazear/sage/v0.14.7/crates/sage/src/scoring.rs">fragment scoring implementation</a>.</li>
<li><strong>Detection specificity and generalization remain limited.</strong> The expanded challenge
and mixed-file validation support the revised gate, but do not establish all acquisition modes,
low label fractions, or coisolated mixed chemistries. The original accuracy files were reused for
iteration; later results are exploratory rather than untouched held-out validation. No downstream
database-search identification benefit was measured.</li>
</ol>
<figure><img src="figures/truth_cases.svg" alt="Four raw-spectrum comparisons illustrating reference uncertainty">
<figcaption>The same raw spectrum is mirrored under two peptide assignments. These are selected
diagnostic examples, not an estimate of reference error prevalence. Erwinia was also checked at
its original 0.2-Da search tolerance. Full peaks, exclusive evidence, precursor/isotope residuals,
candidate q-values and alternative tag scores are in <a href="audit/spectrum_support.json">the spectrum audit</a>.</figcaption></figure>

<h2>Independent corroboration and sensitivity analysis</h2>
<p>Sage and Comet agree on 6,773 of 6,774 shared accepted sequences in PXD037999 and 9,543 of 9,548 in fr09
(I/L equivalent). Deposited Mascot agrees on 2,132 of 2,142 shared accepted Erwinia sequences.
Agreement between search engines is useful corroboration but can share database and modeling biases.</p>
<p>Restricting the two independent projects to 8,979 references with an accepted independent search
supporting the same modified peptide retains the benefit: +29 label-blind and +30 label-aware
correct rank-1 tags, zero paired losses and unchanged recall. The small full-cohort recall gains lie
outside the independently corroborated subset. This selected subset is supplementary; it does not
replace the original denominators. See <a href="audit/quality_subset_paired.tsv">exact subset counts</a>
and <a href="audit/failure_quality_strata.tsv">failure strata</a>.</p>

<h2>Runtime and reproducibility</h2>
<p>Median elapsed seconds from three runs per arm, eight threads, warm input cache, same lightly
loaded dax host. Times include input/output and automatic probing. Forced G/A filtering is shown
separately from automatic mode, which adds a bounded probing pass. The negative control's output is unchanged.</p>
''' + table(['File', 'Configuration', 'Baseline s', 'Forced on s', 'Automatic s', 'Δ s', 'Δ %'], runtime) + '''
<p>Each complete iteration comprises 9 file/chemistry cells × 4 arms × 3 repetitions = 108 executions.
The four arms are v1.13.1 baseline, new default/off, forced G/A on, and automatic G/A.
Final runtime measurements and accuracy reuse require the output-equivalence check described
above. The completed G/A-only benchmark passed repeat-output and default/baseline equality checks.
An <a href="provenance/independent-benchmark-audit-v2.json">independent audit</a>
also rehashed all 216 output files across both iterations and found no changed cells.
Raw outputs remain in the original
user-owned research directory on Ceph.</p>
<p>Settings: tag length 4, extension 0, one ordinary two-residue gap, cap 50, E ≤ 20 before a gap penalty of 100,
maximum 400 peaks, 10 per window, and 20-ppm fragment tolerance. Reference PSMs are frozen Sage rank-1
targets at spectrum q ≤ 0.01, excluding any entrapment/decoy protein mapping. PXD004541 fr02 is
development data; fr09 is within-project validation. PXD037999 and PXD000001 are independent
projects; PXD003531 is a label-free control. No reference label was changed.</p>
<pre>FASTag -in run.mzML -out tags.tsv -tmt_pseudo_filter auto

# For known TMT, configure its masses as usual:
# -fixed_modifications 'Carbamidomethyl (C)' 'TMT6plex (K)' 'TMT6plex (N-term)'
# -variable_modifications 'Oxidation (M)'
# Default remains off. Reporter filtering is separate and was not used.</pre>
<p>Artifacts: <a href="summary.tsv">metrics</a> · <a href="paired_changes.tsv">paired changes</a> ·
<a href="manifest.json">hashes/settings</a> · <a href="timings.jsonl">timing commands</a> ·
<a href="spectrum_outcomes.tsv.gz">per-spectrum outcomes</a> · <a href="iteration1/summary.tsv">iteration 1</a> ·
<a href="../../../doc/TMT-GA-ITERATION-PROTOCOL.txt">iteration protocol</a>.</p>
</html>'''
(root / 'report.html').write_text(report)
