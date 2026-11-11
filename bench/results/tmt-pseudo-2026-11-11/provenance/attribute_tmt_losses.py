#!/usr/bin/env python3
"""Read-only attribution of frozen baseline -> auto paper-recall losses."""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path('/scratch/kohlbach/fastag-tmt-filter-20261111')
sys.path.insert(0, str(ROOT / 'src' / 'bench'))
import tmt_pseudo_filter as B
import pandas as pd

L, W, G, A = 229.162932, 18.010564684, 57.021463735, 71.037113805

def rules(row, fixed):
    tokens = list(B.TOKEN.finditer(row.tag))
    first = tokens[0][1] if tokens and not tokens[0][2] else ''
    last = tokens[-1][1] if tokens and not tokens[-1][2] else ''
    if getattr(row, 'ion_series', 'by') != 'by':
        return []
    out = []
    for aa, mass in [('G', G), ('A', A)]:
        if abs(fixed.get(aa, 0)) > 1e-8:
            continue
        if first == aa and abs(row.nterm_mass - (L - mass)) <= .020:
            out.append('n_' + aa)
        if last == aa and abs(row.cterm_mass - (L - W - mass)) <= .006:
            out.append('c_' + aa)
    if last == 'K' and abs(fixed.get('K', 0)) <= 1e-8 and abs(row.cterm_mass - L) <= .006:
        out.append('c_K')
    return out

def selected_tags(path, keys):
    kept = []
    for part in pd.read_csv(path, sep='\t', dtype={'spectrum': str, 'tag': str}, keep_default_na=False, chunksize=100000):
        key = part.spectrum.map(B.P.spectrum_key)
        part = part.loc[key.isin(keys)].copy()
        if not part.empty:
            kept.append(part)
    if not kept:
        return pd.DataFrame()
    return B.P._add_rank(pd.concat(kept, ignore_index=True))

datasets = json.loads((ROOT / 'datasets.json').read_text())
if isinstance(datasets, dict):
    datasets = datasets['datasets']
outcomes = pd.read_csv(ROOT / 'results' / 'spectrum_outcomes.tsv.gz', sep='\t')
report = {'scope': 'all baseline-to-auto lost paper_flank any50 spectra, label_blind, rep1',
          'rounding_note': 'Rules evaluated on TSV flanks rounded to 4 decimals; all classified matches have margins reported.',
          'datasets': [], 'correct_tags': []}
for ds in datasets:
    chem = next((c for c in ds['chemistries'] if c['name'] == 'label_blind'), None)
    if chem is None:
        continue
    group = outcomes[(outcomes.dataset == ds['id']) & (outcomes.chemistry == 'label_blind') & (outcomes.rule == 'paper_flank')]
    base = group[group.arm == 'baseline'].set_index('key')
    auto = group[group.arm == 'auto'].set_index('key').reindex(base.index)
    lost = set(base.index[base.any50 & ~auto.any50])
    print(ds['id'], 'lost', len(lost), file=sys.stderr, flush=True)
    truth = B.load_truth(ds)
    folder = ROOT / 'results' / ds['id'] / 'label_blind'
    bt = selected_tags(folder / 'baseline' / 'rep1.tags.tsv', lost)
    at = selected_tags(folder / 'auto' / 'rep1.tags.tsv', lost)
    bm = B.S._mark(bt, truth, 'flank')
    am = B.S._mark(at, truth, 'flank') if not at.empty else pd.DataFrame(columns=['correct'])
    correct = bm[bm.correct & (bm['rank'] <= 50)]
    assert set(correct.key) == lost
    assert not am.correct.any()
    fixed = chem['fixed_masses']
    fixed_tuple = tuple(sorted((k, float(v)) for k,v in fixed.items() if k in B.S.RESIDUE_MASS))
    tag_rules, spectrum_rules = Counter(), {}
    strict_count = 0
    for row in correct.itertuples(index=False):
        matched = rules(row, fixed)
        label = '+'.join(matched) or 'unclassified'
        tag_rules[label] += 1
        spectrum_rules.setdefault(row.key, set()).update(matched or ['unclassified'])
        strict = bool(B.strict_correct(row.tag, float(row.nterm_mass), float(row.cterm_mass), row.peptide, fixed_tuple))
        strict_count += strict
        report['correct_tags'].append(dict(dataset=ds['id'], key=row.key, tag=row.tag, rank=int(row.rank),
            nterm_mass=float(row.nterm_mass), cterm_mass=float(row.cterm_mass), peptide=row.peptide,
            evalue=float(row.evalue), gapped=int(row.gapped), rules=label, strict_correct=strict,
            c_K_window_margin=.006-abs(float(row.cterm_mass)-L) if 'c_K' in matched else None))
    rec = dict(dataset=ds['id'], lost_spectra=len(lost), baseline_paper_correct_tags=len(correct),
               auto_paper_correct_tags=int(am.correct.sum()), baseline_strict_correct_tags=strict_count,
               tag_rule_counts=dict(tag_rules), spectrum_rule_union_counts=dict(Counter('+'.join(sorted(v)) for v in spectrum_rules.values())))
    report['datasets'].append(rec)
    print(json.dumps(rec), file=sys.stderr, flush=True)
report['total_lost_spectra'] = sum(r['lost_spectra'] for r in report['datasets'])
report['total_correct_tags'] = len(report['correct_tags'])
print(json.dumps(report, indent=2))
