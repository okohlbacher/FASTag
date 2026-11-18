#!/usr/bin/env python3
"""Collect the accuracy-1.15.0 numbers into one table (stdlib only).

Usage: summarize.py <acc dir>   (the run.sh output directory, /scratch/kohlbach/rsw-bench/acc)
Writes summary.tsv to stdout: one row per data set, truth and setting. rank1/top5/top50 are the
shares of truth spectra with at least one tag whose rank-1 / top-5 / top-50 tags include a valid
tag; any_valid is the share of all truth spectra with any valid tag (top 50).
"""
import csv
import re
import sys
from pathlib import Path

acc = Path(sys.argv[1])
out = csv.writer(sys.stdout, delimiter='\t', lineterminator='\n')
out.writerow(['dataset', 'truth', 'setting', 'scorer', 'truth_spectra', 'tagged',
              'rank1_pct', 'top5_pct', 'top50_pct', 'any_valid_pct'])

# 1. PXD000001, repository scorer (tools/pxd000001_truth.py)
for prof in ('matched', 'default', 'default_samplemods'):
    t = (acc / 'pxd000001' / prof / 'score.txt').read_text()
    n_gt, tagged = map(int, re.search(r'accepted-PSM spectra (\d+), with >=1 tag (\d+)', t).groups())
    pct = {k: float(re.search(rf'^{k}\s*:\s*\d+\s+\(([\d.]+)%\)', t, re.M).group(1))
           for k in ('rank-1', 'top-5', 'total')}
    anyv = float(re.search(r'any valid tag, all accepted-PSM spectra: \d+/\d+ \(([\d.]+)%\)', t).group(1))
    out.writerow(['PXD000001', 'Mascot (deposited, 1% FDR)', prof, 'tools/pxd000001_truth.py', n_gt, tagged,
                  f"{pct['rank-1']:.2f}", f"{pct['top-5']:.2f}", f"{pct['total']:.2f}", f'{anyv:.2f}'])

# 2. fastag-bench harness, flank rule, no control
for f in sorted((acc / 'results' / 'accuracy').glob('*/*_summary.tsv')):
    rows = [r for r in csv.DictReader((l for l in f.open() if not l.startswith('#')), delimiter='\t')
            if r['rule'] == 'flank' and r['control'] == 'none']
    for r in rows:
        truth = {'sage': 'Sage 0.14.7 (1% PSM FDR)', 'mascot': 'Mascot (deposited, 1% FDR)'}[r['truth']]
        out.writerow([r['pxd'], truth, r['profile'].replace('fastag_', ''), 'fastag-bench accuracy',
                      r['psm_spectra'], r['psm_spectra_tagged'],
                      *(f'{100 * float(r[k]):.2f}' for k in
                        ('top1_any_rate', 'top5_any_rate', 'top50_any_rate', 'any_tag_recall'))])
