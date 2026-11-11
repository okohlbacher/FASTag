#!/usr/bin/env python3
"""Render the frozen TMT experiment as a standalone HTML report."""
import argparse
import csv
import html
import json
from pathlib import Path

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('results', type=Path)
args = ap.parse_args()
root = args.results
rows = list(csv.DictReader((root / 'summary.tsv').open(), delimiter='\t'))
timings = [json.loads(line) for line in (root / 'timings.jsonl').read_text().splitlines()]
index = {(r['dataset'], r['chemistry'], r['rule'], r['arm']): r for r in rows}
cells = list(dict.fromkeys((r['dataset'], r['chemistry']) for r in rows))
escape = html.escape


def table(headers, body):
    return '<div class="table"><table><thead><tr>' + ''.join(
        '<th>' + escape(x) + '</th>' for x in headers
    ) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(
        '<td>' + escape(str(x)) + '</td>' for x in line
    ) + '</tr>' for line in body) + '</tbody></table></div>'


def accuracy(chemistry, rule='paper_flank'):
    body = []
    for dataset, chem in cells:
        if chem != chemistry:
            continue
        b = index[dataset, chem, rule, 'baseline']
        a = index[dataset, chem, rule, 'auto']
        n = int(b['psms'])
        body.append([dataset, f'{n:,}',
                     f"{100*float(b['recall50']):.3f} → {100*float(a['recall50']):.3f}",
                     f"{int(a['recall50_correct'])-int(b['recall50_correct']):+d}",
                     f"{100*float(b['rank1_accuracy']):.3f} → {100*float(a['rank1_accuracy']):.3f}",
                     f"{int(a['rank1_correct'])-int(b['rank1_correct']):+d}"])
    return table(['File', 'Reference PSMs', 'Recall@50 (%)', 'Δ correct', 'Rank-1 (%)', 'Δ correct'], body)


runtime = []
for dataset, chem in cells:
    b, on, a = [index[dataset, chem, 'paper_flank', arm] for arm in ['baseline', 'on', 'auto']]
    bv, av = float(b['wall_median_s']), float(a['wall_median_s'])
    runtime.append([dataset, chem, b['wall_median_s'], on['wall_median_s'],
                    a['wall_median_s'], f'{av-bv:+.3f}', f'{100*(av/bv-1):+.1f}%'])

detection = []
for record in timings:
    if record['rep'] == 1 and record['arm'] == 'auto':
        detection.append([record['dataset'], record['chemistry'],
                          ' | '.join(record['tmt_diagnostics'])])

report = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FASTag: automatic TMT detection and pseudo-tag filtering</title>
<style>
body{font:16px/1.55 system-ui,sans-serif;color:#182635;max-width:1180px;margin:36px auto;padding:0 24px}
h1{font-size:32px;line-height:1.2}h2{margin-top:2em;font-size:23px}h3{font-size:18px}
a{color:#076d9a}code,pre{font:13px/1.5 ui-monospace,monospace}pre{background:#f0f4f6;padding:18px;overflow:auto}
.lead{font-size:19px}.note{border-left:4px solid #b1761d;padding:10px 18px;background:#fff8ec}
img{width:100%;height:auto}figure{margin:24px 0}figcaption{font-size:14px;color:#526271}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:16px 0}
th,td{text-align:left;border-bottom:1px solid #dbe1e6;padding:9px 11px;vertical-align:top}
th{background:#edf3f6}td:last-child{font-variant-numeric:tabular-nums}.small{font-size:14px;color:#526271}
</style><h1>Automatic TMT detection works in these files; filtering helps when the label masses are configured</h1>
<p class="small">FASTag feature experiment · 11 November 2026 · branch <code>feat/tmt-pseudo-tag-filter</code> · implementation <code>7eadc4e</code></p>
<p class="lead">The detector activated on all four TMT6/10 files and abstained on the label-free control.
With TMT specified in the residue masses, automatic filtering improved rank-1 accuracy in every TMT file,
with no paired losses of correct rank-1 calls or recall. Recall itself was essentially unchanged.
With TMT omitted, the paper's existing correctness metric showed recall losses in every TMT file
and rank-1 losses in both independent validation projects.</p>
<p class="note"><strong>Recommendation:</strong> keep this feature experimental and off by default.
Use the filter with known TMT chemistry when cleaner top-ranked tags are the objective.
Automatic detection currently switches filtering on; it does <strong>not</strong> add TMT modifications
to the tagger's residue alphabet. Detecting a label and modeling its mass are separate operations.</p>

<h2>Independent validation is the decisive comparison</h2>
<p>PXD037999 and PXD000001 contribute 10,912 reference PSMs. With TMT specified,
rank-1 accuracy rose from <strong>81.562% to 82.093%</strong> (+58 correct calls, +0.532 percentage points).
Recall@50 stayed at <strong>94.630%</strong> (10,326 correct spectra).
With TMT omitted, rank-1 accuracy fell from <strong>82.203% to 81.928%</strong> (−30),
and recall fell from <strong>95.115% to 94.529%</strong> (−64).</p>
<p>Across all four TMT files, including the development file and a second file from its project,
TMT-specified rank-1 accuracy rose 86.971% → 87.532% (+190); recall changed
97.643% → 97.649% (+2). These 33,854 PSMs are a descriptive pooled result,
not four independent project replications.</p>

<h2>Primary metric: sequence plus a correct flank</h2>
<p>A tag or its reverse must match the reference sequence (I/L equivalent) and have at least one
correct flank at that same placement, within 0.05 Da. Recall@50 asks whether any of the first 50 tags
is correct; rank-1 accuracy asks whether the first tag is correct. All reference PSMs remain in the
denominator, including spectra with no tag. Tables compare baseline → automatic narrow filtering.</p>
<h3>TMT specified in both baseline and filtered runs</h3>
''' + accuracy('label_aware') + '''
<h3>TMT omitted in both baseline and filtered runs</h3>
''' + accuracy('label_blind') + '''
<figure><img src="figures/paper_flank.svg" alt="Changes in recall and rank-1 accuracy under the primary sequence-and-flank metric">
<figcaption>Changes relative to the same chemistry configuration. Blue: automatic narrow filter.
Purple: automatic filter plus reporter-endpoint removal. fr02 generated the hypotheses;
fr09 is within-project validation. No confidence intervals are shown: these are exact paired changes
in fixed reference sets, and the experiment has only two independent validation projects.</figcaption></figure>

<h2>Why can a chemically suspicious tag still count as correct?</h2>
<p>Consider a peptide ending in TMT-labeled lysine. A tag ending in bare K can have the correct amino-acid
sequence and correct N flank while placing the missing 229.162932 Da label in its C gap.
The paper metric accepts it. The filter's bare-K rule deletes it.
For example, the synthetic peptide <code>[+229.162932]-AGPEPK[+229.162932]</code>
admits <code>PEPK</code> with N gap 357.221510 Da and C gap 229.162932 Da:
sequence and N placement are right, but the tag assigns no modification to K.</p>
<p>An independent audit of every lost-recall spectrum found that <strong>all 124 losses
were caused by the bare-K rule, none by the G/A rules</strong> (35 fr02, 55 PXD037999,
9 Erwinia, 25 fr09). Each had exactly one paper-correct baseline tag, which failed strict
residue-mass correctness. For a real example, fr02 scan 8236 has reference
<code>[+229.16293]-VTGGAASK[+229.16293]</code>; the deleted rank-10 tag
<code>AASK</code> has N gap 543.3225 Da and C gap 229.1628 Da.
The net recall change is −121 after three newly recalled spectra.
<a href="provenance/lost-recall-attribution.json">All 124 cases and their rule assignments</a>
are retained. Preserving or reannotating these terminal K tags is the next refinement to test;
a G/A-only counterfactual has not been benchmarked here.</p>
<p>The supplementary <strong>strict residue-mass metric</strong> additionally requires every tag
residue's fixed-plus-variable mass to match the reference within 0.02 Da.
With TMT omitted, automatic filtering increased strict rank-1 accuracy on the two independent files
from 78.904% to 81.662% (+301), with no strict paired losses; strict recall changed by only +1.
This is improved chemical consistency, not evidence that the primary recall loss disappeared.</p>
<figure><img src="figures/strict_mass.svg" alt="Changes when each residue mass must also be correct">
<figcaption>Supplementary metric, defined before scoring. All four TMT files together:
strict rank-1 +533 with TMT omitted, versus primary rank-1 +33 and primary recall −121.</figcaption></figure>

<h2>What was implemented</h2>
<p>The detector uses a deterministic probe of up to 1,024 eligible MS2 spectra spread across the input,
four-residue ungapped tags and E ≤ 1 evidence. It counts distinct spectra, not tag rows.
Let L = 229.162932 Da, W = 18.010565 Da, and K = 128.094963 Da.</p>
<pre>probe = four-residue, ungapped tags from sampled MS2 spectra
eligible = spectra with at least one qualifying tag
N_evidence = spectra with n ≈ L       or c ≈ L − W
K_evidence = spectra with c ≈ K + L   or n ≈ K + L + W
threshold = max(20, ceil(0.01 × count(eligible)))
activate only if count(eligible) ≥ 100 and both evidence counts ≥ threshold
abstain if analogous TMTpro evidence passes, or tolerance is specified in Da

for each scored candidate, before deduplication and the top-50 cap:
    reject BY tags with unmodified G/A at a matching TMT-split boundary:
        first G/A and n ≈ L − residue_mass
        last  G/A and c ≈ L − W − residue_mass
    reject BY tags ending in bare K with c ≈ L
        (disabled when K has a fixed shift; variable-modified K is protected)
    optionally reject charge-1 BY tags whose c + W + proton is a TMT reporter
retain candidate scores and E-values; refill output slots from remaining tags</pre>
<p>N-flank windows are ±0.020 Da and C-flank windows ±0.006 Da. Ordinary residue flanks,
TMT-plus-residue flanks, and a-ion counterparts are not broadly removed.
The detector does not use reporter ions, which are shared with other isobaric labels.
The full frozen specification is in
<a href="../../../doc/TMT-PSEUDO-FILTER-PROTOCOL.txt">TMT-PSEUDO-FILTER-PROTOCOL.txt</a>.
The 229.162932 Da modification is documented by
<a href="https://www.unimod.org/modifications_view.php?editid1=737">Unimod 737</a>;
the label mass differs from the approximately 126–131 m/z reporter ions.</p>

<h2>Detection and runtime</h2>
<p>All automatic decisions were identical across three repetitions and both chemistry configurations.
Automatic and forced-on outputs were byte-identical on every TMT file.
Automatic output, including the reporter option, was byte-identical to baseline on the label-free
control (8,254 PSMs; recall 93.930%, rank-1 67.095%). This small control set does not establish
general detection sensitivity or specificity.</p>
''' + table(['File', 'Chemistry', 'Probe diagnostic'], detection) + '''
<p>Median elapsed seconds from three serial runs, eight threads on <code>dax</code>, warm file cache;
times include reading, detection, tagging and writing. Forced filtering alone cost approximately zero.
Automatic detection added 0.133–0.244 s on the TMT files: about 8–11% for the larger runs,
but 55% for the short Erwinia run. The label-free control added 0.384 s (12.2%).</p>
''' + table(['File', 'Chemistry', 'Baseline (s)', 'Forced on (s)', 'Automatic (s)', 'Δ s', 'Δ %'], runtime) + '''

<h2>Reporter-endpoint option</h2>
<p>The separately benchmarked reporter filter gave small additional gains. On the two independent
TMT-specified files it added another 17 correct rank-1 calls and one recalled spectrum over the narrow
filter, bringing rank-1 to 82.249% (+75 versus baseline) and recall to 94.639% (+1).
It can leave additional spectra without output, but no correct primary or strict calls were lost
in the TMT-specified reference sets. It did not resolve the primary recall losses with TMT omitted.
All counts, including tag-output coverage, are retained in <a href="summary.tsv">summary.tsv</a>.</p>

<h2>Scope and reproducibility</h2>
<p>The hypotheses and thresholds were frozen before scoring. fr02 from PXD004541 was development data;
fr09 is another file from that project. PXD037999 and PXD000001 are independent project validation;
PXD003531 is the label-free control. Reference PSMs are Sage rank-1 targets at spectrum q ≤ 0.01,
with entrapment and decoy protein assignments excluded. These references are not error-free truth
and do not measure performance on unidentified spectra.</p>
<p>Every comparison holds spectra, truth and chemistry configuration fixed. Tag length 4, extension 0,
one ordinary two-residue gap, maximum 50 tags, E ≤ 20 before gap penalty 100, maximum 400 peaks,
10 peaks per window and 20 ppm fragment tolerance were used. TMT files retained their cysteine
treatment and variable methionine oxidation. Erwinia truth also allows TMT on Y; this was omitted
from both tagger arms. The control tagger uses oxidation and phosphorylation; its frozen truth also
allows deamidation and N-terminal acetylation. Neither asymmetry changes between arms.</p>
<p>The five arms were baseline v1.13.1, new binary default/off, forced on, automatic,
and automatic plus reporters: nine file/chemistry cells × five arms × three repetitions = 135 runs.
All completed successfully and repeated outputs were identical. All nine default/off outputs matched
baseline byte-for-byte. An independent audit rehashed every output and rechecked paired scoring.
Code checks passed: 85 tests, four optional skips; GUI typecheck and 25 parameter tests also passed.</p>
<p>Only these high-resolution files, length 4 and no extension were benchmarked. There is no empirical
TMTpro, mixed-label, partially labeled or low-resolution negative-control validation here.
The TMTpro abstention path has unit coverage, not a measured dataset-level specificity estimate.
Do not generalize to arbitrary acquisition modes or claim a downstream peptide-search improvement.</p>
<pre># Example: known TMT with automatic evidence-gated filtering
FASTag -in run.mzML -out tags.tsv \\
  -fixed_modifications 'Carbamidomethyl (C)' 'TMT6plex (K)' 'TMT6plex (N-term)' \\
  -variable_modifications 'Oxidation (M)' -tmt_pseudo_filter auto

# Add -tmt_reporter_filter for the separately benchmarked reporter rule.
# Use -tmt_pseudo_filter on for known chemistry without the detection prepass.
# Default is off. Automatic mode requires seekable mzML/MGF input.</pre>
<p>Artifacts: <a href="summary.tsv">all metrics</a> · <a href="paired_changes.tsv">paired gains/losses</a> ·
<a href="spectrum_outcomes.tsv.gz">per-spectrum outcomes</a> · <a href="timings.jsonl">commands and timings</a> ·
<a href="manifest.json">input, truth, binary and scorer hashes</a> ·
<a href="provenance/independent-validation.json">independent output audit</a> ·
<a href="provenance/build-and-validation.json">build and test record</a>.</p>
<p>Raw outputs and run logs are retained at <code>/ceph/ibmi/abi/oliver/fastag-tmt-filter-20261111/results</code>;
input spectra, frozen reference tables and Sage configurations at
<code>/ceph/ibmi/abi/oliver/fastag-tmt-filter-benchmark-20261111</code>.
Run <code>bench/tmt_pseudo_filter.py</code> with the manifest's dataset and binary paths to reproduce;
the original command vectors are in the timing file.
Regenerate these plots with <code>python bench/plot_tmt_pseudo.py RESULTS</code> and this report with
<code>python bench/report_tmt_pseudo.py RESULTS</code>.</p></html>'''
(root / 'report.html').write_text(report)
